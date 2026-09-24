import { NextRequest, NextResponse } from "next/server";

import {
  createRouteSupabaseClient,
  createServiceSupabaseClient,
  getRouteAuthenticatedUser,
} from "@/lib/supabase-server";
import { enforceRateLimit } from "@/lib/rate-limit";
import {
  deactivateQrTokenById,
  generateQrLoginDataUrl,
  getOrCreateQrToken,
  getQrTokenById,
  listQrTokensBySchool,
  regenerateQrToken,
  bulkGetOrCreateTokens,
} from "@/lib/qr-tokens";
import { logRouteError } from "@/lib/route-utils";

const ADMIN_ROLES = new Set(["super_admin", "admin", "manager"]);

// A QR token is a password-less login credential for its target user, so
// issuing one is equivalent to being able to sign in as that user. Only a
// super_admin may issue tokens for school admins; nobody may issue one for a
// super_admin.
const PRIVILEGED_TARGET_ROLES = new Set(["admin", "manager"]);

type Actor = { id: string; role: string; schoolId: string | null };

type TargetProfile = { id: string; role: string | null; school_id: string | null };

async function resolveActor(req: NextRequest): Promise<Actor | null> {
  const supabase = await createRouteSupabaseClient();
  const {
    data: { user },
    error,
  } = await getRouteAuthenticatedUser(
    supabase,
    req.headers.get("authorization"),
  );

  if (error || !user?.id) return null;

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("role, is_active, school_id")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile || profile.is_active === false) return null;
  if (!profile.role || !ADMIN_ROLES.has(profile.role)) return null;

  return { id: user.id, role: profile.role, schoolId: profile.school_id as string | null };
}

// Non-super-admins are pinned to their own school; a mismatching school_id in
// the request is rejected rather than silently rewritten.
function resolveEffectiveSchoolId(
  actor: Actor,
  requested: unknown,
): { schoolId: string } | { error: NextResponse } {
  const requestedId = typeof requested === "string" && requested ? requested : null;

  if (actor.role === "super_admin") {
    const schoolId = requestedId || actor.schoolId;
    if (!schoolId) {
      return { error: NextResponse.json({ error: "school_id required" }, { status: 400 }) };
    }
    return { schoolId };
  }

  if (!actor.schoolId) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  if (requestedId && requestedId !== actor.schoolId) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { schoolId: actor.schoolId };
}

function canIssueFor(actor: Actor, target: TargetProfile, schoolId: string): boolean {
  if (target.school_id !== schoolId) return false;
  if (target.role === "super_admin") return false;
  if (target.role && PRIVILEGED_TARGET_ROLES.has(target.role) && actor.role !== "super_admin") {
    return false;
  }
  return true;
}

async function loadTargetProfiles(userIds: string[]): Promise<Map<string, TargetProfile>> {
  const serviceSupabase = createServiceSupabaseClient();
  const profiles = new Map<string, TargetProfile>();
  const CHUNK = 500;
  for (let i = 0; i < userIds.length; i += CHUNK) {
    const { data, error } = await serviceSupabase
      .from("user_profiles")
      .select("id, role, school_id")
      .in("id", userIds.slice(i, i + CHUNK));
    if (error) throw error;
    for (const row of (data ?? []) as TargetProfile[]) {
      profiles.set(row.id, row);
    }
  }
  return profiles;
}

async function authorizeTargets(
  actor: Actor,
  userIds: string[],
  schoolId: string,
): Promise<boolean> {
  const profiles = await loadTargetProfiles(userIds);
  return userIds.every((id) => {
    const profile = profiles.get(id);
    return Boolean(profile && canIssueFor(actor, profile, schoolId));
  });
}

// Loads a token by id and verifies the actor may manage it.
async function authorizeExistingToken(actor: Actor, tokenId: string) {
  const token = await getQrTokenById(tokenId);
  if (!token) return null;
  if (actor.role !== "super_admin" && token.school_id !== actor.schoolId) return null;
  if (!(await authorizeTargets(actor, [token.user_id], token.school_id))) return null;
  return token;
}

const forbidden = () => NextResponse.json({ error: "Forbidden" }, { status: 403 });

export async function GET(req: NextRequest) {
  try {
    const actor = await resolveActor(req);
    if (!actor) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(req.url);
    const scope = resolveEffectiveSchoolId(actor, url.searchParams.get("school_id"));
    if ("error" in scope) return scope.error;

    const tokens = await listQrTokensBySchool(scope.schoolId);

    return NextResponse.json({ ok: true, tokens });
  } catch (error) {
    logRouteError("admin-qr-tokens-get", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await resolveActor(req);
    if (!actor) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rateLimited = await enforceRateLimit(req, {
      namespace: "admin-qr-tokens",
      windowMs: 10 * 60_000,
      maxHits: 60,
      identifier: actor.id,
    });
    if (rateLimited) return rateLimited;

    const body = await req.json().catch(() => null);
    if (!body || typeof body.action !== "string") {
      return NextResponse.json(
        { error: "action required" },
        { status: 400 },
      );
    }

    const { action } = body;

    if (action === "create" || action === "generate_qr") {
      const { auth_user_id } = body;
      if (typeof auth_user_id !== "string" || !auth_user_id) {
        return NextResponse.json(
          { error: "auth_user_id required" },
          { status: 400 },
        );
      }
      const scope = resolveEffectiveSchoolId(actor, body.school_id);
      if ("error" in scope) return scope.error;

      if (!(await authorizeTargets(actor, [auth_user_id], scope.schoolId))) {
        return forbidden();
      }

      const token = await getOrCreateQrToken({
        authUserId: auth_user_id,
        schoolId: scope.schoolId,
      });
      const qrDataUrl = await generateQrLoginDataUrl(token.token);

      return NextResponse.json({ ok: true, token, qrDataUrl });
    }

    if (action === "regenerate") {
      const { token_id } = body;
      if (typeof token_id !== "string" || !token_id) {
        return NextResponse.json(
          { error: "token_id required" },
          { status: 400 },
        );
      }
      if (!(await authorizeExistingToken(actor, token_id))) {
        return forbidden();
      }
      const token = await regenerateQrToken(token_id);
      const qrDataUrl = await generateQrLoginDataUrl(token.token);
      return NextResponse.json({ ok: true, token, qrDataUrl });
    }

    if (action === "deactivate") {
      const { token_id } = body;
      if (typeof token_id !== "string" || !token_id) {
        return NextResponse.json(
          { error: "token_id required" },
          { status: 400 },
        );
      }
      if (!(await authorizeExistingToken(actor, token_id))) {
        return forbidden();
      }
      await deactivateQrTokenById(token_id);
      return NextResponse.json({ ok: true });
    }

    if (action === "bulk_generate") {
      const { auth_user_ids } = body;
      if (
        !Array.isArray(auth_user_ids) ||
        auth_user_ids.length === 0 ||
        !auth_user_ids.every((id: unknown) => typeof id === "string" && id)
      ) {
        return NextResponse.json(
          { error: "auth_user_ids (array) required" },
          { status: 400 },
        );
      }
      if (auth_user_ids.length > 2000) {
        return NextResponse.json(
          { error: "Maximum 2000 accounts per bulk request" },
          { status: 400 },
        );
      }
      const scope = resolveEffectiveSchoolId(actor, body.school_id);
      if ("error" in scope) return scope.error;

      const uniqueIds = Array.from(new Set(auth_user_ids as string[]));
      if (!(await authorizeTargets(actor, uniqueIds, scope.schoolId))) {
        return forbidden();
      }

      const tokenMap = await bulkGetOrCreateTokens(scope.schoolId, uniqueIds);

      const tokens: Record<string, string> = Object.fromEntries(tokenMap);

      return NextResponse.json({ ok: true, tokens });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    logRouteError("admin-qr-tokens-post", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
