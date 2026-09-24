import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { resolveStudentContext, unauthorized } from "@/lib/student-api";
import { uploadFile } from "@/lib/storage";
import { enforceRateLimit } from "@/lib/rate-limit";

const ALLOWED_AVATAR_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_AVATAR_BYTES = 3 * 1024 * 1024; // 3MB

const updateSchema = z.object({
  phone: z.string().trim().max(30).optional(),
  personal_email: z
    .union([z.literal(""), z.string().trim().email().max(255)])
    .optional(),
  avatar_base64: z.string().max(6_000_000).optional(),
  avatar_url: z.string().url().max(2000).optional(),
});

function parseAvatarDataUrl(dataUrl: string) {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  const mimeType = match[1];
  let buffer: Buffer;
  try {
    buffer = Buffer.from(match[2], "base64");
  } catch {
    return null;
  }
  return { mimeType, buffer };
}

export async function POST(req: NextRequest) {
  const ctx = await resolveStudentContext(req);
  if (!ctx) return unauthorized();

  const limited = await enforceRateLimit(req, {
    namespace: "student-profile-update",
    windowMs: 60_000,
    maxHits: 10,
    identifier: ctx.userId,
  });
  if (limited) return limited;

  const raw = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "validation_error" },
      { status: 400 },
    );
  }

  const { phone, personal_email, avatar_base64, avatar_url } = parsed.data;
  const { supabase, studentId, schoolId, userId } = ctx;

  const studentUpdates: Record<string, unknown> = {};

  if (personal_email !== undefined) {
    studentUpdates.personal_email = personal_email === "" ? null : personal_email;
  }

  if (avatar_base64) {
    const parsedImage = parseAvatarDataUrl(avatar_base64);
    if (!parsedImage) {
      return NextResponse.json(
        { ok: false, error: "invalid_image" },
        { status: 400 },
      );
    }
    if (!ALLOWED_AVATAR_MIME.has(parsedImage.mimeType)) {
      return NextResponse.json(
        { ok: false, error: "invalid_image_type" },
        { status: 400 },
      );
    }
    if (parsedImage.buffer.byteLength > MAX_AVATAR_BYTES) {
      return NextResponse.json(
        { ok: false, error: "image_too_large" },
        { status: 400 },
      );
    }
    const ext = parsedImage.mimeType.split("/")[1];
    const path = `${schoolId}/${studentId}/avatar-${randomUUID()}.${ext}`;
    try {
      const publicUrl = await uploadFile(
        supabase,
        "avatars",
        path,
        parsedImage.buffer,
        parsedImage.mimeType,
      );
      studentUpdates.photo_url = publicUrl;
    } catch {
      return NextResponse.json(
        { ok: false, error: "upload_failed" },
        { status: 500 },
      );
    }
  } else if (avatar_url) {
    studentUpdates.photo_url = avatar_url;
  }

  const managedProfileUpdates: Record<string, unknown> = {};
  if (phone !== undefined) {
    managedProfileUpdates.phone = phone === "" ? null : phone;
  }

  if (
    Object.keys(studentUpdates).length === 0 &&
    Object.keys(managedProfileUpdates).length === 0
  ) {
    return NextResponse.json({ ok: false, error: "no_fields" }, { status: 400 });
  }

  if (Object.keys(studentUpdates).length > 0) {
    studentUpdates.updated_at = new Date().toISOString();
    const { error: studentUpdateError } = await supabase
      .from("students")
      .update(studentUpdates)
      .eq("id", studentId)
      .eq("school_id", schoolId);

    if (studentUpdateError) {
      return NextResponse.json(
        { ok: false, error: "update_failed" },
        { status: 500 },
      );
    }
  }

  if (Object.keys(managedProfileUpdates).length > 0) {
    const { error: profileUpdateError } = await supabase
      .from("managed_user_profiles")
      .update(managedProfileUpdates)
      .eq("auth_user_id", userId)
      .eq("school_id", schoolId);

    if (profileUpdateError) {
      return NextResponse.json(
        { ok: false, error: "update_failed" },
        { status: 500 },
      );
    }
  }

  const [profileRes, studentRes, schoolRes] = await Promise.all([
    supabase
      .from("managed_user_profiles")
      .select("full_name, email, phone")
      .eq("auth_user_id", userId)
      .eq("school_id", schoolId)
      .maybeSingle(),
    supabase
      .from("students")
      .select(
        "full_name, class_name, registration_number, date_of_birth, photo_url, created_at, personal_email",
      )
      .eq("id", studentId)
      .eq("school_id", schoolId)
      .maybeSingle(),
    supabase.from("schools").select("name").eq("id", schoolId).maybeSingle(),
  ]);

  const profile = profileRes.data as Record<string, unknown> | null;
  const student = studentRes.data as Record<string, unknown> | null;
  const school = schoolRes.data as Record<string, unknown> | null;

  return NextResponse.json({
    ok: true,
    data: {
      full_name:
        (student?.full_name as string) ?? (profile?.full_name as string) ?? null,
      email: (profile?.email as string) ?? null,
      phone: (profile?.phone as string) ?? null,
      personal_email: (student?.personal_email as string) ?? null,
      class_name: (student?.class_name as string) ?? null,
      school_name: (school?.name as string) ?? null,
      enrollment_date:
        ((student?.created_at as string) ?? "").slice(0, 10) || null,
      student_id: (student?.registration_number as string) ?? null,
      avatar_url: (student?.photo_url as string) ?? null,
    },
  });
}
