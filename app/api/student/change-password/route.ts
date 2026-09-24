import { NextRequest, NextResponse } from "next/server";
import { resolveStudentContext, unauthorized } from "@/lib/student-api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const changePasswordSchema = z.object({
  current_password: z.string().min(1, "كلمة المرور الحالية مطلوبة"),
  new_password: z.string().min(6, "كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل").max(256),
});

export async function POST(req: NextRequest) {
  const ctx = await resolveStudentContext(req);
  if (!ctx) return unauthorized();

  // Each attempt verifies current_password against Supabase Auth, so without
  // a limit this endpoint is a password-guessing oracle for a hijacked session.
  const rateLimited = await enforceRateLimit(req, {
    namespace: "student-change-password",
    windowMs: 15 * 60_000,
    maxHits: 5,
    identifier: ctx.userId,
    productionFailureMode: "memory-fallback",
    onRateLimited: { error: "too_many_attempts", message: "محاولات كثيرة، حاول لاحقاً" },
  });
  if (rateLimited) return rateLimited;

  const raw = await req.json().catch(() => null);
  const parsed = changePasswordSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors = parsed.error.issues.map((i) => ({
      field: i.path.join("."),
      message: i.message,
    }));
    return NextResponse.json({ ok: false, error: "validation_error", fields: fieldErrors }, { status: 400 });
  }

  const { current_password, new_password } = parsed.data;
  const { supabase, userId } = ctx;

  const { data: profile } = await supabase
    .from("managed_user_profiles")
    .select("email")
    .eq("auth_user_id", userId)
    .maybeSingle();

  const email = (profile as Record<string, unknown>)?.email as string | undefined;
  if (!email) {
    return NextResponse.json({ ok: false, error: "no_email" }, { status: 400 });
  }

  const verifyClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );

  const { error: signInError } = await verifyClient.auth.signInWithPassword({
    email,
    password: current_password,
  });

  if (signInError) {
    return NextResponse.json({ ok: false, error: "wrong_password" }, { status: 401 });
  }

  const { error: updateError } = await supabase.auth.admin.updateUserById(
    userId,
    { password: new_password },
  );

  if (updateError) {
    return NextResponse.json({ ok: false, error: "update_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
