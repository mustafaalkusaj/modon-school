import { NextRequest, NextResponse } from "next/server";
import { resolveStudentContext, unauthorized, serverError } from "@/lib/student-api";

interface NotificationPreferences {
  grades: boolean;
  attendance: boolean;
  assignments: boolean;
  exams: boolean;
  messages: boolean;
}

const DEFAULT_PREFERENCES: NotificationPreferences = {
  grades: true,
  attendance: true,
  assignments: true,
  exams: true,
  messages: true,
};

function sanitizePreferences(input: unknown): NotificationPreferences {
  const body = (input ?? {}) as Record<string, unknown>;
  return {
    grades: typeof body.grades === "boolean" ? body.grades : DEFAULT_PREFERENCES.grades,
    attendance:
      typeof body.attendance === "boolean" ? body.attendance : DEFAULT_PREFERENCES.attendance,
    assignments:
      typeof body.assignments === "boolean" ? body.assignments : DEFAULT_PREFERENCES.assignments,
    exams: typeof body.exams === "boolean" ? body.exams : DEFAULT_PREFERENCES.exams,
    messages: typeof body.messages === "boolean" ? body.messages : DEFAULT_PREFERENCES.messages,
  };
}

export async function GET(req: NextRequest) {
  const ctx = await resolveStudentContext(req);
  if (!ctx) return unauthorized();

  const { supabase, studentId, schoolId } = ctx;

  const { data, error } = await (supabase as any)
    .from("student_notification_preferences")
    .select("grades, attendance, assignments, exams, messages")
    .eq("student_id", studentId)
    .eq("school_id", schoolId)
    .maybeSingle();

  if (error) {
    return serverError("fetch_failed");
  }

  const preferences: NotificationPreferences = data
    ? sanitizePreferences(data)
    : DEFAULT_PREFERENCES;

  return NextResponse.json({ ok: true, data: preferences });
}

export async function POST(req: NextRequest) {
  const ctx = await resolveStudentContext(req);
  if (!ctx) return unauthorized();

  const { supabase, studentId, schoolId } = ctx;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_body" },
      { status: 400 },
    );
  }

  const preferences = sanitizePreferences(body);

  const { error } = await (supabase as any)
    .from("student_notification_preferences")
    .upsert(
      {
        student_id: studentId,
        school_id: schoolId,
        ...preferences,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "student_id" },
    );

  if (error) {
    return serverError("save_failed");
  }

  return NextResponse.json({ ok: true, data: preferences });
}
