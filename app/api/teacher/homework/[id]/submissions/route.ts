import { NextRequest, NextResponse } from "next/server";

import { listTeacherAssignmentSubmissions } from "@/lib/academic-records-server";
import { resolveTeacherHomeworkContext } from "@/lib/homework-web-server";

/** GET — submissions for one homework item this teacher owns, for grading. */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const context = await resolveTeacherHomeworkContext(req);
  if (!context.ok) return context.response;

  const { id } = await params;
  const result = await listTeacherAssignmentSubmissions(context.value, id);

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.message }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    data: { assignment: result.assignment, submissions: result.submissions },
  });
}
