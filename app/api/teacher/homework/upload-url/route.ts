import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { resolveTeacherHomeworkContext } from "@/lib/homework-web-server";
import { HOMEWORK_BUCKET } from "@/lib/homework-storage";
import { enforceRateLimit } from "@/lib/rate-limit";

/**
 * Web counterpart of app/api/mobile/teacher/storage/upload-url, scoped to
 * the "assignments" folder only — homework reference attachments.
 */
const MAX_BYTES = 10 * 1024 * 1024; // 10MB per the homework spec
const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

function safeFileName(value: string) {
  const normalized = value
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .toLowerCase();
  return normalized.slice(0, 120) || "attachment";
}

export async function POST(req: NextRequest) {
  try {
    const context = await resolveTeacherHomeworkContext(req);
    if (!context.ok) return context.response;
    const ctx = context.value;

    const limited = await enforceRateLimit(req, {
      namespace: "web-teacher-homework-upload-url",
      windowMs: 60 * 60_000,
      maxHits: 60,
      identifier: ctx.actorUserId,
    });
    if (limited) return limited;

    const body = (await req.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    const fileName =
      typeof body?.file_name === "string" ? body.file_name.trim() : "";
    const mimeType =
      typeof body?.mime_type === "string"
        ? body.mime_type.trim().toLowerCase()
        : "";
    const sizeBytes =
      typeof body?.size_bytes === "number"
        ? body.size_bytes
        : Number(body?.size_bytes);

    if (!fileName || !ALLOWED_MIME_TYPES.has(mimeType)) {
      return NextResponse.json(
        { ok: false, error: "نوع الملف غير مسموح." },
        { status: 400 },
      );
    }
    if (!Number.isInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_BYTES) {
      return NextResponse.json(
        { ok: false, error: "حجم الملف غير صالح أو يتجاوز 10 م.ب." },
        { status: 400 },
      );
    }

    const teacherId = ctx.account.teacher?.id;
    if (!teacherId) {
      return NextResponse.json(
        { ok: false, error: "حساب المعلم غير مرتبط بسجل صالح." },
        { status: 403 },
      );
    }

    const sanitizedName = safeFileName(fileName);
    const path = `${ctx.schoolId}/${teacherId}/assignments/${randomUUID()}-${sanitizedName}`;
    const { data, error } = await ctx.serviceSupabase.storage
      .from(HOMEWORK_BUCKET)
      .createSignedUploadUrl(path, { upsert: false });

    if (error || !data?.signedUrl) {
      return NextResponse.json(
        { ok: false, error: "تعذر إنشاء رابط رفع آمن." },
        { status: 500 },
      );
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
  } catch {
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
