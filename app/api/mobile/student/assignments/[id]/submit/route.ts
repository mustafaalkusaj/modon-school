import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { resolveMobileRouteContext } from "@/lib/mobile-api-server";
import { enforceRateLimit } from "@/lib/rate-limit";
import { createServiceSupabaseClient } from "@/lib/supabase-server";

import { isAssignmentVisibleToStudent } from "../../assignment-visibility";

type Params = { params: Promise<{ id: string }> };

// `assignment_submissions` is not present in the generated Database types
// yet, so we intentionally bypass the typed `.from()` overloads for this
// table while preserving existing runtime behavior.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function assignmentSubmissionsTable(client: unknown): any {
  return (client as { from: (table: string) => unknown }).from(
    "assignment_submissions",
  );
}

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const { id: assignmentId } = await params;
    const context = await resolveMobileRouteContext(req, "student");
    if (context.ok === false) return context.response;

    const { schoolId, account } = context.value;
    const studentId = account.student?.id;
    if (!studentId) {
      return NextResponse.json(
        { ok: false, error: "لا يوجد حساب طالب مرتبط." },
        { status: 403 },
      );
    }

    const supabase = createServiceSupabaseClient();
    const { data, error } = await assignmentSubmissionsTable(supabase)
      .select("id, notes, file_url, file_name, file_mime_type, submitted_at")
      .eq("school_id", schoolId)
      .eq("assignment_id", assignmentId)
      .eq("student_id", studentId)
      .maybeSingle();

    if (error) throw error;
    return NextResponse.json({ ok: true, submission: data ?? null });
  } catch {
    return NextResponse.json(
      { ok: false, error: "internal_error" },
      { status: 500 },
    );
  }
}

const submitBodySchema = z.object({
  notes: z.string().trim().max(5000, "الملاحظات طويلة جدًا.").nullish(),
  file_url: z.string().trim().max(1000, "رابط الملف طويل جدًا.").nullish(),
  file_name: z.string().trim().max(255, "اسم الملف طويل جدًا.").nullish(),
  file_mime_type: z
    .string()
    .trim()
    .max(255, "نوع الملف غير صالح.")
    .nullish(),
});

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { id: assignmentId } = await params;
    const context = await resolveMobileRouteContext(req, "student");
    if (context.ok === false) return context.response;

    // Submissions carry user content; keep the write path from becoming a
    // spam amplifier.
    const rateLimited = await enforceRateLimit(req, {
      namespace: "mobile-student-assignment-submit",
      windowMs: 10 * 60_000,
      maxHits: 20,
      identifier: context.value.authUserId,
    });
    if (rateLimited) return rateLimited;

    const { schoolId, account } = context.value;
    const student = account.student;
    const studentId = student?.id;
    if (!student || !studentId) {
      return NextResponse.json(
        { ok: false, error: "لا يوجد حساب طالب مرتبط." },
        { status: 403 },
      );
    }

    const raw = await req.json().catch(() => null);
    const parsed = submitBodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        {
          ok: false,
          error: parsed.error.issues[0]?.message ?? "invalid_body",
        },
        { status: 400 },
      );
    }
    const { notes, file_url, file_name, file_mime_type } = parsed.data;

    if (!notes && !file_url) {
      return NextResponse.json(
        { ok: false, error: "يجب إرفاق ملاحظة أو ملف على الأقل." },
        { status: 400 },
      );
    }

    const supabase = createServiceSupabaseClient();

    // The service client bypasses RLS: confirm the assignment belongs to the
    // caller's school, is not moderated away, and is addressed to this student
    // before writing a submission against it.
    const { data: assignmentData, error: assignmentError } = await supabase
      .from("assignments")
      .select("*")
      .eq("id", assignmentId)
      .eq("school_id", schoolId)
      .maybeSingle();

    if (assignmentError) throw assignmentError;

    const assignmentRow = (assignmentData ?? null) as Record<
      string,
      unknown
    > | null;
    const isModeratedAway =
      assignmentRow != null &&
      (assignmentRow.status === "deleted_by_admin" ||
        (assignmentRow.deleted_at !== undefined &&
          assignmentRow.deleted_at !== null));

    if (
      !assignmentRow ||
      isModeratedAway ||
      !isAssignmentVisibleToStudent(assignmentRow, student)
    ) {
      return NextResponse.json(
        { ok: false, error: "الواجب غير موجود." },
        { status: 404 },
      );
    }

    const { data, error } = await assignmentSubmissionsTable(supabase)
      .upsert(
        {
          school_id: schoolId,
          assignment_id: assignmentId,
          student_id: studentId,
          notes: notes ?? null,
          file_url: file_url ?? null,
          file_name: file_name ?? null,
          file_mime_type: file_mime_type ?? null,
          submitted_at: new Date().toISOString(),
        },
        { onConflict: "assignment_id,student_id" },
      )
      .select("id, notes, file_url, file_name, file_mime_type, submitted_at")
      .single();

    if (error) throw error;

    // Event-driven notification to the owning teacher — additive, never blocks
    // the write.
    const teacherId =
      typeof assignmentRow.teacher_id === "string" &&
      assignmentRow.teacher_id.trim()
        ? assignmentRow.teacher_id.trim()
        : null;
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
            studentName: (studentRow as Record<string, unknown> | null)
              ?.full_name as string | undefined,
            title: (assignmentRow.title as string) ?? "واجب",
          });
        })
        .catch(() => {});
    }

    return NextResponse.json({ ok: true, submission: data });
  } catch {
    return NextResponse.json(
      { ok: false, error: "internal_error" },
      { status: 500 },
    );
  }
}
