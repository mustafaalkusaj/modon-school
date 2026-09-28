import { NextRequest, NextResponse } from "next/server";
import { resolveTeacherContext, unauthorized } from "@/lib/teacher-api";

export async function GET(req: NextRequest) {
  const ctx = await resolveTeacherContext(req);
  if (!ctx) return unauthorized();

  const { supabase, userId, schoolId } = ctx;

  /* conversations uses a join table: conversation_participants.
     Fetch participant rows for this teacher, then load conversations. */
  const { data: participantRows, error: pErr } = await supabase
    .from("conversation_participants")
    .select("conversation_id")
    .eq("user_id", userId);

  if (pErr) {
    return NextResponse.json(
      { ok: false, error: "fetch_failed" },
      { status: 500 },
    );
  }

  const convIds = (participantRows ?? []).map(
    (r) => (r as Record<string, unknown>).conversation_id as string,
  );

  if (convIds.length === 0) {
    return NextResponse.json({ ok: true, data: [] });
  }

  const { data, error } = await supabase
    .from("conversations")
    .select("id, title, subject, type, created_at, updated_at")
    .eq("school_id", schoolId)
    .in("id", convIds)
    .order("updated_at", { ascending: false });

  if (error) {
    return NextResponse.json(
      { ok: false, error: "fetch_failed" },
      { status: 500 },
    );
  }

  const conversations = (data ?? []) as Array<Record<string, unknown>>;

  const [messagesRes, participantsRes] = await Promise.all([
    supabase
      .from("messages")
      .select("conversation_id, body, created_at, sender_id")
      .in("conversation_id", convIds)
      .order("created_at", { ascending: false }),
    supabase
      .from("conversation_participants")
      .select("conversation_id, display_name, user_id")
      .in("conversation_id", convIds),
  ]);

  const allMessages = (messagesRes.data ?? []) as Array<Record<string, unknown>>;
  const allParticipants = (participantsRes.data ?? []) as Array<Record<string, unknown>>;

  const lastMessageMap = new Map<string, Record<string, unknown>>();
  for (const m of allMessages) {
    const cid = m.conversation_id as string;
    if (!lastMessageMap.has(cid)) {
      lastMessageMap.set(cid, m);
    }
  }

  const otherParticipantMap = new Map<string, string>();
  for (const p of allParticipants) {
    const cid = p.conversation_id as string;
    if ((p.user_id as string) !== userId && !otherParticipantMap.has(cid)) {
      otherParticipantMap.set(cid, (p.display_name as string) ?? "");
    }
  }

  const unreadMap = new Map<string, number>();
  for (const m of allMessages) {
    const cid = m.conversation_id as string;
    const conv = conversations.find((c) => (c.id as string) === cid);
    if (!conv) continue;
    const updatedAt = (conv.updated_at as string) ?? "1970-01-01";
    if ((m.sender_id as string) !== userId && (m.created_at as string) > updatedAt) {
      unreadMap.set(cid, (unreadMap.get(cid) ?? 0) + 1);
    }
  }

  const enriched = conversations.map((conv) => {
    const convId = conv.id as string;
    const lastMsg = lastMessageMap.get(convId);
    return {
      id: convId,
      title: conv.title ?? "",
      lastMessage: (lastMsg?.body as string) ?? "",
      lastMessageAt: (lastMsg?.created_at as string) ?? (conv.updated_at as string) ?? "",
      otherParticipantName: otherParticipantMap.get(convId) ?? "",
      unreadCount: unreadMap.get(convId) ?? 0,
    };
  });

  return NextResponse.json({
    ok: true,
    data: enriched,
  });
}

export async function POST(req: NextRequest) {
  const ctx = await resolveTeacherContext(req);
  if (!ctx) return unauthorized();

  const { supabase, userId, schoolId, fullName } = ctx;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_json" },
      { status: 400 },
    );
  }

  const conversationId = body.conversation_id as string | undefined;
  const messageBody = body.body as string | undefined;
  const title = body.title as string | undefined;
  const type = body.type as string | undefined;

  /* Send message to existing conversation */
  if (conversationId && messageBody) {
    const { data, error } = await supabase
      .from("messages")
      .insert({
        conversation_id: conversationId,
        sender_id: userId,
        sender_name: fullName ?? "Teacher",
        sender_role: "teacher",
        body: messageBody,
      })
      .select("id, conversation_id, body, created_at")
      .single();

    if (error) {
      return NextResponse.json(
        { ok: false, error: "send_failed" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      data: data as Record<string, unknown>,
    });
  }

  /* Create new conversation + first message */
  if (!messageBody) {
    return NextResponse.json(
      { ok: false, error: "missing_body" },
      { status: 400 },
    );
  }

  const { data: conversation, error: convError } = await supabase
    .from("conversations")
    .insert({
      title: title ?? null,
      type: type ?? "direct",
      created_by: userId,
      school_id: schoolId,
    })
    .select("id, title, type, created_at")
    .single();

  if (convError || !conversation) {
    return NextResponse.json(
      { ok: false, error: "create_conversation_failed" },
      { status: 500 },
    );
  }

  const convId = (conversation as Record<string, unknown>).id as string;

  /* Add self as participant */
  await supabase.from("conversation_participants").insert({
    conversation_id: convId,
    user_id: userId,
    display_name: fullName ?? "Teacher",
    role: "teacher",
  });

  /* Send first message */
  const { error: msgError } = await supabase.from("messages").insert({
    conversation_id: convId,
    sender_id: userId,
    sender_name: fullName ?? "Teacher",
    sender_role: "teacher",
    body: messageBody,
  });

  if (msgError) {
    return NextResponse.json(
      { ok: false, error: "send_initial_message_failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    data: conversation as Record<string, unknown>,
  });
}
