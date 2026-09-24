import { NextRequest, NextResponse } from "next/server";
import { resolveStudentContext, unauthorized } from "@/lib/student-api";

export async function GET(req: NextRequest) {
  const ctx = await resolveStudentContext(req);
  if (!ctx) return unauthorized();

  const { supabase, userId, schoolId } = ctx;

  // 1. Get all conversation IDs the student participates in
  const { data: participantRows, error: partErr } = await supabase
    .from("conversation_participants")
    .select("conversation_id")
    .eq("user_id", userId);

  if (partErr) {
    return NextResponse.json(
      { ok: false, error: "fetch_failed" },
      { status: 500 },
    );
  }

  const rawIds = (participantRows ?? []).map(
    (r: Record<string, unknown>) => r.conversation_id as string,
  );

  if (rawIds.length === 0) {
    return NextResponse.json({ ok: true, data: [] });
  }

  // 2. Batch-fetch conversations — scoped by school_id for tenant isolation
  const { data: conversations } = await supabase
    .from("conversations")
    .select("id, title")
    .in("id", rawIds)
    .eq("school_id", schoolId);

  const conversationIds = (conversations ?? []).map(
    (c: Record<string, unknown>) => c.id as string,
  );

  if (conversationIds.length === 0) {
    return NextResponse.json({ ok: true, data: [] });
  }

  // 3. Batch-fetch all participants for these conversations (display_name is
  // stored directly on conversation_participants in nakheel's schema, so no
  // extra join to user_profiles is needed here).
  const { data: allParticipants } = await supabase
    .from("conversation_participants")
    .select("conversation_id, user_id, display_name")
    .in("conversation_id", conversationIds);

  const otherNamesMap: Record<string, string[]> = {};
  for (const p of (allParticipants ?? []) as Record<string, unknown>[]) {
    if (p.user_id === userId) continue;
    const cid = p.conversation_id as string;
    const name = (p.display_name as string) ?? "";
    if (!otherNamesMap[cid]) otherNamesMap[cid] = [];
    if (name) otherNamesMap[cid].push(name);
  }

  // 4. Batch-fetch the latest message per conversation using a single query
  //    ordered by created_at desc, then pick the first per conversation in JS
  const { data: recentMessages } = await supabase
    .from("messages")
    .select("id, conversation_id, sender_id, body, created_at, read_at")
    .in("conversation_id", conversationIds)
    .order("created_at", { ascending: false });

  const lastMessageMap: Record<
    string,
    { body: string; created_at: string }
  > = {};
  const unreadCountMap: Record<string, number> = {};

  for (const msg of (recentMessages ?? []) as Record<string, unknown>[]) {
    const cid = msg.conversation_id as string;

    if (!lastMessageMap[cid]) {
      lastMessageMap[cid] = {
        body: (msg.body as string) ?? "",
        created_at: (msg.created_at as string) ?? "",
      };
    }

    if (msg.sender_id !== userId && msg.read_at == null) {
      unreadCountMap[cid] = (unreadCountMap[cid] ?? 0) + 1;
    }
  }

  const convMap = (conversations ?? []).reduce<Record<string, string>>(
    (acc, c: Record<string, unknown>) => {
      acc[c.id as string] = (c.title as string) ?? "";
      return acc;
    },
    {},
  );

  const threads = conversationIds.map((cid) => ({
    id: cid,
    title: convMap[cid] ?? "",
    lastMessage: lastMessageMap[cid]?.body ?? "",
    lastMessageAt: lastMessageMap[cid]?.created_at ?? "",
    otherParticipantName: (otherNamesMap[cid] ?? []).join(", ") || "",
    unreadCount: unreadCountMap[cid] ?? 0,
  }));

  threads.sort((a, b) => {
    if (!a.lastMessageAt && !b.lastMessageAt) return 0;
    if (!a.lastMessageAt) return 1;
    if (!b.lastMessageAt) return -1;
    return b.lastMessageAt.localeCompare(a.lastMessageAt);
  });

  return NextResponse.json({ ok: true, data: threads });
}
