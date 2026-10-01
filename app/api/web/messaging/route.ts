import { NextRequest, NextResponse } from "next/server";
import { resolveSchoolScopedActorContext } from "@/lib/managed-users-server";
import { createServiceSupabaseClient } from "@/lib/supabase-server";
import { enforceRateLimit } from "@/lib/rate-limit";
import type { SupabaseClient } from "@supabase/supabase-js";

import { logRouteError } from "@/lib/route-utils";
export const dynamic = "force-dynamic";

const ALLOWED_ROLES = ["admin", "super_admin", "employee"] as const;

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: { message } }, { status });
}

// conversation_participants.role and messages.sender_role are CHECK-constrained
// to admin|teacher|parent. Map every app role onto that set (staff → admin,
// guardians → parent) so inserts never violate the constraint.
function mapMessagingRole(
  role: string | null | undefined,
): "admin" | "teacher" | "parent" {
  const normalized = (role ?? "").trim().toLowerCase();
  if (normalized === "teacher") return "teacher";
  if (
    normalized === "parent" ||
    normalized === "guardian" ||
    normalized === "student"
  )
    return "parent";
  return "admin";
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Cap on conversations previewed in one inbox response. */
const INBOX_CONVERSATION_LIMIT = 100;

// Messaging identities live in TWO tables: app users (students, teachers,
// guardians) in `managed_user_profiles`, and web/staff users (admins,
// super_admins, employees) in `user_profiles`. `current_school_id()` resolves
// membership from both, so every lookup here must too -- checking only
// managed_user_profiles makes every admin permanently unmessageable.
async function fetchMessagingProfiles(
  supabase: SupabaseClient,
  userIds: string[],
): Promise<
  Map<string, { name: string; role: "admin" | "teacher" | "parent" }>
> {
  const map = new Map<
    string,
    { name: string; role: "admin" | "teacher" | "parent" }
  >();
  const ids = Array.from(new Set(userIds.filter(Boolean)));
  if (ids.length === 0) return map;

  const [managedResult, webResult] = await Promise.all([
    supabase
      .from("managed_user_profiles")
      .select("auth_user_id, full_name, role")
      .in("auth_user_id", ids),
    supabase
      .from("user_profiles")
      .select("id, full_name, role")
      .in("id", ids)
      .is("deleted_at", null),
  ]);

  const put = (
    id: string | null | undefined,
    name: string | null | undefined,
    role: string | null | undefined,
  ) => {
    if (!id || map.has(id)) return;
    map.set(id, {
      name: (name ?? "").trim() || "—",
      role: mapMessagingRole(role),
    });
  };

  for (const row of (managedResult.data ?? []) as Array<{
    auth_user_id?: string | null;
    full_name?: string | null;
    role?: string | null;
  }>) {
    put(row.auth_user_id, row.full_name, row.role);
  }
  for (const row of (webResult.data ?? []) as Array<{
    id?: string | null;
    full_name?: string | null;
    role?: string | null;
  }>) {
    put(row.id, row.full_name, row.role);
  }
  return map;
}

/** Auth user ids from `candidates` that belong to `schoolId` in either table. */
async function filterSchoolMembers(
  supabase: SupabaseClient,
  candidates: string[],
  schoolId: string,
): Promise<Set<string>> {
  const members = new Set<string>();
  if (candidates.length === 0) return members;

  const [managedResult, webResult] = await Promise.all([
    supabase
      .from("managed_user_profiles")
      .select("auth_user_id")
      .in("auth_user_id", candidates)
      .eq("school_id", schoolId),
    supabase
      .from("user_profiles")
      .select("id")
      .in("id", candidates)
      .eq("school_id", schoolId)
      .is("deleted_at", null),
  ]);

  for (const row of (managedResult.data ?? []) as Array<{
    auth_user_id?: string | null;
  }>) {
    if (row.auth_user_id) members.add(row.auth_user_id);
  }
  for (const row of (webResult.data ?? []) as Array<{ id?: string | null }>) {
    if (row.id) members.add(row.id);
  }
  return members;
}

/**
 * True when a block exists in either direction between the actor and any of
 * `otherIds`. `messaging_blocks` is only readable by its own creator under RLS,
 * so this must run on the service client.
 */
async function hasMessagingBlock(
  supabase: SupabaseClient,
  schoolId: string,
  actorUserId: string,
  otherIds: string[],
): Promise<boolean> {
  if (otherIds.length === 0) return false;
  const [outgoing, incoming] = await Promise.all([
    supabase
      .from("messaging_blocks")
      .select("id")
      .eq("school_id", schoolId)
      .eq("blocker_user_id", actorUserId)
      .in("blocked_user_id", otherIds)
      .limit(1),
    supabase
      .from("messaging_blocks")
      .select("id")
      .eq("school_id", schoolId)
      .eq("blocked_user_id", actorUserId)
      .in("blocker_user_id", otherIds)
      .limit(1),
  ]);
  return (outgoing.data ?? []).length > 0 || (incoming.data ?? []).length > 0;
}

async function isParticipant(
  supabase: SupabaseClient,
  conversationId: string,
  userId: string,
) {
  const { data } = await supabase
    .from("conversation_participants")
    .select("conversation_id")
    .eq("conversation_id", conversationId)
    .eq("user_id", userId)
    .maybeSingle();
  return Boolean(data);
}

// GET ?threadId=... -> messages of a thread (caller must be a participant)
// GET (no threadId)  -> inbox: conversations the caller participates in
export async function GET(request: NextRequest) {
  const schoolIdParam = request.nextUrl.searchParams.get("schoolId");
  const context = await resolveSchoolScopedActorContext(
    schoolIdParam,
    {
      allowedRoles: [...ALLOWED_ROLES],
      roleDeniedMessage: "ليس لديك صلاحية الوصول إلى الرسائل.",
    },
    request.headers.get("authorization"),
  );
  if (!context.ok) {
    return jsonError(context.message, context.status);
  }

  const { actorSupabase, actorUserId, targetSchoolId } = context.value;
  const threadId = request.nextUrl.searchParams.get("threadId");

  if (threadId) {
    if (!(await isParticipant(actorSupabase, threadId, actorUserId))) {
      return NextResponse.json(
        { ok: false, error: "forbidden" },
        { status: 403 },
      );
    }

    // Conversation metadata and messages are independent -- fetch in parallel.
    const [convResult, messagesResult] = await Promise.all([
      actorSupabase
        .from("conversations")
        .select("id, school_id, title, created_at")
        .eq("id", threadId)
        .single(),
      actorSupabase
        .from("messages")
        .select("id, conversation_id, sender_id, body, created_at, read_at")
        .eq("conversation_id", threadId)
        .order("created_at", { ascending: true }),
    ]);

    if (messagesResult.error) {
      logRouteError("web-messaging", messagesResult.error);
      return NextResponse.json({ ok: false, error: "تعذر إكمال العملية. حاول مرة أخرى لاحقاً." }, { status: 500 });
    }

    // Read state is PER PARTICIPANT, tracked on conversation_participants.
    // `messages.read_at` is a single column shared by the whole thread, so in
    // any 3+ person conversation one reader would mark it read for everyone --
    // it is left untouched here and is not used to derive unread counts.
    await actorSupabase
      .from("conversation_participants")
      .update({ last_read_at: new Date().toISOString() })
      .eq("conversation_id", threadId)
      .eq("user_id", actorUserId);

    return NextResponse.json({
      ok: true,
      conversation: convResult.data,
      items: messagesResult.data ?? [],
    });
  }

  // Inbox
  const { data: parts, error: partsError } = await actorSupabase
    .from("conversation_participants")
    .select("conversation_id, last_read_at")
    .eq("user_id", actorUserId)
    .limit(INBOX_CONVERSATION_LIMIT);

  if (partsError) {
    logRouteError("web-messaging", partsError);
    return NextResponse.json({ ok: false, error: "تعذر إكمال العملية. حاول مرة أخرى لاحقاً." }, { status: 500 });
  }

  const ids = (parts ?? []).map((p) => p.conversation_id);
  if (ids.length === 0) {
    return NextResponse.json({ ok: true, items: [] });
  }

  const lastReadByConv = new Map<string, string | null>(
    (parts ?? []).map((p) => [p.conversation_id, p.last_read_at ?? null]),
  );

  const { data: conversations, error } = await actorSupabase
    .from("conversations")
    .select("id, school_id, title, created_at")
    .in("id", ids)
    .eq("school_id", targetSchoolId)
    .order("created_at", { ascending: false })
    .limit(INBOX_CONVERSATION_LIMIT);

  if (error) {
    logRouteError("web-messaging", error);
    return NextResponse.json({ ok: false, error: "تعذر إكمال العملية. حاول مرة أخرى لاحقاً." }, { status: 500 });
  }

  const convIds = (conversations ?? []).map((c) => c.id);

  // Previously this fetched EVERY message of every conversation and picked the
  // newest in JS. PostgREST caps rows at a server-side default, so on a busy
  // inbox the cap truncated older conversations out of the result and their
  // preview silently rendered as "no messages". Bounded per-conversation
  // queries instead: one newest row + one unread count each.
  const [previews, participantsResult] = await Promise.all([
    Promise.all(
      convIds.map(async (conversationId) => {
        const lastRead = lastReadByConv.get(conversationId) ?? null;
        let unreadQuery = actorSupabase
          .from("messages")
          .select("id", { count: "exact", head: true })
          .eq("conversation_id", conversationId)
          .neq("sender_id", actorUserId);
        if (lastRead) unreadQuery = unreadQuery.gt("created_at", lastRead);

        const [lastResult, unreadResult] = await Promise.all([
          actorSupabase
            .from("messages")
            .select("body, created_at, sender_id")
            .eq("conversation_id", conversationId)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
          unreadQuery,
        ]);

        return {
          conversationId,
          last: lastResult.data ?? null,
          unread: unreadResult.count ?? 0,
        };
      }),
    ),
    actorSupabase
      .from("conversation_participants")
      .select("conversation_id, user_id")
      .in("conversation_id", convIds)
      .neq("user_id", actorUserId),
  ]);

  const lastByConv = new Map<
    string,
    { body: string; created_at: string; sender_id: string | null } | null
  >();
  const unreadByConv = new Map<string, number>();
  for (const preview of previews) {
    lastByConv.set(preview.conversationId, preview.last);
    unreadByConv.set(preview.conversationId, preview.unread);
  }

  // Build a map of conversationId -> first other participant userId
  const otherParticipantByConv = new Map<string, string>();
  for (const p of participantsResult.data ?? []) {
    if (!otherParticipantByConv.has(p.conversation_id)) {
      otherParticipantByConv.set(p.conversation_id, p.user_id);
    }
  }

  // Resolve participant names in batch
  const otherUserIds = Array.from(new Set(otherParticipantByConv.values()));
  // Resolve across both identity tables so admin counterparties get a real name
  // instead of falling through to the generic "محادثة" placeholder.
  const profileByUserId = await fetchMessagingProfiles(
    actorSupabase,
    otherUserIds,
  );

  const items = (conversations ?? []).map((c) => {
    const otherUserId = otherParticipantByConv.get(c.id);
    const participantName = otherUserId
      ? (profileByUserId.get(otherUserId)?.name ?? null)
      : null;
    return {
      ...c,
      display_name:
        participantName && participantName !== "—"
          ? participantName
          : (c.title ?? "محادثة"),
      last_message: lastByConv.get(c.id) ?? null,
      unread_count: unreadByConv.get(c.id) ?? 0,
      last_read_at: lastReadByConv.get(c.id) ?? null,
    };
  });

  return NextResponse.json({ ok: true, items });
}

// POST with { body, threadId }                 -> send a message into an existing thread
// POST with { body, participantIds[], title? } -> create a conversation then send first message
export async function POST(request: NextRequest) {
  const rateLimited = await enforceRateLimit(request, {
    namespace: "messaging:send",
    maxHits: 30,
    windowMs: 60_000,
  });
  if (rateLimited) return rateLimited;

  const reqBody = await request.json().catch(() => null);
  if (
    !reqBody?.body ||
    typeof reqBody.body !== "string" ||
    !reqBody.body.trim()
  ) {
    return NextResponse.json(
      { ok: false, error: "body is required" },
      { status: 400 },
    );
  }
  if (reqBody.body.length > 5000) {
    return NextResponse.json(
      { ok: false, error: "body too long (max 5000)" },
      { status: 400 },
    );
  }

  const context = await resolveSchoolScopedActorContext(
    reqBody.schoolId ?? null,
    {
      allowedRoles: [...ALLOWED_ROLES],
      roleDeniedMessage: "ليس لديك صلاحية إرسال الرسائل.",
    },
    request.headers.get("authorization"),
  );
  if (!context.ok) {
    return jsonError(context.message, context.status);
  }

  const { actorUserId, targetSchoolId } = context.value;
  const serviceSupabase = createServiceSupabaseClient();
  let conversationId: string | null = reqBody.threadId ?? null;

  // Resolve the sender's display name + role (messages.sender_name/sender_role
  // are NOT NULL; sender_role is CHECK-constrained to admin|teacher|parent).
  const actorProfileMap = await fetchMessagingProfiles(serviceSupabase, [
    actorUserId,
  ]);
  const actorProfile = actorProfileMap.get(actorUserId) ?? {
    name: "—",
    role: "admin" as const,
  };

  if (conversationId) {
    if (!(await isParticipant(serviceSupabase, conversationId, actorUserId))) {
      return NextResponse.json(
        { ok: false, error: "forbidden" },
        { status: 403 },
      );
    }
    const { data: thread } = await serviceSupabase
      .from("conversations")
      .select("id, school_id")
      .eq("id", conversationId)
      .maybeSingle();
    if (
      !thread ||
      (thread as { school_id?: string }).school_id !== targetSchoolId
    ) {
      return NextResponse.json(
        { ok: false, error: "forbidden" },
        { status: 403 },
      );
    }

    // Blocks are enforced on every send, not just on thread creation --
    // otherwise blocking someone from mobile leaves an existing web thread wide
    // open. (App Store UGC safety requirement.)
    const { data: threadOthers } = await serviceSupabase
      .from("conversation_participants")
      .select("user_id")
      .eq("conversation_id", conversationId)
      .neq("user_id", actorUserId);
    const threadOtherIds = (threadOthers ?? [])
      .map((row: { user_id: string }) => row.user_id)
      .filter(Boolean);
    if (
      await hasMessagingBlock(
        serviceSupabase,
        targetSchoolId,
        actorUserId,
        threadOtherIds,
      )
    ) {
      return NextResponse.json(
        { ok: false, error: "لا يمكن إرسال رسالة ضمن هذه المحادثة." },
        { status: 403 },
      );
    }
  } else {
    const participantIds: string[] = (
      Array.isArray(reqBody.participantIds) ? reqBody.participantIds : []
    ).filter(
      (id: unknown): id is string =>
        typeof id === "string" && UUID_RE.test(id.trim()),
    );
    const uniqueParticipants = Array.from(
      new Set([actorUserId, ...participantIds].filter(Boolean)),
    );
    if (uniqueParticipants.length < 2) {
      return NextResponse.json(
        {
          ok: false,
          error: "participantIds must include at least one other user",
        },
        { status: 400 },
      );
    }

    const otherIds = uniqueParticipants.filter((id) => id !== actorUserId);
    if (otherIds.length > 0) {
      const verifiedSet = await filterSchoolMembers(
        serviceSupabase,
        otherIds,
        targetSchoolId,
      );
      const invalid = otherIds.filter((id) => !verifiedSet.has(id));
      if (invalid.length > 0) {
        return NextResponse.json(
          { ok: false, error: "بعض المشاركين لا ينتمون لهذه المدرسة." },
          { status: 403 },
        );
      }

      if (
        await hasMessagingBlock(
          serviceSupabase,
          targetSchoolId,
          actorUserId,
          otherIds,
        )
      ) {
        return NextResponse.json(
          { ok: false, error: "لا يمكن بدء محادثة مع هذا المستخدم." },
          { status: 403 },
        );
      }
    }

    const { data: conv, error: convError } = await serviceSupabase
      .from("conversations")
      .insert({
        school_id: targetSchoolId,
        type: "direct",
        subject:
          typeof reqBody.title === "string" && reqBody.title.trim()
            ? reqBody.title.trim()
            : null,
        created_by: actorUserId,
      })
      .select("id")
      .single();

    if (convError || !conv) {
      return NextResponse.json(
        { ok: false, error: convError?.message ?? "failed to create" },
        { status: 500 },
      );
    }
    conversationId = conv.id;

    const participantProfiles = await fetchMessagingProfiles(
      serviceSupabase,
      uniqueParticipants,
    );
    const { error: partError } = await serviceSupabase
      .from("conversation_participants")
      .insert(
        uniqueParticipants.map((uid) => {
          const profile =
            uid === actorUserId ? actorProfile : participantProfiles.get(uid);
          return {
            conversation_id: conv.id,
            user_id: uid,
            role: profile?.role ?? "admin",
            display_name: profile?.name ?? "—",
          };
        }),
      );
    if (partError) {
      // These two inserts are not in one transaction. A conversation with zero
      // participants is unreachable -- every read path in this file starts from
      // conversation_participants -- so it can never be listed, opened or
      // deleted again. Roll it back rather than leaking a permanent orphan.
      const { error: rollbackError } = await serviceSupabase
        .from("conversations")
        .delete()
        .eq("id", conv.id);
      if (rollbackError) {
        console.error("[messaging] orphaned conversation left behind", {
          conversationId: conv.id,
          schoolId: targetSchoolId,
          participantError: partError.message,
          rollbackError: rollbackError.message,
        });
      }
      logRouteError("web-messaging", partError);
      return NextResponse.json({ ok: false, error: "تعذر إكمال العملية. حاول مرة أخرى لاحقاً." }, { status: 500 });
    }
  }

  const { data: message, error } = await serviceSupabase
    .from("messages")
    .insert({
      conversation_id: conversationId,
      sender_id: actorUserId,
      sender_name: actorProfile.name,
      sender_role: actorProfile.role,
      body: reqBody.body.trim(),
    })
    .select("id, conversation_id, sender_id, body, created_at, read_at")
    .single();

  if (error) {
    logRouteError("web-messaging", error);
    return NextResponse.json({ ok: false, error: "تعذر إكمال العملية. حاول مرة أخرى لاحقاً." }, { status: 500 });
  }
  return NextResponse.json(
    { ok: true, threadId: conversationId, item: message },
    { status: 201 },
  );
}
