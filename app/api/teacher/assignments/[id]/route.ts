import { NextRequest, NextResponse } from "next/server";
import { resolveTeacherContext, unauthorized } from "@/lib/teacher-api";

const ASSIGNMENT_STATUSES = ["active", "draft", "archived"] as const;
type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

function isAssignmentStatus(value: unknown): value is AssignmentStatus {
  return (
    typeof value === "string" &&
    (ASSIGNMENT_STATUSES as readonly string[]).includes(value)
  );
}

type Params = { params: Promise<{ id: string }> };

// PATCH: teacher edits/archives their own assignment.
export async function PATCH(req: NextRequest, { params }: Params) {
  const ctx = await resolveTeacherContext(req);
  if (!ctx) return unauthorized();

  const { id } = await params;
  const { supabase, teacherId, schoolId } = ctx;

  const { data: existing, error: fetchErr } = await supabase
    .from("assignments")
    .select("id, teacher_id, school_id")
    .eq("id", id)
    .eq("school_id", schoolId)
    .maybeSingle();

  if (fetchErr) {
    return NextResponse.json(
      { ok: false, error: "fetch_failed" },
      { status: 500 },
    );
  }
  const existingRow = existing as Record<string, unknown> | null;
  if (!existingRow || existingRow.teacher_id !== teacherId) {
    return NextResponse.json(
      { ok: false, error: "not_found" },
      { status: 404 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_json" },
      { status: 400 },
    );
  }

  const update: Record<string, unknown> = {};

  if (typeof body.title === "string" && body.title.trim()) {
    update.title = body.title;
  }
  if (body.description === null || typeof body.description === "string") {
    update.description = body.description ?? null;
  }
  if (typeof body.class_name === "string" && body.class_name.trim()) {
    update.class_name = body.class_name;
  }
  if (body.section === null || typeof body.section === "string") {
    update.section = body.section ?? null;
  }
  if (typeof body.subject === "string" && body.subject.trim()) {
    update.subject = body.subject;
  }
  if (body.due_at === null || typeof body.due_at === "string") {
    update.due_at = body.due_at ?? null;
  }
  if (typeof body.max_grade === "number" && Number.isFinite(body.max_grade)) {
    if (body.max_grade <= 0) {
      return NextResponse.json(
        { ok: false, error: "invalid_max_grade" },
        { status: 400 },
      );
    }
    update.max_grade = Math.trunc(body.max_grade);
  }
  if (typeof body.allow_late === "boolean") {
    update.allow_late = body.allow_late;
  }
  if (isAssignmentStatus(body.status)) {
    update.status = body.status;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json(
      { ok: false, error: "no_fields_to_update" },
      { status: 400 },
    );
  }

  const { data, error } = await supabase
    .from("assignments")
    .update(update)
    .eq("id", id)
    .eq("teacher_id", teacherId)
    .eq("school_id", schoolId)
    .select(
      "id, title, description, class_name, section, subject, due_at, max_grade, status, allow_late, updated_at",
    )
    .single();

  if (error) {
    return NextResponse.json(
      { ok: false, error: "update_failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, data: data as Record<string, unknown> });
}

// DELETE: teacher archives their own assignment (soft-delete via status).
export async function DELETE(req: NextRequest, { params }: Params) {
  const ctx = await resolveTeacherContext(req);
  if (!ctx) return unauthorized();

  const { id } = await params;
  const { supabase, teacherId, schoolId } = ctx;

  const { data, error } = await supabase
    .from("assignments")
    .update({ status: "archived" })
    .eq("id", id)
    .eq("teacher_id", teacherId)
    .eq("school_id", schoolId)
    .select("id, status")
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { ok: false, error: "delete_failed" },
      { status: 500 },
    );
  }
  if (!data) {
    return NextResponse.json(
      { ok: false, error: "not_found" },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true, data });
}
