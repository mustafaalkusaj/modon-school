import { NextRequest, NextResponse } from "next/server";
import { getManagedLoginLocalPart } from "@/lib/managed-users/auth-email";
import { openTemporaryPassword } from "@/lib/managed-users/password-vault";
import { resolveSchoolScopedActorContext } from "@/lib/managed-users-server";
import { createServiceSupabaseClient } from "@/lib/supabase-server";

import { logRouteError } from "@/lib/route-utils";
const BATCH_SIZE = 50;

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const authHeader = request.headers.get("authorization");

  const context = await resolveSchoolScopedActorContext(
    searchParams.get("schoolId"),
    {
      allowedRoles: ["admin", "super_admin"],
      roleDeniedMessage: "ليس لديك صلاحية عرض حسابات الطلبة.",
    },
    authHeader,
  );

  if (!context.ok) {
    console.error(`[student-accounts] auth failed: status=${context.status} message="${context.message}" hasAuthHeader=${!!authHeader} schoolIdParam=${searchParams.get("schoolId")}`);
    return NextResponse.json({ ok: false, message: context.message, students: [], without_account: 0 }, { status: context.status });
  }

  const { targetSchoolId } = context.value;
  const serviceClient = createServiceSupabaseClient();

  const { data: studentRows, error: studentsError } = await serviceClient
    .from("students")
    .select("id, full_name, class_name, section, auth_user_id")
    .eq("school_id", targetSchoolId)
    .eq("status", "active")
    .is("deleted_at", null)
    .order("class_name", { ascending: true })
    .order("full_name", { ascending: true });

  if (studentsError) {
    logRouteError("web-student-accounts", studentsError);
    return NextResponse.json({ ok: false, error: "تعذر إكمال العملية. حاول مرة أخرى لاحقاً." }, { status: 500 });
  }

  if (!studentRows || studentRows.length === 0) {
    return NextResponse.json({
      ok: true,
      students: [],
      without_account: 0,
    });
  }

  const authUserIds = studentRows
    .map((s) => s.auth_user_id)
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
      logRouteError("web-student-accounts", error);
      return NextResponse.json({ ok: false, error: "تعذر إكمال العملية. حاول مرة أخرى لاحقاً." }, { status: 500 });
    }
    if (data) allCredentials.push(...data);
  }

  const credMap = new Map(allCredentials.map((c) => [c.auth_user_id, c]));

  const students = studentRows.map((s) => {
    const cred = s.auth_user_id ? credMap.get(s.auth_user_id) : undefined;
    return {
      studentId: s.id,
      authUserId: s.auth_user_id ?? null,
      fullName: s.full_name,
      className: s.class_name,
      section: s.section,
      username: cred?.login_identifier ? (getManagedLoginLocalPart(cred.login_identifier) ?? cred.login_identifier) : "",
      password: openTemporaryPassword(cred?.temporary_password_plain),
      hasAccount: !!(cred?.login_identifier),
    };
  });

  const withoutAccount = students.filter((s) => !s.hasAccount).length;

  return NextResponse.json({
    ok: true,
    students,
    without_account: withoutAccount,
  });
}
