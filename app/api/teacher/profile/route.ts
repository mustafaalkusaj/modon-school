import { NextRequest, NextResponse } from "next/server";
import { resolveTeacherContext, unauthorized } from "@/lib/teacher-api";

// Teacher accounts have no user_profiles row — the profile lives on `teachers`.
const PROFILE_SELECT =
  "id, full_name, email, email_work, phone, photo, job_title, specialization, subject";

type TeacherRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  email_work: string | null;
  phone: string | null;
  photo: string | null;
  job_title: string | null;
  specialization: string | null;
  subject: string | null;
};

function toProfile(row: TeacherRow, loginEmail: string | null) {
  return {
    id: row.id,
    full_name: row.full_name ?? "",
    email: row.email_work ?? row.email ?? loginEmail,
    phone: row.phone ?? null,
    avatar_url: row.photo ?? null,
    role: "teacher",
    job_title: row.job_title ?? row.specialization ?? row.subject ?? null,
  };
}

async function loginEmailFor(
  ctx: NonNullable<Awaited<ReturnType<typeof resolveTeacherContext>>>,
) {
  const { data } = await ctx.supabase
    .from("managed_user_profiles")
    .select("email")
    .eq("auth_user_id", ctx.userId)
    .maybeSingle();
  return data?.email ?? null;
}

export async function GET(req: NextRequest) {
  const ctx = await resolveTeacherContext(req);
  if (!ctx) return unauthorized();

  const { data, error } = await ctx.supabase
    .from("teachers")
    .select(PROFILE_SELECT)
    .eq("id", ctx.teacherId)
    .eq("school_id", ctx.schoolId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ ok: false, error: "fetch_failed" }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ ok: false, error: "profile_not_found" }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    data: { profile: toProfile(data as TeacherRow, await loginEmailFor(ctx)) },
  });
}

/** Teachers may only update their own contact phone from the portal. */
export async function PUT(req: NextRequest) {
  const ctx = await resolveTeacherContext(req);
  if (!ctx) return unauthorized();

  const body = (await req.json().catch(() => null)) as { phone?: unknown } | null;
  if (!body || typeof body.phone !== "string") {
    return NextResponse.json({ ok: false, error: "no_valid_fields" }, { status: 400 });
  }

  const { data, error } = await ctx.supabase
    .from("teachers")
    .update({ phone: body.phone.trim().slice(0, 32) || null })
    .eq("id", ctx.teacherId)
    .eq("school_id", ctx.schoolId)
    .select(PROFILE_SELECT)
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json({ ok: false, error: "update_failed" }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    data: { profile: toProfile(data as TeacherRow, await loginEmailFor(ctx)) },
  });
}
