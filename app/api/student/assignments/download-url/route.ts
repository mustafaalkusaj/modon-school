import { NextRequest, NextResponse } from "next/server";

import { resolveStudentContext, unauthorized } from "@/lib/student-api";
import { enforceRateLimit } from "@/lib/rate-limit";
import {
  HOMEWORK_BUCKET,
  createHomeworkSignedDownloadUrl,
  isValidHomeworkPath,
} from "@/lib/homework-storage";

/**
 * Signs a download URL for either:
 *  - the assignment's own reference attachment (any student in that class), or
 *  - the student's own submission file.
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await resolveStudentContext(req);
    if (!ctx) return unauthorized();

    const limited = await enforceRateLimit(req, {
      namespace: "web-student-download-url",
      windowMs: 60 * 60_000,
      maxHits: 120,
      identifier: ctx.userId,
    });
    if (limited) return limited;

    const body = (await req.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    const bucket = typeof body?.bucket === "string" ? body.bucket.trim() : "";
    const path = typeof body?.path === "string" ? body.path.trim() : "";
    const downloadName =
      typeof body?.file_name === "string"
        ? body.file_name.trim().slice(0, 180)
        : "";

    if (bucket !== HOMEWORK_BUCKET || !isValidHomeworkPath(ctx.schoolId, path)) {
      return NextResponse.json(
        { ok: false, error: "مسار الملف غير صالح." },
        { status: 403 },
      );
    }

    let allowed = path.startsWith(`${ctx.schoolId}/${ctx.studentId}/`);

    if (!allowed) {
      const { data: assignment } = await ctx.supabase
        .from("assignments")
        .select("id, class_name")
        .eq("school_id", ctx.schoolId)
        .eq("attachment_bucket", HOMEWORK_BUCKET)
        .eq("attachment_path", path)
        .maybeSingle();

      allowed = Boolean(
        assignment &&
          (assignment as Record<string, unknown>).class_name === ctx.className,
      );
    }

    if (!allowed) {
      return NextResponse.json(
        { ok: false, error: "لا تملك صلاحية فتح هذا الملف." },
        { status: 403 },
      );
    }

    const { data, error } = await createHomeworkSignedDownloadUrl(
      ctx.supabase,
      path,
      downloadName || undefined,
    );

    if (error || !data?.signedUrl) {
      return NextResponse.json(
        { ok: false, error: "تعذر إنشاء رابط تنزيل آمن." },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      data: { signed_url: data.signedUrl, expires_in: 900 },
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "internal_error" },
      { status: 500 },
    );
  }
}
