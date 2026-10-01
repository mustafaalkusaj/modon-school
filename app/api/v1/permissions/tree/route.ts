import { NextRequest, NextResponse } from "next/server";
import { resolveSchoolScopedActorContext } from "@/lib/managed-users-server";
import { createServiceSupabaseClient } from "@/lib/supabase-server";
import { loadPermissionTree } from "@/lib/authorization/deep-permissions";
import { jsonError } from "@/lib/route-utils";

/** GET /api/v1/permissions/tree — full modules→pages→definitions tree for matrix UI */
export async function GET(req: NextRequest) {
  const context = await resolveSchoolScopedActorContext(
    null,
    { allowedRoles: ["admin", "super_admin"], roleDeniedMessage: "غير مصرح" },
    req.headers.get("authorization"),
  );
  if (!context.ok) {
    return jsonError(
      "message" in context ? context.message : "غير مصرح",
      "status" in context ? context.status : 403,
    );
  }

  const service = createServiceSupabaseClient();

  try {
    const tree = await loadPermissionTree(service);
    return NextResponse.json(
      { ok: true, tree },
      {
        headers: {
          // Auth-gated, tenant-specific: a shared CDN must never be able to
          // serve one tenant's permission tree to another.
          "Cache-Control": "private, no-store",
        },
      },
    );
  } catch {
    return jsonError("تعذر تحميل شجرة الصلاحيات", 500);
  }
}
