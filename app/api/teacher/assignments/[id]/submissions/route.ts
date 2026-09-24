import { NextRequest, NextResponse } from "next/server";
import { resolveTeacherContext, unauthorized } from "@/lib/teacher-api";

type Params = { params: Promise<{ id: string }> };

// GET: teacher lists all submissions for one of their own assignments,
// joined with the submitting student's name.
export async function GET(req: NextRequest, { params }: Params) {
  const ctx = await resolveTeacherContext(req);
  if (!ctx) return unauthorized();

  const { id: assignmentId } = await params;
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

  const { data, error } = await supabase
    .from("assignment_submissions")
    .select(
      "id, student_id, notes, file_url, file_name, file_mime_type, submitted_at, is_late, grade, feedback, status, graded_at, graded_by, students(full_name)",
    )
    .eq("assignment_id", assignmentId)
    .eq("school_id", schoolId)
    .order("submitted_at", { ascending: false });

  if (error) {
    return NextResponse.json(
      { ok: false, error: "fetch_failed" },
      { status: 500 },
    );
  }

  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const submissions = rows.map((row) => {
    const student = row.students as { full_name?: string } | null;
    return {
      id: row.id,
      student_id: row.student_id,
      student_name: student?.full_name ?? null,
      notes: row.notes,
      file_url: row.file_url,
      file_name: row.file_name,
      file_mime_type: row.file_mime_type,
      submitted_at: row.submitted_at,
      is_late: row.is_late,
      grade: row.grade,
      feedback: row.feedback,
      status: row.status,
      graded_at: row.graded_at,
      graded_by: row.graded_by,
    };
  });

  const gradedCount = submissions.filter((s) => s.grade !== null).length;
  const averageGrade =
    gradedCount > 0
      ? Math.round(
          (submissions.reduce((sum, s) => sum + (Number(s.grade) || 0), 0) /
            gradedCount) *
            100,
        ) / 100
      : null;

  return NextResponse.json({
    ok: true,
    data: {
      assignment_id: assignmentId,
      title: assignmentRow.title,
      max_grade: assignmentRow.max_grade,
      submissions,
      stats: {
        submission_count: submissions.length,
        graded_count: gradedCount,
        average_grade: averageGrade,
      },
    },
  });
}
