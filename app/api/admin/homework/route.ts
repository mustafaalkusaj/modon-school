import { NextRequest, NextResponse } from "next/server";

import { listAdminHomework, resolveAdminHomeworkContext } from "@/lib/homework-web-server";

/** GET — all homework in the school, filterable by subject/class/status/search. */
export async function GET(req: NextRequest) {
  const context = await resolveAdminHomeworkContext(req);
  if (!context.ok) return context.response;

  const params = req.nextUrl.searchParams;

  try {
    const items = await listAdminHomework(context.value, {
      subject: params.get("subject"),
      className: params.get("className"),
      status: params.get("status"),
      search: params.get("search"),
    });

    return NextResponse.json({ ok: true, data: items });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "تعذر تحميل الواجبات." },
      { status: 500 },
    );
  }
}
