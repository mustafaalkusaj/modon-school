import { createServiceSupabaseClient } from "@/lib/supabase-server";

import { getManagedLoginLocalPart, toManagedAuthEmail } from "./auth-email";

/**
 * Resolves what the user typed into the Supabase Auth email to sign in with.
 *
 * - Real emails are returned untouched.
 * - Managed identifiers (with or without the @schoolapp.local suffix) are looked
 *   up in managed_user_credentials so accounts created under any historical
 *   ASCII mapping still sign in; otherwise the canonical ASCII email is used.
 */
export async function resolveManagedSignInEmail(typed: string) {
  const trimmed = typed.trim();
  const identifier = getManagedLoginLocalPart(trimmed) ?? (trimmed.includes("@") ? null : trimmed);
  if (identifier === null) return trimmed;

  const fallbackEmail = toManagedAuthEmail(identifier);
  try {
    const serviceClient = createServiceSupabaseClient();
    const { data: credRow } = await serviceClient
      .from("managed_user_credentials")
      .select("auth_user_id")
      .in("login_identifier", Array.from(new Set([identifier, identifier.toLowerCase()])))
      .limit(1)
      .maybeSingle();
    if (!credRow?.auth_user_id) return fallbackEmail;

    const { data: authUser } = await serviceClient.auth.admin.getUserById(credRow.auth_user_id);
    return authUser?.user?.email ?? fallbackEmail;
  } catch {
    return fallbackEmail;
  }
}
