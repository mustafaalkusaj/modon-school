import { NextRequest, NextResponse } from "next/server";
import { resolveTeacherContext, unauthorized, serverError } from "@/lib/teacher-api";

export async function GET(req: NextRequest) {
  const ctx = await resolveTeacherContext(req);
  if (!ctx) return unauthorized();

  const { supabase, teacherId, schoolId } = ctx;

  const { data, error } = await supabase
    .from("teachers")
    .select("id, full_name, phone, subject, job_title, status")
    .eq("id", teacherId)
    .eq("school_id", schoolId)
    .maybeSingle();

  if (error) return serverError("fetch_failed");

  if (!data) {
    return NextResponse.json(
      { ok: false, error: "profile_not_found" },
      { status: 404 },
    );
  }

  const row = data as Record<string, unknown>;

  let avatarUrl: string | null = null;
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("avatar_url")
    .eq("id", ctx.userId)
    .maybeSingle();
  if (profile) {
    avatarUrl = ((profile as Record<string, unknown>).avatar_url as string) ?? null;
  }

  return NextResponse.json({
    ok: true,
    data: {
      profile: {
        id: row.id as string,
        full_name: (row.full_name as string) ?? "",
        phone: (row.phone as string) ?? null,
        avatar_url: avatarUrl,
        role: "teacher",
        subject: (row.subject as string) ?? null,
        job_title: (row.job_title as string) ?? null,
      },
    },
  });
}

export async function PATCH(req: NextRequest) {
  const ctx = await resolveTeacherContext(req);
  if (!ctx) return unauthorized();

  const { supabase, teacherId, schoolId } = ctx;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_json" },
      { status: 400 },
    );
  }

  const allowedFields = ["phone"] as const;
  const updates: Record<string, unknown> = {};

  for (const field of allowedFields) {
    if (field in body) {
      const val = body[field];
      updates[field] = typeof val === "string" ? val.trim() : null;
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { ok: false, error: "no_valid_fields" },
      { status: 400 },
    );
  }

  const { error } = await supabase
    .from("teachers")
    .update(updates)
    .eq("id", teacherId)
    .eq("school_id", schoolId);

  if (error) return serverError("update_failed");

  return NextResponse.json({ ok: true, data: { updated: Object.keys(updates) } });
}
