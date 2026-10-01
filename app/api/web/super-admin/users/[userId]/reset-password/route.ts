import { NextRequest, NextResponse } from "next/server";
import { resolveSuperAdminActorContext } from "@/lib/super-admin-server";
import { createServiceSupabaseClient } from "@/lib/supabase-server";
import { jsonServerError } from "@/lib/route-utils";
import { enforceRateLimit, getRateLimitClientIp } from "@/lib/rate-limit";
import { writeAuditLog } from "@/lib/audit/audit-log";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: { message } }, { status });
}

function generateRandomPassword(length = 12): string {
  const charset = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const randomBytes = crypto.getRandomValues(new Uint8Array(length));
  let password = "";
  for (let i = 0; i < length; i++) {
    password += charset.charAt(randomBytes[i] % charset.length);
  }
  return password;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const rateLimited = await enforceRateLimit(req, {
    namespace: "super-admin-reset-password",
    windowMs: 60 * 60_000,
    maxHits: 5,
    identifier: getRateLimitClientIp(req),
  });
  if (rateLimited) {
    return rateLimited;
  }

  const { userId } = await params;
  const context = await resolveSuperAdminActorContext(
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

  const normalizedUserId = userId.trim();
  if (!normalizedUserId) {
    return jsonError("معرف المستخدم غير صالح.", 400);
  }

  const newPassword = generateRandomPassword(12);

  try {
    const serviceSupabase = createServiceSupabaseClient();
    const { error } = await serviceSupabase.auth.admin.updateUserById(
      normalizedUserId,
      {
        password: newPassword,
      },
    );

    if (error) {
      return jsonServerError(
        "web-super-admin-users-userId-reset-password",
        error,
        "تعذر إعادة تعيين كلمة المرور.",
        500,
      );
    }

    // Audit log: record the password reset (never the password itself).
    await writeAuditLog({
      actor_user_id: context.value.actorUserId,
      actor_role: "super_admin",
      actor_source: "app",
      action_type: "reset_password",
      entity_type: "user",
      entity_id: normalizedUserId,
      summary: `Super admin reset the password of user ${normalizedUserId}`,
      ip_address: req.headers.get("x-forwarded-for") || null,
      user_agent: req.headers.get("user-agent") || null,
    });

    return NextResponse.json({ ok: true, temporaryPassword: newPassword });
  } catch (error) {
    return jsonServerError(
      "web-super-admin-users-userId-reset-password",
      error,
      "تعذر إعادة تعيين كلمة المرور.",
      500,
    );
  }
}
