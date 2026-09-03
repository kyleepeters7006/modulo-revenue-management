import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { request as httpsRequest } from "node:https";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

export const PRODUCTION_SYNC_TABLES = [
  "locations",
  "room_type_groupings",
  "care_level_rates",
  "adjustment_rules",
  "rent_roll_data",
  "rent_roll_history",
  "competitive_survey_data",
  "room_type_occupancy_history",
  "move_in_out_events",
  "guardrails",
  "pricing_weights",
  "targets_and_trends",
  "assumptions",
  "manual_rate_overrides",
  "upload_history",
] as const;

export const PRODUCTION_SYNC_REPLACE_TABLES = PRODUCTION_SYNC_TABLES.filter(
  (table): table is Exclude<typeof table, "locations"> => table !== "locations",
);

// Locations are merged so production-only records that reference them survive.
// The remaining imported tables are replaced, plus the computed AI outcome rows
// that directly reference rent-roll records.
export const PRODUCTION_SYNC_CLEAR_TABLES = [
  ...PRODUCTION_SYNC_REPLACE_TABLES,
  "ai_rate_outcomes",
] as const;

export const MAX_PRODUCTION_SYNC_BYTES = 1024 * 1024 * 1024;
export const PRODUCTION_SYNC_MAX_AGE_MS = 5 * 60 * 1000;
export const PRODUCTION_SYNC_RECEIVER_PATH = "/api/admin/receive-production-sync";
export const PRODUCTION_SYNC_TABLESET_VERSION = "2026-09-03-v1";

const SIGNATURE_VERSION = "modulo-production-sync-v1";

export interface ProductionSyncAuth {
  timestamp: number;
  nonce: string;
  size: number;
  sha256: string;
  signature: string;
}

function signaturePayload(auth: Omit<ProductionSyncAuth, "signature">): string {
  return [
    SIGNATURE_VERSION,
    "POST",
    PRODUCTION_SYNC_RECEIVER_PATH,
    PRODUCTION_SYNC_TABLESET_VERSION,
    PRODUCTION_SYNC_TABLES.join(","),
    auth.timestamp,
    auth.nonce,
    auth.size,
    auth.sha256.toLowerCase(),
  ].join("\n");
}

export function createProductionSyncAuth(
  secret: string,
  size: number,
  sha256: string,
  now = Date.now(),
  nonce = randomUUID(),
): ProductionSyncAuth {
  const unsigned = { timestamp: now, nonce, size, sha256: sha256.toLowerCase() };
  return {
    ...unsigned,
    signature: createHmac("sha256", secret).update(signaturePayload(unsigned)).digest("hex"),
  };
}

export function verifyProductionSyncAuth(
  secret: string,
  auth: ProductionSyncAuth,
  now = Date.now(),
): { ok: true } | { ok: false; error: string } {
  if (!Number.isSafeInteger(auth.timestamp) || Math.abs(now - auth.timestamp) > PRODUCTION_SYNC_MAX_AGE_MS) {
    return { ok: false, error: "Sync authorization has expired" };
  }
  if (!/^[a-f0-9-]{20,80}$/i.test(auth.nonce)) {
    return { ok: false, error: "Invalid sync nonce" };
  }
  if (!Number.isSafeInteger(auth.size) || auth.size <= 0 || auth.size > MAX_PRODUCTION_SYNC_BYTES) {
    return { ok: false, error: "Invalid sync archive size" };
  }
  if (!/^[a-f0-9]{64}$/i.test(auth.sha256) || !/^[a-f0-9]{64}$/i.test(auth.signature)) {
    return { ok: false, error: "Invalid sync digest" };
  }

  const expected = createHmac("sha256", secret)
    .update(signaturePayload({
      timestamp: auth.timestamp,
      nonce: auth.nonce,
      size: auth.size,
      sha256: auth.sha256,
    }))
    .digest();
  const supplied = Buffer.from(auth.signature, "hex");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return { ok: false, error: "Invalid sync signature" };
  }
  return { ok: true };
}

export function assertManagedPostgresCliEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): void {
  const required = ["PGHOST", "PGPORT", "PGUSER", "PGPASSWORD", "PGDATABASE"] as const;
  const missing = required.filter((key) => !env[key]);
  if (missing.length) {
    throw new Error(`Managed PostgreSQL CLI environment is missing: ${missing.join(", ")}`);
  }
}

export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk as Buffer);
  }
  return hash.digest("hex");
}

export async function receiveSyncArchive(
  source: NodeJS.ReadableStream,
  destinationPath: string,
  expectedSize: number,
): Promise<{ size: number; sha256: string }> {
  let size = 0;
  const hash = createHash("sha256");
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length;
      if (size > expectedSize || size > MAX_PRODUCTION_SYNC_BYTES) {
        callback(new Error("Sync archive exceeded its declared size"));
        return;
      }
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  await pipeline(source, meter, createWriteStream(destinationPath, { flags: "wx", mode: 0o600 }));
  return { size, sha256: hash.digest("hex") };
}

export function assertAllowedProductionSyncArchive(listOutput: string): void {
  const found = new Set<string>();
  for (const rawLine of listOutput.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(";")) continue;
    const tableData = line.match(/^\d+;\s+\d+\s+\d+\s+TABLE DATA\s+(\S+)\s+(\S+)\s+/);
    if (tableData) {
      const [, schema, table] = tableData;
      if (schema !== "public" || !PRODUCTION_SYNC_TABLES.includes(table as typeof PRODUCTION_SYNC_TABLES[number])) {
        throw new Error(`Sync archive contains an unapproved table: ${schema}.${table}`);
      }
      if (found.has(table)) {
        throw new Error(`Sync archive contains duplicate table data: ${schema}.${table}`);
      }
      found.add(table);
      continue;
    }
    throw new Error(`Sync archive contains an unexpected entry type`);
  }

  const missing = PRODUCTION_SYNC_TABLES.filter((table) => !found.has(table));
  if (missing.length) {
    throw new Error(`Sync archive is missing required tables: ${missing.join(", ")}`);
  }
}

export async function postProductionSyncArchive(
  productionBaseUrl: string,
  archivePath: string,
  auth: ProductionSyncAuth,
): Promise<{ statusCode: number; body: string }> {
  const target = new URL(PRODUCTION_SYNC_RECEIVER_PATH, productionBaseUrl);
  if (target.protocol !== "https:" || target.username || target.password) {
    throw new Error("PRODUCTION_APP_URL must be a credential-free HTTPS URL");
  }

  return new Promise((resolve, reject) => {
    const req = httpsRequest(target, {
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
        "content-length": String(auth.size),
        "x-sync-size": String(auth.size),
        "x-sync-timestamp": String(auth.timestamp),
        "x-sync-nonce": auth.nonce,
        "x-sync-sha256": auth.sha256,
        "x-sync-signature": auth.signature,
      },
    }, (response) => {
      const chunks: Buffer[] = [];
      let responseBytes = 0;
      response.on("data", (chunk: Buffer) => {
        responseBytes += chunk.length;
        if (responseBytes <= 1024 * 1024) chunks.push(chunk);
      });
      response.on("end", () => {
        resolve({
          statusCode: response.statusCode || 500,
          body: Buffer.concat(chunks).toString("utf8"),
        });
      });
    });
    req.setTimeout(12 * 60 * 1000, () => req.destroy(new Error("Production sync request timed out")));
    req.on("error", reject);
    createReadStream(archivePath).on("error", reject).pipe(req);
  });
}