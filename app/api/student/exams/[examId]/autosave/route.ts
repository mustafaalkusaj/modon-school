import { NextRequest, NextResponse } from "next/server";
import { resolveStudentContext, unauthorized } from "@/lib/student-api";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

/**
 * Partial (non-final) answer persistence for an in-progress exam attempt.
 * Mirrors app/api/mobile/student/exams/[examId]/autosave/route.ts: the draft
 * is stored in the same `exam_attempts.answers_json` jsonb column, so a
 * draft saved on mobile is visible to web and vice versa. Only /submit can
 * finalize an attempt — this route only ever UPDATEs an already-existing
 * in_progress row.
 */

const MAX_ANSWERS = 500;

type DraftAnswer = {
  question_id: string;
  answer: unknown;
  time_spent_seconds: number | null;
};

type Draft = {
  answers: DraftAnswer[];
  flags: Record<string, boolean>;
  current_index: number;
  saved_at: string;
};

async function loadInProgressAttempt(
  supabase: SupabaseClient<Database>,
  {
    examId,
    attemptId,
    schoolId,
    studentId,
  }: { examId: string; attemptId: string; schoolId: string; studentId: string },
): Promise<
  | { ok: true; attempt: { id: string; answers_json: unknown } }
  | { ok: false; response: NextResponse }
> {
  const { data: exam, error: examError } = await supabase
    .from("exams")
    .select("id")
    .eq("id", examId)
    .eq("school_id", schoolId)
    .single();

  if (examError || !exam) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: "exam_not_found" },
        { status: 404 },
      ),
    };
  }

  const { data: attempt, error: attemptError } = await supabase
    .from("exam_attempts")
    .select("id, exam_id, student_id, status, answers_json")
    .eq("id", attemptId)
    .eq("exam_id", examId)
    .eq("student_id", studentId)
    .eq("school_id", schoolId)
    .single();

  if (attemptError || !attempt) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: "attempt_not_found" },
        { status: 404 },
      ),
    };
  }

  const attemptRow = attempt as {
    id: string;
    status: string | null;
    answers_json: unknown;
  };

  if (attemptRow.status !== "in_progress") {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: "attempt_already_submitted" },
        { status: 400 },
      ),
    };
  }

  return {
    ok: true,
    attempt: { id: attemptRow.id, answers_json: attemptRow.answers_json },
  };
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

  const draftAnswers: DraftAnswer[] = [];
  for (let i = 0; i < body.answers.length; i++) {
    const ans = body.answers[i];
    if (typeof ans !== "object" || ans === null) {
      return NextResponse.json(
        { ok: false, error: `invalid_answer_at_${i}` },
        { status: 400 },
      );
    }
    const record = ans as Record<string, unknown>;
    const questionId = record.question_id ?? record.questionId;
    if (typeof questionId !== "string" || questionId.trim() === "") {
      return NextResponse.json(
        { ok: false, error: `missing_question_id_at_${i}` },
        { status: 400 },
      );
    }
    const rawTime = record.time_spent_seconds ?? record.timeSpentSeconds;
    draftAnswers.push({
      question_id: questionId,
      answer: record.answer ?? null,
      time_spent_seconds:
        typeof rawTime === "number" && Number.isFinite(rawTime)
          ? Math.max(0, Math.floor(rawTime))
          : null,
    });
  }

  const guard = await loadInProgressAttempt(supabase, {
    examId,
    attemptId,
    schoolId,
    studentId,
  });
  if (guard.ok === false) return guard.response;

  // Integrity-check fields (tab-switch count, flagged questions) are
  // optional and simply passed through when present, matching the schema
  // the mobile app writes so both surfaces stay consistent even though the
  // web UI does not (yet) run its own tab-switch detection.
  const rawFlags = body.flags;
  const flags: Record<string, boolean> = {};
  if (rawFlags && typeof rawFlags === "object" && !Array.isArray(rawFlags)) {
    for (const [key, value] of Object.entries(
      rawFlags as Record<string, unknown>,
    )) {
      if (value === true) flags[key] = true;
    }
  }

  const rawIndex = body.current_index ?? body.currentIndex;
  const currentIndex =
    typeof rawIndex === "number" && Number.isFinite(rawIndex) && rawIndex >= 0
      ? Math.floor(rawIndex)
      : 0;

  const draft: Draft = {
    answers: draftAnswers,
    flags,
    current_index: currentIndex,
    saved_at: new Date().toISOString(),
  };

  const { error: updateError } = await supabase
    .from("exam_attempts")
    // `answer` is genuinely unknown JSON, so the generated Json type cannot
    // describe it — same cast the mobile autosave route uses.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update({ answers_json: draft as any })
    .eq("id", attemptId)
    .eq("exam_id", examId)
    .eq("student_id", studentId)
    .eq("school_id", schoolId)
    .eq("status", "in_progress");

  if (updateError) {
    return NextResponse.json(
      { ok: false, error: "autosave_failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    data: {
      attempt_id: attemptId,
      saved_at: draft.saved_at,
      saved_count: draftAnswers.length,
    },
  });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ examId: string }> },
) {
  const ctx = await resolveStudentContext(req);
  if (!ctx) return unauthorized();

  const { supabase, schoolId, studentId } = ctx;
  const { examId } = await params;

  const attemptId = req.nextUrl.searchParams.get("attempt_id");
  if (!attemptId) {
    return NextResponse.json(
      { ok: false, error: "attempt_id_required" },
      { status: 400 },
    );
  }

  const guard = await loadInProgressAttempt(supabase, {
    examId,
    attemptId,
    schoolId,
    studentId,
  });
  if (guard.ok === false) return guard.response;

  const stored = guard.attempt.answers_json;
  const draft =
    stored && typeof stored === "object" && !Array.isArray(stored)
      ? (stored as Partial<Draft>)
      : null;

  return NextResponse.json({
    ok: true,
    data: {
      attempt_id: attemptId,
      draft: draft
        ? {
            answers: Array.isArray(draft.answers) ? draft.answers : [],
            flags:
              draft.flags && typeof draft.flags === "object" ? draft.flags : {},
            current_index:
              typeof draft.current_index === "number" ? draft.current_index : 0,
            saved_at: draft.saved_at ?? null,
          }
        : null,
    },
  });
}
