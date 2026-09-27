import { NextRequest, NextResponse } from "next/server";
import { resolveTeacherContext, unauthorized } from "@/lib/teacher-api";
import { createTeacherAssignmentRecord } from "@/lib/academic-records-server";
import { enforceRateLimit } from "@/lib/rate-limit";

const ASSIGNMENT_STATUSES = ["active", "draft", "archived"] as const;
type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

function isAssignmentStatus(value: unknown): value is AssignmentStatus {
  return (
    typeof value === "string" &&
    (ASSIGNMENT_STATUSES as readonly string[]).includes(value)
  );
}

export async function GET(req: NextRequest) {
  const ctx = await resolveTeacherContext(req);
  if (!ctx) return unauthorized();

  const { supabase, teacherId, schoolId } = ctx;

  const { data, error } = await supabase
    .from("assignments")
    .select(
      "id, title, description, class_name, subject, due_at, created_at, max_grade, status, allow_late, section",
    )
    .eq("school_id", schoolId)
    .eq("teacher_id", teacherId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json(
      { ok: false, error: "fetch_failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    data: ((data ?? []) as Record<string, unknown>[]).map((row) => ({
      ...row,
      due_date: row.due_at ?? null,
    })),
  });
}

export async function POST(req: NextRequest) {
  const ctx = await resolveTeacherContext(req);
  if (!ctx) return unauthorized();

  const limited = await enforceRateLimit(req, {
    namespace: "web-teacher-homework-create",
    windowMs: 60_000,
    maxHits: 30,
    identifier: ctx.userId,
  });
  if (limited) return limited;

  const body = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const status = isAssignmentStatus(body.status) ? body.status : "active";

  const result = await createTeacherAssignmentRecord(
    { schoolId: ctx.schoolId, account: { teacher: { id: ctx.teacherId, assignments: ctx.assignments } }, serviceSupabase: ctx.supabase },
    {
      title: body.title,
      description: body.description,
      class_name: body.class_name,
      section: body.section,
      subject: body.subject,
      student_id: body.student_id,
      due_at: body.due_at ?? body.due_date,
      max_grade: body.max_grade,
      allow_late: body.allow_late,
      status,
    },
  );

  return NextResponse.json(
    { ok: result.ok, message: result.message, error: result.ok ? undefined : result.message },
    { status: result.ok ? 201 : 400 },
  );
}
