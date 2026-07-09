/**
 * Scheduled SFTP Import Service
 *
 * Manages scheduled_imports configs, encrypts SFTP credentials (AES-256-GCM
 * with a key derived from SEED_SECRET/SESSION_SECRET), and runs a node-cron
 * loop that picks up matching files from SFTP servers and imports them.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import cron from "node-cron";
import SftpClient from "ssh2-sftp-client";
import { db } from "../db";
import { eq, and } from "drizzle-orm";
import { scheduledImports, type ScheduledImport } from "@shared/schema";
import {
  parseImportFile,
  validateData,
  executeImport,
  hashFile,
  isDuplicateFile,
  detectPeriodFromFilename,
  recordSkippedRun,
  createImportNotification,
} from "./dataImportService";
import { getDataset } from "@shared/importRegistry";

// ── Credential encryption ────────────────────────────────────────────

function getKey(): Buffer {
  const secret = process.env.SEED_SECRET || process.env.SESSION_SECRET;
  if (!secret) throw new Error("SEED_SECRET or SESSION_SECRET must be set to encrypt SFTP credentials");
  return createHash("sha256").update(`sftp-credentials:${secret}`).digest();
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${enc.toString("base64")}`;
}

export function decryptSecret(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split(".");
  const decipher = createDecipheriv("aes-256-gcm", getKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf-8");
}

// ── Wildcard matching ────────────────────────────────────────────────

export function wildcardToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}

// ── CRUD helpers ─────────────────────────────────────────────────────

export async function listSchedules(clientId: string): Promise<Omit<ScheduledImport, "encryptedPassword">[]> {
  const rows = await db.select().from(scheduledImports).where(eq(scheduledImports.clientId, clientId));
  return rows.map(({ encryptedPassword, ...rest }) => ({ ...rest, hasPassword: !!encryptedPassword }) as any);
}

export async function createSchedule(clientId: string, data: any): Promise<ScheduledImport> {
  const { password, ...rest } = data;
  const [row] = await db.insert(scheduledImports).values({
    ...rest,
    clientId,
    encryptedPassword: password ? encryptSecret(password) : null,
  }).returning();
  return row;
}

export async function updateSchedule(clientId: string, id: string, data: any): Promise<ScheduledImport | undefined> {
  const { password, ...rest } = data;
  const set: any = { ...rest, updatedAt: new Date() };
  if (password) set.encryptedPassword = encryptSecret(password);
  const [row] = await db.update(scheduledImports)
    .set(set)
    .where(and(eq(scheduledImports.id, id), eq(scheduledImports.clientId, clientId)))
    .returning();
  return row;
}

export async function deleteSchedule(clientId: string, id: string): Promise<void> {
  await db.delete(scheduledImports).where(and(eq(scheduledImports.id, id), eq(scheduledImports.clientId, clientId)));
}

// ── Schedule matching ────────────────────────────────────────────────

function isDue(schedule: ScheduledImport, now: Date): boolean {
  const [hh, mm] = (schedule.scheduleTime || "06:00").split(":").map(Number);
  if (now.getHours() !== hh || now.getMinutes() !== mm) return false;
  if (schedule.frequency === "weekly") {
    return now.getDay() === (schedule.dayOfWeek ?? 1);
  }
  if (schedule.frequency === "monthly") {
    return now.getDate() === (schedule.dayOfMonth ?? 1);
  }
  return true; // daily
}

// ── SFTP run ─────────────────────────────────────────────────────────

export async function runScheduledImport(schedule: ScheduledImport): Promise<{ status: string; message: string }> {
  const clientId = schedule.clientId;
  const dataset = getDataset(schedule.datasetType);
  if (!dataset) return finishRun(schedule, "failed", `Unknown dataset type: ${schedule.datasetType}`);

  const sftp = new SftpClient();
  let password: string;
  try {
    if (!schedule.encryptedPassword) throw new Error("No password configured");
    password = decryptSecret(schedule.encryptedPassword);
  } catch (err) {
    return finishRun(schedule, "failed", `Credential error: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    await sftp.connect({
      host: schedule.host,
      port: schedule.port || 22,
      username: schedule.username,
      password,
      readyTimeout: 20000,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await createImportNotification(clientId, null, "error", `SFTP connection failed: ${schedule.name}`,
      `Could not connect to ${schedule.host}:${schedule.port} — ${msg}. Check host, credentials and firewall.`);
    return finishRun(schedule, "failed", `Connection/auth failed: ${msg}`);
  }

  try {
    let fileList;
    try {
      fileList = await sftp.list(schedule.remotePath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await createImportNotification(clientId, null, "error", `SFTP path error: ${schedule.name}`,
        `Could not read directory "${schedule.remotePath}" on ${schedule.host} — ${msg}.`);
      return finishRun(schedule, "failed", `Remote path error: ${msg}`);
    }

    const regex = wildcardToRegex(schedule.filePattern || "*");
    const matches = fileList.filter((f) => f.type === "-" && regex.test(f.name));
    if (matches.length === 0) {
      await createImportNotification(clientId, null, "warning", `No files found: ${schedule.name}`,
        `No files matching "${schedule.filePattern}" were found in ${schedule.remotePath} on ${schedule.host}.`);
      return finishRun(schedule, "no_files", `No files matching ${schedule.filePattern}`);
    }

    const results: string[] = [];
    let anyImported = false;
    let anyFailed = false;

    for (const file of matches) {
      const remoteFile = `${schedule.remotePath.replace(/\/$/, "")}/${file.name}`;
      let buffer: Buffer;
      try {
        buffer = (await sftp.get(remoteFile)) as Buffer;
      } catch (err) {
        // Locked or unreadable file
        const msg = err instanceof Error ? err.message : String(err);
        anyFailed = true;
        results.push(`${file.name}: download failed (${msg})`);
        await recordSkippedRun({ clientId, datasetId: schedule.datasetType, fileName: file.name, fileHash: null, source: "sftp", scheduledImportId: schedule.id, status: "failed", errorMessage: `Download failed (possibly locked): ${msg}` });
        continue;
      }

      const fileHash = hashFile(buffer);
      if (await isDuplicateFile(clientId, schedule.datasetType, fileHash)) {
        results.push(`${file.name}: already imported (duplicate), skipped`);
        await recordSkippedRun({ clientId, datasetId: schedule.datasetType, fileName: file.name, fileHash, source: "sftp", scheduledImportId: schedule.id, status: "skipped_duplicate" });
        continue;
      }

      try {
        const { headers, rows } = parseImportFile(buffer, file.name);
        const validation = validateData(schedule.datasetType, headers, rows, file.name);
        let period = validation.detectedPeriod;
        let periodSource = validation.periodSource as "column" | "filename" | null;
        if (!period) {
          period = detectPeriodFromFilename(dataset, file.name);
          periodSource = period ? "filename" : null;
        }
        if (!period) {
          anyFailed = true;
          results.push(`${file.name}: could not determine period`);
          await recordSkippedRun({ clientId, datasetId: schedule.datasetType, fileName: file.name, fileHash, source: "sftp", scheduledImportId: schedule.id, status: "failed", errorMessage: "Could not determine reporting period from file contents or filename" });
          continue;
        }
        const run = await executeImport({
          clientId,
          datasetId: schedule.datasetType,
          fileName: file.name,
          fileHash,
          source: "sftp",
          scheduledImportId: schedule.id,
          period,
          periodSource: periodSource || "filename",
          mode: dataset.replacesPeriod ? "replace_period" : "append",
          validation,
        });
        if (run.status === "imported" || run.status === "partial") {
          anyImported = true;
          results.push(`${file.name}: ${run.insertedRows} rows imported (${run.status})`);
          if (schedule.deleteAfterImport) {
            try { await sftp.delete(remoteFile); } catch { /* non-fatal */ }
          }
        } else {
          anyFailed = true;
          results.push(`${file.name}: ${run.status} — ${run.errorMessage || ""}`);
        }
      } catch (err) {
        anyFailed = true;
        const msg = err instanceof Error ? err.message : String(err);
        results.push(`${file.name}: ${msg}`);
        await recordSkippedRun({ clientId, datasetId: schedule.datasetType, fileName: file.name, fileHash, source: "sftp", scheduledImportId: schedule.id, status: "failed", errorMessage: msg });
      }
    }

    const status = anyImported && anyFailed ? "partial" : anyImported ? "success" : anyFailed ? "failed" : "skipped_duplicate";
    return finishRun(schedule, status, results.join("; "));
  } finally {
    await sftp.end().catch(() => {});
  }
}

async function finishRun(schedule: ScheduledImport, status: string, message: string): Promise<{ status: string; message: string }> {
  await db.update(scheduledImports).set({
    lastRunAt: new Date(),
    lastRunStatus: status,
    lastRunMessage: message.substring(0, 2000),
    updatedAt: new Date(),
  }).where(eq(scheduledImports.id, schedule.id));
  console.log(`[ScheduledImport] ${schedule.name} (${schedule.id}): ${status} — ${message}`);
  return { status, message };
}

// ── Cron loop ────────────────────────────────────────────────────────

let started = false;
const running = new Set<string>();

export function startScheduledImportLoop(): void {
  if (started) return;
  started = true;
  // Check every minute which schedules are due
  cron.schedule("* * * * *", async () => {
    const now = new Date();
    try {
      const schedules = await db.select().from(scheduledImports).where(eq(scheduledImports.enabled, true));
      for (const schedule of schedules) {
        if (!isDue(schedule, now)) continue;
        if (running.has(schedule.id)) continue; // prevent overlap
        running.add(schedule.id);
        runScheduledImport(schedule)
          .catch((err) => console.error(`[ScheduledImport] ${schedule.name} crashed:`, err))
          .finally(() => running.delete(schedule.id));
      }
    } catch (err) {
      console.error("[ScheduledImport] Scheduler tick failed:", err);
    }
  });
  console.log("[ScheduledImport] SFTP import scheduler started (checks every minute)");
}
