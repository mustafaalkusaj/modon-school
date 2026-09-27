import { NextRequest, NextResponse } from "next/server";
import { resolveTeacherContext, unauthorized } from "@/lib/teacher-api";
import { sendTeacherBroadcast } from "@/lib/mobile-api-server";
import { enforceRateLimit } from "@/lib/rate-limit";

/** POST — send a notification to the teacher's own students (class, section or one student). */
export async function POST(req: NextRequest) {
  const ctx = await resolveTeacherContext(req);
  if (!ctx) return unauthorized();

  const limited = await enforceRateLimit(req, {
    namespace: "mobile-teacher-broadcast",
    windowMs: 60 * 60_000,
    maxHits: 30,
    identifier: ctx.userId,
  });
  if (limited) return limited;

  const payload = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const result = await sendTeacherBroadcast(ctx.mobile, {
    title: payload.title,
    message: payload.message,
    class_name: payload.class_name,
    section: payload.section,
    student_id: payload.student_id,
  });

  return NextResponse.json(
    { ok: result.ok, message: result.message, data: result.data ?? null },
    { status: result.ok ? 200 : 400 },
  );
}

export async function GET(req: NextRequest) {
  const ctx = await resolveTeacherContext(req);
  if (!ctx) return unauthorized();

  const { supabase, userId, schoolId } = ctx;

  const { data, error } = await supabase
    .from("notifications")
    .select("id, title, message, type, is_read, link, created_at")
    .eq("user_id", userId)
    .eq("school_id", schoolId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    return NextResponse.json(
      { ok: false, error: "fetch_failed" },
      { status: 500 },
    );
  }

  /* Page expects `body` not `message` */
  const mapped = (data ?? []).map((n: Record<string, unknown>) => ({
    id: n.id,
    title: n.title,
    body: n.message ?? null,
    created_at: n.created_at,
    is_read: n.is_read,
  }));

  return NextResponse.json({ ok: true, data: mapped });
}

export async function PATCH(req: NextRequest) {
  const ctx = await resolveTeacherContext(req);
  if (!ctx) return unauthorized();

  const { supabase, userId, schoolId } = ctx;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_json" },
      { status: 400 },
    );
  }

  const id = body.id as string | undefined;
  const isRead = body.is_read as boolean | undefined;

  if (!id || typeof isRead !== "boolean") {
    return NextResponse.json(
      { ok: false, error: "missing_id_or_is_read" },
      { status: 400 },
    );
  }

  const { error } = await supabase
    .from("notifications")
    .update({ is_read: isRead })
    .eq("id", id)
    .eq("user_id", userId)
    .eq("school_id", schoolId);

  if (error) {
    return NextResponse.json(
      { ok: false, error: "update_failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, data: { id, is_read: isRead } });
}
