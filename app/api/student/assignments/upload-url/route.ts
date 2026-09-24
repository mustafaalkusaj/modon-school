import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { resolveStudentContext, unauthorized } from "@/lib/student-api";
import { enforceRateLimit } from "@/lib/rate-limit";

/**
 * Web counterpart of the mobile student upload-url route
 * (app/api/mobile/student/storage/upload-url). Same bucket, same
 * signed-upload-url pattern — `school-media` is a private bucket with no
 * client-writable INSERT policy, so uploads go through a service-role
 * signed URL instead of a direct client upload.
 */

const BUCKET = "school-media";
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
    const ctx = await resolveStudentContext(req);
    if (!ctx) return unauthorized();

    const limited = await enforceRateLimit(req, {
      namespace: "web-student-upload-url",
      windowMs: 60 * 60_000,
      maxHits: 60,
      identifier: ctx.userId,
    });
    if (limited) return limited;

    const body = (await req.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    const assignmentId =
      typeof body?.assignment_id === "string" ? body.assignment_id.trim() : "";
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

    if (!assignmentId) {
      return NextResponse.json(
        { ok: false, error: "الواجب غير محدد." },
        { status: 400 },
      );
    }
    if (!fileName || !ALLOWED_MIME_TYPES.has(mimeType)) {
      return NextResponse.json(
        { ok: false, error: "نوع الملف غير مسموح." },
        { status: 400 },
      );
    }
    if (
      !Number.isInteger(sizeBytes) ||
      sizeBytes <= 0 ||
      sizeBytes > MAX_BYTES
    ) {
      return NextResponse.json(
        { ok: false, error: "حجم الملف غير صالح أو يتجاوز 10 م.ب." },
        { status: 400 },
      );
    }

    // Only allow uploads against an assignment inside the student's school
    // and class.
    const { data: assignment } = await ctx.supabase
      .from("assignments")
      .select("id, class_name")
      .eq("id", assignmentId)
      .eq("school_id", ctx.schoolId)
      .maybeSingle();

    if (
      !assignment ||
      (assignment as Record<string, unknown>).class_name !== ctx.className
    ) {
      return NextResponse.json(
        { ok: false, error: "الواجب غير موجود." },
        { status: 404 },
      );
    }

    const sanitizedName = safeFileName(fileName);
    const path = `${ctx.schoolId}/${ctx.studentId}/assignments/${assignmentId}/${randomUUID()}-${sanitizedName}`;
    const { data, error } = await ctx.supabase.storage
      .from(BUCKET)
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
        bucket: BUCKET,
        path,
        file_name: fileName.slice(0, 180),
        mime_type: mimeType,
        size_bytes: sizeBytes,
        signed_url: data.signedUrl,
      },
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "internal_error" },
      { status: 500 },
    );
  }
}
