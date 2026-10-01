import { NextRequest, NextResponse } from "next/server";

import { deletePaymentSchema } from "@/lib/api-schemas";
import {
  applyBranchScopeToQuery,
  resolveBranchScope,
} from "@/lib/branch-scope";
import { resolveSchoolScopedActorContext } from "@/lib/managed-users-server";
import { enforceRateLimit } from "@/lib/rate-limit";
import {
  jsonError,
  jsonValidationError,
  logRouteError,
} from "@/lib/route-utils";
import { routeUserHasPermission } from "@/lib/route-permissions";
import { invalidateSchoolCacheDomains } from "@/lib/server-cache";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ paymentId: string }> },
) {
  const { paymentId } = await params;
  if (!paymentId || !UUID_REGEX.test(paymentId)) {
    return jsonError("معرف الدفعة غير صالح.", 400);
  }
  const body = await req.json().catch(() => null);
  const schoolId = body?.school_id;
  if (!schoolId || typeof schoolId !== "string") {
    return jsonError("school_id مطلوب.", 400);
  }
  // Clients send the state they want. A bare toggle (no `audited`) is still
  // accepted, but two quick clicks on it cancelled each other out.
  const requestedAudited =
    typeof body?.audited === "boolean" ? (body.audited as boolean) : null;

  const context = await resolveSchoolScopedActorContext(
    schoolId,
    {
      allowedRoles: ["super_admin", "admin", "employee"],
      roleDeniedMessage: "تدقيق الدفعات متاح ضمن المدرسة الحالية فقط.",
    },
    req.headers.get("authorization"),
  );

  if (!context.ok) {
    return jsonError(
      "message" in context
        ? context.message
        : "تعذر التحقق من صلاحيات المستخدم.",
      "status" in context ? context.status : 500,
    );
  }

  const { actorSupabase, actorUserId, targetSchoolId } = context.value;

  const rateLimited = await enforceRateLimit(req, {
    namespace: "payments-audit-toggle",
    windowMs: 60_000,
    maxHits: 60,
    identifier: actorUserId,
  });
  if (rateLimited) return rateLimited;

  // Marking a payment as audited is a finance action: same permission as
  // recording or deleting payments, and only inside the actor's branches.
  const [canAdd, canDelete] = await Promise.all([
    routeUserHasPermission(actorSupabase, actorUserId, "add_payments"),
    routeUserHasPermission(actorSupabase, actorUserId, "delete_payments"),
  ]);
  if (!canAdd && !canDelete) {
    return jsonError("ليس لديك صلاحية تدقيق الدفعات.", 403);
  }
  const branchScope = resolveBranchScope(context.value);
  if (!branchScope.ok) {
    return jsonError(branchScope.message, branchScope.status);
  }

  // `audited_at` is not part of the generated Database types yet, so the row is
  // typed explicitly here.
  const { data: paymentRow, error: fetchErr } = await applyBranchScopeToQuery(
    actorSupabase
      .from("payments")
      .select("id, audited_at" as "id")
      .eq("id", paymentId)
      .eq("school_id", targetSchoolId)
      .is("deleted_at", null),
    branchScope.value,
  ).maybeSingle();

  if (fetchErr || !paymentRow) {
    return jsonError("تعذر العثور على الدفعة.", 404);
  }
  const payment = paymentRow as unknown as {
    id: string;
    audited_at: string | null;
  };

  const shouldBeAudited = requestedAudited ?? !payment.audited_at;
  const newAuditedAt = shouldBeAudited
    ? (payment.audited_at ?? new Date().toISOString())
    : null;

  const { error: updateErr } = await actorSupabase
    .from("payments")
    .update({ audited_at: newAuditedAt } as never)
    .eq("id", paymentId)
    .eq("school_id", targetSchoolId)
    .is("deleted_at", null);

  if (updateErr) {
    logRouteError("payments-audit-toggle", updateErr, {
      actorUserId,
      schoolId: targetSchoolId,
      paymentId,
    });
    return jsonError("تعذر تحديث حالة التدقيق.", 500);
  }

  return NextResponse.json({
    ok: true,
    paymentId,
    audited_at: newAuditedAt,
  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ paymentId: string }> },
) {
  const { paymentId } = await params;
  if (!paymentId || !UUID_REGEX.test(paymentId)) {
    return jsonError("معرف الدفعة غير صالح.", 400);
  }
  const body = await req.json().catch(() => null);
  const parsed = deletePaymentSchema.safeParse(body);
  if (!parsed.success) {
    return jsonValidationError(parsed.error);
  }
  const { school_id: schoolId } = parsed.data;

  const context = await resolveSchoolScopedActorContext(
    schoolId,
    {
      allowedRoles: ["super_admin", "admin", "employee"],
      roleDeniedMessage: "حذف الدفعات متاح ضمن المدرسة الحالية فقط.",
    },
    req.headers.get("authorization"),
  );

  if (!context.ok) {
    return jsonError(
      "message" in context
        ? context.message
        : "تعذر التحقق من صلاحيات المستخدم.",
      "status" in context ? context.status : 500,
    );
  }

  const branchScope = resolveBranchScope(context.value);
  if (!branchScope.ok) {
    return jsonError(branchScope.message, branchScope.status);
  }

  const { actorSupabase, actorUserId, targetSchoolId } = context.value;
  const rateLimited = await enforceRateLimit(req, {
    namespace: "payments-records-delete",
    windowMs: 60_000,
    maxHits: 40,
    identifier: actorUserId,
  });
  if (rateLimited) {
    return rateLimited;
  }

  const canDeletePayments = await routeUserHasPermission(
    actorSupabase,
    actorUserId,
    "delete_payments",
  );
  if (!canDeletePayments) {
    return jsonError("ليس لديك صلاحية حذف الدفعات.", 403);
  }

  const paymentQuery = applyBranchScopeToQuery(
    actorSupabase
      .from("payments")
      .select("id, student_id, deleted_at")
      .eq("id", paymentId)
      .eq("school_id", targetSchoolId),
    branchScope.value,
  );
  const { data: payment, error: paymentError } =
    await paymentQuery.maybeSingle();

  if (paymentError || !payment?.id || typeof payment.student_id !== "string") {
    return jsonError(
      "تعذر العثور على الدفعة المطلوبة ضمن المدرسة الحالية.",
      404,
    );
  }

  if (payment.deleted_at) {
    return jsonError("تم حذف هذه الدفعة مسبقاً.", 404);
  }

  // Soft delete: UPDATE with deleted_at instead of hard DELETE
  // This avoids database trigger issues and maintains audit trail
  let softDeleteQuery = actorSupabase
    .from("payments")
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by: actorUserId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", paymentId)
    .eq("school_id", targetSchoolId)
    // Guard against a concurrent delete: only a live row may be soft-deleted.
    .is("deleted_at", null);

  // Only apply branch scope filtering if user has specific branch access
  if (branchScope.value.branchId) {
    softDeleteQuery = softDeleteQuery.eq(
      "branch_id",
      branchScope.value.branchId,
    );
  } else if (branchScope.value.branchIds.length > 0) {
    softDeleteQuery = softDeleteQuery.in(
      "branch_id",
      branchScope.value.branchIds,
    );
  }
  // If neither (group_admin with all branches), no branch filtering needed

  const { data: deletedRows, error: deleteError } =
    await softDeleteQuery.select("id");

  if (deleteError) {
    logRouteError("payments-records-delete", deleteError, {
      actorUserId,
      schoolId: targetSchoolId,
      paymentId,
      errorCode: deleteError.code,
      errorMessage: deleteError.message,
    });
    // Details are in the server log; never echo database errors to clients.
    return jsonError("تعذر حذف الدفعة. حاول مرة أخرى.", 500);
  }

  // RLS or the branch filter can match nothing without raising an error;
  // that used to be reported as a successful delete.
  if (!deletedRows || deletedRows.length === 0) {
    return jsonError(
      "لم يتم حذف الدفعة: غير موجودة ضمن صلاحياتك أو حُذفت مسبقاً.",
      409,
    );
  }

  invalidateSchoolCacheDomains(targetSchoolId, [
    "dashboard-overview",
    "payments-meta",
    "payments-list",
    "reports-overview",
    "students-meta",
  ]);

  // Trigger recompute_student_payment_totals fires on UPDATE of deleted_at
  // Query updated student data (includes trigger-recomputed paid_fee and remaining_fee)
  const { data: updatedStudent, error: studentQueryError } = await actorSupabase
    .from("students")
    .select("id, total_fee, paid_fee, remaining_fee, discount_value")
    .eq("id", payment.student_id)
    .eq("school_id", targetSchoolId)
    .maybeSingle();

  if (studentQueryError || !updatedStudent) {
    logRouteError(
      "payments-records-delete-fetch-updated-student",
      studentQueryError,
      {
        actorUserId,
        schoolId: targetSchoolId,
        studentId: payment.student_id,
        paymentId,
      },
    );
    return NextResponse.json(
      {
        ok: true,
        deletedPaymentId: paymentId,
        warning: "تم حذف الدفعة لكن تعذر تحميل الرصيد المحدث.",
      },
      { status: 202 },
    );
  }

  return NextResponse.json({
    ok: true,
    deletedPaymentId: paymentId,
    studentId: payment.student_id,
    studentUpdate: {
      id: updatedStudent.id,
      paid_fee: updatedStudent.paid_fee,
      remaining_fee: updatedStudent.remaining_fee,
      total_fee: updatedStudent.total_fee,
      discount_value: updatedStudent.discount_value,
    },
  });
}
