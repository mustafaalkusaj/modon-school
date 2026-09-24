import { NextRequest, NextResponse } from "next/server";
import { resolveTeacherContext, unauthorized } from "@/lib/teacher-api";
import { notifyNewAssignment } from "@/lib/notify-events";

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
    data: (data ?? []) as Record<string, unknown>[],
  });
}

export async function POST(req: NextRequest) {
  const ctx = await resolveTeacherContext(req);
  if (!ctx) return unauthorized();

  const { supabase, teacherId, schoolId } = ctx;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_json" },
      { status: 400 },
    );
  }

  const title = body.title as string | undefined;
  const description = body.description as string | undefined;
  const className = body.class_name as string | undefined;
  const section = body.section as string | undefined;
  const subject = body.subject as string | undefined;
  const dueAt = body.due_at as string | undefined;
  const maxGradeRaw = body.max_grade;
  const allowLateRaw = body.allow_late;
  const statusRaw = body.status;

  if (!title || !className || !subject) {
    return NextResponse.json(
      { ok: false, error: "missing_required_fields" },
      { status: 400 },
    );
  }

  const maxGrade =
    typeof maxGradeRaw === "number" && Number.isFinite(maxGradeRaw)
      ? Math.trunc(maxGradeRaw)
      : 100;
  if (maxGrade <= 0) {
    return NextResponse.json(
      { ok: false, error: "invalid_max_grade" },
      { status: 400 },
    );
  }

  const allowLate = allowLateRaw === true;
  const status = isAssignmentStatus(statusRaw) ? statusRaw : "active";

  const { data, error } = await supabase
    .from("assignments")
    .insert({
      title,
      description: description ?? null,
      class_name: className,
      section: section ?? null,
      subject,
      due_at: dueAt ?? null,
      teacher_id: teacherId,
      school_id: schoolId,
      max_grade: maxGrade,
      allow_late: allowLate,
      status,
    })
    .select(
      "id, title, class_name, section, subject, due_at, created_at, max_grade, status, allow_late",
    )
    .single();

  if (error) {
    return NextResponse.json(
      { ok: false, error: "insert_failed" },
      { status: 500 },
    );
  }

  // Best-effort: notify the target class/section's students of the new
  // homework. Never fail assignment creation because notification delivery
  // failed.
  if (status === "active") {
    void notifyNewAssignment({
      supabase,
      schoolId,
      className,
      section,
      title,
      subject,
      dueAt: dueAt ?? null,
    }).catch(() => {});
  }

  return NextResponse.json({
    ok: true,
    data: data as Record<string, unknown>,
  });
}
