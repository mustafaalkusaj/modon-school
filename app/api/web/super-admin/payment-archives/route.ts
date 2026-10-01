import { NextRequest, NextResponse } from "next/server";
import { isMissingTableError } from "@/lib/admin-infrastructure";
import { resolveSuperAdminActorContext } from "@/lib/super-admin-server";
import { jsonServerError } from "@/lib/route-utils";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: { message } }, { status });
}

export async function GET(req: NextRequest) {
  const context = await resolveSuperAdminActorContext(
    req.headers.get("authorization"),
  );
  if (!context.ok) {
    return jsonError(context.message, context.status);
  }

  const { actorSupabase } = context.value;

  const { data, error } = await actorSupabase
    .from("account_archives")
    .select(
      "id, school_id, archive_year, archive_date, total_students, total_payments, total_amount, schools(name)",
    )
    .order("archive_date", { ascending: false });

  if (error) {
    if (isMissingTableError(error, "account_archives")) {
      return jsonError("جدول account_archives غير موجود بعد.", 500);
    }
    return jsonServerError(
      "web-super-admin-payment-archives",
      error,
      "تعذر تحميل أرشيفات الحسابات.",
      500,
    );
  }

  return NextResponse.json({ ok: true, archives: data ?? [] });
}
