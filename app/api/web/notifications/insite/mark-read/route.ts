import { NextRequest, NextResponse } from "next/server";
import { resolveNotificationActor } from "@/lib/notification-actor";
import { markAsRead, markAllAsRead } from "@/lib/notifications/insite-service";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: { message } }, { status });
}

export async function POST(request: NextRequest) {
  const context = await resolveNotificationActor(request, [
    "admin",
    "super_admin",
    "employee",
    "student",
    "teacher",
  ]);
  if (!context.ok) {
    return jsonError(context.message, context.status);
  }

  const { supabase: actorSupabase, userId: actorUserId } = context.value;
  const body = await request.json().catch(() => ({}));

  if (body.all === true) {
    await markAllAsRead(actorSupabase, actorUserId);
  } else if (
    Array.isArray(body.notificationIds) &&
    body.notificationIds.length > 0
  ) {
    await markAsRead(
      actorSupabase,
      actorUserId,
      body.notificationIds as string[],
    );
  }

  return NextResponse.json({ ok: true });
}
