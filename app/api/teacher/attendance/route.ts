import { todayBaghdadIso } from "@/lib/tz";
import { NextRequest, NextResponse } from "next/server";
import { recordTeacherAttendanceBatch } from "@/lib/mobile-api-server";
import {
  filterTeacherStudents,
  resolveTeacherAppContext,
  resolveTeacherContext,
  unauthorized,
} from "@/lib/teacher-api";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Roster of one of the teacher's classes merged with that day's attendance. */
export async function GET(req: NextRequest) {
  const ctx = await resolveTeacherContext(req);
  if (!ctx) return unauthorized();
  const app = await resolveTeacherAppContext(ctx);
  if (!app) return unauthorized();

  const url = new URL(req.url);
  const className = url.searchParams.get("class_name");
  const section = url.searchParams.get("section");
  const rawDate = url.searchParams.get("date") ?? "";
  const date = ISO_DATE.test(rawDate) ? rawDate : todayBaghdadIso();

  if (!className) {
    return NextResponse.json(
      { ok: false, error: "class_name_required" },
      { status: 400 },
    );
  }

  const roster = filterTeacherStudents(app, className, section);
  const statusByStudent = new Map<string, string>();

  if (roster.length > 0) {
    const { data, error } = await ctx.supabase
      .from("attendance_records")
      .select("student_id, status")
      .eq("school_id", ctx.schoolId)
      .eq("attendance_date", date)
      .is("deleted_at", null)
      .in(
        "student_id",
        roster.map((s) => s.student_id),
      );

    if (error) {
      return NextResponse.json(
        { ok: false, error: "fetch_failed" },
        { status: 500 },
      );
    }
    for (const row of data ?? []) {
      if (row.student_id && row.status) {
        statusByStudent.set(row.student_id, row.status);
      }
    }
  }

  return NextResponse.json(
    {
      ok: true,
      data: {
        date,
        class_name: className,
        already_recorded: statusByStudent.size > 0,
        students: roster.map((s) => ({
          student_id: s.student_id,
          full_name: s.full_name,
          section: s.section,
          status: statusByStudent.get(s.student_id) ?? "present",
        })),
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(req: NextRequest) {
  const ctx = await resolveTeacherContext(req);
  if (!ctx) return unauthorized();
  const app = await resolveTeacherAppContext(ctx);
  if (!app) return unauthorized();

  const body = (await req.json().catch(() => null)) as {
    date?: unknown;
    records?: Array<Record<string, unknown>>;
  } | null;

  const date =
    typeof body?.date === "string" && ISO_DATE.test(body.date)
      ? body.date
      : todayBaghdadIso();

  const records = Array.isArray(body?.records)
    ? body.records.map((r) => ({
        student_id: r.student_id,
        status: r.status,
        note: r.note ?? null,
        attendance_date: date,
      }))
    : [];

  const result = await recordTeacherAttendanceBatch(app, records);

  return NextResponse.json(
    {
      ok: result.ok,
      error: result.ok ? undefined : result.message,
      message: result.message,
      data: result.data ?? null,
    },
    { status: result.ok ? 200 : 400 },
  );
}
