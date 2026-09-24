import { NextRequest, NextResponse } from "next/server";
import { resolveSchoolScopedActorContext } from "@/lib/managed-users-server";

export const dynamic = "force-dynamic";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: { message } }, { status });
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const context = await resolveSchoolScopedActorContext(
    searchParams.get("schoolId"),
    { allowedRoles: ["admin", "super_admin"], roleDeniedMessage: "ليس لديك صلاحية عرض إحصائيات الإشعارات." },
    request.headers.get("authorization"),
  );
  if (!context.ok) return jsonError(context.message, context.status);

  const { actorSupabase, targetSchoolId } = context.value;
  const days = Math.min(Number(searchParams.get("days")) || 30, 90);
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  const [totalRes, byTypeRes, byStatusRes, recentRes] = await Promise.all([
    actorSupabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("school_id", targetSchoolId)
      .gte("created_at", since),

    actorSupabase
      .from("notifications")
      .select("type")
      .eq("school_id", targetSchoolId)
      .gte("created_at", since),

    actorSupabase
      .from("notifications")
      .select("status")
      .eq("school_id", targetSchoolId)
      .gte("created_at", since),

    actorSupabase
      .from("notifications")
      .select("id, title, type, status, created_at")
      .eq("school_id", targetSchoolId)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  const total = totalRes.count ?? 0;

  const byType: Record<string, number> = {};
  for (const row of (byTypeRes.data ?? []) as Array<{ type: string | null }>) {
    const t = row.type ?? "unknown";
    byType[t] = (byType[t] ?? 0) + 1;
  }

  const byStatus: Record<string, number> = {};
  for (const row of (byStatusRes.data ?? []) as Array<{ status: string | null }>) {
    const s = row.status ?? "unknown";
    byStatus[s] = (byStatus[s] ?? 0) + 1;
  }

  return NextResponse.json({
    ok: true,
    period_days: days,
    total,
    by_type: byType,
    by_status: byStatus,
    recent: recentRes.data ?? [],
  });
}
