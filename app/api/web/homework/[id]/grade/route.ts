import { NextRequest, NextResponse } from "next/server";
import { resolveSchoolScopedActorContext } from "@/lib/managed-users-server";
import { jsonServerError } from "@/lib/route-utils";

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, error: { message } }, { status });
}

type Params = { params: Promise<{ id: string }> };

// PATCH: admin/super_admin grade a submission for the given assignment.
export async function PATCH(req: NextRequest, { params }: Params) {
  const { id: assignmentId } = await params;
  const schoolId = req.nextUrl.searchParams.get("schoolId");
  const context = await resolveSchoolScopedActorContext(
    schoolId,
    {
      allowedRoles: ["super_admin", "admin"],
      roleDeniedMessage: "تقييم الواجبات متاح للإدارة فقط.",
    },
    req.headers.get("authorization"),
  );

  if (!context.ok) {
    return jsonError(
      "message" in context ? context.message : "تعذر التحقق من صلاحيات المستخدم.",
      "status" in context ? context.status : 500,
    );
  }

  const { actorSupabase, targetSchoolId } = context.value;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonError("بيانات الطلب غير صالحة.", 400);
  }

  const { submission_id, grade, feedback } = body as {
    submission_id?: string;
    grade?: number;
    feedback?: string;
  };

  if (!submission_id || typeof submission_id !== "string") {
    return jsonError("معرّف التسليم مطلوب.", 400);
  }

  if (typeof grade !== "number" || !Number.isFinite(grade) || grade < 0) {
    return jsonError("الدرجة يجب أن تكون رقماً أكبر من أو يساوي صفر.", 400);
  }

  try {
    // Fetch the assignment to validate max_grade
    const { data: assignment, error: aErr } = await actorSupabase
      .from("assignments")
      .select("id, max_grade")
      .eq("id", assignmentId)
      .eq("school_id", targetSchoolId)
      .maybeSingle();

    if (aErr) throw aErr;
    if (!assignment) {
      return jsonError("الواجب غير موجود.", 404);
    }

    const assignmentRow = assignment as { id: string; max_grade: number | null };
    const maxGrade = assignmentRow.max_grade ?? 100;

    if (grade > maxGrade) {
      return jsonError(
        `الدرجة يجب أن لا تتجاوز الحد الأقصى (${maxGrade}).`,
        400,
      );
    }

    // Update the submission
    const { data: submission, error: updateErr } = await actorSupabase
      .from("assignment_submissions")
      .update({
        grade,
        feedback: feedback ?? null,
        status: "graded",
        graded_at: new Date().toISOString(),
      })
      .eq("id", submission_id)
      .eq("assignment_id", assignmentId)
      .eq("school_id", targetSchoolId)
      .select("*")
      .single();

    if (updateErr) throw updateErr;
    if (!submission) {
      return jsonError("التسليم غير موجود.", 404);
    }

    return NextResponse.json({ ok: true, data: submission });
  } catch (error) {
    return jsonServerError(
      "web-homework-grade",
      error,
      "تعذر تقييم التسليم.",
      500,
    );
  }
}
