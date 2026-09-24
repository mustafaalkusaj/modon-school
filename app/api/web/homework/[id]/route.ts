import { NextRequest, NextResponse } from "next/server";

import {
  deleteTeacherAssignmentRecord,
  updateTeacherAssignmentRecord,
  type TeacherAssignmentUpdateInput,
} from "@/lib/academic-records-server";
import { resolveTeacherHomeworkContext } from "@/lib/homework-web-server";
import { resolveSchoolScopedActorContext } from "@/lib/managed-users-server";
import { createServiceSupabaseClient } from "@/lib/supabase-server";
import { enforceRateLimit } from "@/lib/rate-limit";
import { jsonError, jsonServerError, isValidUUID } from "@/lib/route-utils";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/web/homework/[id]
 *
 * Fetch a single homework assignment by ID.
 */
export async function GET(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;

  if (!isValidUUID(id)) {
    return jsonError("معرّف الواجب غير صالح.", 400);
  }

  const schoolId =
    req.headers.get("x-school-id") ??
    req.nextUrl.searchParams.get("schoolId");

  const context = await resolveSchoolScopedActorContext(
    schoolId,
    {
      allowedRoles: ["admin", "super_admin", "teacher", "employee"],
      roleDeniedMessage: "ليس لديك صلاحية عرض الواجبات.",
    },
    req.headers.get("authorization"),
  );

  if (!context.ok) {
    return jsonError(context.message, context.status);
  }

  const { targetSchoolId } = context.value;
  const serviceClient = createServiceSupabaseClient();

  try {
    const { data, error } = await serviceClient
      .from("assignments")
      .select("*")
      .eq("id", id)
      .eq("school_id", targetSchoolId)
      .single();

    if (error || !data) {
      return jsonError("الواجب غير موجود.", 404);
    }

    const { enrichAssignmentRows } = await import("@/lib/academic-records-server");
    const [enriched] = await enrichAssignmentRows(serviceClient, [data as Record<string, unknown>]);

    // Fetch submission counts
    const { data: submissions } = await serviceClient
      .from("assignment_submissions")
      .select("assignment_id, status")
      .eq("assignment_id", id);

    let submissionsTotal = 0;
    let submissionsGraded = 0;
    for (const row of (submissions ?? []) as Record<string, unknown>[]) {
      submissionsTotal += 1;
      if (row.status === "graded") submissionsGraded += 1;
    }

    return NextResponse.json({
      ok: true,
      data: {
        ...enriched,
        submissions_total: submissionsTotal,
        submissions_graded: submissionsGraded,
      },
    });
  } catch (err) {
    return jsonServerError("homework.[id].GET", err, "تعذر تحميل بيانات الواجب.", 500);
  }
}

/**
 * PUT /api/web/homework/[id]
 *
 * Update an existing homework assignment.
 */
export async function PUT(req: NextRequest, { params }: RouteParams) {
  const context = await resolveTeacherHomeworkContext(req);
  if (!context.ok) return context.response;

  const limited = await enforceRateLimit(req, {
    namespace: "web-homework-update",
    windowMs: 60_000,
    maxHits: 30,
    identifier: context.value.actorUserId,
  });
  if (limited) return limited;

  const { id } = await params;
  if (!isValidUUID(id)) {
    return jsonError("معرّف الواجب غير صالح.", 400);
  }

  const payload = (await req.json().catch(() => null)) as TeacherAssignmentUpdateInput | null;
  if (!payload) {
    return jsonError("بيانات الطلب غير صالحة.", 400);
  }

  const result = await updateTeacherAssignmentRecord(context.value, {
    ...payload,
    id,
  });

  return NextResponse.json(
    { ok: result.ok, message: result.message, affectedCount: result.affectedCount ?? 0 },
    { status: result.ok ? 200 : 400 },
  );
}

/**
 * DELETE /api/web/homework/[id]
 *
 * Soft-delete a homework assignment.
 */
export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const context = await resolveTeacherHomeworkContext(req);
  if (!context.ok) return context.response;

  const { id } = await params;
  if (!isValidUUID(id)) {
    return jsonError("معرّف الواجب غير صالح.", 400);
  }

  const result = await deleteTeacherAssignmentRecord(context.value, id);

  return NextResponse.json(
    { ok: result.ok, message: result.message, affectedCount: result.affectedCount ?? 0 },
    { status: result.ok ? 200 : 400 },
  );
}
