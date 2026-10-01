import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import sharp from "sharp";

import { sniffImageType } from "@/lib/image-sniff";
import { resolveSchoolScopedActorContext } from "@/lib/managed-users-server";
import { enforceRateLimit } from "@/lib/rate-limit";
import { jsonError, jsonServerError } from "@/lib/route-utils";
import { uploadFile, type StorageBucket } from "@/lib/storage";

const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

const MAX_SIZE = 5 * 1024 * 1024; // 5MB

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

/**
 * Real content type from the file's leading bytes. The browser-supplied
 * File.type and file name are client-controlled, so neither is trusted.
 */
function detectMimeFromBytes(buf: ArrayBuffer): string | null {
  const image = sniffImageType(buf);
  if (image) return image.mime;
  const bytes = new Uint8Array(buf.slice(0, 4));
  // %PDF
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46
  ) {
    return "application/pdf";
  }
  return null;
}

export async function POST(req: NextRequest) {
  const schoolId = req.headers.get("x-school-id") || new URL(req.url).searchParams.get("schoolId");
  if (!schoolId) {
    return jsonError("schoolId is required.", 400);
  }

  const context = await resolveSchoolScopedActorContext(
    schoolId,
    { allowedRoles: ["super_admin", "admin", "employee"], roleDeniedMessage: "غير مصرح بالوصول." },
    req.headers.get("authorization"),
  );
  if (!context.ok) {
    return jsonError(
      "message" in context ? context.message : "Unauthorized",
      "status" in context ? context.status : 403,
    );
  }

  const { actorSupabase, actorUserId, targetSchoolId } = context.value;

  const rateLimited = await enforceRateLimit(req, {
    namespace: "file-upload",
    windowMs: 60_000,
    maxHits: 20,
    identifier: actorUserId,
  });
  if (rateLimited) return rateLimited;

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return jsonError("Invalid multipart/form-data.", 400);
  }

  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    return jsonError("No file provided. Use field name 'file'.", 400);
  }

  if (!ALLOWED_TYPES.has(file.type)) {
    return jsonError(
      `File type "${file.type}" is not allowed. Accepted: ${Array.from(ALLOWED_TYPES).join(", ")}`,
      400,
    );
  }

  if (file.size > MAX_SIZE) {
    return jsonError(`File too large. Maximum size is ${MAX_SIZE / 1024 / 1024}MB.`, 400);
  }

  const bucket = (formData.get("bucket") as StorageBucket) || "attachments";
  if (bucket !== "avatars" && bucket !== "attachments") {
    return jsonError("Invalid bucket. Use 'avatars' or 'attachments'.", 400);
  }

  try {
    const buffer = await file.arrayBuffer();
    const detectedMime = detectMimeFromBytes(buffer);
    if (!detectedMime || detectedMime !== file.type) {
      return jsonError("File content does not match declared type.", 400);
    }

    const extension = EXTENSION_BY_MIME[detectedMime];
    if (!extension) {
      return jsonError("Unsupported file content.", 400);
    }
    const safeName = `${Date.now()}-${randomUUID()}.${extension}`;
    const path = `${targetSchoolId}/${safeName}`;

    // Re-encode images: drops EXIF/GPS metadata and bakes in the orientation.
    const isImage = detectedMime.startsWith("image/");
    const uploadPayload: Buffer | ArrayBuffer = isImage
      ? await sharp(Buffer.from(buffer)).rotate().toBuffer()
      : buffer;

    const publicUrl = await uploadFile(actorSupabase, bucket, path, uploadPayload, detectedMime);

    return NextResponse.json({
      ok: true,
      url: publicUrl,
      bucket,
      path,
      size: file.size,
      contentType: detectedMime,
    });
  } catch (err) {
    return jsonServerError("web-upload", err, "Upload failed.", 500);
  }
}
