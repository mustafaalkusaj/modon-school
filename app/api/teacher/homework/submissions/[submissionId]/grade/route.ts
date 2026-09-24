import { NextRequest, NextResponse } from "next/server";

import {
  gradeTeacherAssignmentSubmission,
  type TeacherSubmissionGradeInput,
} from "@/lib/academic-records-server";
import { resolveTeacherHomeworkContext } from "@/lib/homework-web-server";
import { enforceRateLimit } from "@/lib/rate-limit";

/** POST — record a grade + feedback for one student's submission. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ submissionId: string }> },
) {
  const context = await resolveTeacherHomeworkContext(req);
  if (!context.ok) return context.response;

  const limited = await enforceRateLimit(req, {
    namespace: "web-teacher-homework-grade",
    windowMs: 60_000,
    maxHits: 60,
    identifier: context.value.actorUserId,
  });
  if (limited) return limited;

  const { submissionId } = await params;
  const payload = (await req.json().catch(() => null)) as TeacherSubmissionGradeInput | null;

  const result = await gradeTeacherAssignmentSubmission(context.value, {
    ...(payload ?? {}),
    submission_id: submissionId,
  });

  return NextResponse.json(
    { ok: result.ok, message: result.message },
    { status: result.ok ? 200 : 400 },
  );
}
