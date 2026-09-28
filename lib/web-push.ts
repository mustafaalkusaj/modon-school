import webpush from "web-push";
import { createServiceSupabaseClient } from "@/lib/supabase-server";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY ?? "";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT ?? "mailto:mmustafaomer89@gmail.com";

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

interface WebPushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

const SEND_BATCH = 20;
const RETRY_ATTEMPTS = 2;
const RETRY_BASE_MS = 800;

/** Retries transient failures; 404/410 mean the device is gone, so rethrow at once. */
async function sendWithRetry(
  subscription: WebPushSubscription,
  payload: string,
  options: Parameters<typeof webpush.sendNotification>[2],
) {
  let lastErr: unknown;
  for (let i = 0; i <= RETRY_ATTEMPTS; i++) {
    try {
      await webpush.sendNotification(subscription, payload, options);
      return;
    } catch (err) {
      lastErr = err;
      const code = (err as { statusCode?: number }).statusCode;
      if (code === 410 || code === 404) throw err;
      if (i < RETRY_ATTEMPTS) {
        const delay = RETRY_BASE_MS * Math.pow(2, i) * (0.5 + Math.random() * 0.5);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
}

interface WebPushResult {
  sent: number;
  failed: number;
  deactivated: number;
  errors: string[];
}

export async function sendWebPushToUsers(
  userIds: string[],
  schoolId: string,
  payload: {
    title: string;
    body: string;
    notificationId?: string;
    priority?: string;
    category?: string;
    url?: string;
  },
): Promise<WebPushResult> {
  const result: WebPushResult = { sent: 0, failed: 0, deactivated: 0, errors: [] };

  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    result.errors.push("VAPID keys not configured");
    return result;
  }

  if (userIds.length === 0) return result;

  const svc = createServiceSupabaseClient();

  const { data: subs, error } = await svc
    .from("user_push_subscriptions")
    .select("id, subscription_json")
    .in("user_id", userIds)
    .eq("school_id", schoolId)
    .eq("is_active", true);

  if (error) {
    result.errors.push(`token lookup: ${error.message}`);
    return result;
  }

  const webSubs = (subs ?? []).filter(
    (s) =>
      s.subscription_json &&
      typeof s.subscription_json === "object" &&
      (s.subscription_json as Record<string, unknown>).type === "web",
  );

  if (webSubs.length === 0) return result;

  const pushPayload = JSON.stringify({
    title: payload.title,
    body: payload.body,
    notificationId: payload.notificationId,
    priority: payload.priority ?? "normal",
    category: payload.category ?? "general",
    url: payload.url,
  });

  const deadIds: string[] = [];

  // Parallel batches with a per-request timeout: sequential sends with no
  // timeout could run past the route's time limit on a school-wide
  // announcement. TTL keeps a notification queued for an offline device for a
  // day instead of the push service default.
  const sendOptions = { urgency: "high" as const, TTL: 24 * 60 * 60, timeout: 10_000 };

  const sendOne = async (sub: (typeof webSubs)[number]) => {
    const json = sub.subscription_json as Record<string, unknown>;
    const subscription: WebPushSubscription = {
      endpoint: json.endpoint as string,
      keys: json.keys as { p256dh: string; auth: string },
    };

    if (!subscription.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) {
      result.failed += 1;
      return;
    }

    try {
      await sendWithRetry(subscription, pushPayload, sendOptions);
      result.sent += 1;
    } catch (err: unknown) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode === 410 || statusCode === 404) {
        deadIds.push(sub.id as string);
        result.deactivated += 1;
      } else {
        result.failed += 1;
        result.errors.push(
          err instanceof Error ? err.message : `web push error ${statusCode}`,
        );
      }
    }
  };

  for (let i = 0; i < webSubs.length; i += SEND_BATCH) {
    await Promise.all(webSubs.slice(i, i + SEND_BATCH).map(sendOne));
  }

  if (deadIds.length > 0) {
    await svc
      .from("user_push_subscriptions")
      .update({ is_active: false })
      .in("id", deadIds);
  }

  return result;
}
