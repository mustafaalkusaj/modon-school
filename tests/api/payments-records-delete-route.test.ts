import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ACTOR_ID,
  BRANCH_ID,
  OTHER_BRANCH_ID,
  OTHER_SCHOOL_ID,
  PAYMENT_ID,
  SCHOOL_ID,
  STUDENT_ID,
  createSupabaseMock,
  type QueryResult,
} from "./_helpers/supabase-query-mock";

const resolveSchoolScopedActorContext = vi.fn();
const enforceRateLimit = vi.fn();
const routeUserHasPermission = vi.fn();
const invalidateSchoolCacheDomains = vi.fn();

vi.mock("@/lib/managed-users-server", () => ({ resolveSchoolScopedActorContext }));
vi.mock("@/lib/rate-limit", () => ({ enforceRateLimit }));
vi.mock("@/lib/route-permissions", () => ({ routeUserHasPermission }));
vi.mock("@/lib/server-cache", () => ({ invalidateSchoolCacheDomains }));

const UPDATED_STUDENT = {
  id: STUDENT_ID,
  total_fee: 1000,
  paid_fee: 500,
  remaining_fee: 500,
  discount_value: 0,
};

let db: ReturnType<typeof createSupabaseMock>;

function setup(options: {
  lookup?: QueryResult;
  update?: QueryResult;
  student?: QueryResult;
  allowedBranchIds?: string[];
  actorBranchId?: string | null;
} = {}) {
  db = createSupabaseMock({
    payments: [
      options.lookup ?? { data: { id: PAYMENT_ID, student_id: STUDENT_ID, deleted_at: null } },
      options.update ?? { data: null, error: null },
    ],
    students: options.student ?? { data: UPDATED_STUDENT },
  });

  resolveSchoolScopedActorContext.mockImplementation(async (schoolId: string | null) =>
    schoolId === SCHOOL_ID
      ? {
          ok: true,
          value: {
            actorSupabase: db.client,
            actorUserId: ACTOR_ID,
            targetSchoolId: SCHOOL_ID,
            actorBranchId: options.actorBranchId === undefined ? BRANCH_ID : options.actorBranchId,
            allowedBranchIds: options.allowedBranchIds ?? [BRANCH_ID],
          },
        }
      : { ok: false, status: 403, message: "school forbidden" },
  );
}

async function del(paymentId: string, body: unknown = { school_id: SCHOOL_ID }) {
  const { DELETE } = await import("@/app/api/web/payments/records/[paymentId]/route");
  const request = new NextRequest(`http://localhost/api/web/payments/records/${paymentId}`, {
    method: "DELETE",
    headers: { "content-type": "application/json", authorization: "Bearer token" },
    body: JSON.stringify(body),
  });
  const response = await DELETE(request, { params: Promise.resolve({ paymentId }) });
  return { response, payload: await response.json() };
}

function paymentUpdate() {
  return db.queriesFor("payments").find((query) => query.isWrite());
}

describe("DELETE /api/web/payments/records/[paymentId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    enforceRateLimit.mockResolvedValue(null);
    routeUserHasPermission.mockResolvedValue(true);
    setup();
  });

  describe("validation", () => {
    it("rejects a non-UUID payment id with 400", async () => {
      const { response } = await del("not-a-uuid");

      expect(response.status).toBe(400);
      expect(resolveSchoolScopedActorContext).not.toHaveBeenCalled();
    });

    it("rejects a body without school_id with 400", async () => {
      const { response } = await del(PAYMENT_ID, {});

      expect(response.status).toBe(400);
      expect(resolveSchoolScopedActorContext).not.toHaveBeenCalled();
      expect(db.writes()).toHaveLength(0);
    });
  });

  describe("authorization", () => {
    it("returns 401 for an unauthenticated caller", async () => {
      resolveSchoolScopedActorContext.mockResolvedValue({ ok: false, status: 401, message: "login required" });

      const { response } = await del(PAYMENT_ID);

      expect(response.status).toBe(401);
      expect(db.from).not.toHaveBeenCalled();
    });

    it("rejects deleting a payment of another school", async () => {
      const { response } = await del(PAYMENT_ID, { school_id: OTHER_SCHOOL_ID });

      expect(response.status).toBe(403);
      expect(db.from).not.toHaveBeenCalled();
    });

    it("returns 403 without delete_payments permission", async () => {
      routeUserHasPermission.mockResolvedValue(false);

      const { response } = await del(PAYMENT_ID);

      expect(response.status).toBe(403);
      expect(routeUserHasPermission).toHaveBeenCalledWith(db.client, ACTOR_ID, "delete_payments");
      expect(db.writes()).toHaveLength(0);
    });

    it("returns 404 when the payment is not visible in the actor's school/branch scope", async () => {
      setup({ lookup: { data: null, error: null } });

      const { response } = await del(PAYMENT_ID);

      expect(response.status).toBe(404);
      const lookup = db.queriesFor("payments")[0];
      expect(lookup.argsOf("eq")).toEqual(
        expect.arrayContaining([
          ["id", PAYMENT_ID],
          ["school_id", SCHOOL_ID],
          ["branch_id", BRANCH_ID],
        ]),
      );
      expect(db.writes()).toHaveLength(0);
    });

    it("returns 404 for an already-deleted payment and does not update it again", async () => {
      setup({ lookup: { data: { id: PAYMENT_ID, student_id: STUDENT_ID, deleted_at: "2026-01-01T00:00:00Z" } } });

      const { response } = await del(PAYMENT_ID);

      expect(response.status).toBe(404);
      expect(db.writes()).toHaveLength(0);
    });
  });

  describe("soft delete", () => {
    it("soft-deletes within the actor's school and branch and returns the recomputed balance", async () => {
      const { response, payload } = await del(PAYMENT_ID);

      expect(response.status).toBe(200);
      const update = paymentUpdate();
      expect(update).toBeDefined();
      // Soft delete only: never a hard DELETE.
      expect(update!.argsOf("delete")).toHaveLength(0);
      expect(update!.argsOf("update")[0][0]).toMatchObject({
        deleted_at: expect.any(String),
        deleted_by: ACTOR_ID,
      });
      expect(update!.argsOf("eq")).toEqual([
        ["id", PAYMENT_ID],
        ["school_id", SCHOOL_ID],
        ["branch_id", BRANCH_ID],
      ]);

      expect(payload).toEqual({
        ok: true,
        deletedPaymentId: PAYMENT_ID,
        studentId: STUDENT_ID,
        studentUpdate: {
          id: STUDENT_ID,
          paid_fee: 500,
          remaining_fee: 500,
          total_fee: 1000,
          discount_value: 0,
        },
      });
      expect(invalidateSchoolCacheDomains).toHaveBeenCalledWith(SCHOOL_ID, expect.arrayContaining(["payments-list"]));
    });

    it("restricts a multi-branch actor's update to their branches", async () => {
      setup({ actorBranchId: null, allowedBranchIds: [BRANCH_ID, OTHER_BRANCH_ID] });

      const { response } = await del(PAYMENT_ID);

      expect(response.status).toBe(200);
      expect(paymentUpdate()!.argsOf("in")).toEqual([["branch_id", [BRANCH_ID, OTHER_BRANCH_ID]]]);
    });

    it("does not add a branch filter for a school-wide actor", async () => {
      setup({ actorBranchId: null, allowedBranchIds: [] });

      const { response } = await del(PAYMENT_ID);

      expect(response.status).toBe(200);
      const update = paymentUpdate()!;
      expect(update.argsOf("in")).toHaveLength(0);
      expect(update.argsOf("eq")).toEqual([
        ["id", PAYMENT_ID],
        ["school_id", SCHOOL_ID],
      ]);
    });

    it("returns 500 when the update fails", async () => {
      setup({ update: { error: { code: "42501", message: "new row violates row-level security policy" } } });

      const { response } = await del(PAYMENT_ID);

      expect(response.status).toBe(500);
      expect(invalidateSchoolCacheDomains).not.toHaveBeenCalled();
    });

    it("returns 202 with a warning when the balance reload fails after deleting", async () => {
      setup({ student: { data: null, error: { message: "timeout" } } });

      const { response, payload } = await del(PAYMENT_ID);

      expect(response.status).toBe(202);
      expect(payload).toMatchObject({ ok: true, deletedPaymentId: PAYMENT_ID, warning: expect.any(String) });
    });
  });
});
