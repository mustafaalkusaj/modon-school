import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import {
  resolveTeacherHomeworkContext,
  type WebTeacherHomeworkContext,
} from "@/lib/homework-web-server";
import { HOMEWORK_BUCKET } from "@/lib/homework-storage";
import { enforceRateLimit } from "@/lib/rate-limit";
import { jsonError, jsonServerError } from "@/lib/route-utils";

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

function safeFileName(value: string): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .toLowerCase();
  return normalized.slice(0, 120) || "attachment";
}

/**
 * POST /api/web/homework/upload
 *
 * Accepts a multipart file upload for homework attachments and stores it
 * directly in Supabase Storage, returning a public URL.
 *
 * Alternatively, accepts a JSON body with { file_name, mime_type, size_bytes }
 * to generate a signed upload URL (client-side upload flow).
 *
 * Form fields (multipart):
 *   file — the attachment file
 *
 * JSON body (signed-url flow):
 *   file_name  — original file name
 *   mime_type  — MIME type
 *   size_bytes — file size in bytes
 */
export async function POST(req: NextRequest) {
  const context = await resolveTeacherHomeworkContext(req);
  if (!context.ok) return context.response;

  const ctx = context.value;

  const limited = await enforceRateLimit(req, {
    namespace: "web-homework-upload",
    windowMs: 60 * 60_000,
    maxHits: 60,
    identifier: ctx.actorUserId,
  });
  if (limited) return limited;

  const teacherId = ctx.account.teacher?.id;
  if (!teacherId) {
    return jsonError("حساب المعلم غير مرتبط بسجل صالح.", 403);
  }

  const contentType = req.headers.get("content-type") ?? "";

  // ── Multipart upload (direct file) ────────────────────────────
  if (contentType.includes("multipart/form-data")) {
    return handleDirectUpload(req, ctx, teacherId);
  }

  // ── JSON body (signed-url flow) ───────────────────────────────
  return handleSignedUrlRequest(req, ctx, teacherId);
}

async function handleDirectUpload(
  req: NextRequest,
  ctx: WebTeacherHomeworkContext,
  teacherId: string,
) {
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return jsonError("بيانات multipart غير صالحة.", 400);
  }

  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    return jsonError("لم يتم تحديد ملف. استخدم الحقل 'file'.", 400);
  }

  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return jsonError(
      `نوع الملف "${file.type}" غير مسموح. الأنواع المقبولة: ${Array.from(ALLOWED_MIME_TYPES).join(", ")}`,
      400,
    );
  }

  if (file.size > MAX_BYTES) {
    return jsonError("حجم الملف يتجاوز الحد الأقصى (10 م.ب.).", 400);
  }

  const sanitizedName = safeFileName(file.name);
  const path = `${ctx.schoolId}/${teacherId}/assignments/${randomUUID()}-${sanitizedName}`;

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const { error } = await ctx.serviceSupabase.storage
      .from(HOMEWORK_BUCKET)
      .upload(path, buffer, { contentType: file.type, upsert: false });

    if (error) {
      return jsonServerError("homework.upload.direct", error, "تعذر رفع الملف.", 500);
    }

    const { data: urlData } = ctx.serviceSupabase.storage
      .from(HOMEWORK_BUCKET)
      .getPublicUrl(path);

    return NextResponse.json({
      ok: true,
      data: {
        bucket: HOMEWORK_BUCKET,
        path,
        file_name: file.name.slice(0, 180),
        mime_type: file.type,
        size_bytes: file.size,
        public_url: urlData.publicUrl,
      },
    });
  } catch (err) {
    return jsonServerError("homework.upload.direct", err, "تعذر رفع الملف.", 500);
  }
}

async function handleSignedUrlRequest(
  req: NextRequest,
  ctx: WebTeacherHomeworkContext,
  teacherId: string,
) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;

  const fileName = typeof body?.file_name === "string" ? body.file_name.trim() : "";
  const mimeType = typeof body?.mime_type === "string" ? body.mime_type.trim().toLowerCase() : "";
  const sizeBytes = typeof body?.size_bytes === "number" ? body.size_bytes : Number(body?.size_bytes);

  if (!fileName || !ALLOWED_MIME_TYPES.has(mimeType)) {
    return jsonError("نوع الملف غير مسموح.", 400);
  }

  if (!Number.isInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_BYTES) {
    return jsonError("حجم الملف غير صالح أو يتجاوز 10 م.ب.", 400);
  }

  const sanitizedName = safeFileName(fileName);
  const path = `${ctx.schoolId}/${teacherId}/assignments/${randomUUID()}-${sanitizedName}`;

  try {
    const { data, error } = await ctx.serviceSupabase.storage
      .from(HOMEWORK_BUCKET)
      .createSignedUploadUrl(path, { upsert: false });

    if (error || !data?.signedUrl) {
      return jsonServerError("homework.upload.signed", error, "تعذر إنشاء رابط رفع آمن.", 500);
    }

    return NextResponse.json({
      ok: true,
      data: {
        bucket: HOMEWORK_BUCKET,
        path,
        file_name: fileName.slice(0, 180),
        mime_type: mimeType,
        size_bytes: sizeBytes,
        signed_url: data.signedUrl,
      },
    });
  } catch (err) {
    return jsonServerError("homework.upload.signed", err, "تعذر إنشاء رابط رفع آمن.", 500);
  }
}
