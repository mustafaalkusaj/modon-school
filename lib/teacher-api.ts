import { NextRequest, NextResponse } from "next/server";
import { RBAC_COOKIE_NAME, verifyRBACSession } from "@/lib/rbac-session";
import { createServiceSupabaseClient } from "@/lib/supabase-server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

export interface TeacherContext {
  userId: string;
  schoolId: string;
  teacherId: string;
  fullName: string | null;
  supabase: SupabaseClient<Database>;
}

export async function resolveTeacherContext(
  req: NextRequest,
): Promise<TeacherContext | null> {
  const session = await verifyRBACSession(
    req.cookies.get(RBAC_COOKIE_NAME)?.value,
  );
  if (!session?.userActive || session.role !== "teacher" || !session.schoolId) {
    return null;
  }

  const supabase = createServiceSupabaseClient();

  const { data: teacher } = await supabase
    .from("teachers")
    .select("id, full_name")
    .eq("school_id", session.schoolId)
    .eq("auth_user_id", session.userId)
    .neq("status", "deleted")
    .maybeSingle();

  if (!teacher) return null;

  const row = teacher as Record<string, unknown>;

  return {
    userId: session.userId,
    schoolId: session.schoolId,
    teacherId: row.id as string,
    fullName: (row.full_name as string) ?? null,
    supabase,
  };
}

export async function verifyTeacherOwnsClass(
  ctx: TeacherContext,
  className: string,
): Promise<boolean> {
  const { data } = await ctx.supabase
    .from("class_schedules")
    .select("id")
    .eq("school_id", ctx.schoolId)
    .eq("teacher_id", ctx.teacherId)
    .eq("class_name", className)
    .limit(1);
  return (data ?? []).length > 0;
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
