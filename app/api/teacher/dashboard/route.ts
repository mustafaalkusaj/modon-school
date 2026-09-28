import { todayBaghdadIso } from "@/lib/tz";
import { NextRequest, NextResponse } from "next/server";
import {
  resolveTeacherAppContext,
  resolveTeacherContext,
  summarizeTeacherClasses,
  unauthorized,
} from "@/lib/teacher-api";

export async function GET(req: NextRequest) {
  const ctx = await resolveTeacherContext(req);
  if (!ctx) return unauthorized();
  const app = await resolveTeacherAppContext(ctx);
  if (!app) return unauthorized();

  const { supabase, schoolId, teacherId, userId } = ctx;
  // class_schedules.day_of_week is a smallint (0 = Sunday … 6 = Saturday).
  const todayDay = new Date(`${todayBaghdadIso()}T12:00:00+03:00`).getUTCDay();

  const [scheduleRes, examsRes, assignmentsRes, announcementsRes] =
    await Promise.all([
      supabase
        .from("class_schedules")
        .select(
          "id, start_time, end_time, subject_name, class_name, section, room",
        )
        .eq("school_id", schoolId)
        .eq("teacher_id", teacherId)
        .eq("day_of_week", todayDay)
        .order("start_time", { ascending: true }),
      supabase
        .from("exams")
        .select("id, title, starts_at, subject, class_name")
        .eq("school_id", schoolId)
        .eq("created_by", userId)
        .gte("starts_at", `${todayBaghdadIso()}T00:00:00+03:00`)
        .order("starts_at", { ascending: true })
        .limit(5),
      supabase
        .from("assignments")
        .select("id, title, due_at, class_name, section, subject")
        .eq("school_id", schoolId)
        .eq("teacher_id", teacherId)
        .order("created_at", { ascending: false })
        .limit(5),
      supabase
        .from("school_announcements")
        .select("id, title, body, created_at")
        .eq("school_id", schoolId)
        .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
        .order("created_at", { ascending: false })
        .limit(3),
    ]);

  const classes = summarizeTeacherClasses(app);
  const exams = examsRes.data ?? [];

  return NextResponse.json({
    ok: true,
    data: {
      teacher_name: app.account.teacher?.full_name ?? ctx.fullName,
      school_name: app.account.school.name,
      classes_count: classes.length,
      students_count: app.account.teacher?.assigned_students.length ?? 0,
      subjects: Array.from(new Set(classes.flatMap((c) => c.subjects))),
      upcoming_exams_count: exams.length,
      classes,
      today_schedule: (scheduleRes.data ?? []).map((s) => ({
        id: s.id,
        start_time: s.start_time ?? "",
        end_time: s.end_time ?? "",
        subject_name: s.subject_name ?? "—",
        class_name: [s.class_name, s.section].filter(Boolean).join(" / ") || null,
        room: s.room ?? null,
      })),
      upcoming_exams: exams.map((e) => ({
        id: e.id,
        subject_name: e.subject ?? e.title ?? "",
        exam_date: e.starts_at ?? "",
        class_name: e.class_name ?? null,
      })),
      recent_assignments: (assignmentsRes.data ?? []).map((a) => ({
        id: a.id,
        title: a.title ?? "",
        subject: a.subject ?? null,
        due_at: a.due_at ?? null,
        class_name: [a.class_name, a.section].filter(Boolean).join(" / ") || null,
      })),
      announcements: (announcementsRes.data ?? []).map((a) => ({
        id: a.id,
        title: a.title ?? "",
        body: a.body ?? "",
        created_at: a.created_at ?? "",
      })),
    },
  });
}
