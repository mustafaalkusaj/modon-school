import { NextRequest, NextResponse } from "next/server";
import { resolveTeacherContext, unauthorized } from "@/lib/teacher-api";
import { notifyAssignmentGraded } from "@/lib/notify-events";

type Params = { params: Promise<{ id: string; submissionId: string }> };

// PATCH: teacher grades a submission for one of their own assignments.
export async function PATCH(req: NextRequest, { params }: Params) {
  const ctx = await resolveTeacherContext(req);
  if (!ctx) return unauthorized();

  const { id: assignmentId, submissionId } = await params;
  const { supabase, teacherId, schoolId } = ctx;

  const { data: assignment, error: aErr } = await supabase
    .from("assignments")
    .select("id, teacher_id, max_grade, title")
    .eq("id", assignmentId)
    .eq("school_id", schoolId)
    .maybeSingle();

  if (aErr) {
    return NextResponse.json(
      { ok: false, error: "fetch_failed" },
      { status: 500 },
    );
  }
  const assignmentRow = assignment as Record<string, unknown> | null;
  if (!assignmentRow || assignmentRow.teacher_id !== teacherId) {
    return NextResponse.json(
      { ok: false, error: "not_found" },
      { status: 404 },
    );
  }

  let body: { grade?: unknown; feedback?: unknown };
  try {
    body = (await req.json()) as { grade?: unknown; feedback?: unknown };
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_json" },
      { status: 400 },
    );
  }

  const maxGrade = Number(assignmentRow.max_grade) || 100;
  const grade = body.grade;
  const feedback = body.feedback;

  if (typeof grade !== "number" || !Number.isFinite(grade)) {
    return NextResponse.json(
      { ok: false, error: "invalid_grade" },
      { status: 400 },
    );
  }
  if (grade < 0 || grade > maxGrade) {
    return NextResponse.json(
      { ok: false, error: "grade_out_of_range", max_grade: maxGrade },
      { status: 400 },
    );
  }
  if (feedback !== undefined && typeof feedback !== "string") {
    return NextResponse.json(
      { ok: false, error: "invalid_feedback" },
      { status: 400 },
    );
  }

  const { data, error } = await supabase
    .from("assignment_submissions")
    .update({
      grade: Math.trunc(grade),
      feedback: typeof feedback === "string" ? feedback : null,
      status: "graded",
      graded_at: new Date().toISOString(),
      graded_by: teacherId,
    })
    .eq("id", submissionId)
    .eq("assignment_id", assignmentId)
    .eq("school_id", schoolId)
    .select(
      "id, student_id, grade, feedback, status, graded_at, students(auth_user_id)",
    )
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { ok: false, error: "update_failed" },
      { status: 500 },
    );
  }
  if (!data) {
    return NextResponse.json(
      { ok: false, error: "not_found" },
      { status: 404 },
    );
  }

  const row = data as Record<string, unknown>;

  // Best-effort: notify the student their work was graded (push + in-app).
  if (row.student_id) {
    void notifyAssignmentGraded({
      supabase,
      schoolId,
      studentId: row.student_id as string,
      grade: typeof row.grade === "number" ? row.grade : null,
      maxGrade: typeof maxGrade === "number" ? maxGrade : null,
    }).catch(() => {});
  }

  return NextResponse.json({
    ok: true,
    data: {
      id: row.id,
      student_id: row.student_id,
      grade: row.grade,
      feedback: row.feedback,
      status: row.status,
      graded_at: row.graded_at,
    },
  });
}
