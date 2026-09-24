import { NextRequest, NextResponse } from "next/server";

import { computeHomeworkStats, resolveAdminHomeworkContext } from "@/lib/homework-web-server";

/** GET — submission-rate / average-grade stats by subject and class. */
export async function GET(req: NextRequest) {
  const context = await resolveAdminHomeworkContext(req);
  if (!context.ok) return context.response;

  try {
    const stats = await computeHomeworkStats(context.value);
    return NextResponse.json({ ok: true, data: stats });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "تعذر حساب الإحصائيات." },
      { status: 500 },
    );
  }
}
