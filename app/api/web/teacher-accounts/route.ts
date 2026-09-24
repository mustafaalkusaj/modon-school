import { NextRequest, NextResponse } from "next/server";
import { resolveSchoolScopedActorContext } from "@/lib/managed-users-server";
import { createServiceSupabaseClient } from "@/lib/supabase-server";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: { message } }, { status });
}

const BATCH_SIZE = 50;

/**
 * GET /api/web/teacher-accounts — list teachers with their managed credentials
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;

  const context = await resolveSchoolScopedActorContext(
    searchParams.get("schoolId"),
    {
      allowedRoles: ["admin", "super_admin"],
      roleDeniedMessage: "ليس لديك صلاحية عرض حسابات المعلمين.",
    },
    request.headers.get("authorization"),
  );

  if (!context.ok) {
    return jsonError(context.message, context.status);
  }

  const { targetSchoolId } = context.value;
  const serviceClient = createServiceSupabaseClient();

  const { data: teacherRows, error: teachersError } = await serviceClient
    .from("teachers")
    .select("id, full_name, subject, job_title, auth_user_id, app_username, app_status")
    .eq("school_id", targetSchoolId)
    .neq("status", "deleted")
    .order("full_name", { ascending: true });

  if (teachersError) {
    return NextResponse.json(
      { ok: false, error: teachersError.message },
      { status: 500 },
    );
  }

  if (!teacherRows || teacherRows.length === 0) {
    return NextResponse.json({ ok: true, teachers: [] });
  }

  const authUserIds = teacherRows
    .map((t) => t.auth_user_id)
    .filter((id): id is string => !!id);

  const allCredentials: {
    auth_user_id: string;
    login_identifier: string;
    temporary_password_plain: string | null;
  }[] = [];

  for (let i = 0; i < authUserIds.length; i += BATCH_SIZE) {
    const batch = authUserIds.slice(i, i + BATCH_SIZE);
    const { data, error } = await serviceClient
      .from("managed_user_credentials")
      .select("auth_user_id, login_identifier, temporary_password_plain")
      .in("auth_user_id", batch);

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 },
      );
    }
    if (data) allCredentials.push(...data);
  }

  const credMap = new Map(allCredentials.map((c) => [c.auth_user_id, c]));

  const teachers = teacherRows.map((t) => {
    const cred = t.auth_user_id ? credMap.get(t.auth_user_id) : undefined;
    return {
      authUserId: t.auth_user_id ?? "",
      fullName: t.full_name,
      subject: t.subject ?? "",
      jobTitle: t.job_title ?? "",
      username: t.app_username ?? cred?.login_identifier ?? "",
      password: cred?.temporary_password_plain ?? "",
      appStatus: t.app_status ?? "",
    };
  });

  const withoutAccount = (teacherRows ?? []).filter((t) => !t.auth_user_id).length;

  return NextResponse.json({ ok: true, teachers, without_account: withoutAccount });
}

/**
 * POST /api/web/teacher-accounts — provision a single teacher account
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const teacherId = typeof body?.teacherId === "string" ? body.teacherId : null;
  const schoolId = typeof body?.schoolId === "string" ? body.schoolId : null;

  if (!teacherId) {
    return jsonError("teacherId مطلوب.", 400);
  }

  const context = await resolveSchoolScopedActorContext(
    schoolId,
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

  const { data: teacher, error: fetchError } = await serviceSupabase
    .from("teachers")
    .select("id, full_name, phone, auth_user_id")
    .eq("id", teacherId)
    .eq("school_id", targetSchoolId)
    .neq("status", "deleted")
    .maybeSingle();

  if (fetchError || !teacher) {
    return jsonError("لم يتم العثور على المعلم.", 404);
  }

  if (teacher.auth_user_id) {
    return jsonError("هذا المعلم لديه حساب بالفعل.", 409);
  }

  const {
    generateManagedLoginIdentifier,
    generateTemporaryPassword,
    hashPassword,
    buildManagedAuthIdentityPayload,
    syncManagedUserAccountState,
  } = await import("@/lib/managed-users-server");

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
    return jsonError(createError?.message ?? "فشل إنشاء الحساب", 500);
  }

  const authUserId = createdUser.user.id;

  const { error: linkError } = await serviceSupabase
    .from("teachers")
    .update({ auth_user_id: authUserId })
    .eq("id", teacher.id)
    .eq("school_id", targetSchoolId);

  if (linkError) {
    await serviceSupabase.auth.admin.deleteUser(authUserId);
    return jsonError("فشل ربط الحساب بالمعلم.", 500);
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

  return NextResponse.json({
    ok: true,
    teacher: {
      fullName,
      username: loginIdentifier,
      password: temporaryPassword,
    },
  });
}
