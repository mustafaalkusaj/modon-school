import { NextRequest, NextResponse } from "next/server";

import { z } from "zod";

import { resolveMobileRouteContext } from "@/lib/mobile-api-server";
import { enforceRateLimit } from "@/lib/rate-limit";

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

export async function POST(req: NextRequest) {
  try {
    const context = await resolveMobileRouteContext(req, "student");
    if (context.ok === false) {
      return context.response;
    }

    const {
      schoolId,
      account,
      authUserId,
      serviceSupabase: supabase,
    } = context.value;

    const limited = await enforceRateLimit(req, {
      namespace: "mobile-exam-integrity",
      windowMs: 60_000,
      maxHits: 60,
      identifier: authUserId,
    });
    if (limited) return limited;

    const studentId = account.student?.id;

    if (!studentId) {
      return NextResponse.json(
        { ok: false, error: { message: "لم يتم العثور على بيانات الطالب." } },
        { status: 400 },
      );
    }

    const body = await req.json().catch(() => null);
    // Mobile sends snake_case (attempt_id / event_type); accept camelCase too.
    const attemptId: string | undefined = body?.attempt_id ?? body?.attemptId;
    const rawEventType: string | undefined =
      body?.event_type ?? body?.eventType;
    if (!attemptId || !rawEventType) {
      return NextResponse.json(
        { ok: false, error: { message: "attempt_id و event_type مطلوبان." } },
        { status: 400 },
      );
    }

    let validatedMetadata: Record<string, unknown> | null = null;
    if (body?.metadata != null) {
      const metaParsed = metadataSchema.safeParse(body.metadata);
      if (!metaParsed.success) {
        return NextResponse.json(
          {
            ok: false,
            error: { message: "بيانات الحدث الإضافية غير صالحة." },
          },
          { status: 400 },
        );
      }
      validatedMetadata = metaParsed.data;
    }

    const eventType = String(rawEventType).trim().toLowerCase();
    if (!VALID_EVENT_TYPES.includes(eventType)) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            message: `نوع الحدث غير صالح. الأنواع المسموحة: ${VALID_EVENT_TYPES.join(", ")}`,
          },
        },
        { status: 400 },
      );
    }

    // Verify attempt belongs to this student
    const { data: attempt, error: attemptError } = await supabase
      .from("exam_attempts")
      .select("id, exam_id, student_id")
      .eq("id", attemptId)
      .eq("student_id", studentId)
      .single();

    if (attemptError || !attempt) {
      return NextResponse.json(
        { ok: false, error: { message: "المحاولة غير موجودة." } },
        { status: 404 },
      );
    }

    const attemptRow = attempt as { id: string; exam_id: string };

    // Insert integrity log
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
        { ok: false, error: { message: "internal_error" } },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      logged: true,
      item: data,
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "internal_error" },
      { status: 500 },
    );
  }
}
