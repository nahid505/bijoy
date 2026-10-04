// Encryption of stored SMS API keys (AES-256-GCM). The key comes from the server environment:
// SMS_ENCRYPTION_KEY if set, otherwise derived from AUTH_SECRET with HKDF. Ciphertexts are
// "v1:<iv>:<tag>:<data>" (base64url); tampering makes decryption fail.
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

function masterKey(info: string): Buffer {
  const base = process.env.SMS_ENCRYPTION_KEY || process.env.AUTH_SECRET;
  if (!base || base.length < 32) throw new Error("SMS_ENCRYPTION_KEY or AUTH_SECRET (min 32 chars) must be set");
  return Buffer.from(hkdfSync("sha256", base, "bijoy-lenden", info, 32));
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey("sms-api-key"), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(":");
}

export function decryptSecret(stored: string | null | undefined): string | null {
  if (!stored) return null;
  const [v, iv, tag, data] = stored.split(":");
  if (v !== "v1" || !iv || !tag || !data) return null;
  try {
    const d = createDecipheriv("aes-256-gcm", masterKey("sms-api-key"), Buffer.from(iv, "base64url"));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([d.update(Buffer.from(data, "base64url")), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export const secretHint = (plain: string) => (plain.length <= 4 ? "••••" : `••••${plain.slice(-4)}`);

/** Keyed hash for one-time codes (never stored in plain text). */
export function otpHash(purpose: string, mobile: string, code: string): string {
  return createHmac("sha256", masterKey("otp")).update(`${purpose}:${mobile}:${code}`).digest("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
