import { NextRequest, NextResponse } from "next/server";
import { RBAC_COOKIE_NAME, verifyRBACSession } from "@/lib/rbac-session";
import { createServiceSupabaseClient } from "@/lib/supabase-server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

export interface StudentContext {
  userId: string;
  schoolId: string;
  studentId: string;
  className: string | null;
  supabase: SupabaseClient<Database>;
}

export async function resolveStudentContext(
  req: NextRequest,
): Promise<StudentContext | null> {
  const session = await verifyRBACSession(
    req.cookies.get(RBAC_COOKIE_NAME)?.value,
  );
  if (!session?.userActive || session.role !== "student" || !session.schoolId) {
    return null;
  }

  const supabase = createServiceSupabaseClient();

  const { data: profile } = await supabase
    .from("managed_user_profiles")
    .select("student_id")
    .eq("auth_user_id", session.userId)
    .eq("school_id", session.schoolId)
    .maybeSingle();

  let studentId =
    typeof (profile as Record<string, unknown>)?.student_id === "string"
      ? ((profile as Record<string, unknown>).student_id as string)
      : null;

  // Defensive fallback: managed_user_profiles (canonical, mobile-facing) and
  // user_profiles (web-facing) are supposed to stay in sync via a trigger,
  // but a student whose row only exists in user_profiles/students would
  // otherwise be locked out of every /api/student/* route despite holding a
  // valid RBAC session. Re-verify school_id and active status here exactly
  // like the primary path (which is itself scoped by the RBAC session's
  // userActive/schoolId checks above) before trusting the fallback lookup.
  if (!studentId) {
    const { data: legacyProfile } = await supabase
      .from("user_profiles")
      .select("role, school_id, is_active")
      .eq("id", session.userId)
      .eq("school_id", session.schoolId)
      .maybeSingle();

    const legacy = legacyProfile as Record<string, unknown> | null;
    const legacyIsActive =
      typeof legacy?.is_active === "boolean" ? legacy.is_active : true;

    if (legacy && legacy.role === "student" && legacyIsActive) {
      const { data: legacyStudent } = await supabase
        .from("students")
        .select("id")
        .eq("auth_user_id", session.userId)
        .eq("school_id", session.schoolId)
        .maybeSingle();

      const legacyStudentId = (legacyStudent as Record<string, unknown>)?.id;
      if (typeof legacyStudentId === "string") {
        studentId = legacyStudentId;
      }
    }
  }

  if (!studentId) return null;

  const { data: student } = await supabase
    .from("students")
    .select("class_name")
    .eq("id", studentId)
    .eq("school_id", session.schoolId)
    .maybeSingle();

  return {
    userId: session.userId,
    schoolId: session.schoolId,
    studentId,
    className: (student as Record<string, unknown>)?.class_name as string | null,
    supabase,
  };
}

export function unauthorized() {
  return NextResponse.json(
    { ok: false, error: "unauthorized" },
    { status: 401, headers: { "Cache-Control": "no-store" } },
  );
}

export function serverError(message: string) {
  return NextResponse.json(
    { ok: false, error: message },
    { status: 500 },
  );
}
