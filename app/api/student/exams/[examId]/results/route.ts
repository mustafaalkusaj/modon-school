import { NextRequest, NextResponse } from "next/server";
import { resolveStudentContext, unauthorized } from "@/lib/student-api";

/** Terminal attempt status written by the submit and teacher-grade routes. */
const ATTEMPT_STATUS_GRADED = "graded";

/**
 * The student's own graded results for an exam. Mirrors
 * app/api/mobile/student/exams/[examId]/results/route.ts: scores and the
 * per-question breakdown are only revealed once an attempt's status is
 * "graded" — a still-"submitted" (awaiting manual grading) or "in_progress"
 * attempt returns null/empty details, never a leaked score.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ examId: string }> },
) {
  const ctx = await resolveStudentContext(req);
  if (!ctx) return unauthorized();

  const { supabase, schoolId, studentId } = ctx;
  const { examId } = await params;

  const search = req.nextUrl.searchParams;
  const attemptId = search.get("attempt_id");

  let attemptsQuery = supabase
    .from("exam_attempts")
    .select(
      "id, exam_id, student_id, score, status, started_at, submitted_at, time_spent_seconds",
    )
    .eq("exam_id", examId)
    .eq("student_id", studentId)
    .eq("school_id", schoolId)
    .order("submitted_at", { ascending: false });

  if (attemptId) {
    attemptsQuery = attemptsQuery.eq("id", attemptId);
  }

  const { data: attempts, error: attemptsError } = await attemptsQuery;

  if (attemptsError) {
    return NextResponse.json(
      { ok: false, error: "internal_error" },
      { status: 500 },
    );
  }

  if (!attempts || attempts.length === 0) {
    return NextResponse.json(
      { ok: false, error: "no_attempts" },
      { status: 404 },
    );
  }

  const attemptRows = attempts as Array<{
    id: string;
    exam_id: string;
    score: number | null;
    status: string;
    started_at: string | null;
    submitted_at: string | null;
    time_spent_seconds: number | null;
  }>;

  const { data: exam } = await supabase
    .from("exams")
    .select("id, title, total_marks, subject, class_name")
    .eq("id", examId)
    .eq("school_id", schoolId)
    .single();

  const examRow = exam as {
    id: string;
    title: string;
    total_marks: number | null;
    subject: string | null;
    class_name: string | null;
  } | null;

  const { data: examQuestions } = await supabase
    .from("exam_questions")
    .select("question_id, marks")
    .eq("exam_id", examId);
  const marksMap = new Map<string, number>();
  for (const row of (examQuestions ?? []) as Array<{
    question_id: string;
    marks: number | null;
  }>) {
    marksMap.set(row.question_id, Number(row.marks) || 0);
  }
  const totalMarks =
    examRow?.total_marks ??
    Array.from(marksMap.values()).reduce((sum, v) => sum + v, 0);

  const results = await Promise.all(
    attemptRows.map(async (attempt) => {
      const canSeeDetails = attempt.status === ATTEMPT_STATUS_GRADED;

      let breakdown: Array<Record<string, unknown>> = [];
      if (canSeeDetails) {
        const { data: answers } = await supabase
          .from("student_answers")
          .select(
            "question_id, student_answer, is_correct, marks_awarded, time_spent_seconds, questions!inner(id, prompt, type, options, answer)",
          )
          .eq("attempt_id", attempt.id);

        breakdown = ((answers ?? []) as Array<Record<string, unknown>>).map(
          (a) => {
            const q = (a.questions as Record<string, unknown> | null) ?? {};
            return {
              id: q.id ?? a.question_id ?? null,
              prompt: q.prompt ?? null,
              type: q.type ?? null,
              options: q.options ?? null,
              student_answer: a.student_answer,
              correct_answer: q.answer ?? null,
              marks: marksMap.get(a.question_id as string) ?? 0,
              marks_awarded: a.marks_awarded,
              is_correct: a.is_correct,
              time_spent_seconds: a.time_spent_seconds,
            };
          },
        );
      }

      return {
        attempt_id: attempt.id,
        score: canSeeDetails ? attempt.score : null,
        status: attempt.status,
        started_at: attempt.started_at,
        submitted_at: attempt.submitted_at,
        time_spent_seconds: attempt.time_spent_seconds,
        can_see_details: canSeeDetails,
        questions_breakdown: breakdown,
      };
    }),
  );

  const latest = results[0];
  const canSeeLatest = Boolean(latest?.can_see_details);
  const latestScore = canSeeLatest ? Number(latest?.score ?? 0) : null;
  const passed =
    latestScore !== null && totalMarks > 0
      ? latestScore / totalMarks >= 0.5
      : null;

  return NextResponse.json({
    ok: true,
    data: {
      exam: examRow
        ? {
            id: examRow.id,
            title: examRow.title,
            total_marks: examRow.total_marks,
            subject: examRow.subject,
          }
        : null,
      attempt: latest
        ? {
            score: latestScore,
            total: totalMarks,
            passed,
            time_spent_seconds: latest.time_spent_seconds,
            status: latest.status,
            can_see_details: canSeeLatest,
          }
        : null,
      questions_breakdown: latest?.questions_breakdown ?? [],
      results,
    },
  });
}
