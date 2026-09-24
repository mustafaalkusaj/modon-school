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
 * POST /api/web/student-accounts/recreate-all
 *
 * Deletes all existing student auth accounts and recreates them
 * with the current username/password format.
 */
export async function POST(request: NextRequest) {
  const rateLimited = await enforceRateLimit(request, {
    namespace: "students-recreate-all",
    windowMs: 10 * 60_000,
    maxHits: 3,
  });
  if (rateLimited) return rateLimited;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;

  const context = await resolveSchoolScopedActorContext(
    typeof body?.schoolId === "string" ? body.schoolId : null,
    {
      allowedRoles: ["admin", "super_admin"],
      roleDeniedMessage: "إعادة إنشاء حسابات الطلبة متاح لمدير المدرسة فقط.",
    },
    request.headers.get("authorization"),
  );

  if (!context.ok) {
    return jsonError(context.message, context.status);
  }

  const { actorSupabase, actorUserId, targetSchoolId } = context.value;
  const serviceSupabase = createServiceSupabaseClient();

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
    return NextResponse.json({ ok: true, deleted: 0, created: 0 });
  }

  // Phase 1: Delete existing auth accounts
  let deleted = 0;
  const CONCURRENCY = 10;

  const studentsWithAuth = students.filter(
    (s) => typeof s.auth_user_id === "string",
  );

  for (let i = 0; i < studentsWithAuth.length; i += CONCURRENCY) {
    const batch = studentsWithAuth.slice(i, i + CONCURRENCY);
    await Promise.allSettled(
      batch.map(async (student) => {
        const authUserId = student.auth_user_id as string;
        await serviceSupabase.auth.admin.deleteUser(authUserId).catch(() => {});
        await serviceSupabase
          .from("managed_user_credentials")
          .delete()
          .eq("auth_user_id", authUserId);
        await serviceSupabase
          .from("managed_user_profiles")
          .delete()
          .eq("auth_user_id", authUserId);
        await serviceSupabase
          .from("students")
          .update({ auth_user_id: null })
          .eq("id", student.id)
          .eq("school_id", targetSchoolId);
        deleted++;
      }),
    );
  }

  // Phase 2: Recreate all accounts with new format
  let created = 0;
  const failed: Array<{ studentId: string; name: string; reason: string }> = [];

  for (let i = 0; i < students.length; i += CONCURRENCY) {
    const batch = students.slice(i, i + CONCURRENCY);
    await Promise.allSettled(
      batch.map(async (student) => {
        const fullName = (student.full_name as string).trim();
        const phone = typeof student.phone === "string" ? student.phone : null;

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
      }),
    );
  }

  return NextResponse.json({
    ok: true,
    deleted,
    created,
    failed: failed.length,
    total: students.length,
    ...(failed.length > 0 && { failed_details: failed }),
  });
}
