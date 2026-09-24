import { NextRequest, NextResponse } from "next/server";
import { isOpsTokenAuthorized } from "@/lib/ops/security";
import { sendPushNotification } from "@/lib/push-notifications";
import { logRouteError } from "@/lib/route-utils";
import { createServiceSupabaseClient } from "@/lib/supabase-server";
import type { SupabaseClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

type TargetScope = "school" | "branch" | "class" | "role" | "user";

function unauthorized() {
  return NextResponse.json(
    { ok: false, error: "Unauthorized" },
    { status: 401, headers: { "Cache-Control": "no-store" } },
  );
}

async function resolveTargetUserIds(
  supabase: SupabaseClient,
  schoolId: string,
  scope: TargetScope,
  value: string | null,
): Promise<string[]> {
  if (scope === "user" && value) return [value];

  if (scope === "role") {
    const role = (value ?? "").trim().toLowerCase();
    if (role === "teacher" || role === "teachers") {
      const { data } = await supabase
        .from("teachers")
        .select("auth_user_id")
        .eq("school_id", schoolId)
        .not("auth_user_id", "is", null);
      return unique((data ?? []).map((r) => (r as { auth_user_id: string | null }).auth_user_id));
    }
    const { data } = await supabase
      .from("students")
      .select("auth_user_id")
      .eq("school_id", schoolId)
      .not("auth_user_id", "is", null);
    return unique((data ?? []).map((r) => (r as { auth_user_id: string | null }).auth_user_id));
  }

  let query = supabase
    .from("students")
    .select("auth_user_id")
    .eq("school_id", schoolId)
    .not("auth_user_id", "is", null);

  if (scope === "branch" && value) query = query.eq("branch_id", value);
  if (scope === "class" && value) query = query.eq("class_name", value);

  const { data } = await query;
  return unique((data ?? []).map((r) => (r as { auth_user_id: string | null }).auth_user_id));
}

function unique(values: Array<string | null>): string[] {
  return Array.from(new Set(values.filter((v): v is string => Boolean(v && v.trim()))));
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
  const now = new Date().toISOString();

  const { data: pending, error: fetchError } = await client
    .from("scheduled_notifications")
    .select("*")
    .eq("status", "pending")
    .lte("scheduled_at", now)
    .order("scheduled_at", { ascending: true })
    .limit(50);

  if (fetchError) {
    logRouteError("cron/scheduled-notifications:fetch", fetchError);
    return NextResponse.json(
      { ok: false, error: "Failed to fetch scheduled notifications" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }

  const items = (pending ?? []) as Array<Record<string, unknown>>;
  let sent = 0;
  let failed = 0;

  for (const item of items) {
    const id = item.id as string;
    const schoolId = item.school_id as string;
    const branchId = (item.branch_id as string) ?? null;
    const scope = item.target_scope as TargetScope;
    const targetValue = (item.target_value as string) ?? null;

    try {
      const userIds = await resolveTargetUserIds(client, schoolId, scope, targetValue);

      if (userIds.length === 0) {
        await client
          .from("scheduled_notifications")
          .update({ status: "sent", sent_at: now, result: { targeted: 0, sent: 0 } })
          .eq("id", id);
        sent++;
        continue;
      }

      const result = await sendPushNotification(client, {
        schoolId,
        branchId,
        userIds,
        type: (item.type as string) ?? "general",
        title: item.title as string,
        message: item.message as string,
        link: (item.link as string) ?? null,
      });

      await client
        .from("scheduled_notifications")
        .update({
          status: "sent",
          sent_at: now,
          result: {
            targeted: result.targeted,
            sent: result.sent,
            failed: result.failed,
            inAppSaved: result.inAppSaved,
          },
        })
        .eq("id", id);

      sent++;
    } catch (error) {
      failed++;
      logRouteError("cron/scheduled-notifications:send", error);
      await client
        .from("scheduled_notifications")
        .update({ status: "failed", result: { error: String(error) } })
        .eq("id", id);
    }
  }

  return NextResponse.json(
    { ok: true, processed: items.length, sent, failed },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
