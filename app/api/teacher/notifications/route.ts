import { NextRequest, NextResponse } from "next/server";
import { sendTeacherBroadcast } from "@/lib/mobile-api-server";
import { enforceRateLimit } from "@/lib/rate-limit";
import {
  resolveTeacherAppContext,
  resolveTeacherContext,
  unauthorized,
} from "@/lib/teacher-api";

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

/**
 * Send a notification to the teacher's own students (a whole class, one
 * section, or a single student). Recipients are resolved server-side from the
 * teacher's assigned roster — the same path the mobile teacher app uses.
 */
export async function POST(req: NextRequest) {
  const ctx = await resolveTeacherContext(req);
  if (!ctx) return unauthorized();

  const limited = await enforceRateLimit(req, {
    namespace: "web-teacher-broadcast",
    windowMs: 60 * 60_000,
    maxHits: 30,
    identifier: ctx.userId,
  });
  if (limited) return limited;

  const app = await resolveTeacherAppContext(ctx);
  if (!app?.account.teacher) return unauthorized();

  // ctx.teacherId is not always teachers.id in this portal; the app context's
  // teacher.id is.
  const { data: teacherRow } = await ctx.supabase
    .from("teachers")
    .select("messaging_paused")
    .eq("id", app.account.teacher.id)
    .eq("school_id", ctx.schoolId)
    .maybeSingle();
  if (teacherRow?.messaging_paused) {
    return NextResponse.json(
      { ok: false, error: "تم إيقاف الإرسال لحسابك مؤقتاً من قبل الإدارة." },
      { status: 403 },
    );
  }

  const payload = ((await req.json().catch(() => null)) ?? {}) as Record<
    string,
    unknown
  >;
  const result = await sendTeacherBroadcast(app, {
    title: payload.title,
    message: payload.message,
    class_name: payload.class_name,
    section: payload.section,
    student_id: payload.student_id,
  });

  return NextResponse.json(
    {
      ok: result.ok,
      error: result.ok ? undefined : result.message,
      message: result.message,
      data: result.data ?? null,
    },
    { status: result.ok ? 200 : 400 },
  );
}
