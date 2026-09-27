import { NextRequest, NextResponse } from "next/server";
import { resolveTeacherContext, unauthorized } from "@/lib/teacher-api";

export async function GET(req: NextRequest) {
  const ctx = await resolveTeacherContext(req);
  if (!ctx) return unauthorized();

  const { data } = await ctx.supabase
    .from("teachers")
    .select("full_name, phone, job_title, specialization, subject")
    .eq("id", ctx.teacherId)
    .eq("school_id", ctx.schoolId)
    .maybeSingle();

  const teacher = (data ?? {}) as Record<string, unknown>;
  const text = (value: unknown) =>
    typeof value === "string" && value.trim() ? value.trim() : null;

  return NextResponse.json({
    ok: true,
    data: {
      profile: {
        id: ctx.teacherId,
        full_name: text(teacher.full_name) ?? ctx.account.profile.full_name,
        email:
          ctx.account.app_account?.login_identifier ??
          (ctx.account.profile.email || null),
        phone: text(teacher.phone) ?? ctx.account.profile.phone,
        avatar_url: null,
        role: "teacher",
        job_title:
          text(teacher.job_title) ??
          text(teacher.specialization) ??
          text(teacher.subject),
      },
    },
  });
}
