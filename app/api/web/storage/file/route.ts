import { NextRequest, NextResponse } from "next/server";

import { resolveSchoolScopedActorContext } from "@/lib/managed-users-server";
import { isPrivateWebBucket } from "@/lib/protected-storage-url";
import { enforceRateLimit } from "@/lib/rate-limit";
import { createServiceSupabaseClient } from "@/lib/supabase-server";

const FINANCIAL_BUCKETS = new Set(["financial-receipts"]);
const ALLOWED_ROLES = ["super_admin", "admin", "employee"] as const;

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: { message } }, { status });
}

export async function GET(req: NextRequest) {
  const bucket = req.nextUrl.searchParams.get("bucket")?.trim() ?? "";
  const path = req.nextUrl.searchParams.get("path")?.trim() ?? "";
  const schoolId = path.split("/", 1)[0] ?? "";

  if (
    !isPrivateWebBucket(bucket) ||
    !schoolId ||
    path.length > 1024 ||
    path.startsWith("/") ||
    path.includes("..") ||
    path.includes("\\")
  ) {
    return jsonError("مسار الملف غير صالح.", 400);
  }

  const context = await resolveSchoolScopedActorContext(
    schoolId,
    {
      allowedRoles: [...ALLOWED_ROLES],
      roleDeniedMessage: "ليس لديك صلاحية فتح هذا الملف.",
    },
    req.headers.get("authorization"),
  );
  if (!context.ok) {
    return jsonError(context.message, context.status);
  }

  if (
    FINANCIAL_BUCKETS.has(bucket) &&
    !["super_admin", "admin"].includes(context.value.actorRole)
  ) {
    return jsonError("ليس لديك صلاحية فتح هذا المستند المالي.", 403);
  }

  const limited = await enforceRateLimit(req, {
    namespace: "protected-storage-file",
    windowMs: 60_000,
    maxHits: 180,
    identifier: context.value.actorUserId,
  });
  if (limited) return limited;

  const serviceSupabase = createServiceSupabaseClient();
  const { data, error } = await serviceSupabase.storage
    .from(bucket)
    .createSignedUrl(path, 60);
  if (error || !data?.signedUrl) {
    return jsonError("تعذر فتح الملف.", 404);
  }

  const response = NextResponse.redirect(data.signedUrl, 307);
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
