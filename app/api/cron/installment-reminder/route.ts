/**
 * Cron worker: reminds students with outstanding fee balances.
 * Run monthly (or as configured in vercel.json). Finds every student
 * whose remaining balance > 0 and sends a push + in-app notification.
 *
 * Auth: CRON_SECRET (Vercel) or OPS_ALERT_TOKEN (manual trigger).
 */
import { NextRequest, NextResponse } from "next/server";

import { notifyInstallmentDue } from "@/lib/notify-events";
import { isOpsTokenAuthorized } from "@/lib/ops/security";
import { logRouteError } from "@/lib/route-utils";
import { createServiceSupabaseClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

const BATCH_SIZE = 200;

function unauthorized() {
  return NextResponse.json(
    { ok: false, error: "Unauthorized" },
    { status: 401, headers: { "Cache-Control": "no-store" } },
  );
}

async function handle(req: NextRequest) {
  if (
    !isOpsTokenAuthorized(req, [
      process.env.CRON_SECRET,
      process.env.OPS_ALERT_TOKEN,
    ])
  ) {
    return unauthorized();
  }

  const client = createServiceSupabaseClient();

  let schoolIds: string[];
  try {
    const { data, error } = await client
      .from("students")
      .select("school_id")
      .not("school_id", "is", null)
      .limit(10000);

    if (error) throw error;
    schoolIds = Array.from(
      new Set(
        (data ?? [])
          .map((r) => (r as Record<string, unknown>).school_id as string)
          .filter(Boolean),
      ),
    );
  } catch (error) {
    logRouteError("cron/installment-reminder:schools", error);
    return NextResponse.json(
      { ok: false, error: "تعذر تحميل المدارس." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }

  let totalNotified = 0;
  let totalFailed = 0;

  for (const schoolId of schoolIds) {
    try {
      const { data: students, error } = await client
        .from("students")
        .select("id, total_fee, paid_fee, discount_value")
        .eq("school_id", schoolId)
        .not("auth_user_id", "is", null)
        .is("deleted_at", null);

      if (error) {
        logRouteError("cron/installment-reminder:students", error);
        totalFailed += 1;
        continue;
      }

      const owingStudentIds = (students ?? [])
        .filter((s) => {
          const row = s as Record<string, unknown>;
          const total = Number(row.total_fee ?? 0);
          const paid = Number(row.paid_fee ?? 0);
          const discount = Number(row.discount_value ?? 0);
          return total - paid - discount > 0;
        })
        .map((s) => (s as Record<string, unknown>).id as string);

      if (owingStudentIds.length === 0) continue;

      for (let i = 0; i < owingStudentIds.length; i += BATCH_SIZE) {
        const batch = owingStudentIds.slice(i, i + BATCH_SIZE);
        try {
          const result = await notifyInstallmentDue({
            supabase: client,
            schoolId,
            studentIds: batch,
          });
          totalNotified += result.sent + result.inAppSaved;
        } catch (err) {
          totalFailed += batch.length;
          logRouteError("cron/installment-reminder:notify", err);
        }
      }
    } catch (err) {
      totalFailed += 1;
      logRouteError("cron/installment-reminder:school-loop", err);
    }
  }

  return NextResponse.json(
    {
      ok: true,
      schools_checked: schoolIds.length,
      notified: totalNotified,
      failed: totalFailed,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
