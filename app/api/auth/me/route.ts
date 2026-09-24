import { NextRequest, NextResponse } from "next/server";

import { cookies } from "next/headers";

import { resolveWebUserProfile, resolveWebUserProfileWithStatus } from "@/lib/authorization/snapshot";
import {
  createRouteSupabaseClient,
  createServiceSupabaseClient,
  getRouteAuthenticatedUser,
} from "@/lib/supabase-server";
import { RBAC_COOKIE_NAME, verifyRBACSession } from "@/lib/rbac-session";
import { buildTemplatePermissions, DEFAULT_PATH_BY_ROLE } from "@/types/roles";

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
} as const;

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, error: { message } }, { status });
}

export async function GET(req: NextRequest) {
  const supabase = await createRouteSupabaseClient();
  const {
    data: { user },
    error,
  } = await getRouteAuthenticatedUser(supabase, req.headers.get("authorization"));

  if (error || !user?.id) {
    // No Supabase session — fall back to RBAC cookie (QR login flow)
    const cookieStore = await cookies();
    const rbacToken = cookieStore.get(RBAC_COOKIE_NAME)?.value;
    const rbacSession = await verifyRBACSession(rbacToken);

    if (!rbacSession) {
      return jsonError("Unauthorized", 401);
    }

    const svc = createServiceSupabaseClient();
    const rbacResolved = await resolveWebUserProfileWithStatus(
      svc,
      rbacSession.userId,
    ).catch(() => null);

    if (rbacResolved && rbacResolved.status !== "profile_missing" && rbacResolved.status !== "unknown_role") {
      return NextResponse.json(
        {
          ok: true,
          user: {
            ...rbacResolved.profile,
            deepPermissions: rbacResolved.snapshot.deepPermissions,
            sidebar: rbacResolved.snapshot.sidebar,
            dashboardSections: rbacResolved.snapshot.dashboardSections,
            role_color: rbacResolved.snapshot.roleColor ?? null,
          },
          session: rbacResolved.snapshot,
        },
        { headers: NO_STORE_HEADERS },
      );
    }

    return jsonError("Unauthorized", 401);
  }

  let profileResolutionFailed = false;
  const resolved = await resolveWebUserProfile(supabase, user.id).catch((resolveError) => {
    profileResolutionFailed = true;
    console.error("[auth/me] failed to resolve web user profile", {
      userId: user.id,
      error: resolveError,
    });
    return null;
  });

  if (profileResolutionFailed) {
    return jsonError("Failed to resolve profile", 500);
  }

  if (!resolved) {
    const svc = createServiceSupabaseClient();
    const { data: managed } = await svc
      .from("managed_user_profiles")
      .select("auth_user_id, role, school_id, student_id, full_name")
      .eq("auth_user_id", user.id)
      .eq("is_active", true)
      .maybeSingle();

    if (managed?.role === "student") {
      const permissions = buildTemplatePermissions("student");
      const studentProfile = {
        id: managed.auth_user_id,
        full_name: managed.full_name ?? user.email ?? "Student",
        email: user.email ?? null,
        avatar_url: null,
        role: "student" as const,
        permissions,
        school_id: managed.school_id,
        is_active: true,
        default_path: DEFAULT_PATH_BY_ROLE.student,
      };

      return NextResponse.json(
        {
          ok: true,
          user: studentProfile,
          session: {
            deepPermissions: permissions,
            sidebar: [],
            dashboardSections: [],
            roleColor: null,
          },
        },
        { headers: NO_STORE_HEADERS },
      );
    }

    return jsonError("Profile not found", 404);
  }

  return NextResponse.json({
    ok: true,
    user: {
      ...resolved.profile,
      deepPermissions: resolved.snapshot.deepPermissions,
      sidebar: resolved.snapshot.sidebar,
      dashboardSections: resolved.snapshot.dashboardSections,
      role_color: resolved.snapshot.roleColor ?? null,
    },
    session: resolved.snapshot,
  });
}
