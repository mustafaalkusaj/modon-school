import { NextRequest, NextResponse } from "next/server";
import {
  buildManagedAuthIdentityPayload,
  generateManagedLoginIdentifier,
  generateTemporaryPassword,
  hashPassword,
  resolveSchoolScopedActorContext,
  syncManagedUserAccountState,
} from "@/lib/managed-users-server";
import { enforceRateLimit } from "@/lib/rate-limit";
import { createServiceSupabaseClient } from "@/lib/supabase-server";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: { message } }, { status });
}

/**
 * POST /api/web/teacher-accounts/ensure-all — ensure all teachers have managed accounts
 */
export async function POST(request: NextRequest) {
  const rateLimited = await enforceRateLimit(request, {
    namespace: "teachers-ensure-all",
    windowMs: 5 * 60_000,
    maxHits: 5,
  });
  if (rateLimited) return rateLimited;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;

  const context = await resolveSchoolScopedActorContext(
    typeof body?.schoolId === "string" ? body.schoolId : null,
    {
      allowedRoles: ["admin", "super_admin"],
      roleDeniedMessage: "إنشاء حسابات المعلمين متاح لمدير المدرسة فقط.",
    },
    request.headers.get("authorization"),
  );

  if (!context.ok) {
    return jsonError(context.message, context.status);
  }

  const { actorSupabase, actorUserId, targetSchoolId } = context.value;
  const serviceSupabase = createServiceSupabaseClient();

  const { data: teachersWithout, error: fetchError } = await serviceSupabase
    .from("teachers")
    .select("id, full_name, phone")
    .eq("school_id", targetSchoolId)
    .neq("status", "deleted")
    .is("auth_user_id", null);

  if (fetchError) {
    return jsonError("تعذر جلب قائمة المعلمين بدون حسابات.", 500);
  }

  const teachersToProvision = (teachersWithout ?? []).filter(
    (t) => typeof t.full_name === "string" && (t.full_name as string).trim(),
  );

  if (teachersToProvision.length === 0) {
    return NextResponse.json({
      ok: true,
      created: 0,
      failed: 0,
      message: "جميع المعلمين لديهم حسابات بالفعل.",
    });
  }

  let created = 0;
  const failed: Array<{ teacherId: string; name: string; reason: string }> = [];

  const CONCURRENCY = 10;

  const createAccount = async (teacher: { id: string; full_name: unknown; phone: unknown }) => {
    const fullName = (teacher.full_name as string).trim();
    const phone = typeof teacher.phone === "string" ? teacher.phone : null;

    const loginIdentifier = await generateManagedLoginIdentifier(actorSupabase, {
      schoolId: targetSchoolId,
      role: "teacher",
      fullName,
      preferredEmail: "",
    });
    const temporaryPassword = generateTemporaryPassword();
    const createdAt = new Date().toISOString();

    const authIdentityPayload = buildManagedAuthIdentityPayload({
      role: "teacher",
      schoolId: targetSchoolId,
      fullName,
      loginIdentifier,
      createdBy: actorUserId,
      credentialPatch: {
        temporaryPasswordHash: hashPassword(temporaryPassword),
        hasPendingSetup: true,
        passwordLastResetAt: createdAt,
        cardLastPrintedAt: null,
      },
    });

    const authEmail = loginIdentifier.includes("@")
      ? loginIdentifier
      : `${loginIdentifier}@schoolapp.local`;

    const { data: createdUser, error: createError } = await serviceSupabase.auth.admin.createUser({
      email: authEmail,
      password: temporaryPassword,
      email_confirm: true,
      ...authIdentityPayload,
    });

    if (createError || !createdUser.user?.id) {
      failed.push({
        teacherId: teacher.id,
        name: fullName,
        reason: createError?.message ?? "فشل إنشاء الحساب",
      });
      return;
    }

    const authUserId = createdUser.user.id;

    const { error: linkError } = await serviceSupabase
      .from("teachers")
      .update({ auth_user_id: authUserId })
      .eq("id", teacher.id)
      .eq("school_id", targetSchoolId);

    if (linkError) {
      await serviceSupabase.auth.admin.deleteUser(authUserId);
      failed.push({ teacherId: teacher.id, name: fullName, reason: "فشل ربط الحساب" });
      return;
    }

    await syncManagedUserAccountState(actorSupabase, {
      authUserId,
      schoolId: targetSchoolId,
      role: "teacher",
      fullName,
      email: loginIdentifier,
      phone,
      isActive: true,
      temporaryPassword,
    });

    created++;
  };

  for (let i = 0; i < teachersToProvision.length; i += CONCURRENCY) {
    const batch = teachersToProvision.slice(i, i + CONCURRENCY);
    await Promise.allSettled(batch.map((t) => createAccount(t)));
  }

  return NextResponse.json({
    ok: true,
    created,
    failed: failed.length,
    total: teachersToProvision.length,
    ...(failed.length > 0 && { failed_details: failed }),
  });
}
