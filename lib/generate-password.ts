import { randomBytes } from "node:crypto";

const PASSWORD_CHARSET =
  "0123456789";
const DEFAULT_PASSWORD_LENGTH = 8;

/**
 * Cryptographically strong, unbiased temporary password.
 *
 * Uses rejection sampling instead of `byte % charset.length` so every character
 * in the charset is equally likely (plain modulo over 256 favours the first
 * 256 % 10 = 6 characters).
 */
export function generatePassword(length = DEFAULT_PASSWORD_LENGTH): string {
  const charsetLength = PASSWORD_CHARSET.length;
  // Largest multiple of charsetLength that fits in a byte; values at or above
  // this limit are rejected and re-drawn.
  const limit = Math.floor(256 / charsetLength) * charsetLength;

  let password = "";
  while (password.length < length) {
    const bytes = randomBytes(length);
    for (let i = 0; i < bytes.length && password.length < length; i++) {
      const byte = bytes[i];
      if (byte >= limit) {
        continue;
      }
      password += PASSWORD_CHARSET[byte % charsetLength];
    }
  }

  return password;
}
