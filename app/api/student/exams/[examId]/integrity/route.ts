import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { enforceRateLimit } from "@/lib/rate-limit";
import { resolveStudentContext, unauthorized } from "@/lib/student-api";

const VALID_EVENT_TYPES = [
  "app_switch",
  "tab_change",
  "screenshot_attempt",
  "copy_paste",
  "focus_lost",
];

const metadataSchema = z
  .record(z.string(), z.unknown())
  .refine((obj) => Object.keys(obj).length <= 20, {
    message: "metadata must have at most 20 keys",
  })
  .refine((obj) => JSON.stringify(obj).length <= 10000, {
    message: "metadata JSON must be under 10000 characters",
  });

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ examId: string }> },
) {
  const ctx = await resolveStudentContext(req);
  if (!ctx) return unauthorized();

  const rlResponse = await enforceRateLimit(req, {
    namespace: "student-exam-integrity",
    windowMs: 60_000,
    maxHits: 20,
    identifier: ctx.studentId,
  });
  if (rlResponse) return rlResponse;

  const { examId } = await params;
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
    .eq("exam_id", examId)
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

  let validatedMetadata: Record<string, unknown> | null = null;
  if (body?.metadata != null) {
    const metaParsed = metadataSchema.safeParse(body.metadata);
    if (!metaParsed.success) {
      return NextResponse.json(
        {
          ok: false,
          error: "invalid_metadata",
          details: metaParsed.error.issues.map((i) => i.message),
        },
        { status: 400 },
      );
    }
    validatedMetadata = metaParsed.data;
  }

  const { data, error } = await supabase
    .from("exam_integrity_logs")
    .insert({
      attempt_id: attemptRow.id,
      exam_id: attemptRow.exam_id,
      student_id: studentId,
      school_id: schoolId,
      event_type: eventType,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      metadata: validatedMetadata as any,
    })
    .select("id, event_type, created_at")
    .single();

  if (error) {
    return NextResponse.json(
      { ok: false, error: "internal_error" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, data });
}
