import { NextRequest, NextResponse } from "next/server";
import { resolveManagedUsersActorContext } from "@/lib/managed-users-server";
import {
  applyBranchScopeToQuery,
  resolveBranchScope,
} from "@/lib/branch-scope";
import { enforceRateLimit } from "@/lib/rate-limit";
import { createServiceSupabaseClient } from "@/lib/supabase-server";
import { isValidUUID } from "@/lib/route-utils";
import { invalidateSchoolCacheDomains } from "@/lib/server-cache";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: { message } }, { status });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;

  const schoolId = typeof body?.schoolId === "string" ? body.schoolId : null;
  const keepId = typeof body?.keepId === "string" ? body.keepId : null;
  const mergeIds = Array.isArray(body?.mergeIds) ? body.mergeIds : [];

  if (!keepId || !isValidUUID(keepId)) {
    return jsonError("معرّف الطالب المحتفظ به غير صالح.", 400);
  }
  const validMergeIds = mergeIds.filter(
    (id): id is string => typeof id === "string" && isValidUUID(id) && id !== keepId,
  );
  if (validMergeIds.length === 0) {
    return jsonError("يجب تحديد طالب واحد على الأقل للدمج.", 400);
  }

  const context = await resolveManagedUsersActorContext(
    schoolId,
    req.headers.get("authorization"),
  );
  if (!context.ok) {
    return jsonError(
      "message" in context ? context.message : "تعذر التحقق من الصلاحيات.",
      401,
    );
  }

  const requestedBranchId =
    typeof body?.branchId === "string" ? body.branchId : null;
  const branchScope = resolveBranchScope(context.value, requestedBranchId);
  if (!branchScope.ok) {
    return jsonError(branchScope.message, branchScope.status);
  }

  const rateLimited = await enforceRateLimit(req, {
    namespace: "students-merge",
    windowMs: 60_000,
    maxHits: 5,
  });
  if (rateLimited) return rateLimited;

  const supabase = createServiceSupabaseClient();
  const resolvedSchoolId = context.value.targetSchoolId;
  const actorUserId = context.value.actorUserId;

  const allIds = [keepId, ...validMergeIds];
  let studentsQuery = supabase
    .from("students")
    .select("id, full_name, status")
    .eq("school_id", resolvedSchoolId)
    .in("id", allIds);
  studentsQuery = applyBranchScopeToQuery(studentsQuery, branchScope.value);

  const { data: students, error: fetchErr } = await studentsQuery;
  if (fetchErr) {
    return jsonError(fetchErr.message, 500);
  }
  if (!students || students.length !== allIds.length) {
    return jsonError("بعض الطلاب غير موجودين ضمن المدرسة الحالية.", 404);
  }

  const { error: transferErr } = await supabase
    .from("payments")
    .update({ student_id: keepId })
    .eq("school_id", resolvedSchoolId)
    .in("student_id", validMergeIds)
    .is("deleted_at", null);

  if (transferErr) {
    return jsonError("تعذر نقل المدفوعات: " + transferErr.message, 500);
  }

  const now = new Date().toISOString();
  const { error: deleteErr } = await supabase
    .from("students")
    .update({
      status: "deleted",
      deleted_at: now,
      deleted_by: actorUserId,
    })
    .eq("school_id", resolvedSchoolId)
    .in("id", validMergeIds);

  if (deleteErr) {
    return jsonError("تعذر حذف الطلاب المدمجين: " + deleteErr.message, 500);
  }

  invalidateSchoolCacheDomains(resolvedSchoolId, [
    "dashboard-overview",
    "payments-meta",
    "reports-overview",
    "students-meta",
  ]);

  return NextResponse.json({
    ok: true,
    keptStudentId: keepId,
    mergedCount: validMergeIds.length,
  });
}
