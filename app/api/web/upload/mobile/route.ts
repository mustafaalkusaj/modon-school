import { NextRequest, NextResponse } from "next/server";

import { createServiceSupabaseClient } from "@/lib/supabase-server";
import { sniffImageType } from "@/lib/image-sniff";
import { enforceRateLimit } from "@/lib/rate-limit";
import { jsonError } from "@/lib/route-utils";

export const dynamic = "force-dynamic";

const MAX_SIZE = 2 * 1024 * 1024; // 2MB

export async function POST(req: NextRequest) {
  // Unauthenticated (reached by scanning a QR on a phone), so throttle per IP.
  const rateLimited = await enforceRateLimit(req, {
    namespace: "upload-mobile",
    windowMs: 10 * 60_000,
    maxHits: 20,
  });
  if (rateLimited) return rateLimited;

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return jsonError("Invalid multipart/form-data.", 400);
  }

  const token = formData.get("token");
  if (!token || typeof token !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(token)) {
    return jsonError("Token is required.", 400);
  }

  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    return jsonError("No file provided.", 400);
  }

  if (file.size > MAX_SIZE) {
    return jsonError("حجم الصورة كبير جداً. الحد الأقصى 2MB.", 400);
  }

  const sb = createServiceSupabaseClient();

  const { data: session, error: sessionError } = await sb
    .from("upload_sessions")
    .select("id, status, expires_at")
    .eq("token", token)
    .single();

  if (sessionError || !session) {
    return jsonError("رابط غير صالح أو منتهي الصلاحية.", 404);
  }

  if (session.status === "completed") {
    return jsonError("تم رفع الصورة مسبقاً.", 400);
  }

  if (session.status === "expired" || new Date(session.expires_at) < new Date()) {
    return jsonError("انتهت صلاحية الرابط.", 410);
  }

  const buffer = await file.arrayBuffer();
  // Safari's canvas.toBlob falls back to PNG when WebP is unsupported, so
  // accept any real image and store it under its actual type.
  const image = sniffImageType(buffer);
  if (!image) {
    return jsonError("الملف ليس صورة صالحة.", 400);
  }
  const fileName = `temp/${token}/photo.${image.ext}`;

  const { error: uploadError } = await sb.storage
    .from("student-photos")
    .upload(fileName, buffer, { contentType: image.mime, upsert: true });

  if (uploadError) {
    return jsonError("تعذر رفع الصورة.", 500);
  }

  const { data: urlData } = sb.storage.from("student-photos").getPublicUrl(fileName);

  const { error: updateError } = await sb
    .from("upload_sessions")
    .update({ status: "completed", image_url: urlData.publicUrl })
    .eq("token", token)
    .eq("status", "pending");

  if (updateError) {
    return jsonError("تعذر تحديث الجلسة.", 500);
  }

  return NextResponse.json({ ok: true, url: urlData.publicUrl });
}
