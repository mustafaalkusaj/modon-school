import { NextRequest, NextResponse } from "next/server";

import {
  createRouteSupabaseClient,
  getRouteAuthenticatedUser,
} from "@/lib/supabase-server";
import { enforceRateLimit } from "@/lib/rate-limit";
import {
  deactivateQrTokenById,
  generateQrLoginDataUrl,
  getOrCreateQrToken,
  listQrTokensBySchool,
  regenerateQrToken,
  bulkGetOrCreateTokens,
} from "@/lib/qr-tokens";
import { logRouteError } from "@/lib/route-utils";

const ADMIN_ROLES = new Set(["super_admin", "admin", "manager"]);

async function resolveActor(req: NextRequest) {
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

export async function GET(req: NextRequest) {
  try {
    const actor = await resolveActor(req);
    if (!actor) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(req.url);
    const schoolId = url.searchParams.get("school_id") || actor.schoolId;
    if (!schoolId) {
      return NextResponse.json(
        { error: "school_id required" },
        { status: 400 },
      );
    }

    const tokens = await listQrTokensBySchool(schoolId);

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
      const { auth_user_id, school_id } = body;
      if (!auth_user_id) {
        return NextResponse.json(
          { error: "auth_user_id required" },
          { status: 400 },
        );
      }
      const sid = school_id || actor.schoolId;
      if (!sid) {
        return NextResponse.json(
          { error: "school_id required" },
          { status: 400 },
        );
      }

      const token = await getOrCreateQrToken({
        authUserId: auth_user_id,
        schoolId: sid,
      });
      const qrDataUrl = await generateQrLoginDataUrl(token.token);

      return NextResponse.json({ ok: true, token, qrDataUrl });
    }

    if (action === "regenerate") {
      const { token_id } = body;
      if (!token_id) {
        return NextResponse.json(
          { error: "token_id required" },
          { status: 400 },
        );
      }
      const token = await regenerateQrToken(token_id);
      const qrDataUrl = await generateQrLoginDataUrl(token.token);
      return NextResponse.json({ ok: true, token, qrDataUrl });
    }

    if (action === "deactivate") {
      const { token_id } = body;
      if (!token_id) {
        return NextResponse.json(
          { error: "token_id required" },
          { status: 400 },
        );
      }
      await deactivateQrTokenById(token_id);
      return NextResponse.json({ ok: true });
    }

    if (action === "bulk_generate") {
      const { auth_user_ids, school_id } = body;
      if (!Array.isArray(auth_user_ids) || auth_user_ids.length === 0) {
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
      const sid = school_id || actor.schoolId;
      if (!sid) {
        return NextResponse.json(
          { error: "school_id required" },
          { status: 400 },
        );
      }

      const tokenMap = await bulkGetOrCreateTokens(sid, auth_user_ids);

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
