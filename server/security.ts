import crypto from "node:crypto";
import bcrypt from "bcryptjs";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const MFA_ALGORITHM = "aes-256-gcm";

function encryptionKey(): Buffer {
  return crypto.createHash("sha256")
    .update(process.env.MFA_ENCRYPTION_SECRET || process.env.SESSION_SECRET || "modulo-development-secret")
    .digest();
}

export function encryptSecret(value: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(MFA_ALGORITHM, encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map(part => part.toString("base64url")).join(".");
}

export function decryptSecret(value: string): string {
  const [ivText, tagText, encryptedText] = value.split(".");
  if (!ivText || !tagText || !encryptedText) throw new Error("Invalid encrypted secret");
  const decipher = crypto.createDecipheriv(
    MFA_ALGORITHM,
    encryptionKey(),
    Buffer.from(ivText, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedText, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function createTotpSecret(): string {
  const bytes = crypto.randomBytes(20);
  let value = "";
  let buffer = 0;
  let bits = 0;
  for (let index = 0; index < bytes.length; index++) {
    const byte = bytes[index];
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      value += BASE32[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) value += BASE32[(buffer << (5 - bits)) & 31];
  return value;
}

function decodeBase32(value: string): Buffer {
  const normalized = value.toUpperCase().replace(/[\s=-]/g, "");
  let buffer = 0;
  let bits = 0;
  const output: number[] = [];
  for (const char of normalized) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error("Invalid TOTP secret");
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((buffer >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

export function totpCode(secret: string, timestamp = Date.now()): { code: string; step: number } {
  const step = Math.floor(timestamp / 30_000);
  const counter = Buffer.alloc(8);
  counter.writeBigInt64BE(BigInt(step));
  const digest = crypto.createHmac("sha1", decodeBase32(secret)).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const number = ((digest[offset] & 0x7f) << 24)
    | (digest[offset + 1] << 16)
    | (digest[offset + 2] << 8)
    | digest[offset + 3];
  return { code: String(number % 1_000_000).padStart(6, "0"), step };
}

export function verifyTotp(
  secret: string,
  suppliedCode: string,
  lastUsedStep: number | null = null,
  timestamp = Date.now(),
): number | null {
  const normalized = String(suppliedCode || "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(normalized)) return null;
  const currentStep = Math.floor(timestamp / 30_000);
  for (const delta of [-1, 0, 1]) {
    const step = currentStep + delta;
    if (lastUsedStep !== null && step <= lastUsedStep) continue;
    const expected = totpCode(secret, step * 30_000).code;
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(normalized))) return step;
  }
  return null;
}

export function createRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => {
    const raw = crypto.randomBytes(5).toString("hex").toUpperCase();
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}

export async function hashRecoveryCode(code: string): Promise<string> {
  return bcrypt.hash(code.replace(/[^A-Za-z0-9]/g, "").toUpperCase(), 12);
}

export async function compareRecoveryCode(code: string, hash: string): Promise<boolean> {
  return bcrypt.compare(code.replace(/[^A-Za-z0-9]/g, "").toUpperCase(), hash);
}

export function randomSecurityToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export class ProgressiveThrottle {
  private readonly failures = new Map<string, { count: number; until: number; lastFailure: number }>();

  recordFailure(key: string): number {
    const current = this.failures.get(key);
    const now = Date.now();
    const count = current && now - current.lastFailure <= 15 * 60_000
      ? current.count + 1
      : 1;
    const delay = Math.min(15 * 60_000, 250 * 2 ** Math.min(count - 1, 10));
    this.failures.set(key, { count, until: now + delay, lastFailure: now });
    return delay;
  }

  isBlocked(key: string): boolean {
    const current = this.failures.get(key);
    if (!current) return false;
    return current.until > Date.now();
  }

  clear(key: string): void {
    this.failures.delete(key);
  }
}