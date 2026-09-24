import { NextRequest, NextResponse } from "next/server";
import { createServiceSupabaseClient } from "@/lib/supabase-server";
import { uploadFile } from "@/lib/storage";
import { sniffImageType } from "@/lib/image-sniff";
import { enforceRateLimit } from "@/lib/rate-limit";

const MAX_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_PHOTOS = 4;

/**
 * POST — upload exam photo (public, no auth — accessed via QR from phone)
 * Query: ?sessionId=xxx
 */
export async function POST(req: NextRequest) {
  const rateLimited = await enforceRateLimit(req, {
    namespace: "public-exam-photos",
    windowMs: 10 * 60_000,
    maxHits: 30,
  });
  if (rateLimited) return rateLimited;

  const sessionId = new URL(req.url).searchParams.get("sessionId");
  if (!sessionId || !/^[a-zA-Z0-9_-]{8,64}$/.test(sessionId)) {
    return NextResponse.json({ error: "Invalid session ID" }, { status: 400 });
  }

  const supabase = createServiceSupabaseClient();

  // Check how many photos already uploaded for this session
  const { data: existing } = await supabase.storage
    .from("exam-photos")
    .list(sessionId);
  if (existing && existing.length >= MAX_PHOTOS) {
    return NextResponse.json(
      { error: "الحد الأقصى 4 صور", count: existing.length },
      { status: 400 },
    );
  }

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) {
    return NextResponse.json({ error: "No file" }, { status: 400 });
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "حجم الصورة أكبر من 5MB" }, { status: 400 });
  }

  // Type and extension come from the bytes, never from the client's
  // File.type or file name.
  const buffer = await file.arrayBuffer();
  const image = sniffImageType(buffer);
  if (!image) {
    return NextResponse.json({ error: "نوع الملف غير مدعوم" }, { status: 400 });
  }

  const idx = (existing?.length ?? 0) + 1;
  const path = `${sessionId}/${idx}.${image.ext}`;

  try {
    const url = await uploadFile(supabase, "exam-photos", path, buffer, image.mime);
    const count = (existing?.length ?? 0) + 1;
    return NextResponse.json({ ok: true, url, count });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Upload failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * GET — poll uploaded photos for a session
 * Query: ?sessionId=xxx
 */
export async function GET(req: NextRequest) {
  const sessionId = new URL(req.url).searchParams.get("sessionId");
  if (!sessionId || !/^[a-zA-Z0-9_-]{8,64}$/.test(sessionId)) {
    return NextResponse.json({ error: "Invalid session ID" }, { status: 400 });
  }

  const supabase = createServiceSupabaseClient();
  const { data: files } = await supabase.storage
    .from("exam-photos")
    .list(sessionId);

  const urls = (files ?? [])
    .filter((f) => !f.name.startsWith("."))
    .map((f) => {
      const { data } = supabase.storage
        .from("exam-photos")
        .getPublicUrl(`${sessionId}/${f.name}`);
      return data.publicUrl;
    });

  return NextResponse.json({ ok: true, photos: urls, count: urls.length });
}
