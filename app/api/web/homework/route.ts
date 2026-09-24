import { NextRequest, NextResponse } from "next/server";

import {
  createTeacherAssignmentRecord,
  type TeacherAssignmentCreateInput,
} from "@/lib/academic-records-server";
import {
  listAdminHomework,
  resolveAdminHomeworkContext,
  resolveTeacherHomeworkContext,
} from "@/lib/homework-web-server";
import { enforceRateLimit } from "@/lib/rate-limit";
import { jsonError, jsonServerError } from "@/lib/route-utils";

/**
 * GET /api/web/homework
 *
 * Unified homework listing endpoint.
 * - Admins / super_admins: all assignments in the school (filterable).
 * - Teachers: only their own assignments.
 *
 * Query params:
 *   schoolId  — required
 *   role      — "admin" | "teacher" (defaults to admin)
 *   status    — filter by status
 *   subject   — filter by subject
 *   className — filter by class
 *   search    — free-text search on title
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const requestedRole = searchParams.get("role") ?? "admin";

  // ── Teacher path ──────────────────────────────────────────────
  if (requestedRole === "teacher") {
    const context = await resolveTeacherHomeworkContext(req);
    if (!context.ok) return context.response;

    const ctx = context.value;
    const teacherId = ctx.account.teacher?.id;
    if (!teacherId) {
      return jsonError("حساب المعلم غير مرتبط بسجل صالح.", 403);
    }

    try {
      const { data, error } = await ctx.serviceSupabase
        .from("assignments")
        .select("*")
        .eq("school_id", ctx.schoolId)
        .eq("teacher_id", teacherId)
        .order("created_at", { ascending: false });

      if (error) {
        return jsonServerError("homework.GET.teacher", error, "تعذر تحميل الواجبات.", 500);
      }

      const rows = (data ?? []) as Record<string, unknown>[];
      const assignmentIds = rows
        .map((r) => r.id as string)
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

      const { enrichAssignmentRows } = await import("@/lib/academic-records-server");
      const enriched = await enrichAssignmentRows(ctx.serviceSupabase, rows);
      const items = enriched.map((row) => {
        const id = row.id as string;
        const counts = submissionCounts.get(id) ?? { total: 0, graded: 0 };
        return { ...row, submissions_total: counts.total, submissions_graded: counts.graded };
      });

      return NextResponse.json({ ok: true, data: items });
    } catch (err) {
      return jsonServerError("homework.GET.teacher", err, "تعذر تحميل الواجبات.", 500);
    }
  }

  // ── Admin path ────────────────────────────────────────────────
  const context = await resolveAdminHomeworkContext(req);
  if (!context.ok) return context.response;

  try {
    const items = await listAdminHomework(context.value, {
      subject: searchParams.get("subject"),
      className: searchParams.get("className"),
      status: searchParams.get("status"),
      search: searchParams.get("search"),
    });

    return NextResponse.json({ ok: true, data: items });
  } catch (err) {
    return jsonServerError("homework.GET.admin", err, "تعذر تحميل الواجبات.", 500);
  }
}

/**
 * POST /api/web/homework
 *
 * Create a new homework assignment.
 * Body fields: title, description, subject, class_name, section,
 *              due_at, max_grade, allow_late, status, attachment
 */
export async function POST(req: NextRequest) {
  const context = await resolveTeacherHomeworkContext(req);
  if (!context.ok) return context.response;

  const limited = await enforceRateLimit(req, {
    namespace: "web-homework-create",
    windowMs: 60_000,
    maxHits: 30,
    identifier: context.value.actorUserId,
  });
  if (limited) return limited;

  const payload = (await req.json().catch(() => null)) as TeacherAssignmentCreateInput | null;
  if (!payload) {
    return jsonError("بيانات الطلب غير صالحة.", 400);
  }

  const result = await createTeacherAssignmentRecord(context.value, payload);

  return NextResponse.json(
    { ok: result.ok, message: result.message, affectedCount: result.affectedCount ?? 0 },
    { status: result.ok ? 201 : 400 },
  );
}
