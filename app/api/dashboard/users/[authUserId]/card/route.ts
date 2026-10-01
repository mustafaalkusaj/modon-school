import { NextRequest, NextResponse } from "next/server";

import {
  buildManagedUserAccountCard,
  fetchManagedUserByAuthUserId,
  markAccountCardPrinted,
  resolveManagedUsersActorContext,
} from "@/lib/managed-users-server";

import { jsonServerError } from "@/lib/route-utils";
function jsonError(message: string, status: number) {
  return NextResponse.json({ error: { message } }, { status });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ authUserId: string }> },
) {
  const { authUserId } = await params;
  const schoolId = req.nextUrl.searchParams.get("schoolId");
  const context = await resolveManagedUsersActorContext(
    schoolId,
    req.headers.get("authorization"),
  );

  if (!context.ok) {
    return jsonError(
      "message" in context
        ? context.message
        : "تعذر التحقق من صلاحيات المستخدم.",
      "status" in context ? context.status : 500,
    );
  }

  const { actorSupabase, targetSchoolId } = context.value;
  let user: Awaited<ReturnType<typeof fetchManagedUserByAuthUserId>> = null;
  try {
    user = await fetchManagedUserByAuthUserId(actorSupabase, {
      authUserId,
      schoolId: targetSchoolId,
    });
  } catch (error) {
    return jsonServerError("dashboard-users-authUserId-card", error, "تعذر تحميل الحساب المطلوب.", 500);
  }

  if (!user) {
    return jsonError("الحساب المطلوب غير موجود داخل المدرسة الحالية.", 404);
  }

  const accountCard = await buildManagedUserAccountCard(actorSupabase, user);
  await markAccountCardPrinted(actorSupabase, {
    authUserId,
    schoolId: targetSchoolId,
  });

  return NextResponse.json({
    ok: true,
    accountCard,
    user,
  });
}
