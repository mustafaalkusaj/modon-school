/**
 * Cron worker: reminds students one day before a homework due date if they
 * have not submitted yet. Registered in vercel.json under `crons`; Vercel
 * sends `Authorization: Bearer $CRON_SECRET` automatically — same guard as
 * /api/cron/account-deletion. `OPS_ALERT_TOKEN` is also accepted so it can be
 * triggered by hand.
 */
import { NextRequest, NextResponse } from "next/server";

import { notifyDeadlineReminder } from "@/lib/notify-events";
import { isOpsTokenAuthorized } from "@/lib/ops/security";
import { logRouteError } from "@/lib/route-utils";
import { createServiceSupabaseClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

function unauthorized() {
  return NextResponse.json(
    { ok: false, error: "Unauthorized" },
    { status: 401, headers: { "Cache-Control": "no-store" } },
  );
}

async function handle(req: NextRequest) {
  if (
    !isOpsTokenAuthorized(req, [
      process.env.CRON_SECRET,
      process.env.OPS_ALERT_TOKEN,
    ])
  ) {
    return unauthorized();
  }

  const client = createServiceSupabaseClient();

  const now = new Date();
  const windowStart = new Date(now.getTime() + 20 * 60 * 60 * 1000); // +20h
  const windowEnd = new Date(now.getTime() + 28 * 60 * 60 * 1000); // +28h
  // A ~24h-out window (20h–28h ahead) run once daily catches "due tomorrow"
  // regardless of exact cron trigger time, without re-notifying the same
  // assignment across consecutive daily runs.

  let dueAssignments;
  try {
    const { data, error } = await client
      .from("assignments")
      .select("id, school_id, title, subject, class_name, section, due_at, student_id, status")
      .eq("status", "active")
      .gte("due_at", windowStart.toISOString())
      .lt("due_at", windowEnd.toISOString());

    if (error) throw error;
    dueAssignments = data ?? [];
  } catch (error) {
    logRouteError("cron/homework-deadline-reminder:load", error);
    return NextResponse.json(
      { ok: false, error: "تعذر تحميل الواجبات المستحقة." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }

  let notified = 0;
  let failed = 0;

  for (const assignment of dueAssignments as Record<string, unknown>[]) {
    try {
      const schoolId = assignment.school_id as string;
      const assignmentId = assignment.id as string;
      const className = (assignment.class_name as string) ?? null;
      const section = (assignment.section as string) ?? null;
      const directStudentId = (assignment.student_id as string) ?? null;

      let candidateStudentIds: string[] = [];
      if (directStudentId) {
        candidateStudentIds = [directStudentId];
      } else if (className) {
        let query = client
          .from("students")
          .select("id")
          .eq("school_id", schoolId)
          .eq("class_name", className);
        if (section) query = query.eq("section", section);
        const { data: students } = await query;
        candidateStudentIds = (students ?? [])
          .map((row) => (row as Record<string, unknown>).id as string)
          .filter(Boolean);
      }

      if (candidateStudentIds.length === 0) continue;

      const { data: submitted } = await client
        .from("assignment_submissions")
        .select("student_id")
        .eq("assignment_id", assignmentId)
        .in("student_id", candidateStudentIds);

      const submittedIds = new Set(
        (submitted ?? []).map(
          (row) => (row as Record<string, unknown>).student_id as string,
        ),
      );
      const pendingStudentIds = candidateStudentIds.filter(
        (id) => !submittedIds.has(id),
      );

      if (pendingStudentIds.length === 0) continue;

      const result = await notifyDeadlineReminder({
        supabase: client,
        schoolId,
        studentIds: pendingStudentIds,
        title: (assignment.title as string) ?? "واجب",
        subject: (assignment.subject as string) ?? null,
        dueAt: (assignment.due_at as string) ?? null,
      });
      notified += result.sent + result.inAppSaved;
    } catch (error) {
      failed += 1;
      logRouteError("cron/homework-deadline-reminder:notify", error);
    }
  }

  return NextResponse.json(
    {
      ok: true,
      assignments_checked: dueAssignments.length,
      notified,
      failed,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
