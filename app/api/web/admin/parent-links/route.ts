import { NextRequest, NextResponse } from "next/server";
import { resolveSchoolScopedActorContext } from "@/lib/managed-users-server";
import { createServiceSupabaseClient } from "@/lib/supabase-server";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: { message } }, { status });
}

const ADMIN_ROLES = ["admin", "super_admin"] as const;

type ServiceClient = ReturnType<typeof createServiceSupabaseClient>;

/**
 * Parents live in one of two tables depending on how the account was made:
 * self-registered parents in user_profiles, provisioned ones in
 * managed_user_profiles. Check both, scoped to the school, and return the
 * auth user id either way.
 */
async function findParentByEmail(
  serviceClient: ServiceClient,
  email: string,
  schoolId: string,
): Promise<{ id: string; email: string } | null> {
  const normalized = email.trim().toLowerCase();

  const { data: profile } = await serviceClient
    .from("user_profiles")
    .select("id, email")
    .ilike("email", normalized)
    .eq("school_id", schoolId)
    .maybeSingle();

  if (profile?.id) {
    return { id: profile.id, email: profile.email ?? normalized };
  }

  const { data: managed } = await serviceClient
    .from("managed_user_profiles")
    .select("auth_user_id, email")
    .ilike("email", normalized)
    .eq("school_id", schoolId)
    .maybeSingle();

  if (managed?.auth_user_id) {
    return { id: managed.auth_user_id, email: managed.email ?? normalized };
  }

  return null;
}

/** Display emails for a set of parent auth user ids, from either table. */
async function resolveParentEmails(
  serviceClient: ServiceClient,
  parentIds: string[],
): Promise<Map<string, string>> {
  const emails = new Map<string, string>();
  if (parentIds.length === 0) return emails;

  const { data: profiles } = await serviceClient
    .from("user_profiles")
    .select("id, email")
    .in("id", parentIds);

  for (const p of profiles ?? []) {
    if (p.email) emails.set(p.id, p.email);
  }

  const unresolved = parentIds.filter((id) => !emails.has(id));
  if (unresolved.length > 0) {
    const { data: managed } = await serviceClient
      .from("managed_user_profiles")
      .select("auth_user_id, email")
      .in("auth_user_id", unresolved);

    for (const m of managed ?? []) {
      if (m.email) emails.set(m.auth_user_id, m.email);
    }
  }

  return emails;
}

/**
 * GET /api/web/admin/parent-links?schoolId= — list parent↔student links.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;

  const context = await resolveSchoolScopedActorContext(
    searchParams.get("schoolId"),
    {
      allowedRoles: [...ADMIN_ROLES],
      roleDeniedMessage: "ليس لديك صلاحية عرض روابط أولياء الأمور.",
    },
    request.headers.get("authorization"),
  );

  if (!context.ok) return jsonError(context.message, context.status);

  const { targetSchoolId } = context.value;
  const serviceClient = createServiceSupabaseClient();

  const { data: rows, error } = await serviceClient
    .from("parent_student_links")
    .select("id, parent_user_id, student_id, created_at")
    .eq("school_id", targetSchoolId)
    .order("created_at", { ascending: false });

  if (error) return jsonError(error.message, 500);

  const links = rows ?? [];
  const parentEmails = await resolveParentEmails(
    serviceClient,
    Array.from(new Set(links.map((l) => l.parent_user_id))),
  );

  const studentIds = Array.from(new Set(links.map((l) => l.student_id)));
  const studentNames = new Map<string, string>();
  if (studentIds.length > 0) {
    const { data: students } = await serviceClient
      .from("students")
      .select("id, full_name")
      .in("id", studentIds);
    for (const s of students ?? []) {
      studentNames.set(s.id, s.full_name ?? "");
    }
  }

  return NextResponse.json({
    ok: true,
    links: links.map((l) => ({
      id: l.id,
      parent_user_id: l.parent_user_id,
      parent_email: parentEmails.get(l.parent_user_id) ?? "—",
      student_id: l.student_id,
      student_name: studentNames.get(l.student_id) ?? "—",
    })),
  });
}

/**
 * POST /api/web/admin/parent-links — link a parent account to a student.
 * Body: { parent_email, student_id, schoolId }
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;

  const parentEmail = typeof body?.parent_email === "string" ? body.parent_email.trim() : "";
  const studentId = typeof body?.student_id === "string" ? body.student_id : "";
  const requestedSchoolId = typeof body?.schoolId === "string" ? body.schoolId : null;

  if (!parentEmail || !studentId) {
    return jsonError("البريد الإلكتروني لولي الأمر والطالب مطلوبان.", 400);
  }

  const context = await resolveSchoolScopedActorContext(
    requestedSchoolId,
    {
      allowedRoles: [...ADMIN_ROLES],
      roleDeniedMessage: "ليس لديك صلاحية ربط أولياء الأمور.",
    },
    request.headers.get("authorization"),
  );

  if (!context.ok) return jsonError(context.message, context.status);

  const { targetSchoolId } = context.value;
  const serviceClient = createServiceSupabaseClient();

  const parent = await findParentByEmail(serviceClient, parentEmail, targetSchoolId);
  if (!parent) {
    return jsonError("لا يوجد حساب بهذا البريد الإلكتروني في هذه المدرسة.", 404);
  }

  // Never link a student from another school, even when the id is valid.
  const { data: student } = await serviceClient
    .from("students")
    .select("id, school_id")
    .eq("id", studentId)
    .maybeSingle();

  if (!student || student.school_id !== targetSchoolId) {
    return jsonError("الطالب غير موجود في هذه المدرسة.", 404);
  }

  const { data: existing } = await serviceClient
    .from("parent_student_links")
    .select("id")
    .eq("parent_user_id", parent.id)
    .eq("student_id", studentId)
    .eq("school_id", targetSchoolId)
    .maybeSingle();

  if (existing?.id) {
    return jsonError("ولي الأمر مرتبط بهذا الطالب بالفعل.", 409);
  }

  const { data: inserted, error: insertError } = await serviceClient
    .from("parent_student_links")
    .insert({
      parent_user_id: parent.id,
      student_id: studentId,
      school_id: targetSchoolId,
    })
    .select("id")
    .single();

  if (insertError) return jsonError(insertError.message, 500);

  return NextResponse.json({ ok: true, link: { id: inserted.id } }, { status: 201 });
}

/**
 * DELETE /api/web/admin/parent-links — remove a link.
 * Body: { link_id, schoolId }
 */
export async function DELETE(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;

  const linkId = typeof body?.link_id === "string" ? body.link_id : "";
  const requestedSchoolId = typeof body?.schoolId === "string" ? body.schoolId : null;

  if (!linkId) return jsonError("معرف الرابط مطلوب.", 400);

  const context = await resolveSchoolScopedActorContext(
    requestedSchoolId,
    {
      allowedRoles: [...ADMIN_ROLES],
      roleDeniedMessage: "ليس لديك صلاحية حذف روابط أولياء الأمور.",
    },
    request.headers.get("authorization"),
  );

  if (!context.ok) return jsonError(context.message, context.status);

  const { targetSchoolId } = context.value;
  const serviceClient = createServiceSupabaseClient();

  // The school_id filter is what stops one school deleting another's link.
  const { error } = await serviceClient
    .from("parent_student_links")
    .delete()
    .eq("id", linkId)
    .eq("school_id", targetSchoolId);

  if (error) return jsonError(error.message, 500);

  return NextResponse.json({ ok: true });
}
