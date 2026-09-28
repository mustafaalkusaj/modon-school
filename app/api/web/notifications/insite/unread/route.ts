import { NextRequest, NextResponse } from "next/server";
import { resolveNotificationActor } from "@/lib/notification-actor";
import { getUnreadCount } from "@/lib/notifications/insite-service";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: { message } }, { status });
}

export async function GET(request: NextRequest) {
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

  const { supabase, userId, schoolId } = context.value;
  const count = await getUnreadCount(supabase, userId, schoolId);

  return NextResponse.json({ ok: true, count });
}
