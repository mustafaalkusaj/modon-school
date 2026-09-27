import { NextRequest, NextResponse } from "next/server";
import {
  resolveTeacherContext,
  summarizeTeacherClasses,
  unauthorized,
} from "@/lib/teacher-api";

export async function GET(req: NextRequest) {
  const ctx = await resolveTeacherContext(req);
  if (!ctx) return unauthorized();

  const { data: scheduleData } = await ctx.supabase
    .from("class_schedules")
    .select("class_name")
    .eq("school_id", ctx.schoolId)
    .eq("teacher_id", ctx.teacherId);

  const scheduleClassNames = ((scheduleData ?? []) as Array<{ class_name: string | null }>)
    .map((row) => row.class_name ?? "")
    .filter(Boolean);

  const classes = summarizeTeacherClasses(ctx, scheduleClassNames).map((c) => ({
    id: c.class_name,
    ...c,
  }));

  const assignments = ctx.assignments.map((a) => ({
    class_name: a.class_name,
    section: a.section_name,
    subject: a.subject_name,
  }));

  return NextResponse.json({ ok: true, data: { classes, assignments } });
}
