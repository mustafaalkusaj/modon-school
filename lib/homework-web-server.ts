/**
 * Web (RBAC-session) glue for the homework module.
 *
 * The actual read/write logic already lives in lib/academic-records-server.ts
 * (built for the mobile teacher API) and lib/mobile-api-server.ts. This file
 * only adapts the web actor-resolution path (resolveSchoolScopedActorContext,
 * which reads the `school_rbac` cookie / bearer session) into the same
 * `AcademicTeacherRouteContext` shape those functions expect, so none of that
 * logic is duplicated for the web surface.
 */
import { NextRequest, NextResponse } from "next/server";

import { resolveSchoolScopedActorContext } from "@/lib/managed-users/context";
import { buildManagedAppAccountContext } from "@/lib/managed-user-app-context";
import { createServiceSupabaseClient } from "@/lib/supabase-server";
import type { AcademicTeacherRouteContext } from "@/lib/academic-records-server";

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export interface WebTeacherHomeworkContext extends AcademicTeacherRouteContext {
  actorUserId: string;
}

/**
 * Resolve the calling teacher's homework-write context from the web RBAC
 * session. Returns a 403 if the account has no linked teacher record.
 */
export async function resolveTeacherHomeworkContext(
  req: NextRequest,
): Promise<
  | { ok: true; value: WebTeacherHomeworkContext }
  | { ok: false; response: NextResponse }
> {
  const context = await resolveSchoolScopedActorContext(
    req.nextUrl.searchParams.get("schoolId"),
    {
      allowedRoles: ["teacher"],
      roleDeniedMessage: "إدارة الواجبات متاحة لحسابات المعلمين فقط.",
    },
    req.headers.get("authorization"),
  );

  if (!context.ok) {
    return { ok: false, response: jsonError(context.message, context.status) };
  }

  const { actorUserId, targetSchoolId } = context.value;
  const account = await buildManagedAppAccountContext(actorUserId);

  if (!account.teacher?.id) {
    return {
      ok: false,
      response: jsonError("حساب المعلم الحالي غير مرتبط بسجل صالح.", 403),
    };
  }

  return {
    ok: true,
    value: {
      actorUserId,
      schoolId: targetSchoolId,
      account: { teacher: account.teacher },
      serviceSupabase: createServiceSupabaseClient(),
    },
  };
}

export interface WebAdminHomeworkContext {
  actorUserId: string;
  schoolId: string;
  serviceSupabase: ReturnType<typeof createServiceSupabaseClient>;
}

/**
 * Resolve an admin/super_admin/employee actor for the read-only homework
 * oversight surface (list all homework in the school + stats).
 */
export async function resolveAdminHomeworkContext(
  req: NextRequest,
): Promise<
  | { ok: true; value: WebAdminHomeworkContext }
  | { ok: false; response: NextResponse }
> {
  const context = await resolveSchoolScopedActorContext(
    req.nextUrl.searchParams.get("schoolId"),
    {
      allowedRoles: ["super_admin", "admin", "employee"],
      roleDeniedMessage: "الإشراف على الواجبات متاح لإدارة المدرسة فقط.",
    },
    req.headers.get("authorization"),
  );

  if (!context.ok) {
    return { ok: false, response: jsonError(context.message, context.status) };
  }

  return {
    ok: true,
    value: {
      actorUserId: context.value.actorUserId,
      schoolId: context.value.targetSchoolId,
      serviceSupabase: createServiceSupabaseClient(),
    },
  };
}

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export interface HomeworkListFilters {
  subject?: string | null;
  className?: string | null;
  status?: string | null;
  search?: string | null;
}

/** All homework in the school, for the admin oversight list. */
export async function listAdminHomework(
  ctx: WebAdminHomeworkContext,
  filters: HomeworkListFilters,
) {
  let query = ctx.serviceSupabase
    .from("assignments")
    .select("*")
    .eq("school_id", ctx.schoolId);

  const subject = normalizeText(filters.subject);
  const className = normalizeText(filters.className);
  const status = normalizeText(filters.status);
  const search = normalizeText(filters.search);

  if (subject) query = query.eq("subject", subject);
  if (className) query = query.eq("class_name", className);
  if (status) query = query.eq("status", status);
  if (search) query = query.ilike("title", `%${search}%`);

  const { data, error } = await query.order("created_at", { ascending: false });
  if (error) throw error;

  const rows = (data ?? []) as Record<string, unknown>[];
  const { enrichAssignmentRows } = await import("@/lib/academic-records-server");
  const enriched = await enrichAssignmentRows(ctx.serviceSupabase, rows);

  const assignmentIds = rows
    .map((row) => row.id as string)
    .filter((id): id is string => Boolean(id));

  const submissionCounts = new Map<string, { total: number; graded: number }>();
  if (assignmentIds.length > 0) {
    const { data: submissions } = await ctx.serviceSupabase
      .from("assignment_submissions")
      .select("assignment_id, status")
      .in("assignment_id", assignmentIds);

    for (const row of (submissions ?? []) as Record<string, unknown>[]) {
      const id = row.assignment_id as string;
      if (!id) continue;
      const entry = submissionCounts.get(id) ?? { total: 0, graded: 0 };
      entry.total += 1;
      if (row.status === "graded") entry.graded += 1;
      submissionCounts.set(id, entry);
    }
  }

  return enriched.map((row) => {
    const id = row.id as string;
    const counts = submissionCounts.get(id) ?? { total: 0, graded: 0 };
    return { ...row, submissions_total: counts.total, submissions_graded: counts.graded };
  });
}

/** Submission-rate / average-score stats for the admin overview panel. */
export async function computeHomeworkStats(ctx: WebAdminHomeworkContext) {
  const { data: assignments, error: assignmentsError } = await ctx.serviceSupabase
    .from("assignments")
    .select("id, subject, class_name, status")
    .eq("school_id", ctx.schoolId);

  if (assignmentsError) throw assignmentsError;

  const assignmentRows = (assignments ?? []) as Record<string, unknown>[];
  const assignmentIds = assignmentRows
    .map((row) => row.id as string)
    .filter((id): id is string => Boolean(id));

  const { data: submissions, error: submissionsError } =
    assignmentIds.length > 0
      ? await ctx.serviceSupabase
          .from("assignment_submissions")
          .select("assignment_id, grade, status")
          .in("assignment_id", assignmentIds)
      : { data: [] as Record<string, unknown>[], error: null };

  if (submissionsError) throw submissionsError;

  const assignmentById = new Map(
    assignmentRows.map((row) => [row.id as string, row]),
  );

  type Bucket = { totalStudentsSubmitted: number; totalGrades: number; sumGrades: number };
  const bySubject = new Map<string, Bucket>();
  const byClass = new Map<string, Bucket>();

  const emptyBucket = (): Bucket => ({
    totalStudentsSubmitted: 0,
    totalGrades: 0,
    sumGrades: 0,
  });

  for (const submission of (submissions ?? []) as Record<string, unknown>[]) {
    const assignment = assignmentById.get(submission.assignment_id as string);
    const subject = normalizeText(assignment?.subject) || "غير محدد";
    const className = normalizeText(assignment?.class_name) || "غير محدد";

    const subjectBucket = bySubject.get(subject) ?? emptyBucket();
    const classBucket = byClass.get(className) ?? emptyBucket();

    subjectBucket.totalStudentsSubmitted += 1;
    classBucket.totalStudentsSubmitted += 1;

    if (typeof submission.grade === "number") {
      subjectBucket.totalGrades += 1;
      subjectBucket.sumGrades += submission.grade;
      classBucket.totalGrades += 1;
      classBucket.sumGrades += submission.grade;
    }

    bySubject.set(subject, subjectBucket);
    byClass.set(className, classBucket);
  }

  const toStatsArray = (map: Map<string, Bucket>) =>
    Array.from(map.entries()).map(([key, bucket]) => ({
      name: key,
      submissions: bucket.totalStudentsSubmitted,
      average_grade:
        bucket.totalGrades > 0
          ? Math.round((bucket.sumGrades / bucket.totalGrades) * 10) / 10
          : null,
    }));

  return {
    total_assignments: assignmentRows.length,
    active_assignments: assignmentRows.filter((row) => row.status === "active")
      .length,
    total_submissions: (submissions ?? []).length,
    by_subject: toStatsArray(bySubject),
    by_class: toStatsArray(byClass),
  };
}
