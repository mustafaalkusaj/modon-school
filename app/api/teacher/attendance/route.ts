import { NextRequest, NextResponse } from "next/server";
import { recordTeacherAttendanceBatch } from "@/lib/mobile-api-server";
import {
  filterTeacherStudents,
  resolveTeacherContext,
  unauthorized,
} from "@/lib/teacher-api";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  const ctx = await resolveTeacherContext(req);
  if (!ctx) return unauthorized();

  const url = new URL(req.url);
  const className = url.searchParams.get("class_name");
  const rawDate = url.searchParams.get("date") ?? "";
  const date = DATE_RE.test(rawDate) ? rawDate : new Date().toISOString().slice(0, 10);

  if (!className) {
    return NextResponse.json(
      { ok: false, error: "class_name_required" },
      { status: 400 },
    );
  }

  const roster = filterTeacherStudents(ctx, className, url.searchParams.get("section"));
  const studentIds = roster.map((s) => s.student_id);

  const recordMap = new Map<string, Record<string, unknown>>();
  if (studentIds.length > 0) {
    const { data, error } = await ctx.supabase
      .from("attendance_records")
      .select("id, student_id, status, note")
      .eq("school_id", ctx.schoolId)
      .eq("attendance_date", date)
      .in("student_id", studentIds);

    if (error) {
      return NextResponse.json({ ok: false, error: "fetch_failed" }, { status: 500 });
    }
    for (const r of (data ?? []) as Array<Record<string, unknown>>) {
      recordMap.set(r.student_id as string, r);
    }
  }

  const students = roster.map((s) => {
    const rec = recordMap.get(s.student_id);
    return {
      student_id: s.student_id,
      full_name: s.full_name,
      section: s.section,
      status: ((rec?.status as string) ?? "present") as string,
      recorded: Boolean(rec),
      note: (rec?.note as string) ?? null,
    };
  });

  return NextResponse.json({
    ok: true,
    data: { date, class_name: className, students },
  });
}

export async function POST(req: NextRequest) {
  const ctx = await resolveTeacherContext(req);
  if (!ctx) return unauthorized();

  const body = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const rawDate = typeof body.date === "string" ? body.date : "";
  const date = DATE_RE.test(rawDate) ? rawDate : new Date().toISOString().slice(0, 10);
  const records = Array.isArray(body.records)
    ? (body.records as Array<Record<string, unknown>>).map((r) => ({
        student_id: r.student_id,
        status: r.status,
        note: r.note,
        attendance_date: date,
      }))
    : [];

  const result = await recordTeacherAttendanceBatch(ctx.mobile, records);

  return NextResponse.json(
    {
      ok: result.ok,
      message: result.message,
      error: result.ok ? undefined : result.message,
      data: result.data ?? null,
    },
    { status: result.ok ? 200 : 400 },
  );
}
