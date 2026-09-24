import { NextRequest, NextResponse } from "next/server";
import { resolveStudentContext, unauthorized } from "@/lib/student-api";
import { normalizeClassKey } from "@/lib/mobile-api-server";

/** Terminal attempt status written by the submit and teacher-grade routes. */
const ATTEMPT_STATUS_GRADED = "graded";

/**
 * Single-exam detail for the web student exam-taking page.
 *
 * Mirrors app/api/mobile/student/exams/[examId]/route.ts: entitlement is
 * school + class scoped, and questions/answer keys are never returned here —
 * only the start route hands out the (answer-stripped) question set, matching
 * mobile's flow of "detail for the landing screen, questions only after
 * starting an attempt".
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ examId: string }> },
) {
  const ctx = await resolveStudentContext(req);
  if (!ctx) return unauthorized();

  const { supabase, schoolId, studentId, className } = ctx;
  const { examId } = await params;

  const { data: exam, error: examError } = await supabase
    .from("exams")
    .select(
      "id, school_id, title, type, subject, class_name, total_marks, starts_at, ends_at, created_at",
    )
    .eq("id", examId)
    .eq("school_id", schoolId)
    .maybeSingle();

  if (examError) {
    return NextResponse.json(
      { ok: false, error: "internal_error" },
      { status: 500 },
    );
  }
  if (!exam) {
    return NextResponse.json(
      { ok: false, error: "exam_not_found" },
      { status: 404 },
    );
  }

  const examRow = exam as {
    id: string;
    school_id: string;
    title: string;
    type: string | null;
    subject: string | null;
    class_name: string | null;
    total_marks: number | null;
    starts_at: string | null;
    ends_at: string | null;
    created_at: string | null;
  };

  // Class entitlement: same normalized-key comparison as mobile. A
  // class-less student is DENIED for a class-targeted exam (fail closed).
  if (examRow.class_name) {
    const studentClassKey = className ? normalizeClassKey(className) : null;
    if (
      !studentClassKey ||
      studentClassKey !== normalizeClassKey(examRow.class_name)
    ) {
      return NextResponse.json(
        { ok: false, error: "class_mismatch" },
        { status: 403 },
      );
    }
  }

  const [settingsResult, attemptsResult] = await Promise.all([
    supabase
      .from("exam_settings")
      .select(
        "exam_id, max_attempts, shuffle_questions, duration_minutes, auto_submit, lock_browser, shuffle_options, allow_review, instructions",
      )
      .eq("exam_id", examId)
      .maybeSingle(),
    supabase
      .from("exam_attempts")
      .select(
        "id, exam_id, student_id, score, status, started_at, submitted_at, time_spent_seconds",
      )
      .eq("exam_id", examId)
      .eq("student_id", studentId)
      .order("started_at", { ascending: true }),
  ]);

  if (attemptsResult.error) {
    return NextResponse.json(
      { ok: false, error: "internal_error" },
      { status: 500 },
    );
  }

  const attemptRows = (attemptsResult.data ?? []) as Array<{
    id: string;
    score: number | null;
    status: string | null;
    started_at: string | null;
    submitted_at: string | null;
    time_spent_seconds: number | null;
  }>;

  // Scores stay hidden until the attempt is genuinely graded (same rule as
  // the results route): in_progress -> submitted (awaiting manual grading)
  // -> graded is the only state where the score is truthful.
  const attempts = attemptRows.map((attempt) => {
    const graded = attempt.status === ATTEMPT_STATUS_GRADED;
    return {
      id: attempt.id,
      score: graded ? attempt.score : null,
      total: examRow.total_marks,
      status: attempt.status,
      started_at: attempt.started_at,
      submitted_at: attempt.submitted_at,
      time_spent_seconds: attempt.time_spent_seconds,
      can_see_details: graded,
    };
  });

  const activeAttempt = attemptRows.find((a) => a.status === "in_progress");

  return NextResponse.json({
    ok: true,
    data: {
      exam: {
        ...examRow,
        attempts_count: attempts.length,
        active_attempt_id: activeAttempt?.id ?? null,
        settings: sanitizeSettingsForStudent(
          (settingsResult.data ?? null) as Record<string, unknown> | null,
        ),
        attempts,
      },
    },
  });
}

/**
 * Only the settings a student is allowed to see. Nothing here reveals
 * answers or grading configuration.
 */
function sanitizeSettingsForStudent(settings: Record<string, unknown> | null) {
  if (!settings) return null;
  return {
    duration_minutes:
      (settings as { duration_minutes?: number }).duration_minutes ?? null,
    max_attempts: (settings as { max_attempts?: number }).max_attempts ?? null,
    auto_submit: (settings as { auto_submit?: boolean }).auto_submit ?? true,
    lock_browser: (settings as { lock_browser?: boolean }).lock_browser ?? false,
    shuffle_questions:
      (settings as { shuffle_questions?: boolean }).shuffle_questions ?? false,
    shuffle_options:
      (settings as { shuffle_options?: boolean }).shuffle_options ?? false,
    allow_review: (settings as { allow_review?: boolean }).allow_review ?? true,
    instructions: (settings as { instructions?: string }).instructions ?? null,
  };
}
