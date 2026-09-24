import { NextRequest, NextResponse } from "next/server";
import { resolveSchoolScopedActorContext } from "@/lib/managed-users-server";
import { createServiceSupabaseClient } from "@/lib/supabase-server";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: { message } }, { status });
}

const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 50;

/**
 * GET /api/web/fee-notifications — recent fee notifications for the dashboard
 * activity feed.
 *
 * Shares the item shape of /api/web/teacher-activity/{messages,homework}:
 * { id, title, createdAt, status }. The dashboard merges all three sources
 * into a single timeline, so the keys must line up exactly.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;

  const context = await resolveSchoolScopedActorContext(
    searchParams.get("schoolId"),
    {
      allowedRoles: ["admin", "super_admin"],
      roleDeniedMessage: "ليس لديك صلاحية عرض إشعارات الأقساط.",
    },
    request.headers.get("authorization"),
  );

  if (!context.ok) {
    return jsonError(context.message, context.status);
  }

  const { targetSchoolId } = context.value;

  const parsedPageSize = Number.parseInt(searchParams.get("pageSize") ?? "", 10);
  const pageSize = Number.isFinite(parsedPageSize)
    ? Math.min(Math.max(parsedPageSize, 1), MAX_PAGE_SIZE)
    : DEFAULT_PAGE_SIZE;

  const branchId = searchParams.get("branchId");

  const serviceClient = createServiceSupabaseClient();

  let query = serviceClient
    .from("fee_notifications")
    .select("id, title, message, created_at, failed_count")
    .eq("school_id", targetSchoolId)
    .order("created_at", { ascending: false })
    .limit(pageSize);

  // A branch-scoped dashboard should not surface another branch's notices.
  // Rows with no branch_id are school-wide, so they stay visible either way.
  if (branchId) {
    query = query.or(`branch_id.eq.${branchId},branch_id.is.null`);
  }

  const { data, error } = await query;

  if (error) {
    return jsonError(error.message, 500);
  }

  const items = (data ?? []).map((row) => ({
    id: row.id,
    title: row.title || row.message || "إشعار قسط",
    createdAt: row.created_at,
    // Rendered as a badge in the feed; a delivery failure is the only state
    // worth flagging to an admin at a glance.
    status: (row.failed_count ?? 0) > 0 ? "failed" : "sent",
  }));

  return NextResponse.json(
    { ok: true, items, totalCount: items.length },
    { headers: { "Cache-Control": "private, no-store, max-age=0" } },
  );
}
