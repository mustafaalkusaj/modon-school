import { NextRequest, NextResponse } from "next/server";

import type { UserProfile } from "@/lib/auth";
import { resolveWebUserProfileWithStatus } from "@/lib/authorization/snapshot";
import { createServiceSupabaseClient } from "@/lib/supabase-server";
import { validateQrToken, deactivateQrToken } from "@/lib/qr-tokens";
import {
  RBAC_COOKIE_NAME,
  buildRBACSessionPayload,
  getRBACCookieOptions,
  hasRBACSecret,
  signRBACSession,
} from "@/lib/rbac-session";
import { logRouteError } from "@/lib/route-utils";
import {
  enforceRateLimit,
  buildAuthRateLimitIdentifier,
} from "@/lib/rate-limit";
import type { Permission } from "@/types/roles";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let _step = "parse_body";
  try {
    // ── Rate limiting ──────────────────────────────────────────────────
    _step = "rate_limit";
    const rateLimited = await enforceRateLimit(req, {
      namespace: "auth-qr-login",
      windowMs: 10 * 60_000,
      maxHits: 30,
      identifier: buildAuthRateLimitIdentifier(req, null),
      productionFailureMode: "memory-fallback",
      onRateLimited: {
        error: "too_many_attempts",
        message: "Too many QR login attempts. Please try again later.",
      },
    });
    if (rateLimited) return rateLimited;

    // ── Parse body ─────────────────────────────────────────────────────
    _step = "parse_body";
    const body = await req.json().catch(() => null);
    const token = typeof body?.token === "string" ? body.token.trim() : "";
    if (!token) {
      return NextResponse.json(
        { error: "invalid_token", code: "QR_LOGIN_MISSING_TOKEN" },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }

    // ── RBAC secret check ──────────────────────────────────────────────
    _step = "rbac_secret_check";
    if (!hasRBACSecret()) {
      logRouteError(
        "qr-login-config",
        new Error("RBAC session secret is unavailable."),
      );
      return NextResponse.json(
        { error: "server_config", code: "QR_LOGIN_SERVER_CONFIG" },
        { status: 500, headers: { "Cache-Control": "no-store" } },
      );
    }

    // ── Validate QR token ──────────────────────────────────────────────
    _step = "validate_token";
    console.log("[qr-login] validating token:", token.slice(0, 8) + "...");
    const qrRow = await validateQrToken(token);
    if (!qrRow) {
      console.log("[qr-login] token invalid — not found or expired");
      return NextResponse.json(
        { error: "invalid_token", code: "QR_LOGIN_INVALID_TOKEN" },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      );
    }
    console.log("[qr-login] token valid, user_id:", qrRow.user_id);

    // ── Resolve user profile ───────────────────────────────────────────
    _step = "profile_lookup";
    const supabase = createServiceSupabaseClient();
    let profileLookupFailed = false;
    const resolved = await resolveWebUserProfileWithStatus(
      supabase,
      qrRow.user_id,
    ).catch((error) => {
      profileLookupFailed = true;
      logRouteError("qr-login-profile", error, { userId: qrRow.user_id });
      return null;
    });

    if (profileLookupFailed || !resolved) {
      console.log("[qr-login] profile lookup failed for user:", qrRow.user_id);
      return NextResponse.json(
        { error: "login_failed", code: "QR_LOGIN_PROFILE_LOOKUP_FAILED" },
        { status: 500, headers: { "Cache-Control": "no-store" } },
      );
    }

    console.log("[qr-login] resolved status:", resolved.status);
    if (resolved.status === "profile_missing" || resolved.status === "unknown_role") {
      console.log("[qr-login] BLOCKED — profile_missing or unknown_role for user:", qrRow.user_id);
      return NextResponse.json(
        { error: "invalid_token", code: "QR_LOGIN_INVALID_TOKEN" },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      );
    }

    const { profile, snapshot } = resolved;
    console.log("[qr-login] profile.is_active:", profile.is_active, "role:", snapshot.role);
    if (!profile.is_active) {
      return NextResponse.json(
        { error: "inactive_account", code: "QR_LOGIN_PROFILE_INACTIVE" },
        { status: 403, headers: { "Cache-Control": "no-store" } },
      );
    }

    // ── Build RBAC session ─────────────────────────────────────────────
    _step = "build_session";
    const payload = buildRBACSessionPayload({
      userId: snapshot.userId,
      role: snapshot.role,
      permissions: snapshot.permissions,
      schoolId: snapshot.schoolId,
      branchId: snapshot.branchId,
      allowedBranchIds: snapshot.allowedBranchIds,
      userActive: snapshot.userActive,
      schoolActive: snapshot.schoolActive,
      subscriptionStatus: snapshot.subscriptionStatus,
      subscriptionEnd: snapshot.subscriptionEnd,
      scopeLevel: snapshot.scopeLevel,
      allowedModule: snapshot.allowedModule,
      allowedModules: snapshot.allowedModules,
      allowedPages: snapshot.allowedPages,
      defaultPath: snapshot.defaultPath,
      isSinglePageUser: snapshot.isSinglePageUser,
      hierarchyLevel: snapshot.hierarchyLevel,
      permissionsVersion: snapshot.permissionsVersion,
      groupId: snapshot.groupId,
      deepPermissions: snapshot.deepPermissions,
      sidebar: snapshot.sidebar,
    });

    const signed = await signRBACSession(payload);
    if (!signed) {
      return NextResponse.json(
        { error: "server_config", code: "QR_LOGIN_SERVER_CONFIG" },
        { status: 500, headers: { "Cache-Control": "no-store" } },
      );
    }

    // ── Deactivate the QR token (single-use) ───────────────────────────
    _step = "deactivate_token";
    await deactivateQrToken(token);

    // ── Return profile + set RBAC cookie ───────────────────────────────
    const response = NextResponse.json(
      {
        ok: true,
        profile: {
          ...profile,
          id: profile.id,
          full_name: profile.full_name ?? null,
          email: profile.email ?? null,
          avatar_url: null,
          role: snapshot.role,
          permissions: snapshot.permissions as Permission[],
        } satisfies UserProfile,
      },
      { headers: { "Cache-Control": "no-store" } },
    );

    response.cookies.set(RBAC_COOKIE_NAME, signed, getRBACCookieOptions());
    return response;
  } catch (error) {
    logRouteError("qr-login-unexpected", error, { step: _step });
    return NextResponse.json(
      { error: "login_failed", code: "QR_LOGIN_UNEXPECTED" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
