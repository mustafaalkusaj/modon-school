import { NextRequest, NextResponse } from "next/server";
import { resolveNotificationActor } from "@/lib/notification-actor";
import { createServiceSupabaseClient } from "@/lib/supabase-server";

export async function POST(request: NextRequest) {
  // QR-login accounts have no Supabase session — accept the signed RBAC
  // cookie too, or their devices could never be registered for push.
  const context = await resolveNotificationActor(request, [
    "admin",
    "super_admin",
    "employee",
    "student",
    "teacher",
    "parent",
    "driver",
    "transport_manager",
  ]);
  if (!context.ok) {
    return NextResponse.json({ error: context.message }, { status: context.status });
  }

  const { userId: actorUserId, schoolId: targetSchoolId } = context.value;

  const body = await request.json().catch(() => null);
  if (!body?.subscription?.endpoint || !body?.subscription?.keys) {
    return NextResponse.json(
      { error: "subscription with endpoint and keys required" },
      { status: 400 },
    );
  }

  const subscriptionJson = {
    type: "web" as const,
    endpoint: body.subscription.endpoint,
    keys: body.subscription.keys,
  };

  const svc = createServiceSupabaseClient();

  const { data: existing } = await svc
    .from("user_push_subscriptions")
    .select("id")
    .eq("user_id", actorUserId)
    .eq("school_id", targetSchoolId)
    .contains("subscription_json", { endpoint: subscriptionJson.endpoint })
    .limit(1)
    .maybeSingle();

  // Report write failures instead of answering ok: true for a device that was
  // never stored.
  const { error: writeError } = existing
    ? await svc
        .from("user_push_subscriptions")
        .update({ subscription_json: subscriptionJson, is_active: true })
        .eq("id", existing.id)
    : await svc.from("user_push_subscriptions").insert({
        user_id: actorUserId,
        school_id: targetSchoolId,
        platform: "web",
        subscription_json: subscriptionJson,
        is_active: true,
      });

  if (writeError) {
    console.error("[push-subscribe] failed to store subscription:", writeError.message);
    return NextResponse.json(
      { ok: false, error: "تعذر تفعيل الإشعارات على هذا الجهاز." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
