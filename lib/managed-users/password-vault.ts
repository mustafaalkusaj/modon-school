import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

/**
 * Encrypts temporary passwords before they are stored in
 * managed_user_credentials.temporary_password_plain, so the account-card
 * pages can still print them while the database (and its backups) only hold
 * ciphertext.
 *
 * Key: TEMP_PASSWORD_ENCRYPTION_KEY = 32 random bytes, base64
 *   (generate with: openssl rand -base64 32)
 *
 * Format: "enc:v1:<iv b64>:<tag b64>:<ciphertext b64>" (AES-256-GCM).
 * Values without the prefix are legacy plaintext and are returned as-is until
 * scripts/encrypt-temp-passwords.mjs has rewritten them.
 */
const PREFIX = "enc:v1:";

function readKey(): Buffer | null {
  const raw = process.env.TEMP_PASSWORD_ENCRYPTION_KEY?.trim();
  if (!raw) return null;
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("TEMP_PASSWORD_ENCRYPTION_KEY must be 32 bytes (base64).");
  }
  return key;
}

/**
 * Returns the value to store. Without a key nothing is stored (null), so a
 * missing env var never falls back to writing plaintext; the password is still
 * shown once in the create/reset response.
 */
export function sealTemporaryPassword(password: string | null | undefined): string | null {
  if (!password) return null;
  const key = readKey();
  if (!key) {
    console.warn("[password-vault] TEMP_PASSWORD_ENCRYPTION_KEY is not set; temporary password not stored.");
    return null;
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(password, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${ciphertext.toString("base64")}`;
}

/** Returns the printable password, or "" when it cannot be recovered. */
export function openTemporaryPassword(stored: string | null | undefined): string {
  if (!stored) return "";
  if (!stored.startsWith(PREFIX)) return stored; // legacy plaintext row
  const key = readKey();
  if (!key) return "";
  try {
    const [ivB64, tagB64, dataB64] = stored.slice(PREFIX.length).split(":");
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return "";
  }
}
