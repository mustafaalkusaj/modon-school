import { NextRequest, NextResponse } from "next/server";
import { resolveStudentContext, unauthorized } from "@/lib/student-api";

export async function POST(req: NextRequest) {
  const ctx = await resolveStudentContext(req);
  if (!ctx) return unauthorized();

  const body = await req.json().catch(() => null);
  if (!body?.adId || !body?.reaction) {
    return NextResponse.json(
      { ok: false, error: "adId and reaction required" },
      { status: 400 },
    );
  }

  const allowed = ["like", "love", "celebrate", "seen"];
  if (!allowed.includes(body.reaction)) {
    return NextResponse.json(
      { ok: false, error: "invalid reaction" },
      { status: 400 },
    );
  }

  const { supabase, schoolId } = ctx;

  const { error } = await (supabase.from as any)("ad_reactions")
    .upsert(
      {
        ad_id: body.adId,
        student_id: ctx.studentId,
        reaction: body.reaction,
      },
      { onConflict: "ad_id,student_id" },
    )
    .eq("school_id", schoolId);

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

  const { supabase } = ctx;

  await (supabase.from as any)("ad_reactions")
    .delete()
    .eq("ad_id", adId)
    .eq("student_id", ctx.studentId);

  return NextResponse.json({ ok: true });
}
