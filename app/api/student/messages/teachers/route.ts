import { NextRequest, NextResponse } from "next/server";
import { resolveStudentContext, unauthorized } from "@/lib/student-api";

export async function GET(req: NextRequest) {
  const ctx = await resolveStudentContext(req);
  if (!ctx) return unauthorized();

  const { supabase, schoolId } = ctx;

  const { data: teachers, error } = await supabase
    .from("teachers")
    .select("id, full_name, auth_user_id")
    .eq("school_id", schoolId)
    .neq("status", "deleted")
    .not("auth_user_id", "is", null)
    .order("full_name", { ascending: true });

  if (error) {
    return NextResponse.json(
      { ok: false, error: "fetch_failed" },
      { status: 500 },
    );
  }

  const data = (teachers ?? [])
    .filter((t: Record<string, unknown>) => !!t.auth_user_id)
    .map((t: Record<string, unknown>) => ({
      id: t.auth_user_id as string,
      name: (t.full_name as string) ?? "",
    }));

  return NextResponse.json({ ok: true, data });
}
