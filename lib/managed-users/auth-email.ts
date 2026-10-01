export const MANAGED_AUTH_EMAIL_DOMAIN = "schoolapp.local";

const MANAGED_AUTH_EMAIL_SUFFIX = `@${MANAGED_AUTH_EMAIL_DOMAIN}`;

// Supabase Auth rejects non-ASCII emails, but managed login identifiers start
// with an Arabic prefix (ط = student, م = teacher). Map them to ASCII for auth.
const ARABIC_PREFIX_MAP: Record<string, string> = { "ط": "st", "م": "tc" };

function toAsciiLocalPart(value: string) {
  return value
    .trim()
    .replace(/[^\x00-\x7F]/g, (ch) => ARABIC_PREFIX_MAP[ch] ?? "u")
    .replace(/[^A-Za-z0-9._+-]/g, "");
}

/** Returns the identifier part of a managed email, or null for any other value. */
export function getManagedLoginLocalPart(email: string) {
  const trimmed = email.trim();
  return trimmed.toLowerCase().endsWith(MANAGED_AUTH_EMAIL_SUFFIX)
    ? trimmed.slice(0, -MANAGED_AUTH_EMAIL_SUFFIX.length)
    : null;
}

/**
 * Builds the Supabase Auth email for a managed login identifier.
 * Real emails (other than the managed domain) are returned untouched.
 */
export function toManagedAuthEmail(identifier: string) {
  const trimmed = identifier.trim();
  const localPart = getManagedLoginLocalPart(trimmed);
  if (localPart === null && trimmed.includes("@")) return trimmed;
  return `${toAsciiLocalPart(localPart ?? trimmed)}${MANAGED_AUTH_EMAIL_SUFFIX}`;
}
