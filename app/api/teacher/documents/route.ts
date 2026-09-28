import { NextRequest, NextResponse } from "next/server";
import { resolveTeacherContext, unauthorized } from "@/lib/teacher-api";

export async function GET(req: NextRequest) {
  const ctx = await resolveTeacherContext(req);
  if (!ctx) return unauthorized();

  const { supabase, teacherId, schoolId } = ctx;

  const { data, error } = await supabase
    .from("teacher_documents")
    .select(
      "id, title, document_type, file_path, image_url, expiry_date, notes, created_at",
    )
    .eq("school_id", schoolId)
    .eq("teacher_id", teacherId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json(
      { ok: false, error: "fetch_failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    data: { documents: data ?? [] },
  });
}
