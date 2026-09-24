import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ACTOR_ID,
  BRANCH_ID,
  OTHER_BRANCH_ID,
  OTHER_SCHOOL_ID,
  SCHOOL_ID,
  STUDENT_ID,
  createSupabaseMock,
  type QueryResult,
} from "./_helpers/supabase-query-mock";

const resolveSchoolScopedActorContext = vi.fn();
const enforceRateLimit = vi.fn();
const routeUserHasPermission = vi.fn();
const invalidateSchoolCacheDomains = vi.fn();
const createServiceSupabaseClient = vi.fn();
const notifyPayment = vi.fn();

vi.mock("@/lib/managed-users-server", () => ({ resolveSchoolScopedActorContext }));
vi.mock("@/lib/rate-limit", () => ({ enforceRateLimit }));
vi.mock("@/lib/route-permissions", () => ({ routeUserHasPermission }));
vi.mock("@/lib/server-cache", () => ({ invalidateSchoolCacheDomains }));
vi.mock("@/lib/supabase-server", () => ({ createServiceSupabaseClient }));
vi.mock("@/lib/notify-events", () => ({ notifyPayment }));

const RPC_ROW = {
  id: "66666666-6666-4666-8666-666666666666",
  school_id: SCHOOL_ID,
  branch_id: BRANCH_ID,
  student_id: STUDENT_ID,
  amount: 250,
  payment_method: "cash",
  notes: null,
  created_at: "2026-09-01T00:00:00.000Z",
  receipt_number: "R-100",
  manual_receipt_number: null,
  paid_fee_after: 750,
  remaining_fee_after: 250,
  error_code: null,
};

let actorDb: ReturnType<typeof createSupabaseMock>;
let serviceDb: ReturnType<typeof createSupabaseMock>;

function setup(options: {
  student?: QueryResult;
  rpc?: QueryResult;
  allowedBranchIds?: string[];
  actorBranchId?: string | null;
} = {}) {
  actorDb = createSupabaseMock({
    students: options.student ?? { data: { id: STUDENT_ID, school_id: SCHOOL_ID, branch_id: BRANCH_ID } },
    payments: { data: { verification_token: "tok-1" } },
  });
  serviceDb = createSupabaseMock({}, options.rpc ?? { data: [RPC_ROW] });
  createServiceSupabaseClient.mockReturnValue(serviceDb.client);

  // Mirror the real resolver: only the actor's own school is accepted.
  resolveSchoolScopedActorContext.mockImplementation(async (schoolId: string | null) =>
    schoolId === SCHOOL_ID
      ? {
          ok: true,
          value: {
            actorSupabase: actorDb.client,
            actorUserId: ACTOR_ID,
            targetSchoolId: SCHOOL_ID,
            actorBranchId: options.actorBranchId === undefined ? BRANCH_ID : options.actorBranchId,
            allowedBranchIds: options.allowedBranchIds ?? [BRANCH_ID],
          },
        }
      : { ok: false, status: 403, message: "school forbidden" },
  );
}

function buildRequest(body: unknown) {
  return new NextRequest("http://localhost/api/web/payments/records", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer token" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const validBody = {
  school_id: SCHOOL_ID,
  student_id: STUDENT_ID,
  amount: 250,
  payment_method: "cash",
};

async function post(body: unknown) {
  const { POST } = await import("@/app/api/web/payments/records/route");
  const response = await POST(buildRequest(body));
  return { response, payload: await response.json() };
}

describe("POST /api/web/payments/records", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    enforceRateLimit.mockResolvedValue(null);
    routeUserHasPermission.mockResolvedValue(true);
    notifyPayment.mockResolvedValue(undefined);
    setup();
  });

  describe("validation", () => {
    it.each([
      ["non-JSON body", "not-json"],
      ["missing student_id", { school_id: SCHOOL_ID, amount: 10 }],
      ["zero amount", { ...validBody, amount: 0 }],
      ["negative amount", { ...validBody, amount: -5 }],
      ["non-numeric amount", { ...validBody, amount: "abc" }],
      ["unknown payment method", { ...validBody, payment_method: "crypto" }],
      ["malformed school id", { ...validBody, school_id: "not-a-uuid" }],
    ])("rejects %s with 400 before authorizing", async (_label, body) => {
      const { response } = await post(body);

      expect(response.status).toBe(400);
      expect(resolveSchoolScopedActorContext).not.toHaveBeenCalled();
      expect(serviceDb.rpc).not.toHaveBeenCalled();
    });
  });

  describe("authorization", () => {
    it("returns 401 for an unauthenticated caller and writes nothing", async () => {
      resolveSchoolScopedActorContext.mockResolvedValue({ ok: false, status: 401, message: "login required" });

      const { response, payload } = await post(validBody);

      expect(response.status).toBe(401);
      expect(payload.error.message).toBe("login required");
      expect(serviceDb.rpc).not.toHaveBeenCalled();
      expect(actorDb.from).not.toHaveBeenCalled();
    });

    it("returns 403 for a role outside super_admin/admin/employee", async () => {
      resolveSchoolScopedActorContext.mockResolvedValue({ ok: false, status: 403, message: "role denied" });

      const { response } = await post(validBody);

      expect(response.status).toBe(403);
      expect(resolveSchoolScopedActorContext).toHaveBeenCalledWith(
        SCHOOL_ID,
        expect.objectContaining({ allowedRoles: ["super_admin", "admin", "employee"] }),
        "Bearer token",
      );
      expect(serviceDb.rpc).not.toHaveBeenCalled();
    });

    it("rejects a payment for another school", async () => {
      const { response } = await post({ ...validBody, school_id: OTHER_SCHOOL_ID });

      expect(response.status).toBe(403);
      expect(createServiceSupabaseClient).not.toHaveBeenCalled();
      expect(serviceDb.rpc).not.toHaveBeenCalled();
    });

    it("returns 403 without add_payments permission", async () => {
      routeUserHasPermission.mockResolvedValue(false);

      const { response } = await post(validBody);

      expect(response.status).toBe(403);
      expect(routeUserHasPermission).toHaveBeenCalledWith(actorDb.client, ACTOR_ID, "add_payments");
      expect(serviceDb.rpc).not.toHaveBeenCalled();
      expect(invalidateSchoolCacheDomains).not.toHaveBeenCalled();
    });

    it("returns the rate-limit response untouched", async () => {
      enforceRateLimit.mockResolvedValue(new Response("slow down", { status: 429 }));
      const { POST } = await import("@/app/api/web/payments/records/route");

      const response = await POST(buildRequest(validBody));

      expect(response.status).toBe(429);
      expect(serviceDb.rpc).not.toHaveBeenCalled();
    });

    it("returns 404 when the student is not in the actor's school", async () => {
      setup({ student: { data: null, error: null } });

      const { response } = await post(validBody);

      expect(response.status).toBe(404);
      expect(actorDb.queriesFor("students")[0].argsOf("eq")).toContainEqual(["school_id", SCHOOL_ID]);
      expect(serviceDb.rpc).not.toHaveBeenCalled();
    });

    it("returns 403 when the student belongs to a branch the actor cannot access", async () => {
      setup({ student: { data: { id: STUDENT_ID, school_id: SCHOOL_ID, branch_id: OTHER_BRANCH_ID } } });

      const { response } = await post(validBody);

      expect(response.status).toBe(403);
      expect(serviceDb.rpc).not.toHaveBeenCalled();
    });
  });

  describe("happy path", () => {
    it("calls create_payment_atomic with the actor's school and the student's real branch", async () => {
      const { response, payload } = await post({
        ...validBody,
        // Client-supplied values that must NOT reach the RPC.
        branch_id: OTHER_BRANCH_ID,
        receipt_number: "CLIENT-1",
        notes: "  first installment  ",
      });

      expect(response.status).toBe(200);
      expect(serviceDb.rpc).toHaveBeenCalledTimes(1);
      const [rpcName, rpcArgs] = serviceDb.rpc.mock.calls[0];
      expect(rpcName).toBe("create_payment_atomic");
      expect(rpcArgs).toMatchObject({
        p_school_id: SCHOOL_ID,
        p_student_id: STUDENT_ID,
        p_branch_id: BRANCH_ID,
        p_amount: 250,
        p_payment_method: "cash",
        p_notes: "first installment",
        // Canonical receipt numbers are always DB-assigned.
        p_receipt_number: null,
        p_manual_receipt_number: "CLIENT-1",
      });
      // The RPC must run on the service client, never the actor's client.
      expect(actorDb.rpc).not.toHaveBeenCalled();

      expect(payload).toEqual({
        ok: true,
        payment: {
          id: RPC_ROW.id,
          school_id: SCHOOL_ID,
          branch_id: BRANCH_ID,
          student_id: STUDENT_ID,
          amount: 250,
          payment_method: "cash",
          notes: null,
          created_at: RPC_ROW.created_at,
          receipt_number: "R-100",
          manual_receipt_number: null,
          verification_token: "tok-1",
        },
        studentUpdate: { id: STUDENT_ID, paid_fee: 750, remaining_fee: 250 },
      });
      expect(invalidateSchoolCacheDomains).toHaveBeenCalledWith(SCHOOL_ID, expect.arrayContaining(["payments-meta"]));
    });

    it("uses the resolved target school rather than the raw client value", async () => {
      const canonicalSchoolId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
      resolveSchoolScopedActorContext.mockResolvedValue({
        ok: true,
        value: {
          actorSupabase: actorDb.client,
          actorUserId: ACTOR_ID,
          targetSchoolId: canonicalSchoolId,
          actorBranchId: null,
          allowedBranchIds: [],
        },
      });

      const { response } = await post(validBody);

      expect(response.status).toBe(200);
      expect(serviceDb.rpc.mock.calls[0][1]).toMatchObject({ p_school_id: canonicalSchoolId });
      expect(actorDb.queriesFor("students")[0].argsOf("eq")).toContainEqual(["school_id", canonicalSchoolId]);
    });

    it("falls back to the actor's branch when the student has no branch", async () => {
      setup({ student: { data: { id: STUDENT_ID, school_id: SCHOOL_ID, branch_id: null } } });

      const { response } = await post(validBody);

      expect(response.status).toBe(200);
      expect(serviceDb.rpc.mock.calls[0][1]).toMatchObject({ p_branch_id: BRANCH_ID });
    });
  });

  describe("RPC error mapping", () => {
    it.each([
      ["STUDENT_NOT_FOUND", 404, undefined],
      ["DUPLICATE_PAYMENT", 409, "DUPLICATE_PAYMENT"],
      ["PAID_IN_FULL", 400, "PAID_IN_FULL"],
      ["PAYMENT_EXCEEDS_REMAINING", 400, "PAYMENT_EXCEEDS_REMAINING"],
      ["SOMETHING_NEW", 500, undefined],
    ])("maps error_code %s to HTTP %i", async (errorCode, status, code) => {
      setup({ rpc: { data: [{ ...RPC_ROW, error_code: errorCode }] } });

      const { response, payload } = await post(validBody);

      expect(response.status).toBe(status);
      if (code) {
        expect(payload.error.code).toBe(code);
      }
      expect(payload.ok).toBeUndefined();
      expect(invalidateSchoolCacheDomains).not.toHaveBeenCalled();
    });

    it("maps a Postgres unique violation (23505) to 409 DUPLICATE_PAYMENT", async () => {
      setup({ rpc: { data: null, error: { code: "23505", message: "duplicate key" } } });

      const { response, payload } = await post(validBody);

      expect(response.status).toBe(409);
      expect(payload.error.code).toBe("DUPLICATE_PAYMENT");
    });

    it("returns 500 without leaking the DB message for other RPC errors", async () => {
      setup({ rpc: { data: null, error: { code: "XX000", message: "internal secret detail" } } });

      const { response, payload } = await post(validBody);

      expect(response.status).toBe(500);
      expect(JSON.stringify(payload)).not.toContain("internal secret detail");
    });

    it("returns 500 when the RPC returns no row", async () => {
      setup({ rpc: { data: [] } });

      const { response } = await post(validBody);

      expect(response.status).toBe(500);
      expect(invalidateSchoolCacheDomains).not.toHaveBeenCalled();
    });
  });
});
