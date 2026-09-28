import { NextRequest, NextResponse } from "next/server";
import { resolveTeacherContext, unauthorized, serverError } from "@/lib/teacher-api";

export async function GET(req: NextRequest) {
  const ctx = await resolveTeacherContext(req);
  if (!ctx) return unauthorized();

  const { supabase, teacherId, schoolId } = ctx;

  const { data, error } = await supabase
    .from("teacher_leaves")
    .select(
      "id, leave_type, reason, start_date, end_date, days_count, status, created_at",
    )
    .eq("teacher_id", teacherId)
    .eq("school_id", schoolId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json(
      { ok: false, error: "fetch_failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    data: { leaves: data ?? [] },
  });
}

export async function POST(req: NextRequest) {
  const ctx = await resolveTeacherContext(req);
  if (!ctx) return unauthorized();

  const { supabase, teacherId, schoolId } = ctx;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_body" },
      { status: 400 },
    );
  }

  const leave_type = body.leave_type as string | undefined;
  const reason = body.reason as string | undefined;
  const start_date = body.start_date as string | undefined;
  const end_date = body.end_date as string | undefined;
  const days_count = body.days_count as number | undefined;

  if (!leave_type || !start_date || !end_date || !days_count) {
    return NextResponse.json(
      { ok: false, error: "missing_fields" },
      { status: 400 },
    );
  }

  const { data, error } = await supabase
    .from("teacher_leaves")
    .insert({
      teacher_id: teacherId,
      school_id: schoolId,
      leave_type,
      reason: reason ?? null,
      start_date,
      end_date,
      days_count,
      status: "pending" as const,
    })
    .select(
      "id, leave_type, reason, start_date, end_date, days_count, status, created_at",
    )
    .single();

  if (error) {
    return serverError("insert_failed");
  }

  return NextResponse.json({
    ok: true,
    data: { leave: data },
  });
}
