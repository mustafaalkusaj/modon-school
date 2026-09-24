import { NextRequest, NextResponse } from "next/server";
import { resolveStudentContext, unauthorized } from "@/lib/student-api";

/**
 * Create or resume the calling student's exam_attempts row and hand back the
 * (answer-stripped) question set. Mirrors
 * app/api/mobile/student/exams/[examId]/start/route.ts exactly, including
 * reuse of the `start_or_resume_exam_attempt` RPC that atomically enforces
 * single/multi-attempt limits and resumes an in_progress attempt instead of
 * creating a duplicate — so an attempt started on mobile resumes correctly
 * here and vice versa.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ examId: string }> },
) {
  const ctx = await resolveStudentContext(req);
  if (!ctx) return unauthorized();

  const { supabase, schoolId, studentId, className } = ctx;
  const { examId } = await params;

  const { data: exam, error: examError } = await supabase
    .from("exams")
    .select("id, school_id, title, starts_at, ends_at, total_marks, class_name")
    .eq("id", examId)
    .eq("school_id", schoolId)
    .single();

  if (examError || !exam) {
    return NextResponse.json(
      { ok: false, error: "exam_not_found" },
      { status: 404 },
    );
  }

  const examRow = exam as {
    id: string;
    starts_at: string | null;
    ends_at: string | null;
    class_name: string | null;
  };

  if (examRow.class_name) {
    const studentClass = className?.trim();
    if (!studentClass || studentClass !== examRow.class_name) {
      return NextResponse.json(
        { ok: false, error: "class_mismatch" },
        { status: 403 },
      );
    }
  }

  const now = new Date();
  if (examRow.starts_at && new Date(examRow.starts_at) > now) {
    return NextResponse.json(
      { ok: false, error: "exam_not_started" },
      { status: 400 },
    );
  }
  if (examRow.ends_at && new Date(examRow.ends_at) < now) {
    return NextResponse.json(
      { ok: false, error: "exam_ended" },
      { status: 400 },
    );
  }

  const { data: settings } = await supabase
    .from("exam_settings")
    .select(
      "id, exam_id, max_attempts, shuffle_questions, duration_minutes, auto_submit, lock_browser, shuffle_options, allow_review, instructions",
    )
    .eq("exam_id", examId)
    .maybeSingle();

  // Same service-only RPC the mobile route uses: attempt counting, resume
  // detection and creation happen in one DB transaction, serializing
  // concurrent starts for the same student/exam pair.
  const { data: attemptResult, error: attemptError } = await (
    supabase.rpc as unknown as (
      name: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message: string } | null }>
  )("start_or_resume_exam_attempt", {
    p_school_id: schoolId,
    p_exam_id: examId,
    p_student_id: studentId,
  });

  if (attemptError) {
    const mapped = mapStartAttemptError(attemptError.message);
    return NextResponse.json(
      { ok: false, error: mapped.error },
      { status: mapped.status },
    );
  }

  const attemptRow = (
    Array.isArray(attemptResult) ? attemptResult[0] : attemptResult
  ) as { attempt_id: string; started_at: string | null; resumed: boolean } | null;

  if (!attemptRow?.attempt_id) {
    return NextResponse.json(
      { ok: false, error: "attempt_creation_failed" },
      { status: 500 },
    );
  }

  const { data: rawQuestions } = await supabase
    .from("exam_questions")
    .select(
      "question_id, sort_order, marks, questions!inner(id, prompt, options, type, difficulty)",
    )
    .eq("exam_id", examId)
    .order("sort_order", { ascending: true });

  let questions = rawQuestions ?? [];
  if (
    (settings as { shuffle_questions?: boolean } | null)?.shuffle_questions
  ) {
    questions = shuffleArray(questions, `${attemptRow.attempt_id}-questions`);
  }

  return NextResponse.json({
    ok: true,
    data: {
      attempt_id: attemptRow.attempt_id,
      resumed: attemptRow.resumed,
      questions: questions.map(toStudentQuestion),
      remaining_seconds: computeRemainingSeconds(settings, attemptRow.started_at),
      settings: sanitizeSettingsForStudent(settings),
    },
  });
}

function shuffleArray<T>(array: T[], seed?: string): T[] {
  const result = [...array];
  let seedNum = 0;
  if (seed) {
    for (let i = 0; i < seed.length; i++) {
      seedNum = ((seedNum << 5) - seedNum + seed.charCodeAt(i)) | 0;
    }
  }
  for (let i = result.length - 1; i > 0; i--) {
    seedNum = (seedNum * 1103515245 + 12345) & 0x7fffffff;
    const j = seedNum % (i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function mapStartAttemptError(message: string): {
  error: string;
  status: number;
} {
  if (message.includes("exam_attempt_limit_reached")) {
    return { error: "attempt_limit_reached", status: 400 };
  }
  if (message.includes("exam_not_started")) {
    return { error: "exam_not_started", status: 400 };
  }
  if (message.includes("exam_ended")) {
    return { error: "exam_ended", status: 400 };
  }
  if (message.includes("exam_class_mismatch")) {
    return { error: "class_mismatch", status: 403 };
  }
  if (message.includes("student_inactive")) {
    return { error: "student_inactive", status: 403 };
  }
  if (
    message.includes("exam_not_found") ||
    message.includes("student_not_found")
  ) {
    return { error: "exam_not_found", status: 404 };
  }
  return { error: "start_failed", status: 500 };
}

/**
 * Flatten an exam_questions row (nests the question under `questions`) into
 * the flat snake_case shape: { id, prompt, type, options, sort_order, marks }.
 * The correct answer is stripped so it never reaches the student.
 */
function toStudentQuestion(
  eq: Record<string, unknown>,
): Record<string, unknown> {
  const q = (eq.questions as Record<string, unknown> | undefined) ?? {};
  return {
    id: q.id ?? eq.question_id ?? null,
    prompt: q.prompt ?? null,
    type: q.type ?? null,
    options: q.options ?? null,
    difficulty: q.difficulty ?? null,
    sort_order: eq.sort_order ?? null,
    marks: eq.marks ?? null,
  };
}

function computeRemainingSeconds(
  settings: Record<string, unknown> | null,
  startedAt: string | null,
): number {
  const durationMinutes =
    (settings as { duration_minutes?: number } | null)?.duration_minutes ?? 60;
  const totalSeconds = durationMinutes * 60;
  if (!startedAt) return totalSeconds;
  const elapsed = Math.floor(
    (Date.now() - new Date(startedAt).getTime()) / 1000,
  );
  return Math.max(0, totalSeconds - Math.max(0, elapsed));
}

function sanitizeSettingsForStudent(
  settings: Record<string, unknown> | null,
): Record<string, unknown> {
  if (!settings) return {};
  return {
    duration_minutes:
      (settings as { duration_minutes?: number }).duration_minutes ?? null,
    auto_submit: (settings as { auto_submit?: boolean }).auto_submit ?? true,
    lock_browser:
      (settings as { lock_browser?: boolean }).lock_browser ?? false,
    shuffle_options:
      (settings as { shuffle_options?: boolean }).shuffle_options ?? false,
    allow_review: (settings as { allow_review?: boolean }).allow_review ?? true,
    instructions: (settings as { instructions?: string }).instructions ?? null,
  };
}
