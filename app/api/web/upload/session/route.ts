import { NextRequest, NextResponse } from "next/server";

import { resolveSchoolScopedActorContext } from "@/lib/managed-users-server";
import { createServiceSupabaseClient } from "@/lib/supabase-server";
import { isValidUUID, jsonError, jsonServerError } from "@/lib/route-utils";
import { excludeDeletedStudents } from "@/lib/students/soft-delete";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const schoolId = body?.schoolId ?? null;

  if (!schoolId) {
    return jsonError("schoolId is required.", 400);
  }

  const context = await resolveSchoolScopedActorContext(
    schoolId,
    {
      allowedRoles: ["super_admin", "admin", "employee"],
      roleDeniedMessage: "غير مصرح بالوصول.",
    },
    req.headers.get("authorization"),
  );
  if (!context.ok) {
    return jsonError(
      "message" in context ? context.message : "Unauthorized",
      "status" in context ? context.status : 403,
    );
  }

  const { targetSchoolId } = context.value;
  const studentId =
    typeof body?.studentId === "string" && body.studentId
      ? body.studentId
      : null;

  const serviceSupabase = createServiceSupabaseClient();

  // A caller may only open an upload session for a student inside the school
  // their session actually resolved to.
  if (studentId) {
    if (!isValidUUID(studentId)) {
      return jsonError("معرف الطالب غير صالح.", 400);
    }
    const { data: student } = await excludeDeletedStudents(
      serviceSupabase.from("students").select("id"),
    )
      .eq("id", studentId)
      .eq("school_id", targetSchoolId)
      .maybeSingle();
    if (!student) {
      return jsonError("الطالب غير موجود ضمن هذه المدرسة.", 404);
    }
  }

  const { data, error } = await serviceSupabase
    .from("upload_sessions")
    .insert({
      school_id: targetSchoolId,
      student_id: studentId,
      status: "pending",
    })
    .select("token, expires_at")
    .single();

  if (error || !data) {
    return jsonServerError(
      "web-upload-session",
      error,
      "Failed to create upload session.",
      500,
    );
  }

  return NextResponse.json({
    ok: true,
    token: data.token,
    expires_at: data.expires_at,
  });
}
