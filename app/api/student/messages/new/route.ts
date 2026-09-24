import { NextRequest, NextResponse } from "next/server";
import { resolveStudentContext, unauthorized } from "@/lib/student-api";

export async function POST(req: NextRequest) {
  const ctx = await resolveStudentContext(req);
  if (!ctx) return unauthorized();

  const { supabase, userId, schoolId, studentId } = ctx;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_json" },
      { status: 400 },
    );
  }

  const recipientId =
    typeof body.recipient_id === "string" ? body.recipient_id.trim() : "";
  const subject =
    typeof body.subject === "string" ? body.subject.trim() : "";
  const messageBody =
    typeof body.body === "string" ? body.body.trim() : "";

  if (!recipientId || !subject || !messageBody) {
    return NextResponse.json(
      { ok: false, error: "missing_fields" },
      { status: 400 },
    );
  }

  // Verify recipient is a teacher at this school
  const { data: teacher } = await supabase
    .from("teachers")
    .select("id, full_name, auth_user_id")
    .eq("auth_user_id", recipientId)
    .eq("school_id", schoolId)
    .neq("status", "deleted")
    .maybeSingle();

  if (!teacher) {
    return NextResponse.json(
      { ok: false, error: "recipient_not_found" },
      { status: 404 },
    );
  }

  const { data: student } = await supabase
    .from("students")
    .select("full_name")
    .eq("id", studentId)
    .eq("school_id", schoolId)
    .maybeSingle();

  const studentName =
    (student as Record<string, unknown> | null)?.full_name as
      | string
      | undefined;

  // 1. Create the conversation
  const { data: conversation, error: convError } = await supabase
    .from("conversations")
    .insert({
      school_id: schoolId,
      type: "direct",
      created_by: userId,
      title: subject,
    })
    .select("id")
    .single();

  if (convError || !conversation) {
    return NextResponse.json(
      { ok: false, error: "create_conversation_failed" },
      { status: 500 },
    );
  }

  const conversationId = (conversation as Record<string, unknown>)
    .id as string;

  // 2. Add both participants
  const { error: participantsError } = await supabase
    .from("conversation_participants")
    .insert([
      {
        conversation_id: conversationId,
        user_id: userId,
        role: "student",
        display_name: studentName?.trim() || "الطالب",
      },
      {
        conversation_id: conversationId,
        user_id: recipientId,
        role: "teacher",
        display_name:
          (teacher as Record<string, unknown>).full_name as string ||
          "المعلم",
      },
    ]);

  if (participantsError) {
    // Clean up the orphaned conversation
    await supabase.from("conversations").delete().eq("id", conversationId);
    return NextResponse.json(
      { ok: false, error: "add_participants_failed" },
      { status: 500 },
    );
  }

  // 3. Insert the first message
  const { error: msgError } = await supabase.from("messages").insert({
    conversation_id: conversationId,
    sender_id: userId,
    sender_name: studentName?.trim() || "",
    sender_role: "student",
    body: messageBody,
  });

  if (msgError) {
    await supabase.from("conversations").delete().eq("id", conversationId);
    return NextResponse.json(
      { ok: false, error: "send_message_failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    data: { conversationId },
  });
}
