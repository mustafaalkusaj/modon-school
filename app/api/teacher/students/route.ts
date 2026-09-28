import { NextRequest, NextResponse } from "next/server";
import {
  filterTeacherStudents,
  resolveTeacherAppContext,
  resolveTeacherContext,
  summarizeTeacherClasses,
  unauthorized,
} from "@/lib/teacher-api";

/**
 * The teacher's own roster (students of the classes/sections assigned to
 * them). `class_name` / `section` are optional filters within that roster —
 * a teacher can never list students outside their assignments.
 */
export async function GET(req: NextRequest) {
  const ctx = await resolveTeacherContext(req);
  if (!ctx) return unauthorized();
  const app = await resolveTeacherAppContext(ctx);
  if (!app) return unauthorized();

  const url = new URL(req.url);
  const students = filterTeacherStudents(
    app,
    url.searchParams.get("class_name"),
    url.searchParams.get("section"),
  );

  // Which of these students have at least one device registered for push
  // (so the teacher can see who a notice will actually ring for).
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
        classes: summarizeTeacherClasses(app),
        class_names: Array.from(
          new Set(summarizeTeacherClasses(app).map((c) => c.class_name)),
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
