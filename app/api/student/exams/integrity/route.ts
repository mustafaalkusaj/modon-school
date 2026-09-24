import { NextRequest, NextResponse } from "next/server";
import { resolveStudentContext, unauthorized } from "@/lib/student-api";

/**
 * Web equivalent of app/api/mobile/student/exams/integrity/route.ts —
 * logs exam-taking integrity events (tab switches, focus loss, copy/paste)
 * against exam_integrity_logs so the web exam-taking flow has the same
 * anti-cheating signal the mobile app already records.
 */

const VALID_EVENT_TYPES = [
  "app_switch",
  "tab_change",
  "screenshot_attempt",
  "copy_paste",
  "focus_lost",
];

export async function POST(req: NextRequest) {
  const ctx = await resolveStudentContext(req);
  if (!ctx) return unauthorized();

  const { supabase, schoolId, studentId } = ctx;

  const body = await req.json().catch(() => null);
  const attemptId: string | undefined = body?.attemptId ?? body?.attempt_id;
  const rawEventType: string | undefined = body?.eventType ?? body?.event_type;

  if (!attemptId || !rawEventType) {
    return NextResponse.json(
      { ok: false, error: "missing_fields" },
      { status: 400 },
    );
  }

  const eventType = String(rawEventType).trim().toLowerCase();
  if (!VALID_EVENT_TYPES.includes(eventType)) {
    return NextResponse.json(
      { ok: false, error: "invalid_event_type" },
      { status: 400 },
    );
  }

  const { data: attempt, error: attemptError } = await supabase
    .from("exam_attempts")
    .select("id, exam_id, student_id")
    .eq("id", attemptId)
    .eq("student_id", studentId)
    .eq("school_id", schoolId)
    .maybeSingle();

  if (attemptError || !attempt) {
    return NextResponse.json(
      { ok: false, error: "attempt_not_found" },
      { status: 404 },
    );
  }

  const attemptRow = attempt as { id: string; exam_id: string };

  const metadata = body.metadata ?? null;
  if (metadata !== null) {
    const isPlainObject =
      typeof metadata === "object" && !Array.isArray(metadata);
    if (!isPlainObject || JSON.stringify(metadata).length > 5000) {
      return NextResponse.json(
        { ok: false, error: "invalid_metadata" },
        { status: 400 },
      );
    }
  }

  const { data, error } = await supabase
    .from("exam_integrity_logs")
    .insert({
      attempt_id: attemptRow.id,
      exam_id: attemptRow.exam_id,
      student_id: studentId,
      school_id: schoolId,
      event_type: eventType,
      metadata,
    })
    .select("id, event_type, created_at")
    .single();

  if (error) {
    return NextResponse.json(
      { ok: false, error: "log_failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, data });
}
