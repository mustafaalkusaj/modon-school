import { NextRequest, NextResponse } from "next/server";

import {
  restoreSchoolArchivePayload,
  type SchoolArchivePayload,
} from "@/lib/school-archives";
import { resolveSuperAdminActorContext } from "@/lib/super-admin-server";

import { jsonServerError } from "@/lib/route-utils";
function jsonError(message: string, status: number) {
  return NextResponse.json({ error: { message } }, { status });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ schoolId: string }> },
) {
  const { schoolId } = await params;
  const context = await resolveSuperAdminActorContext(req.headers.get("authorization"));
  if (!context.ok) {
    return jsonError(context.message, context.status);
  }

  const normalizedSchoolId = schoolId.trim();
  if (!normalizedSchoolId) {
    return jsonError("معرف المدرسة غير صالح.", 400);
  }

  const formData = await req.formData().catch(() => null);
  const file = formData?.get("file");
  if (!(file instanceof File)) {
    return jsonError("ملف الأرشيف مطلوب للاستيراد.", 400);
  }

  try {
    const payload = JSON.parse(await file.text()) as SchoolArchivePayload;
    const restoreResult = await restoreSchoolArchivePayload(
      context.value.dataSupabase,
      normalizedSchoolId,
      payload,
    );

    return NextResponse.json({
      ok: true,
      ...restoreResult,
    });
  } catch (error) {
    console.error("school import error", error);
    return jsonServerError("web-super-admin-schools-schoolId-import", error, "تعذر استيراد ملف الأرشيف.", 500);
  }
}
