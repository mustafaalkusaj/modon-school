import { NextRequest, NextResponse } from "next/server";
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

const resolveAdminMobileRouteContext = vi.fn();

vi.mock("@/lib/mobile-admin-server", () => ({ resolveAdminMobileRouteContext }));

const RPC_ROW = {
  id: "66666666-6666-4666-8666-666666666666",
  receipt_number: "R-7",
  paid_fee_after: 600,
  remaining_fee_after: 400,
  error_code: null,
};

let db: ReturnType<typeof createSupabaseMock>;

function setup(options: { student?: QueryResult; rpc?: QueryResult; tables?: Record<string, QueryResult> } = {}) {
  db = createSupabaseMock(
    {
      students: options.student ?? { data: { id: STUDENT_ID, branch_id: BRANCH_ID } },
      ...options.tables,
    },
    options.rpc ?? { data: [RPC_ROW] },
  );
  resolveAdminMobileRouteContext.mockResolvedValue({
    ok: true,
    value: {
      authUserId: ACTOR_ID,
      schoolId: SCHOOL_ID,
      branchId: OTHER_BRANCH_ID,
      role: "admin",
      serviceSupabase: db.client,
    },
  });
}

function denied(status: number) {
  return { ok: false, response: NextResponse.json({ ok: false, error: "denied" }, { status }) };
}

async function post(body: unknown) {
  const { POST } = await import("@/app/api/mobile/admin/payments/route");
  const request = new NextRequest("http://localhost/api/mobile/admin/payments", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer token" },
    body: JSON.stringify(body),
  });
  const response = await POST(request);
  return { response, payload: await response.json() };
}

const validBody = { student_id: STUDENT_ID, amount: 100, payment_method: "bank_transfer" };

describe("POST /api/mobile/admin/payments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setup();
  });

  it.each([
    [401, "unauthenticated"],
    [403, "non-admin / deactivated / expired school"],
  ])("returns the context's %i (%s) and writes nothing", async (status) => {
    resolveAdminMobileRouteContext.mockResolvedValue(denied(status));

    const { response } = await post(validBody);

    expect(response.status).toBe(status);
    expect(db.from).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["missing student_id", { amount: 100 }],
    ["zero amount", { student_id: STUDENT_ID, amount: 0 }],
    ["negative amount", { student_id: STUDENT_ID, amount: -1 }],
    ["non-numeric amount", { student_id: STUDENT_ID, amount: "abc" }],
  ])("rejects %s with 400", async (_label, body) => {
    const { response } = await post(body);

    expect(response.status).toBe(400);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("returns 404 when the student is not an active student of the admin's school", async () => {
    setup({ student: { data: null } });

    const { response } = await post(validBody);

    expect(response.status).toBe(404);
    const lookup = db.queriesFor("students")[0];
    expect(lookup.argsOf("eq")).toEqual([
      ["id", STUDENT_ID],
      ["school_id", SCHOOL_ID],
    ]);
    expect(lookup.argsOf("is")).toContainEqual(["deleted_at", null]);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("records the payment with the admin's school, ignoring a client-supplied school_id", async () => {
    const { response, payload } = await post({
      ...validBody,
      school_id: OTHER_SCHOOL_ID,
      receipt_number: "CLIENT-RECEIPT",
      manual_receipt_number: "  M-1  ",
      notes: "  note  ",
    });

    expect(response.status).toBe(200);
    expect(db.rpc).toHaveBeenCalledTimes(1);
    const [name, args] = db.rpc.mock.calls[0];
    expect(name).toBe("create_payment_atomic");
    expect(args).toMatchObject({
      p_school_id: SCHOOL_ID,
      p_student_id: STUDENT_ID,
      // The student's own branch wins over the admin's default branch.
      p_branch_id: BRANCH_ID,
      p_amount: 100,
      p_payment_method: "bank_transfer",
      p_notes: "note",
      p_receipt_number: null,
      p_manual_receipt_number: "M-1",
    });
    expect(payload).toEqual({
      ok: true,
      id: RPC_ROW.id,
      receipt_number: "R-7",
      paid_fee: 600,
      remaining_fee: 400,
    });
  });

  it("falls back to cash for an unknown payment method and to the admin branch for branchless students", async () => {
    setup({ student: { data: { id: STUDENT_ID, branch_id: null } } });

    await post({ ...validBody, payment_method: "crypto" });

    expect(db.rpc.mock.calls[0][1]).toMatchObject({ p_payment_method: "cash", p_branch_id: OTHER_BRANCH_ID });
  });

  it.each([
    ["STUDENT_NOT_FOUND", 404],
    ["DUPLICATE_PAYMENT", 409],
    ["PAID_IN_FULL", 409],
    ["PAYMENT_EXCEEDS_REMAINING", 400],
  ])("maps RPC error_code %s to HTTP %i", async (errorCode, status) => {
    setup({ rpc: { data: [{ ...RPC_ROW, error_code: errorCode }] } });

    const { response, payload } = await post(validBody);

    expect(response.status).toBe(status);
    expect(payload.ok).toBe(false);
  });

  it("tells the admin when the payment exceeds the remaining fee", async () => {
    setup({ rpc: { data: [{ ...RPC_ROW, error_code: "PAYMENT_EXCEEDS_REMAINING" }] } });

    const { payload } = await post(validBody);

    expect(payload.error).toBe("قيمة الدفعة أكبر من المبلغ المتبقي.");
  });

  it("maps a unique violation (23505) to 409", async () => {
    setup({ rpc: { data: null, error: { code: "23505" } } });

    const { response } = await post(validBody);

    expect(response.status).toBe(409);
  });

  it("returns 500 for other RPC errors or an empty result", async () => {
    setup({ rpc: { data: null, error: { code: "XX000", message: "secret" } } });
    const failed = await post(validBody);
    expect(failed.response.status).toBe(500);
    expect(JSON.stringify(failed.payload)).not.toContain("secret");

    setup({ rpc: { data: [] } });
    const empty = await post(validBody);
    expect(empty.response.status).toBe(500);
  });
});

describe("GET /api/mobile/admin/payments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function get(query = "") {
    const { GET } = await import("@/app/api/mobile/admin/payments/route");
    const response = await GET(new NextRequest(`http://localhost/api/mobile/admin/payments${query}`));
    return { response, payload: await response.json() };
  }

  it("returns the context's error response for unauthorized callers", async () => {
    setup();
    resolveAdminMobileRouteContext.mockResolvedValue(denied(401));

    const { response } = await get();

    expect(response.status).toBe(401);
    expect(db.from).not.toHaveBeenCalled();
  });

  it("lists balances for the admin's school only, with clamped pagination", async () => {
    setup({
      tables: {
        student_payments: {
          data: [{ id: "sp1", student_id: STUDENT_ID, full_name: "طالب", total_fee: "1000", paid_fee: 600, remaining_fee: 400 }],
          count: 1,
        },
      },
    });

    const { response, payload } = await get("?page=0&limit=1000&search=%20abc%20");

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ ok: true, total: 1, page: 1, limit: 200 });
    expect(payload.items[0]).toMatchObject({ total_fee: 1000, paid_fee: 600, remaining_fee: 400 });
    const query = db.queriesFor("student_payments")[0];
    expect(query.argsOf("eq")).toEqual([["school_id", SCHOOL_ID]]);
    expect(query.argsOf("ilike")).toEqual([["full_name", "%abc%"]]);
    expect(query.argsOf("range")).toEqual([[0, 199]]);
  });

  it("falls back to the students table, still scoped to the admin's school", async () => {
    setup({
      tables: {
        student_payments: { data: null, error: { message: "relation does not exist" } },
      },
      student: { data: [{ id: STUDENT_ID, full_name: "طالب", total_fee: 500, paid_fee: 0, remaining_fee: 500 }], count: 1 },
    });

    const { response, payload } = await get();

    expect(response.status).toBe(200);
    expect(payload.items[0]).toMatchObject({ id: STUDENT_ID, student_id: STUDENT_ID, remaining_fee: 500 });
    const query = db.queriesFor("students")[0];
    expect(query.argsOf("eq")).toEqual([["school_id", SCHOOL_ID]]);
    expect(query.argsOf("is")).toContainEqual(["deleted_at", null]);
  });
});
