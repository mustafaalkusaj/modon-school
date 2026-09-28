import { NextRequest, NextResponse } from "next/server";
import { sectionMatches } from "@/lib/section-scope";
import {
  resolveTeacherAppContext,
  resolveTeacherContext,
  unauthorized,
} from "@/lib/teacher-api";

function norm(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

/**
 * Who the teacher can notify: their assigned classes/sections and the students
 * on their roster (the same roster sendTeacherBroadcast targets), plus whether
 * each student has a device registered for push — so the send page can show
 * how many phones will actually ring.
 */
export async function GET(req: NextRequest) {
  const ctx = await resolveTeacherContext(req);
  if (!ctx) return unauthorized();
  const app = await resolveTeacherAppContext(ctx);
  const teacher = app?.account.teacher;
  if (!teacher) return unauthorized();

  const students = teacher.assigned_students;

  const classes = new Map<
    string,
    { class_name: string; section: string | null; student_count: number }
  >();
  for (const a of teacher.assignments) {
    if (!a.is_active || !a.class_name) continue;
    const section = a.section_name?.trim() || null;
    const key = `${norm(a.class_name)}::${norm(section)}`;
    if (classes.has(key)) continue;
    classes.set(key, {
      class_name: a.class_name,
      section,
      student_count: students.filter(
        (s) =>
          norm(s.class_name) === norm(a.class_name) &&
          sectionMatches(s.section, section),
      ).length,
    });
  }

  const authIds = students
    .map((s) => s.auth_user_id)
    .filter((id): id is string => Boolean(id));
  const pushEnabled = new Set<string>();
  for (let i = 0; i < authIds.length; i += 300) {
    const { data } = await ctx.supabase
      .from("user_push_subscriptions")
      .select("user_id")
      .eq("school_id", ctx.schoolId)
      .eq("is_active", true)
      .in("user_id", authIds.slice(i, i + 300));
    for (const row of data ?? []) {
      if (row.user_id) pushEnabled.add(row.user_id);
    }
  }

  return NextResponse.json(
    {
      ok: true,
      data: {
        classes: Array.from(classes.values()).sort((l, r) =>
          `${l.class_name} ${l.section ?? ""}`.localeCompare(
            `${r.class_name} ${r.section ?? ""}`,
            "ar",
          ),
        ),
        students: students.map((s) => ({
          id: s.student_id,
          full_name: s.full_name,
          class_name: s.class_name,
          section: s.section,
          has_account: Boolean(s.auth_user_id),
          push_enabled: Boolean(s.auth_user_id && pushEnabled.has(s.auth_user_id)),
        })),
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
