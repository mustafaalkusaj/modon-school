import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveStudentContext, unauthorized } from "@/lib/student-api";
import { enforceRateLimit } from "@/lib/rate-limit";

const adReactSchema = z.object({
  adId: z.string().min(1, "adId مطلوب"),
  reaction: z.enum(["like", "love", "celebrate", "seen"], {
    message: "نوع التفاعل غير صالح",
  }),
});

export async function POST(req: NextRequest) {
  const ctx = await resolveStudentContext(req);
  if (!ctx) return unauthorized();

  const rlResponse = await enforceRateLimit(req, {
    namespace: "student-ads-react",
    windowMs: 60_000,
    maxHits: 30,
    identifier: ctx.studentId,
  });
  if (rlResponse) return rlResponse;

  const raw = await req.json().catch(() => null);
  const parsed = adReactSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? "invalid_body" },
      { status: 400 },
    );
  }
  const body = parsed.data;

  const { supabase, schoolId } = ctx;

  const { data: ad } = await (supabase.from as any)("ads")
    .select("id")
    .eq("id", body.adId)
    .eq("school_id", schoolId)
    .eq("is_active", true)
    .maybeSingle();

  if (!ad) {
    return NextResponse.json(
      { ok: false, error: "ad_not_found" },
      { status: 404 },
    );
  }

  const { error } = await (supabase.from as any)("ad_reactions").upsert(
    {
      ad_id: body.adId,
      student_id: ctx.studentId,
      reaction: body.reaction,
    },
    { onConflict: "ad_id,student_id" },
  );

  if (error) {
    return NextResponse.json(
      { ok: false, error: "reaction_failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const ctx = await resolveStudentContext(req);
  if (!ctx) return unauthorized();

  const adId = req.nextUrl.searchParams.get("adId");
  if (!adId) {
    return NextResponse.json(
      { ok: false, error: "adId required" },
      { status: 400 },
    );
  }

  const { supabase, schoolId } = ctx;

  // Verify ad belongs to student's school before allowing deletion
  const { data: ad } = await (supabase.from as any)("ads")
    .select("id")
    .eq("id", adId)
    .eq("school_id", schoolId)
    .maybeSingle();

  if (!ad) {
    return NextResponse.json(
      { ok: false, error: "ad_not_found" },
      { status: 404 },
    );
  }

  await (supabase.from as any)("ad_reactions")
    .delete()
    .eq("ad_id", adId)
    .eq("student_id", ctx.studentId);

  return NextResponse.json({ ok: true });
}
