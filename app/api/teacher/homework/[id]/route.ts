import { NextRequest, NextResponse } from "next/server";

import {
  deleteTeacherAssignmentRecord,
  updateTeacherAssignmentRecord,
  type TeacherAssignmentUpdateInput,
} from "@/lib/academic-records-server";
import { resolveTeacherHomeworkContext } from "@/lib/homework-web-server";
import { enforceRateLimit } from "@/lib/rate-limit";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const context = await resolveTeacherHomeworkContext(req);
  if (!context.ok) return context.response;

  const limited = await enforceRateLimit(req, {
    namespace: "web-teacher-homework-update",
    windowMs: 60_000,
    maxHits: 30,
    identifier: context.value.actorUserId,
  });
  if (limited) return limited;

  const { id } = await params;
  const payload = (await req.json().catch(() => null)) as TeacherAssignmentUpdateInput | null;
  const result = await updateTeacherAssignmentRecord(context.value, {
    ...(payload ?? {}),
    id,
  });

  return NextResponse.json(
    { ok: result.ok, message: result.message, affectedCount: result.affectedCount ?? 0 },
    { status: result.ok ? 200 : 400 },
  );
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const context = await resolveTeacherHomeworkContext(req);
  if (!context.ok) return context.response;

  const { id } = await params;
  const result = await deleteTeacherAssignmentRecord(context.value, id);

  return NextResponse.json(
    { ok: result.ok, message: result.message, affectedCount: result.affectedCount ?? 0 },
    { status: result.ok ? 200 : 400 },
  );
}
