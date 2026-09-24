import { NextRequest, NextResponse } from "next/server";
import { resolveMobileRouteContext } from "@/lib/mobile-api-server";

const ALLOWED_REACTIONS = ["like", "love", "celebrate", "seen"];

export async function POST(req: NextRequest) {
  const context = await resolveMobileRouteContext(req, "student");
  if (!context.ok) return context.response;

  const body = await req.json().catch(() => null);
  if (!body?.adId || !body?.reaction) {
    return NextResponse.json(
      { ok: false, error: "adId and reaction required" },
      { status: 400 },
    );
  }

  if (!ALLOWED_REACTIONS.includes(body.reaction)) {
    return NextResponse.json(
      { ok: false, error: "invalid reaction" },
      { status: 400 },
    );
  }

  const { serviceSupabase, authUserId } = context.value;

  const { error } = await (serviceSupabase.from as any)("ad_reactions").upsert(
    {
      ad_id: body.adId,
      student_id: authUserId,
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
  const context = await resolveMobileRouteContext(req, "student");
  if (!context.ok) return context.response;

  const adId = req.nextUrl.searchParams.get("adId");
  if (!adId) {
    return NextResponse.json(
      { ok: false, error: "adId required" },
      { status: 400 },
    );
  }

  const { serviceSupabase, authUserId } = context.value;

  await (serviceSupabase.from as any)("ad_reactions")
    .delete()
    .eq("ad_id", adId)
    .eq("student_id", authUserId);

  return NextResponse.json({ ok: true });
}
