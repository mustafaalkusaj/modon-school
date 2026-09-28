import { NextRequest, NextResponse } from "next/server";
import { resolveTeacherContext, unauthorized } from "@/lib/teacher-api";

// class_schedules.day_of_week is a smallint: 0 = Sunday … 6 = Saturday.
const DAY_NAME = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

export async function GET(req: NextRequest) {
  const ctx = await resolveTeacherContext(req);
  if (!ctx) return unauthorized();

  const { supabase, schoolId, teacherId } = ctx;

  const { data, error } = await supabase
    .from("class_schedules")
    .select(
      "id, day_of_week, start_time, end_time, subject_name, class_name, section, room",
    )
    .eq("school_id", schoolId)
    .eq("teacher_id", teacherId)
    .order("start_time", { ascending: true });

  if (error) {
    return NextResponse.json(
      { ok: false, error: "fetch_failed" },
      { status: 500 },
    );
  }

  const slots = (data ?? []).map((row) => ({
    id: row.id,
    day_of_week: DAY_NAME[row.day_of_week ?? 0] ?? "sunday",
    start_time: row.start_time ?? "",
    end_time: row.end_time ?? "",
    subject_name: row.subject_name ?? "—",
    class_name:
      [row.class_name, row.section].filter(Boolean).join(" / ") || null,
    room: row.room ?? null,
  }));

  return NextResponse.json({ ok: true, data: { slots } });
}
