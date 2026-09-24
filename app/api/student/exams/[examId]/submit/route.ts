import { NextRequest, NextResponse } from "next/server";
import { resolveStudentContext, unauthorized } from "@/lib/student-api";

/**
 * Finalize an in-progress exam attempt. Mirrors
 * app/api/mobile/student/exams/[examId]/submit/route.ts: grading logic and
 * the atomic RPC (`submit_exam_attempt_atomic`) are identical so a web
 * submission behaves exactly like a mobile one, including the
 * single-submission guard (the RPC rejects a second submit for the same
 * attempt with `exam_attempt_already_submitted`).
 */

const OBJECTIVE_TYPES = [
  "multiple_choice",
  "true_false",
  "fill_blank",
  "matching",
  "ordering",
];

const MAX_ANSWERS = 500;

function autoGrade(
  questionType: string | null,
  correctAnswer: string | null,
  studentAnswer: unknown,
): boolean | null {
  if (!questionType || !OBJECTIVE_TYPES.includes(questionType)) return null;
  if (correctAnswer === null || correctAnswer === undefined) return null;

  const studentStr =
    typeof studentAnswer === "string"
      ? studentAnswer.trim().toLowerCase()
      : JSON.stringify(studentAnswer);
  const correctStr = correctAnswer.trim().toLowerCase();

  return studentStr === correctStr;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ examId: string }> },
) {
  const ctx = await resolveStudentContext(req);
  if (!ctx) return unauthorized();

  const { supabase, schoolId, studentId } = ctx;
  const { examId } = await params;

  const body = await req.json().catch(() => null);
  const attemptId: string | undefined = body?.attempt_id ?? body?.attemptId;
  if (!attemptId || !Array.isArray(body?.answers)) {
    return NextResponse.json(
      { ok: false, error: "attempt_id_and_answers_required" },
      { status: 400 },
    );
  }

  if (body.answers.length > MAX_ANSWERS) {
    return NextResponse.json(
      { ok: false, error: "too_many_answers" },
      { status: 400 },
    );
  }

  for (let i = 0; i < body.answers.length; i++) {
    const ans = body.answers[i];
    if (typeof ans !== "object" || ans === null) {
      return NextResponse.json(
        { ok: false, error: `invalid_answer_at_${i}` },
        { status: 400 },
      );
    }
    const questionId =
      (ans as Record<string, unknown>).question_id ??
      (ans as Record<string, unknown>).questionId;
    if (typeof questionId !== "string" || questionId.trim() === "") {
      return NextResponse.json(
        { ok: false, error: `missing_question_id_at_${i}` },
        { status: 400 },
      );
    }
    const answerValue = (ans as Record<string, unknown>).answer;
    if (answerValue === undefined || answerValue === null || answerValue === "") {
      return NextResponse.json(
        { ok: false, error: `missing_answer_value_at_${i}` },
        { status: 400 },
      );
    }
  }

  const { data: exam, error: examError } = await supabase
    .from("exams")
    .select("id")
    .eq("id", examId)
    .eq("school_id", schoolId)
    .single();

  if (examError || !exam) {
    return NextResponse.json(
      { ok: false, error: "exam_not_found" },
      { status: 404 },
    );
  }

  const { data: attempt, error: attemptError } = await supabase
    .from("exam_attempts")
    .select("id, exam_id, student_id, status, started_at")
    .eq("id", attemptId)
    .eq("exam_id", examId)
    .eq("student_id", studentId)
    .single();

  if (attemptError || !attempt) {
    return NextResponse.json(
      { ok: false, error: "attempt_not_found" },
      { status: 404 },
    );
  }

  const attemptRow = attempt as { id: string; status: string };
  if (attemptRow.status !== "in_progress") {
    return NextResponse.json(
      { ok: false, error: "attempt_already_submitted" },
      { status: 400 },
    );
  }

  const { data: examQuestions } = await supabase
    .from("exam_questions")
    .select("question_id, marks, questions!inner(id, type, answer)")
    .eq("exam_id", examId);

  const questionMap = new Map<
    string,
    { type: string | null; answer: string | null; marks: number }
  >();
  for (const rawEq of examQuestions ?? []) {
    const eq = rawEq as unknown as {
      question_id: string;
      marks: number;
      questions: { id: string; type: string | null; answer: string | null };
    };
    questionMap.set(eq.question_id, {
      type: eq.questions.type,
      answer: eq.questions.answer,
      marks: Number(eq.marks) || 1,
    });
  }

  for (let i = 0; i < body.answers.length; i++) {
    const ans = body.answers[i] as Record<string, unknown>;
    const questionId = (ans.question_id ?? ans.questionId) as string;
    if (!questionMap.has(questionId)) {
      return NextResponse.json(
        { ok: false, error: `question_not_in_exam_at_${i}` },
        { status: 400 },
      );
    }
  }

  let totalScore = 0;
  let gradedCount = 0;
  let pendingManualGrade = 0;

  const studentAnswerRows = (
    body.answers as Array<{
      question_id?: string;
      questionId?: string;
      answer: unknown;
      time_spent_seconds?: number;
      timeSpentSeconds?: number;
      flagged?: boolean;
    }>
  ).map((ans) => {
    const questionId = ans.question_id ?? ans.questionId ?? "";
    const timeSpent = ans.time_spent_seconds ?? ans.timeSpentSeconds ?? null;
    const questionInfo = questionMap.get(questionId);
    const isCorrect = questionInfo
      ? autoGrade(questionInfo.type, questionInfo.answer, ans.answer)
      : null;
    const marksAwarded = isCorrect === true ? (questionInfo?.marks ?? 1) : 0;

    if (isCorrect !== null) {
      gradedCount++;
      totalScore += marksAwarded;
    } else {
      pendingManualGrade++;
    }

    return {
      attempt_id: attemptId,
      question_id: questionId,
      student_answer: ans.answer,
      is_correct: isCorrect,
      marks_awarded: marksAwarded,
      time_spent_seconds: timeSpent,
      // Tab-switch / integrity flag: web has no detector yet, so this is
      // always false today, but the field is passed through (not dropped)
      // so it lines up with the mobile-written schema.
      flagged: ans.flagged ?? false,
    };
  });

  const submitStatus = pendingManualGrade > 0 ? "submitted" : "graded";
  const { data: submitResult, error: submitError } = await (
    supabase.rpc as unknown as (
      name: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message: string } | null }>
  )("submit_exam_attempt_atomic", {
    p_school_id: schoolId,
    p_exam_id: examId,
    p_student_id: studentId,
    p_attempt_id: attemptId,
    p_answers: studentAnswerRows,
    p_score: totalScore,
    p_status: submitStatus,
  });

  if (submitError) {
    const mapped = mapSubmitAttemptError(submitError.message);
    return NextResponse.json(
      { ok: false, error: mapped.error },
      { status: mapped.status },
    );
  }

  const submittedAttempt = (
    Array.isArray(submitResult) ? submitResult[0] : submitResult
  ) as { time_spent_seconds?: number } | null;
  const timeSpentSeconds = submittedAttempt?.time_spent_seconds ?? 0;

  const { data: settings } = await supabase
    .from("exam_settings")
    .select("show_results_immediately")
    .eq("exam_id", examId)
    .maybeSingle();

  const showResults =
    (settings as { show_results_immediately?: boolean } | null)
      ?.show_results_immediately ?? false;

  const result: Record<string, unknown> = {
    ok: true,
    data: {
      attempt_id: attemptId,
      status: submitStatus,
      score: showResults ? totalScore : null,
      graded_count: gradedCount,
      pending_manual_grade: pendingManualGrade,
      time_spent_seconds: timeSpentSeconds,
      results_pending_release: !showResults,
      answers: showResults
        ? studentAnswerRows.map((a) => ({
            question_id: a.question_id,
            is_correct: a.is_correct,
            marks_awarded: a.marks_awarded,
          }))
        : undefined,
    },
  };

  return NextResponse.json(result);
}

function mapSubmitAttemptError(message: string): {
  error: string;
  status: number;
} {
  if (message.includes("exam_attempt_already_submitted")) {
    return { error: "attempt_already_submitted", status: 409 };
  }
  if (
    message.includes("exam_submission_window_closed") ||
    message.includes("invalid_exam_submission_status")
  ) {
    return { error: "submission_window_closed", status: 400 };
  }
  if (
    message.includes("invalid_exam_answers") ||
    message.includes("invalid_exam_answer_question_id") ||
    message.includes("duplicate_exam_answer_question") ||
    message.includes("exam_answer_question_mismatch") ||
    message.includes("invalid_exam_score")
  ) {
    return { error: "invalid_answers", status: 400 };
  }
  if (
    message.includes("exam_attempt_not_found") ||
    message.includes("exam_not_found")
  ) {
    return { error: "attempt_not_found", status: 404 };
  }
  return { error: "submit_failed", status: 500 };
}
