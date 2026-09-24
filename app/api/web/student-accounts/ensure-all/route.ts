import { NextRequest, NextResponse } from "next/server";
import {
  ensureManagedUserProfileLink,
  resolveSchoolScopedActorContext,
  syncManagedUserAccountState,
  generateManagedLoginIdentifier,
  generateTemporaryPassword,
  hashPassword,
  buildManagedAuthIdentityPayload,
} from "@/lib/managed-users-server";
import { enforceRateLimit } from "@/lib/rate-limit";
import { createServiceSupabaseClient } from "@/lib/supabase-server";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: { message } }, { status });
}

/**
 * POST /api/web/student-accounts/ensure-all
 *
 * Idempotent endpoint that ensures ALL active students have managed user accounts.
 * - Students who already have `auth_user_id` are skipped gracefully.
 * - Students without accounts are provisioned (identical logic to provision-all).
 * - The managed_user_profiles link is ensured for every student with an existing account.
 */
export async function POST(request: NextRequest) {
  const rateLimited = await enforceRateLimit(request, {
    namespace: "students-ensure-all",
    windowMs: 5 * 60_000,
    maxHits: 5,
  });
  if (rateLimited) return rateLimited;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;

  const context = await resolveSchoolScopedActorContext(
    typeof body?.schoolId === "string" ? body.schoolId : null,
    {
      allowedRoles: ["admin", "super_admin"],
      roleDeniedMessage: "ضمان حسابات الطلبة متاح لمدير المدرسة فقط.",
    },
    request.headers.get("authorization"),
  );

  if (!context.ok) {
    return jsonError(context.message, context.status);
  }

  const { actorSupabase, actorUserId, targetSchoolId } = context.value;
  const serviceSupabase = createServiceSupabaseClient();

  // Fetch ALL active students (both with and without accounts)
  const { data: allStudents, error: fetchError } = await serviceSupabase
    .from("students")
    .select("id, full_name, phone, auth_user_id")
    .eq("school_id", targetSchoolId)
    .eq("status", "active")
    .is("deleted_at", null);

  if (fetchError) {
    return jsonError("تعذر جلب قائمة الطلبة.", 500);
  }

  const students = (allStudents ?? []).filter(
    (s) => typeof s.full_name === "string" && (s.full_name as string).trim(),
  );

  if (students.length === 0) {
    return NextResponse.json({
      ok: true,
      created: 0,
      ensured: 0,
      skipped: 0,
      failed: 0,
      message: "لا يوجد طلبة نشطين.",
    });
  }

  let created = 0;
  let ensured = 0;
  let skipped = 0;
  const failed: Array<{ studentId: string; name: string; reason: string }> = [];

  const CONCURRENCY = 10;

  const ensureAccount = async (student: {
    id: string;
    full_name: unknown;
    phone: unknown;
    auth_user_id: unknown;
  }) => {
    const fullName = (student.full_name as string).trim();
    const phone = typeof student.phone === "string" ? student.phone : null;
    const existingAuthUserId =
      typeof student.auth_user_id === "string" ? student.auth_user_id : null;

    // ---- Student already has an auth account ----
    if (existingAuthUserId) {
      try {
        await ensureManagedUserProfileLink(actorSupabase, {
          authUserId: existingAuthUserId,
          schoolId: targetSchoolId,
          role: "student",
          fullName,
          email: "",
          phone,
          isActive: true,
          studentId: student.id,
          createdBy: actorUserId,
        });

        // Ensure credentials exist (may be missing for legacy accounts)
        const { data: existingCred } = await serviceSupabase
          .from("managed_user_credentials")
          .select("auth_user_id")
          .eq("auth_user_id", existingAuthUserId)
          .maybeSingle();

        if (!existingCred) {
          const { data: authUser } = await serviceSupabase.auth.admin.getUserById(existingAuthUserId);
          const email = authUser?.user?.email ?? "";
          const loginId = email || await generateManagedLoginIdentifier(actorSupabase, {
            schoolId: targetSchoolId,
            role: "student",
            fullName,
            preferredEmail: "",
          });
          const tempPw = generateTemporaryPassword();

          await syncManagedUserAccountState(actorSupabase, {
            authUserId: existingAuthUserId,
            schoolId: targetSchoolId,
            role: "student",
            fullName,
            email: loginId,
            phone,
            isActive: true,
            studentId: student.id,
            temporaryPassword: tempPw,
          });
        }

        ensured++;
      } catch {
        skipped++;
      }
      return;
    }

    // ---- Student needs a new account ----
    try {
      const loginIdentifier = await generateManagedLoginIdentifier(actorSupabase, {
        schoolId: targetSchoolId,
        role: "student",
        fullName,
        preferredEmail: "",
      });
      const temporaryPassword = generateTemporaryPassword();
      const createdAt = new Date().toISOString();

      const authIdentityPayload = buildManagedAuthIdentityPayload({
        role: "student",
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

      const asciiLogin = loginIdentifier.replace(/[^\x00-\x7F]/g, (ch) =>
        ch === "ط" ? "st" : ch === "م" ? "tc" : "u",
      );
      const authEmail = loginIdentifier.includes("@")
        ? loginIdentifier
        : `${asciiLogin}@schoolapp.local`;

      const { data: createdUser, error: createError } =
        await serviceSupabase.auth.admin.createUser({
          email: authEmail,
          password: temporaryPassword,
          email_confirm: true,
          ...authIdentityPayload,
        });

      if (createError || !createdUser.user?.id) {
        failed.push({
          studentId: student.id,
          name: fullName,
          reason: createError?.message ?? "فشل إنشاء الحساب",
        });
        return;
      }

      const authUserId = createdUser.user.id;

      const { error: linkError } = await serviceSupabase
        .from("students")
        .update({ auth_user_id: authUserId })
        .eq("id", student.id)
        .eq("school_id", targetSchoolId);

      if (linkError) {
        await serviceSupabase.auth.admin.deleteUser(authUserId);
        failed.push({
          studentId: student.id,
          name: fullName,
          reason: "فشل ربط الحساب",
        });
        return;
      }

      await syncManagedUserAccountState(actorSupabase, {
        authUserId,
        schoolId: targetSchoolId,
        role: "student",
        fullName,
        email: loginIdentifier,
        phone,
        isActive: true,
        studentId: student.id,
        temporaryPassword,
      });

      created++;
    } catch {
      failed.push({
        studentId: student.id,
        name: fullName,
        reason: "خطأ غير متوقع",
      });
    }
  };

  for (let i = 0; i < students.length; i += CONCURRENCY) {
    const batch = students.slice(i, i + CONCURRENCY);
    await Promise.allSettled(batch.map((s) => ensureAccount(s)));
  }

  return NextResponse.json({
    ok: true,
    created,
    ensured,
    skipped,
    failed: failed.length,
    total: students.length,
    ...(failed.length > 0 && { failed_details: failed }),
  });
}
