import { NextRequest, NextResponse } from "next/server";
import { RBAC_COOKIE_NAME, verifyRBACSession } from "@/lib/rbac-session";
import { createServiceSupabaseClient } from "@/lib/supabase-server";
import {
  buildManagedAppAccountContext,
  type ManagedAppAccountContext,
  type ManagedAppStudentPreview,
} from "@/lib/managed-user-app-context";
import type { MobileRouteContext } from "@/lib/mobile-api-server";
import type { ManagedTeacherAssignmentRecord } from "@/lib/managed-users";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

export interface TeacherContext {
  /** auth.users id of the signed-in teacher. */
  userId: string;
  schoolId: string;
  /** public.teachers id — what every teacher_id FK column references. */
  teacherId: string;
  fullName: string | null;
  supabase: SupabaseClient<Database>;
  account: ManagedAppAccountContext;
  assignments: ManagedTeacherAssignmentRecord[];
  /** Branch-scoped roster derived from teacher_assignments / student_teacher_links. */
  students: ManagedAppStudentPreview[];
  /** Same context shape the mobile teacher helpers take, so web routes can reuse them. */
  mobile: MobileRouteContext;
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

  const account = await buildManagedAppAccountContext(session.userId);
  const teacher = account.teacher;
  if (!teacher?.id) return null;
  if (account.identity.school_id && account.identity.school_id !== session.schoolId) {
    return null;
  }

  const supabase = createServiceSupabaseClient();

  return {
    userId: session.userId,
    schoolId: session.schoolId,
    teacherId: teacher.id,
    fullName: teacher.full_name ?? account.profile.full_name ?? null,
    supabase,
    account,
    assignments: teacher.assignments.filter((a) => a.is_active !== false),
    students: teacher.assigned_students,
    mobile: {
      authUserId: session.userId,
      role: "teacher",
      schoolId: session.schoolId,
      account,
      serviceSupabase: supabase,
    },
  };
}

function normalizeKey(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

export interface TeacherClassSummary {
  class_name: string;
  sections: string[];
  subjects: string[];
  student_count: number;
}

/** The teacher's classes, from admin-set assignments plus any timetable slots. */
export function summarizeTeacherClasses(
  ctx: TeacherContext,
  scheduleClassNames: string[] = [],
): TeacherClassSummary[] {
  const byClass = new Map<
    string,
    { class_name: string; sections: Set<string>; subjects: Set<string> }
  >();

  const touch = (className: string) => {
    const key = normalizeKey(className);
    if (!key) return null;
    let entry = byClass.get(key);
    if (!entry) {
      entry = { class_name: className.trim(), sections: new Set(), subjects: new Set() };
      byClass.set(key, entry);
    }
    return entry;
  };

  for (const assignment of ctx.assignments) {
    const entry = touch(assignment.class_name);
    if (!entry) continue;
    if (assignment.section_name?.trim()) entry.sections.add(assignment.section_name.trim());
    if (assignment.subject_name?.trim()) entry.subjects.add(assignment.subject_name.trim());
  }
  for (const className of scheduleClassNames) touch(className);

  return Array.from(byClass.entries()).map(([key, entry]) => ({
    class_name: entry.class_name,
    sections: Array.from(entry.sections),
    subjects: Array.from(entry.subjects),
    student_count: ctx.students.filter((s) => normalizeKey(s.class_name) === key)
      .length,
  }));
}

/** Roster students, optionally narrowed to one class (and section). */
export function filterTeacherStudents(
  ctx: TeacherContext,
  className?: string | null,
  section?: string | null,
) {
  const classKey = normalizeKey(className);
  const sectionKey = normalizeKey(section);
  return ctx.students.filter((student) => {
    if (classKey && normalizeKey(student.class_name) !== classKey) return false;
    if (sectionKey && normalizeKey(student.section) !== sectionKey) return false;
    return true;
  });
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
