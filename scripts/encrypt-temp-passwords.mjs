#!/usr/bin/env node
/**
 * One-time: encrypt legacy plaintext rows in
 * managed_user_credentials.temporary_password_plain (same format as
 * lib/managed-users/password-vault.ts). Safe to re-run; encrypted rows are
 * skipped.
 *
 * Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY),
 *      TEMP_PASSWORD_ENCRYPTION_KEY (same value as the deployed app).
 *
 *   node --env-file=.env.local scripts/encrypt-temp-passwords.mjs          # dry run
 *   node --env-file=.env.local scripts/encrypt-temp-passwords.mjs --apply
 */
import { createCipheriv, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const EXPECTED_REF = "ynrfvdrbwmxmnazjezmo";
const PREFIX = "enc:v1:";
const apply = process.argv.includes("--apply");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
const serviceKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const rawKey = process.env.TEMP_PASSWORD_ENCRYPTION_KEY?.trim() || "";

if (!url.includes(EXPECTED_REF)) {
  console.error(`Refusing to run: Supabase URL is not project ${EXPECTED_REF}.`);
  process.exit(1);
}
if (!serviceKey) {
  console.error("SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) is required.");
  process.exit(1);
}
const key = Buffer.from(rawKey, "base64");
if (key.length !== 32) {
  console.error("TEMP_PASSWORD_ENCRYPTION_KEY must be 32 bytes, base64 (openssl rand -base64 32).");
  process.exit(1);
}

function seal(password) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(password, "utf8"), cipher.final()]);
  return `${PREFIX}${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${data.toString("base64")}`;
}

const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });
const PAGE = 500;
let from = 0;
let pending = 0;
let updated = 0;

for (;;) {
  const { data, error } = await supabase
    .from("managed_user_credentials")
    .select("auth_user_id, temporary_password_plain")
    .not("temporary_password_plain", "is", null)
    .order("auth_user_id")
    .range(from, from + PAGE - 1);
  if (error) throw error;
  if (!data?.length) break;

  for (const row of data) {
    if (row.temporary_password_plain.startsWith(PREFIX)) continue;
    pending++;
    if (!apply) continue;
    const { error: updateError } = await supabase
      .from("managed_user_credentials")
      .update({ temporary_password_plain: seal(row.temporary_password_plain) })
      .eq("auth_user_id", row.auth_user_id)
      .eq("temporary_password_plain", row.temporary_password_plain);
    if (updateError) throw updateError;
    updated++;
  }
  from += PAGE;
}

console.log(apply ? `Encrypted ${updated} of ${pending} plaintext rows.` : `Dry run: ${pending} plaintext rows would be encrypted. Re-run with --apply.`);
