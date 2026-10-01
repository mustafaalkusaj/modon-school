import { NextRequest, NextResponse } from "next/server";

import {
  createRouteSupabaseClient,
  createServiceSupabaseClient,
} from "@/lib/supabase-server";
import { jsonError } from "@/lib/route-utils";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) {
    return jsonError("Token is required.", 400);
  }

  const sb = createServiceSupabaseClient();

  const { data, error } = await sb
    .from("upload_sessions")
    .select("status, image_url, expires_at, school_id")
    .eq("token", token)
    .single();

  if (error || !data) {
    return jsonError("Session not found.", 404);
  }

  const userSb = await createRouteSupabaseClient();
  const {
    data: { user },
  } = await userSb.auth.getUser();

  if (user) {
    // The uploaded image is only disclosed to a signed-in user of the same
    // school as the session — being authenticated anywhere is not enough.
    const { data: profile } = await userSb
      .from("user_profiles")
      .select("role, school_id")
      .eq("id", user.id)
      .maybeSingle();

    const sameSchool =
      Boolean(profile) &&
      (profile!.role === "super_admin" ||
        (Boolean(profile!.school_id) && profile!.school_id === data.school_id));

    if (sameSchool) {
      return NextResponse.json({
        status: data.status,
        image_url: data.image_url,
        expires_at: data.expires_at,
      });
    }
  }

  return NextResponse.json({
    status: data.status,
    expires_at: data.expires_at,
  });
}
