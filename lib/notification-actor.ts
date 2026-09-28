import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { resolveSchoolScopedActorContext } from "@/lib/managed-users-server";
import { RBAC_COOKIE_NAME, verifyRBACSession } from "@/lib/rbac-session";
import { createServiceSupabaseClient } from "@/lib/supabase-server";
import type { UserRole } from "@/types/roles";

export interface NotificationActor {
  userId: string;
  schoolId: string;
  role: UserRole;
  /** Client to read/write the actor's own rows; every query must filter by userId. */
  supabase: SupabaseClient;
}

/**
 * Resolve who is calling a notification endpoint (push registration, bell).
 *
 * Accounts that sign in with a QR code only get the signed `school_rbac`
 * cookie — there is no Supabase auth session — so the regular
 * resolveSchoolScopedActorContext() answers 401 for them. That silently broke
 * push registration and the bell for QR-login students and teachers. When the
 * Supabase session is missing we fall back to the signed RBAC cookie (the same
 * trust the /api/student/* and /api/teacher/* routes already use), re-checking
 * that the managed account is still active.
 */
export async function resolveNotificationActor(
  req: NextRequest,
  allowedRoles: UserRole[],
  requestedSchoolId: string | null = null,
): Promise<
  | { ok: true; value: NotificationActor }
  | { ok: false; status: number; message: string }
> {
  const context = await resolveSchoolScopedActorContext(
    requestedSchoolId,
    { allowedRoles, roleDeniedMessage: "ليس لديك صلاحية لهذه الإشعارات." },
    req.headers.get("authorization"),
  );
  if (context.ok) {
    return {
      ok: true,
      value: {
        userId: context.value.actorUserId,
        schoolId: context.value.targetSchoolId,
        role: context.value.actorRole,
        supabase: context.value.actorSupabase as unknown as SupabaseClient,
      },
    };
  }
  if (context.status !== 401) return context;

  const session = await verifyRBACSession(req.cookies.get(RBAC_COOKIE_NAME)?.value);
  if (!session?.userActive || !session.userId || !session.schoolId) {
    return context;
  }
  if (!allowedRoles.includes(session.role)) {
    return { ok: false, status: 403, message: "ليس لديك صلاحية لهذه الإشعارات." };
  }

  const service = createServiceSupabaseClient();
  const { data: managed } = await service
    .from("managed_user_profiles")
    .select("is_active")
    .eq("auth_user_id", session.userId)
    .eq("school_id", session.schoolId)
    .maybeSingle();
  if (!managed || managed.is_active === false) {
    return context;
  }

  return {
    ok: true,
    value: {
      userId: session.userId,
      schoolId: session.schoolId,
      role: session.role,
      supabase: service as unknown as SupabaseClient,
    },
  };
}
