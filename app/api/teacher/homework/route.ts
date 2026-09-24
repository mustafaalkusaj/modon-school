import { NextRequest, NextResponse } from "next/server";

import {
  createTeacherAssignmentRecord,
  enrichAssignmentRows,
  type TeacherAssignmentCreateInput,
} from "@/lib/academic-records-server";
import { resolveTeacherHomeworkContext } from "@/lib/homework-web-server";
import { enforceRateLimit } from "@/lib/rate-limit";

/** GET — the current teacher's own homework list. */
export async function GET(req: NextRequest) {
  const context = await resolveTeacherHomeworkContext(req);
  if (!context.ok) return context.response;

  const ctx = context.value;
  const teacherId = ctx.account.teacher?.id;
  if (!teacherId) {
    return NextResponse.json({ ok: false, error: "no_teacher_record" }, { status: 403 });
  }

  const { data, error } = await ctx.serviceSupabase
    .from("assignments")
    .select("*")
    .eq("school_id", ctx.schoolId)
    .eq("teacher_id", teacherId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as Record<string, unknown>[];
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

  const enriched = await enrichAssignmentRows(ctx.serviceSupabase, rows);
  const items = enriched.map((row) => {
    const id = row.id as string;
    const counts = submissionCounts.get(id) ?? { total: 0, graded: 0 };
    return { ...row, submissions_total: counts.total, submissions_graded: counts.graded };
  });

  return NextResponse.json({ ok: true, data: items });
}

/** POST — publish a new homework item for a class/section/student this teacher owns. */
export async function POST(req: NextRequest) {
  const context = await resolveTeacherHomeworkContext(req);
  if (!context.ok) return context.response;

  const limited = await enforceRateLimit(req, {
    namespace: "web-teacher-homework-create",
    windowMs: 60_000,
    maxHits: 30,
    identifier: context.value.actorUserId,
  });
  if (limited) return limited;

  const payload = (await req.json().catch(() => null)) as TeacherAssignmentCreateInput | null;
  const result = await createTeacherAssignmentRecord(context.value, payload ?? {});

  return NextResponse.json(
    { ok: result.ok, message: result.message, affectedCount: result.affectedCount ?? 0 },
    { status: result.ok ? 201 : 400 },
  );
}
