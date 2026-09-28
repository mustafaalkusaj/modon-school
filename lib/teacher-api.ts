import { NextRequest, NextResponse } from "next/server";
import { RBAC_COOKIE_NAME, verifyRBACSession } from "@/lib/rbac-session";
import { createServiceSupabaseClient } from "@/lib/supabase-server";
import { buildManagedAppAccountContext } from "@/lib/managed-user-app-context";
import type { MobileRouteContext } from "@/lib/mobile-api-server";
import { sectionMatches } from "@/lib/section-scope";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

export interface TeacherContext {
  /** auth.users id of the signed-in teacher. */
  userId: string;
  schoolId: string;
  /** teachers.id — the key every teacher_* / assignments / grades FK points at. */
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

  // Teacher accounts are managed accounts: managed_user_profiles.teacher_id
  // links the login to the teachers row. Previously this resolved to the auth
  // user id, which matches no teacher_assignments / assignments FK — so the
  // teacher saw no classes or students and every insert failed.
  const { data: managed } = await supabase
    .from("managed_user_profiles")
    .select("teacher_id, full_name")
    .eq("auth_user_id", session.userId)
    .eq("school_id", session.schoolId)
    .maybeSingle();

  let teacherId =
    typeof managed?.teacher_id === "string" ? managed.teacher_id : null;
  let fullName =
    typeof managed?.full_name === "string" ? managed.full_name : null;

  if (!teacherId) {
    const { data: teacher } = await supabase
      .from("teachers")
      .select("id, full_name")
      .eq("auth_user_id", session.userId)
      .eq("school_id", session.schoolId)
      .maybeSingle();
    if (teacher?.id) {
      teacherId = teacher.id;
      fullName = fullName ?? teacher.full_name ?? null;
    }
  }

  if (!teacherId) return null;

  return {
    userId: session.userId,
    schoolId: session.schoolId,
    teacherId,
    fullName,
    supabase,
  };
}

/**
 * Build the same account context the mobile teacher app uses (assignments +
 * branch-scoped assigned_students roster), so the web teacher portal shares
 * one source of truth for "which classes and students belong to me".
 */
export async function resolveTeacherAppContext(
  ctx: TeacherContext,
): Promise<MobileRouteContext | null> {
  const account = await buildManagedAppAccountContext(ctx.userId).catch(() => null);
  if (
    !account ||
    !account.identity.is_active ||
    account.identity.role !== "teacher" ||
    account.identity.school_id !== ctx.schoolId ||
    !account.teacher?.id
  ) {
    return null;
  }
  return {
    authUserId: ctx.userId,
    role: "teacher",
    schoolId: ctx.schoolId,
    account,
    serviceSupabase: createServiceSupabaseClient(),
  };
}

export interface TeacherClassSummary {
  id: string;
  class_name: string;
  section: string | null;
  student_count: number;
  subjects: string[];
}

function norm(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

/** Group the teacher's active assignments into class/section cards. */
export function summarizeTeacherClasses(
  app: MobileRouteContext,
): TeacherClassSummary[] {
  const teacher = app.account.teacher;
  if (!teacher) return [];
  const students = teacher.assigned_students;
  const map = new Map<string, TeacherClassSummary>();

  for (const a of teacher.assignments) {
    if (!a.is_active || !a.class_name) continue;
    const section = a.section_name?.trim() || null;
    const key = `${norm(a.class_name)}::${norm(section)}`;
    let entry = map.get(key);
    if (!entry) {
      entry = {
        id: key,
        class_name: a.class_name,
        section,
        student_count: students.filter(
          (s) =>
            norm(s.class_name) === norm(a.class_name) &&
            sectionMatches(s.section, section),
        ).length,
        subjects: [],
      };
      map.set(key, entry);
    }
    if (a.subject_name && !entry.subjects.includes(a.subject_name)) {
      entry.subjects.push(a.subject_name);
    }
  }

  return Array.from(map.values()).sort((l, r) =>
    `${l.class_name} ${l.section ?? ""}`.localeCompare(
      `${r.class_name} ${r.section ?? ""}`,
      "ar",
    ),
  );
}

/** Students on the teacher's roster, optionally narrowed to one class/section. */
export function filterTeacherStudents(
  app: MobileRouteContext,
  className?: string | null,
  section?: string | null,
) {
  const students = app.account.teacher?.assigned_students ?? [];
  return students.filter((s) => {
    if (className && norm(s.class_name) !== norm(className)) return false;
    if (!sectionMatches(s.section, section)) return false;
    return true;
  });
}

/** True when `className` is one of the teacher's active admin-set assignments. */
export async function verifyTeacherOwnsClass(
  ctx: TeacherContext,
  className: string,
): Promise<boolean> {
  const app = await resolveTeacherAppContext(ctx);
  if (!app) return false;
  const target = norm(className);
  return summarizeTeacherClasses(app).some((c) => norm(c.class_name) === target);
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
