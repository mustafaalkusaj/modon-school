import { NextRequest, NextResponse } from "next/server";
import {
  buildManagedAuthIdentityPayload,
  generateManagedLoginIdentifier,
  generateTemporaryPassword,
  hashPassword,
  resolveSchoolScopedActorContext,
  syncManagedUserAccountState,
  upsertManagedUserCredential,
} from "@/lib/managed-users-server";
import { enforceRateLimit } from "@/lib/rate-limit";
import { createServiceSupabaseClient } from "@/lib/supabase-server";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: { message } }, { status });
}

type ServiceClient = ReturnType<typeof createServiceSupabaseClient>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ActorClient = any;

/**
 * Teachers that already have an auth account but no stored plaintext password
 * (created before the plaintext was kept) cannot show/print their card. Rotate
 * their password so the admin gets a visible one. Returns how many were reset.
 */
async function resetMissingTeacherPasswords(
  serviceSupabase: ServiceClient,
  actorSupabase: ActorClient,
  schoolId: string,
): Promise<number> {
  const { data: linked, error } = await serviceSupabase
    .from("teachers")
    .select("auth_user_id, app_username")
    .eq("school_id", schoolId)
    .neq("status", "deleted")
    .not("auth_user_id", "is", null);
  if (error || !linked?.length) return 0;

  const ids = linked.map((t) => t.auth_user_id as string);
  const { data: creds } = await serviceSupabase
    .from("managed_user_credentials")
    .select("auth_user_id, login_identifier, temporary_password_plain")
    .in("auth_user_id", ids);
  const credMap = new Map((creds ?? []).map((c) => [c.auth_user_id, c]));

  let reset = 0;
  for (const t of linked) {
    const authUserId = t.auth_user_id as string;
    const cred = credMap.get(authUserId);
    if (cred?.temporary_password_plain) continue;
    const loginIdentifier = (t.app_username as string | null) ?? cred?.login_identifier;
    if (!loginIdentifier) continue;

    const temporaryPassword = generateTemporaryPassword();
    const { error: pwError } = await serviceSupabase.auth.admin.updateUserById(authUserId, {
      password: temporaryPassword,
    });
    if (pwError) {
      console.error("[teacher-ensure-all] password update failed", authUserId, pwError.message);
      continue;
    }
    await upsertManagedUserCredential(actorSupabase, {
      authUserId,
      schoolId,
      loginIdentifier,
      temporaryPassword,
    });
    reset++;
  }
  return reset;
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
    typeof body?.schoolId === "string" ? body.schoolId : request.nextUrl.searchParams.get("schoolId"),
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

  let reset = 0;
  try {
    reset = await resetMissingTeacherPasswords(serviceSupabase, actorSupabase, targetSchoolId);
  } catch (err) {
    console.error("[teacher-ensure-all] password reset failed", err);
  }

  if (teachersToProvision.length === 0) {
    return NextResponse.json({
      ok: true,
      created: 0,
      reset,
      failed: 0,
      message: reset > 0
        ? `تم توليد كلمة مرور جديدة لـ ${reset} معلم.`
        : "جميع المعلمين لديهم حسابات بالفعل.",
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
    reset,
    failed: failed.length,
    total: teachersToProvision.length,
    ...(failed.length > 0 && { failed_details: failed }),
  });
}
