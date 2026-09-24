/**
 * Admin view over the account-deletion queue.
 *
 *   GET  ?schoolId=…            list this school's requests
 *   POST { requestId, action }  action = "execute" | "reject"
 *
 * "execute" runs the same executor the cron uses, immediately — a school admin
 * should not have to wait for the nightly run to honour a request. The 72h
 * grace window is intentionally NOT enforced here: an admin acting on a
 * verified request is the human review step the window exists to allow.
 */
import { NextRequest, NextResponse } from "next/server";

import { executeAccountDeletion } from "@/lib/account-deletion/executor";
import {
  loadDeletionRequestById,
  loadSchoolDeletionRequests,
  selectOverdue,
} from "@/lib/account-deletion/queue";
import { createSupabaseAccountDeletionGateway } from "@/lib/account-deletion/supabase-gateway";
import { resolveSchoolScopedActorContext } from "@/lib/managed-users-server";
import { enforceRateLimit } from "@/lib/rate-limit";
import { isValidUUID, jsonError, jsonServerError } from "@/lib/route-utils";
import { createServiceSupabaseClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

const ALLOWED_ROLES = ["super_admin", "admin"] as const;
const ROLE_DENIED = "إدارة طلبات حذف الحسابات متاحة لمدير المدرسة فقط.";

export async function GET(req: NextRequest) {
  const schoolId = req.nextUrl.searchParams.get("schoolId");
  const context = await resolveSchoolScopedActorContext(
    schoolId,
    { allowedRoles: [...ALLOWED_ROLES], roleDeniedMessage: ROLE_DENIED },
    req.headers.get("authorization"),
  );
  if (!context.ok) {
    return jsonError(
      "message" in context ? context.message : "تعذر التحقق من الصلاحيات.",
      "status" in context ? context.status : 403,
    );
  }

  try {
    const client = createServiceSupabaseClient();
    const requests = await loadSchoolDeletionRequests(
      client,
      context.value.targetSchoolId,
    );
    return NextResponse.json(
      {
        ok: true,
        data: requests,
        overdue: selectOverdue(requests).map((request) => request.id),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return jsonServerError(
      "web/account/deletion-requests:GET",
      error,
      "تعذر تحميل طلبات حذف الحسابات.",
    );
  }
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    requestId?: unknown;
    schoolId?: unknown;
    action?: unknown;
    note?: unknown;
  } | null;

  const requestId = typeof body?.requestId === "string" ? body.requestId : "";
  const schoolId = typeof body?.schoolId === "string" ? body.schoolId : null;
  const action = body?.action === "reject" ? "reject" : "execute";
  const note = typeof body?.note === "string" ? body.note.slice(0, 1000) : null;

  if (!isValidUUID(requestId)) {
    return jsonError("معرّف الطلب غير صالح.", 400);
  }

  const context = await resolveSchoolScopedActorContext(
    schoolId,
    { allowedRoles: [...ALLOWED_ROLES], roleDeniedMessage: ROLE_DENIED },
    req.headers.get("authorization"),
  );
  if (!context.ok) {
    return jsonError(
      "message" in context ? context.message : "تعذر التحقق من الصلاحيات.",
      "status" in context ? context.status : 403,
    );
  }

  const { actorUserId, targetSchoolId } = context.value;

  const limited = await enforceRateLimit(req, {
    namespace: "account-deletion-action",
    windowMs: 60_000,
    maxHits: 20,
    identifier: actorUserId,
  });
  if (limited) return limited;

  try {
    const client = createServiceSupabaseClient();
    const request = await loadDeletionRequestById(client, requestId);

    if (!request || request.school_id !== targetSchoolId) {
      return jsonError("طلب الحذف غير موجود ضمن نطاق هذه المدرسة.", 404);
    }

    const gateway = createSupabaseAccountDeletionGateway(client);

    if (action === "reject") {
      const now = new Date().toISOString();
      const { error } = await (
        client as unknown as {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          from: (t: string) => any;
        }
      )
        .from("account_deletion_requests")
        .update({
          status: "rejected",
          handled_by: actorUserId,
          resolution_note: note,
          updated_at: now,
        })
        .eq("id", requestId)
        .in("status", ["pending", "in_review", "verified", "failed"]);

      if (error) {
        return jsonServerError(
          "web/account/deletion-requests:reject",
          error,
          "تعذر رفض طلب الحذف.",
        );
      }

      await gateway.writeAudit({
        action: "account_deletion_rejected",
        requestId,
        schoolId: targetSchoolId,
        summary: "تم رفض طلب حذف الحساب من قبل الإدارة.",
        metadata: { actor_user_id: actorUserId, note },
      });

      return NextResponse.json({ ok: true, data: { status: "rejected" } });
    }

    const result = await executeAccountDeletion(gateway, request, {
      trigger: "admin",
      actorUserId,
    });

    return NextResponse.json(
      { ok: result.status !== "failed", data: result },
      {
        status: result.status === "failed" ? 500 : 200,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    return jsonServerError(
      "web/account/deletion-requests:POST",
      error,
      "تعذر تنفيذ الإجراء على طلب الحذف.",
    );
  }
}
