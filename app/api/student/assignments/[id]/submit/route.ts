import { NextRequest, NextResponse } from "next/server";
import { resolveStudentContext, unauthorized } from "@/lib/student-api";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await resolveStudentContext(req);
  if (!ctx) return unauthorized();

  const { id: assignmentId } = await params;
  const { supabase, schoolId, studentId, className } = ctx;

  /* ── validate body ── */
  let body: {
    notes?: string;
    file_url?: string;
    file_name?: string;
    file_mime_type?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_body" },
      { status: 400 },
    );
  }

  const notes = typeof body.notes === "string" ? body.notes.trim() : "";
  const fileUrl = typeof body.file_url === "string" ? body.file_url.trim() : "";
  const fileName =
    typeof body.file_name === "string" ? body.file_name.trim() : "";
  const fileMimeType =
    typeof body.file_mime_type === "string" ? body.file_mime_type.trim() : "";

  if (notes.length === 0 && fileUrl.length === 0) {
    return NextResponse.json(
      { ok: false, error: "notes_required" },
      { status: 400 },
    );
  }

  /* ── verify assignment exists and belongs to student's class ── */
  const { data: assignment } = await supabase
    .from("assignments")
    .select("id, class_name, teacher_id, subject, title, due_at, allow_late, status")
    .eq("id", assignmentId)
    .eq("school_id", schoolId)
    .maybeSingle();

  const assignmentRow = assignment as Record<string, unknown> | null;

  if (!assignmentRow || assignmentRow.class_name !== className) {
    return NextResponse.json(
      { ok: false, error: "assignment_not_found" },
      { status: 404 },
    );
  }

  const dueAt =
    typeof assignmentRow.due_at === "string" ? assignmentRow.due_at : null;
  const allowLate = Boolean(assignmentRow.allow_late);
  const now = new Date();
  const isLate = Boolean(dueAt && now.getTime() > new Date(dueAt).getTime());

  if (isLate && !allowLate) {
    return NextResponse.json(
      { ok: false, error: "deadline_passed" },
      { status: 400 },
    );
  }

  /* ── check for existing submission ── */
  const { data: existing } = await supabase
    .from("assignment_submissions")
    .select("id")
    .eq("assignment_id", assignmentId)
    .eq("student_id", studentId)
    .eq("school_id", schoolId)
    .maybeSingle();

  const existingId = existing
    ? ((existing as Record<string, unknown>).id as string)
    : null;

  const submissionPayload: Record<string, unknown> = {
    notes: notes || null,
    submitted_at: now.toISOString(),
    is_late: isLate,
    status: "submitted",
  };

  if (fileUrl) {
    submissionPayload.file_url = fileUrl;
    submissionPayload.file_name = fileName || "مرفق";
    submissionPayload.file_mime_type = fileMimeType || null;
  }

  let result: Record<string, unknown> | null = null;

  if (existingId) {
    /* ── update ── */
    const { data: updated, error } = await supabase
      .from("assignment_submissions")
      .update(submissionPayload)
      .eq("id", existingId)
      .select("id, notes, submitted_at, is_late")
      .single();

    if (error) {
      return NextResponse.json(
        { ok: false, error: "فشل في حفظ التسليم" },
        { status: 500 },
      );
    }

    result = updated as Record<string, unknown>;
  } else {
    /* ── insert ── */
    const { data: created, error } = await supabase
      .from("assignment_submissions")
      .insert({
        school_id: schoolId,
        assignment_id: assignmentId,
        student_id: studentId,
        ...submissionPayload,
      })
      .select("id, notes, submitted_at, is_late")
      .single();

    if (error) {
      return NextResponse.json(
        { ok: false, error: "فشل في حفظ التسليم" },
        { status: 500 },
      );
    }

    result = created as Record<string, unknown>;
  }

  // Event-driven notification — additive, never blocks the write.
  const teacherId = nullableText(assignmentRow.teacher_id);
  if (teacherId) {
    void import("@/lib/notify-events")
      .then(async ({ notifySubmissionReceived }) => {
        const { data: studentRow } = await supabase
          .from("students")
          .select("full_name")
          .eq("id", studentId)
          .maybeSingle();
        return notifySubmissionReceived({
          supabase,
          schoolId,
          teacherId,
          studentName:
            (studentRow as Record<string, unknown> | null)?.full_name as
              | string
              | undefined,
          title: (assignmentRow.title as string) ?? "واجب",
        });
      })
      .catch(() => {});
  }

  return NextResponse.json(
    { ok: true, data: result },
    { status: existingId ? 200 : 201 },
  );
}

function nullableText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
