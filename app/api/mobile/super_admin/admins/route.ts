import { NextRequest, NextResponse } from "next/server";

import {
  generateTemporaryPassword,
  upsertManagedUserCredential,
} from "@/lib/managed-users-server";
import { resolveSuperAdminMobileRouteContext } from "@/lib/mobile-super-admin-server";
import { enforceRateLimit } from "@/lib/rate-limit";
import { logRouteError } from "@/lib/route-utils";

export async function GET(req: NextRequest) {
  try {
    const context = await resolveSuperAdminMobileRouteContext(req);
    if (context.ok === false) return context.response;

    const { serviceSupabase } = context.value;

    const url = new URL(req.url);
    const search = url.searchParams.get("search") ?? "";
    const status = url.searchParams.get("status") ?? "all";

    let query = serviceSupabase
      .from("managed_user_profiles")
      .select("auth_user_id, full_name, school_id, is_active, role, created_at")
      .eq("role", "admin");

    if (search.trim()) {
      query = query.ilike("full_name", `%${search.trim()}%`);
    }

    if (status === "active") {
      query = query.eq("is_active", true);
    } else if (status === "inactive") {
      query = query.eq("is_active", false);
    }

    const { data, error } = await query.order("created_at", {
      ascending: false,
    });

    if (error) throw error;

    return NextResponse.json({ ok: true, items: data ?? [] });
  } catch {
    return NextResponse.json(
      { ok: false, error: "internal_error" },
      { status: 500 },
    );
  }
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function readTrimmed(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Provision a new school administrator. Mirrors the web console flow: create
 * the auth user, insert the managed profile, then issue a one-time credential
 * the super_admin hands over. The generated password is returned exactly once
 * and never persisted in clear text.
 */
export async function POST(req: NextRequest) {
  try {
    const context = await resolveSuperAdminMobileRouteContext(req);
    if (context.ok === false) return context.response;

    const { serviceSupabase, authUserId } = context.value;

    const rateLimited = await enforceRateLimit(req, {
      namespace: "super-admin-create-admin",
      windowMs: 60_000,
      maxHits: 10,
      identifier: authUserId,
    });
    if (rateLimited) return rateLimited;

    const body = (await req.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const fullName = readTrimmed(body, "full_name");
    const email = readTrimmed(body, "email").toLowerCase();
    const phone = readTrimmed(body, "phone");
    const schoolId = readTrimmed(body, "school_id");

    if (!fullName) {
      return NextResponse.json(
        { ok: false, error: "الاسم الكامل مطلوب." },
        { status: 400 },
      );
    }
    if (!EMAIL_PATTERN.test(email)) {
      return NextResponse.json(
        { ok: false, error: "البريد الإلكتروني غير صالح." },
        { status: 400 },
      );
    }
    if (!schoolId) {
      return NextResponse.json(
        { ok: false, error: "يجب اختيار المدرسة." },
        { status: 400 },
      );
    }

    const { data: school, error: schoolError } = await serviceSupabase
      .from("schools")
      .select("id")
      .eq("id", schoolId)
      .maybeSingle();

    if (schoolError) throw schoolError;
    if (!school) {
      return NextResponse.json(
        { ok: false, error: "المدرسة غير موجودة." },
        { status: 404 },
      );
    }

    const { data: existing, error: existingError } = await serviceSupabase
      .from("managed_user_profiles")
      .select("auth_user_id")
      .eq("email", email)
      .maybeSingle();

    if (existingError) throw existingError;
    if (existing) {
      return NextResponse.json(
        { ok: false, error: "يوجد حساب مسجّل بهذا البريد الإلكتروني." },
        { status: 409 },
      );
    }

    const temporaryPassword = generateTemporaryPassword();

    const { data: created, error: createError } =
      await serviceSupabase.auth.admin.createUser({
        email,
        password: temporaryPassword,
        email_confirm: true,
        user_metadata: { full_name: fullName, role: "admin" },
      });

    if (createError || !created?.user?.id) {
      if (createError) {
        logRouteError("mobile/super_admin/admins", createError);
      }
      return NextResponse.json(
        { ok: false, error: "تعذر إنشاء الحساب." },
        { status: 400 },
      );
    }

    const newAuthUserId = created.user.id;

    try {
      // `persistManagedUserProfile` is typed for student/teacher/parent only,
      // so the admin row is inserted directly with the same column set.
      const { error: profileInsertError } = await serviceSupabase
        .from("managed_user_profiles")
        .insert({
          auth_user_id: newAuthUserId,
          school_id: schoolId,
          role: "admin",
          full_name: fullName,
          email,
          phone: phone || null,
          is_active: true,
          created_by: authUserId,
        });

      if (profileInsertError) throw profileInsertError;

      await upsertManagedUserCredential(serviceSupabase, {
        authUserId: newAuthUserId,
        schoolId,
        loginIdentifier: email,
        temporaryPassword,
      });
    } catch (error) {
      // Roll the auth user back so a half-provisioned account cannot block a
      // retry with the same email.
      await serviceSupabase.auth.admin
        .deleteUser(newAuthUserId)
        .catch(() => undefined);
      throw error;
    }

    return NextResponse.json({
      ok: true,
      item: {
        auth_user_id: newAuthUserId,
        full_name: fullName,
        email,
        school_id: schoolId,
        is_active: true,
        role: "admin",
      },
      credentials: {
        login_identifier: email,
        temporary_password: temporaryPassword,
      },
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "internal_error" },
      { status: 500 },
    );
  }
}
