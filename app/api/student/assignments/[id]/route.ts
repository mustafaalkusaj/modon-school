import { NextRequest, NextResponse } from "next/server";
import { resolveStudentContext, unauthorized } from "@/lib/student-api";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await resolveStudentContext(req);
  if (!ctx) return unauthorized();

  const { id } = await params;
  const { supabase, schoolId, studentId, className } = ctx;

  /* ── fetch assignment ── */
  const { data: assignment, error: aErr } = await supabase
    .from("assignments")
    .select(
      "id, title, subject, due_at, content_kind, description, class_name, created_at, max_grade, allow_late, status, attachment_bucket, attachment_path, attachment_name, attachment_mime_type",
    )
    .eq("id", id)
    .eq("school_id", schoolId)
    .maybeSingle();

  if (aErr) {
    return NextResponse.json(
      { ok: false, error: aErr.message },
      { status: 500 },
    );
  }

  if (!assignment) {
    return NextResponse.json(
      { ok: false, error: "not_found" },
      { status: 404 },
    );
  }

  const row = assignment as Record<string, unknown>;

  /* verify the assignment belongs to this student's class */
  if (row.class_name !== className) {
    return NextResponse.json(
      { ok: false, error: "not_found" },
      { status: 404 },
    );
  }

  /* ── fetch existing submission ── */
  const { data: submission } = await supabase
    .from("assignment_submissions")
    .select(
      "id, notes, file_url, file_name, file_mime_type, submitted_at, grade, feedback, graded_at, is_late, status",
    )
    .eq("assignment_id", id)
    .eq("student_id", studentId)
    .eq("school_id", schoolId)
    .maybeSingle();

  const sub = submission as Record<string, unknown> | null;

  return NextResponse.json({
    ok: true,
    data: {
      assignment: {
        id: row.id as string,
        title: (row.title as string) ?? "—",
        subject: (row.subject as string) ?? null,
        due_at: (row.due_at as string) ?? null,
        content_kind: (row.content_kind as string) ?? "homework",
        description: (row.description as string) ?? null,
        created_at: (row.created_at as string) ?? null,
        max_grade: typeof row.max_grade === "number" ? row.max_grade : 100,
        allow_late: Boolean(row.allow_late),
        status: (row.status as string) ?? "active",
        attachment:
          row.attachment_bucket && row.attachment_path
            ? {
                bucket: row.attachment_bucket as string,
                path: row.attachment_path as string,
                file_name: (row.attachment_name as string) ?? "مرفق",
                mime_type: (row.attachment_mime_type as string) ?? null,
              }
            : null,
      },
      submission: sub
        ? {
            id: sub.id as string,
            notes: (sub.notes as string) ?? null,
            file_url: (sub.file_url as string) ?? null,
            file_name: (sub.file_name as string) ?? null,
            submitted_at: (sub.submitted_at as string) ?? null,
            grade: typeof sub.grade === "number" ? sub.grade : null,
            feedback: (sub.feedback as string) ?? null,
            graded_at: (sub.graded_at as string) ?? null,
            is_late: Boolean(sub.is_late),
            status: (sub.status as string) ?? "submitted",
          }
        : null,
    },
  });
}
