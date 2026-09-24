import { NextRequest, NextResponse } from "next/server";
import {
  generateManagedLoginIdentifier,
  generateTemporaryPassword,
  upsertManagedUserCredential,
  resolveSchoolScopedActorContext,
} from "@/lib/managed-users-server";
import { enforceRateLimit } from "@/lib/rate-limit";
import { createServiceSupabaseClient } from "@/lib/supabase-server";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: { message } }, { status });
}

export async function POST(request: NextRequest) {
  const rateLimited = await enforceRateLimit(request, {
    namespace: "students-regenerate-credentials",
    windowMs: 10 * 60_000,
    maxHits: 3,
  });
  if (rateLimited) return rateLimited;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;

  const context = await resolveSchoolScopedActorContext(
    typeof body?.schoolId === "string" ? body.schoolId : null,
    {
      allowedRoles: ["admin", "super_admin"],
      roleDeniedMessage: "تحديث بيانات الدخول متاح لمدير المدرسة فقط.",
    },
    request.headers.get("authorization"),
  );

  if (!context.ok) {
    return jsonError(context.message, context.status);
  }

  const { actorSupabase, targetSchoolId } = context.value;
  const serviceSupabase = createServiceSupabaseClient();

  const { data: studentsWithAccounts, error: fetchError } = await serviceSupabase
    .from("students")
    .select("id, full_name, auth_user_id")
    .eq("school_id", targetSchoolId)
    .eq("status", "active")
    .is("deleted_at", null)
    .not("auth_user_id", "is", null);

  if (fetchError) {
    return jsonError("تعذر جلب قائمة الطلبة.", 500);
  }

  const students = (studentsWithAccounts ?? []).filter(
    (s) =>
      typeof s.full_name === "string" &&
      (s.full_name as string).trim() &&
      typeof s.auth_user_id === "string",
  );

  if (students.length === 0) {
    return NextResponse.json({ ok: true, updated: 0, message: "لا يوجد طلبة لتحديث بياناتهم." });
  }

  let updated = 0;
  const failed: Array<{ studentId: string; name: string; reason: string }> = [];

  const CONCURRENCY = 10;

  const updateAccount = async (student: { id: string; full_name: unknown; auth_user_id: unknown }) => {
    const fullName = (student.full_name as string).trim();
    const authUserId = student.auth_user_id as string;

    const newLoginIdentifier = await generateManagedLoginIdentifier(actorSupabase, {
      schoolId: targetSchoolId,
      role: "student",
      fullName,
      preferredEmail: "",
    });

    const newPassword = generateTemporaryPassword();
    const safeId = newLoginIdentifier.replace(/[^\x20-\x7E]/g, "") || `st${newLoginIdentifier.replace(/[^\d]/g, "")}`;
    const authEmail = newLoginIdentifier.includes("@")
      ? newLoginIdentifier
      : `${safeId}@schoolapp.local`;

    const { error: authUpdateError } = await serviceSupabase.auth.admin.updateUserById(
      authUserId,
      { email: authEmail, password: newPassword },
    );

    if (authUpdateError) {
      failed.push({ studentId: student.id, name: fullName, reason: authUpdateError.message });
      return;
    }

    await upsertManagedUserCredential(actorSupabase, {
      authUserId,
      schoolId: targetSchoolId,
      loginIdentifier: newLoginIdentifier,
      temporaryPassword: newPassword,
    });

    await serviceSupabase
      .from("managed_user_profiles" as any)
      .update({ email: newLoginIdentifier })
      .eq("auth_user_id", authUserId);

    updated++;
  };

  for (let i = 0; i < students.length; i += CONCURRENCY) {
    const batch = students.slice(i, i + CONCURRENCY);
    await Promise.allSettled(batch.map((s) => updateAccount(s)));
  }

  return NextResponse.json({
    ok: true,
    updated,
    failed: failed.length,
    total: students.length,
    ...(failed.length > 0 && { failed_details: failed }),
  });
}
