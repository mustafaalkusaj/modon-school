/**
 * Shared helpers for signing homework attachment/submission downloads from
 * the `school-media` private bucket over the web (RBAC-cookie) session.
 *
 * This mirrors the permission model already enforced by the mobile route
 * `app/api/mobile/shared/storage/download-url` but is re-implemented against
 * the web session because mobile authenticates via a raw Supabase Auth
 * bearer token while the web app authenticates via the RBAC session cookie
 * (see lib/rbac-session.ts) — the two contexts do not share a request path.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export const HOMEWORK_BUCKET = "school-media";

export function isValidHomeworkPath(schoolId: string, path: string) {
  const schoolPrefix = `${schoolId}/`;
  return Boolean(path) && path.startsWith(schoolPrefix) && !path.includes("..");
}

export async function createHomeworkSignedDownloadUrl(
  supabase: SupabaseClient,
  path: string,
  downloadName?: string | null,
) {
  return supabase.storage
    .from(HOMEWORK_BUCKET)
    .createSignedUrl(path, 15 * 60, downloadName ? { download: downloadName } : undefined);
}
