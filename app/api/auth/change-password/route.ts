import { NextRequest, NextResponse } from "next/server";
import { resolveSchoolScopedActorContext } from "@/lib/managed-users-server";
import { createServiceSupabaseClient } from "@/lib/supabase-server";
import { enforceRateLimit } from "@/lib/rate-limit";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: { message } }, { status });
}

/**
 * POST /api/auth/change-password
 *
 * Accepts { currentPassword, newPassword }.
 * Validates the current password by attempting a sign-in,
 * then updates to the new password via the Supabase admin API.
 *
 * Available to all authenticated roles (admin, super_admin, employee, student, teacher).
 */
export async function POST(request: NextRequest) {
  const rateLimited = await enforceRateLimit(request, {
    namespace: "change-password",
    windowMs: 10 * 60_000,
    maxHits: 10,
  });
  if (rateLimited) return rateLimited;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;

  const currentPassword =
    typeof body?.currentPassword === "string" ? body.currentPassword.trim() : "";
  const newPassword =
    typeof body?.newPassword === "string" ? body.newPassword.trim() : "";

  if (!currentPassword || !newPassword) {
    return jsonError("كلمة المرور الحالية والجديدة مطلوبتان.", 400);
  }

  if (newPassword.length < 6) {
    return jsonError("كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل.", 400);
  }

  if (currentPassword === newPassword) {
    return jsonError("كلمة المرور الجديدة يجب أن تكون مختلفة عن الحالية.", 400);
  }

  // Resolve the authenticated actor (any role)
  const context = await resolveSchoolScopedActorContext(
    null,
    {
      allowedRoles: ["admin", "super_admin", "employee", "student", "teacher"],
      roleDeniedMessage: "ليس لديك صلاحية لتغيير كلمة المرور.",
    },
    request.headers.get("authorization"),
  );

  if (!context.ok) {
    return jsonError(context.message, context.status);
  }

  const { actorUserId } = context.value;
  const serviceSupabase = createServiceSupabaseClient();

  // Fetch the user's email to verify current password
  const { data: authUserData, error: fetchUserError } =
    await serviceSupabase.auth.admin.getUserById(actorUserId);

  if (fetchUserError || !authUserData?.user?.email) {
    return jsonError("تعذر التحقق من الحساب.", 500);
  }

  const userEmail = authUserData.user.email;

  // Verify current password by attempting sign-in
  const { error: signInError } = await serviceSupabase.auth.signInWithPassword({
    email: userEmail,
    password: currentPassword,
  });

  if (signInError) {
    return jsonError("كلمة المرور الحالية غير صحيحة.", 401);
  }

  // Update password via admin API
  const { error: updateError } = await serviceSupabase.auth.admin.updateUserById(
    actorUserId,
    { password: newPassword },
  );

  if (updateError) {
    return jsonError("تعذر تحديث كلمة المرور. حاول مرة أخرى.", 500);
  }

  return NextResponse.json({
    ok: true,
    message: "تم تغيير كلمة المرور بنجاح.",
  });
}
