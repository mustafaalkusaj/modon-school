import { NextRequest, NextResponse } from "next/server";
import {
  resolveTeacherContext,
  summarizeTeacherClasses,
  unauthorized,
} from "@/lib/teacher-api";

const DAY_MAP: Record<number, string> = {
  0: "sunday",
  1: "monday",
  2: "tuesday",
  3: "wednesday",
  4: "thursday",
  5: "friday",
  6: "saturday",
};

export async function GET(req: NextRequest) {
  const ctx = await resolveTeacherContext(req);
  if (!ctx) return unauthorized();

  const { supabase, schoolId, teacherId, userId } = ctx;

  const todayDay = DAY_MAP[new Date().getDay()] ?? "sunday";

  const [scheduleRes, examsRes, assignmentsRes, announcementsRes, unreadRes] =
    await Promise.all([
      supabase
        .from("class_schedules")
        .select(
          "id, day_of_week, start_time, end_time, subject_name, class_name, room",
        )
        .eq("school_id", schoolId)
        .eq("teacher_id", teacherId),

      supabase
        .from("exams")
        .select("id, title, starts_at, subject, class_name")
        .eq("school_id", schoolId)
        .eq("created_by", userId)
        .gte("starts_at", new Date().toISOString().slice(0, 10))
        .order("starts_at", { ascending: true })
        .limit(5),

      supabase
        .from("assignments")
        .select("id, title, due_at, class_name, subject, created_at")
        .eq("school_id", schoolId)
        .eq("teacher_id", teacherId)
        .order("created_at", { ascending: false })
        .limit(5),

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any)
        .from("announcements")
        .select("id, title, body, created_at")
        .eq("school_id", schoolId)
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(3),

      supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("school_id", schoolId)
        .eq("is_read", false),
    ]);

  const allSlots = (scheduleRes.data ?? []) as Array<Record<string, unknown>>;
  const todaySchedule = allSlots
    .filter((s) => s.day_of_week === todayDay)
    .map((s) => ({
      id: s.id as string,
      start_time: (s.start_time as string) ?? "",
      end_time: (s.end_time as string) ?? "",
      subject_name: (s.subject_name as string) ?? "—",
      class_name: (s.class_name as string) ?? null,
      room: (s.room as string) ?? null,
    }))
    .sort((a, b) => a.start_time.localeCompare(b.start_time));

  const classes = summarizeTeacherClasses(
    ctx,
    allSlots.map((s) => (s.class_name as string) ?? "").filter(Boolean),
  );
  const subjects = Array.from(new Set(classes.flatMap((c) => c.subjects)));

  const exams = (examsRes.data ?? []) as Array<Record<string, unknown>>;
  const assignments = (assignmentsRes.data ?? []) as Array<Record<string, unknown>>;
  const announcements = (announcementsRes.data ?? []) as Array<Record<string, unknown>>;

  return NextResponse.json({
    ok: true,
    data: {
      teacher_name: ctx.fullName,
      subjects,
      classes: classes.map((c) => ({
        class_name: c.class_name,
        sections: c.sections,
        subjects: c.subjects,
        student_count: c.student_count,
      })),
      classes_count: classes.length,
      students_count: ctx.students.length,
      upcoming_exams_count: exams.length,
      unread_notifications: unreadRes.count ?? 0,
      today_schedule: todaySchedule,
      upcoming_exams: exams.map((e) => ({
        id: e.id as string,
        title: (e.title as string) ?? "",
        subject_name: (e.subject as string) ?? "",
        exam_date: (e.starts_at as string) ?? "",
        class_name: (e.class_name as string) ?? null,
      })),
      recent_assignments: assignments.map((a) => ({
        id: a.id as string,
        title: (a.title as string) ?? "",
        subject: (a.subject as string) ?? null,
        due_at: (a.due_at as string) ?? null,
        class_name: (a.class_name as string) ?? null,
      })),
      announcements: announcements.map((a) => ({
        id: a.id as string,
        title: (a.title as string) ?? "",
        body: (a.body as string) ?? "",
        created_at: (a.created_at as string) ?? "",
      })),
    },
  });
}
