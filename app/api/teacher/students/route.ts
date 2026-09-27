import { NextRequest, NextResponse } from "next/server";
import {
  filterTeacherStudents,
  resolveTeacherContext,
  summarizeTeacherClasses,
  unauthorized,
} from "@/lib/teacher-api";

export async function GET(req: NextRequest) {
  const ctx = await resolveTeacherContext(req);
  if (!ctx) return unauthorized();

  const url = new URL(req.url);
  const roster = filterTeacherStudents(
    ctx,
    url.searchParams.get("class_name"),
    url.searchParams.get("section"),
  );

  const phoneById = new Map<string, { phone: string | null; guardian_phone: string | null }>();
  const ids = roster.map((s) => s.student_id);
  if (ids.length > 0) {
    const { data } = await ctx.supabase
      .from("students")
      .select("id, phone, guardian_phone")
      .eq("school_id", ctx.schoolId)
      .in("id", ids);
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      phoneById.set(String(row.id), {
        phone: (row.phone as string) ?? null,
        guardian_phone: (row.guardian_phone as string) ?? null,
      });
    }
  }

  return NextResponse.json({
    ok: true,
    data: {
      class_names: summarizeTeacherClasses(ctx).map((c) => c.class_name),
      students: roster.map((s) => ({
        id: s.student_id,
        full_name: s.full_name,
        class_name: s.class_name,
        section: s.section,
        has_app_account: Boolean(s.auth_user_id),
        phone: phoneById.get(s.student_id)?.phone ?? null,
        guardian_phone: phoneById.get(s.student_id)?.guardian_phone ?? null,
      })),
    },
  });
}
