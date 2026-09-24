import { NextRequest, NextResponse } from "next/server";
import { resolveStudentContext, unauthorized } from "@/lib/student-api";

export async function GET(req: NextRequest) {
  const ctx = await resolveStudentContext(req);
  if (!ctx) return unauthorized();

  const { supabase, schoolId } = ctx;

  const { data, error } = await (supabase.from as any)("ads")
    .select(
      "id, type, title, body, bg_color, image_url, target_date, social_url, social_label, video_url, doc_url, is_active, starts_at, ends_at, effect_type",
    )
    .eq("school_id", schoolId)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(20) as { data: any[] | null; error: any };

  if (error) {
    return NextResponse.json(
      { ok: false, error: "fetch_failed" },
      { status: 500 },
    );
  }

  const now = Date.now();
  const filtered = (data ?? []).filter((ad) => {
    if (ad.ends_at && new Date(ad.ends_at).getTime() < now) return false;
    return true;
  });

  const adIds = filtered.map((a) => a.id);
  let reactionCounts: Record<string, number> = {};
  let myReactions: Record<string, string> = {};

  if (adIds.length > 0) {
    const { data: counts } = await (supabase.from as any)("ad_reactions")
      .select("ad_id, reaction")
      .in("ad_id", adIds);

    if (counts) {
      for (const r of counts) {
        reactionCounts[r.ad_id] = (reactionCounts[r.ad_id] ?? 0) + 1;
      }
    }

    const { data: mine } = await (supabase.from as any)("ad_reactions")
      .select("ad_id, reaction")
      .in("ad_id", adIds)
      .eq("student_id", ctx.studentId);

    if (mine) {
      for (const r of mine) {
        myReactions[r.ad_id] = r.reaction;
      }
    }
  }

  const items = filtered.map((ad) => ({
    ...ad,
    reaction_count: reactionCounts[ad.id] ?? 0,
    my_reaction: myReactions[ad.id] ?? null,
  }));

  return NextResponse.json({ ok: true, items });
}
