import { NextRequest, NextResponse } from "next/server";
import { resolveMobileRouteContext } from "@/lib/mobile-api-server";

export async function GET(req: NextRequest) {
  try {
    const context = await resolveMobileRouteContext(req, "student");
    if (context.ok === false) {
      return context.response;
    }

    const { schoolId, serviceSupabase } = context.value;
    const now = new Date().toISOString();

    const { data, error } = await (serviceSupabase.from as any)("ads")
      .select(
        "id, type, title, body, bg_color, image_url, target_date, social_url, social_label, video_url, doc_url, doc_pages, effect_type",
      )
      .eq("school_id", schoolId)
      .eq("is_active", true)
      .or(`starts_at.is.null,starts_at.lte.${now}`)
      .or(`ends_at.is.null,ends_at.gt.${now}`)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json(
        { ok: false, error: "internal_error" },
        { status: 500 },
      );
    }

    const filtered = data ?? [];
    const adIds = filtered.map((a: { id: string }) => a.id);
    let reactionCounts: Record<string, number> = {};
    let myReactions: Record<string, string> = {};

    if (adIds.length > 0) {
      const { data: counts } = await (serviceSupabase.from as any)("ad_reactions")
        .select("ad_id, reaction")
        .in("ad_id", adIds);

      if (counts) {
        for (const r of counts as { ad_id: string; reaction: string }[]) {
          reactionCounts[r.ad_id] = (reactionCounts[r.ad_id] ?? 0) + 1;
        }
      }

      const { authUserId } = context.value;
      const { data: mine } = await (serviceSupabase.from as any)("ad_reactions")
        .select("ad_id, reaction")
        .in("ad_id", adIds)
        .eq("student_id", authUserId);

      if (mine) {
        for (const r of mine as { ad_id: string; reaction: string }[]) {
          myReactions[r.ad_id] = r.reaction;
        }
      }
    }

    const items = filtered.map((ad: { id: string; [key: string]: unknown }) => ({
      ...ad,
      reaction_count: reactionCounts[ad.id] ?? 0,
      my_reaction: myReactions[ad.id] ?? null,
    }));

    const res = NextResponse.json({ ok: true, items });
    res.headers.set("Cache-Control", "private, no-cache, no-store, must-revalidate");
    return res;
  } catch {
    return NextResponse.json(
      { ok: false, error: "internal_error" },
      { status: 500 },
    );
  }
}
