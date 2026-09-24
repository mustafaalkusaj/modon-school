import { NextRequest, NextResponse } from "next/server";
import { resolveSchoolScopedActorContext } from "@/lib/managed-users-server";
import { enforceRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const VALID_SCOPES = ["school", "branch", "class", "role", "user"] as const;

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: { message } }, { status });
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const context = await resolveSchoolScopedActorContext(
    searchParams.get("schoolId"),
    { allowedRoles: ["admin", "super_admin"], roleDeniedMessage: "ليس لديك صلاحية عرض الإشعارات المجدولة." },
    request.headers.get("authorization"),
  );
  if (!context.ok) return jsonError(context.message, context.status);

  const { actorSupabase, targetSchoolId } = context.value;
  const status = searchParams.get("status") ?? "pending";

  const { data, error } = await (actorSupabase
    .from("scheduled_notifications") as ReturnType<typeof actorSupabase.from>)
    .select("*")
    .eq("school_id", targetSchoolId)
    .eq("status", status)
    .order("scheduled_at", { ascending: true })
    .limit(50);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, data: data ?? [] });
}

export async function POST(request: NextRequest) {
  const context = await resolveSchoolScopedActorContext(
    null,
    { allowedRoles: ["admin", "super_admin"], roleDeniedMessage: "ليس لديك صلاحية جدولة الإشعارات." },
    request.headers.get("authorization"),
  );
  if (!context.ok) return jsonError(context.message, context.status);

  const { actorSupabase, actorUserId, targetSchoolId, actorBranchId } = context.value;

  const rateLimited = await enforceRateLimit(request, {
    namespace: "notifications-schedule",
    windowMs: 60_000,
    maxHits: 10,
    identifier: actorUserId,
  });
  if (rateLimited) return rateLimited;

  const body = await request.json().catch(() => null);
  if (!body) return jsonError("invalid body", 400);

  const title = typeof body.title === "string" ? body.title.trim() : "";
  const message = typeof body.message === "string" ? body.message.trim() : "";
  const scope = body.target?.scope as string | undefined;
  const targetValue = body.target?.value as string | undefined;
  const scheduledAt = typeof body.scheduled_at === "string" ? body.scheduled_at.trim() : "";

  if (!title || !message || !scope || !VALID_SCOPES.includes(scope as typeof VALID_SCOPES[number]) || !scheduledAt) {
    return jsonError("title, message, target.scope, and scheduled_at are required", 400);
  }

  const scheduledDate = new Date(scheduledAt);
  if (isNaN(scheduledDate.getTime()) || scheduledDate.getTime() <= Date.now()) {
    return jsonError("scheduled_at must be a valid future date", 400);
  }

  const { data, error } = await (actorSupabase
    .from("scheduled_notifications") as ReturnType<typeof actorSupabase.from>)
    .insert({
      school_id: targetSchoolId,
      branch_id: scope === "branch" ? targetValue ?? actorBranchId ?? null : actorBranchId ?? null,
      created_by: actorUserId,
      title,
      message,
      type: typeof body.type === "string" && body.type.trim() ? body.type.trim() : "general",
      link: typeof body.link === "string" && body.link.trim() ? body.link.trim() : null,
      target_scope: scope,
      target_value: targetValue ?? null,
      scheduled_at: scheduledDate.toISOString(),
    })
    .select("id, title, scheduled_at, status")
    .single();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, data }, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const id = searchParams.get("id");
  if (!id) return jsonError("id is required", 400);

  const context = await resolveSchoolScopedActorContext(
    null,
    { allowedRoles: ["admin", "super_admin"], roleDeniedMessage: "ليس لديك صلاحية حذف الإشعارات المجدولة." },
    request.headers.get("authorization"),
  );
  if (!context.ok) return jsonError(context.message, context.status);

  const { actorSupabase, targetSchoolId } = context.value;

  const { error } = await (actorSupabase
    .from("scheduled_notifications") as ReturnType<typeof actorSupabase.from>)
    .update({ status: "cancelled" })
    .eq("id", id)
    .eq("school_id", targetSchoolId)
    .eq("status", "pending");

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
