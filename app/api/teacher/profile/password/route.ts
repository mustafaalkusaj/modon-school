import { NextRequest, NextResponse } from "next/server";
import { createRouteSupabaseClientWithCookies, applyPendingCookies } from "@/lib/supabase-server";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body?.current_password || !body?.new_password) {
    return jsonError("current_password and new_password are required", 400);
  }
  if (typeof body.new_password !== "string" || body.new_password.length < 6) {
    return jsonError("كلمة المرور يجب أن تكون 6 أحرف على الأقل", 400);
  }

  const { client, pendingCookies } = await createRouteSupabaseClientWithCookies();

  const { data: { user } } = await client.auth.getUser();
  if (!user?.email) {
    return jsonError("غير مسجل الدخول", 401);
  }

  const { error: signInError } = await client.auth.signInWithPassword({
    email: user.email,
    password: body.current_password,
  });
  if (signInError) {
    return jsonError("كلمة المرور الحالية غير صحيحة", 403);
  }

  const { error: updateError } = await client.auth.updateUser({
    password: body.new_password,
  });
  if (updateError) {
    return jsonError(updateError.message, 500);
  }

  const response = NextResponse.json({ ok: true });
  applyPendingCookies(response, pendingCookies);
  return response;
}
