import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveSchoolScopedActorContext = vi.fn();
const routeUserHasPermission = vi.fn();

vi.mock("@/lib/managed-users-server", () => ({ resolveSchoolScopedActorContext }));
vi.mock("@/lib/rate-limit", () => ({ enforceRateLimit: vi.fn(async () => null) }));
vi.mock("@/lib/route-permissions", () => ({ routeUserHasPermission }));
vi.mock("@/lib/server-cache", () => ({ invalidateSchoolCacheDomains: vi.fn() }));
vi.mock("@/lib/branch-scope", () => ({
  applyBranchScopeToQuery: (query: unknown) => query,
  resolveBranchScope: () => ({ ok: true, value: { branchId: null, branchIds: [], cacheKeySuffix: "all" } }),
}));

const SCHOOL = "11111111-1111-4111-8111-111111111111";
const PAYMENT = "22222222-2222-4222-8222-222222222222";

function fakeSupabase(opts: { auditedAt: string | null; deletedRows: unknown[] }) {
  const updates: unknown[] = [];
  function from(table: string) {
    const chain: Record<string, unknown> = {};
    let isUpdate = false;
    for (const op of ["eq", "is", "in"]) chain[op] = () => chain;
    chain.select = () => chain;
    chain.update = (payload: unknown) => {
      isUpdate = true;
      updates.push({ table, payload });
      return chain;
    };
    chain.maybeSingle = async () =>
      table === "payments"
        ? { data: { id: PAYMENT, student_id: "s1", deleted_at: null, audited_at: opts.auditedAt }, error: null }
        : { data: { id: "s1", paid_fee: 0, remaining_fee: 0 }, error: null };
    chain.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve(resolve(isUpdate ? { data: opts.deletedRows, error: null } : { data: [], error: null }));
    return chain;
  }
  return { client: { from }, updates };
}

function request(method: "PATCH" | "DELETE", body: Record<string, unknown>) {
  return new NextRequest(`http://localhost/api/web/payments/records/${PAYMENT}`, {
    method,
    body: JSON.stringify({ school_id: SCHOOL, ...body }),
  });
}

async function load(fake: ReturnType<typeof fakeSupabase>) {
  resolveSchoolScopedActorContext.mockResolvedValue({
    ok: true,
    value: { actorSupabase: fake.client, actorUserId: "u1", targetSchoolId: SCHOOL },
  });
  return import("@/app/api/web/payments/records/[paymentId]/route");
}

const ctx = { params: Promise.resolve({ paymentId: PAYMENT }) };

describe("payment record route", () => {
  beforeEach(() => {
    vi.resetModules();
    routeUserHasPermission.mockReset().mockResolvedValue(true);
  });

  it("applies the requested audit state instead of toggling", async () => {
    const fake = fakeSupabase({ auditedAt: "2026-09-01T10:00:00Z", deletedRows: [] });
    const { PATCH } = await load(fake);
    // Already audited + a second "audit" click must keep it audited.
    const res = await PATCH(request("PATCH", { audited: true }), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.audited_at).toBe("2026-09-01T10:00:00Z");
  });

  it("refuses auditing without a payments permission", async () => {
    routeUserHasPermission.mockResolvedValue(false);
    const { PATCH } = await load(fakeSupabase({ auditedAt: null, deletedRows: [] }));
    const res = await PATCH(request("PATCH", { audited: true }), ctx);
    expect(res.status).toBe(403);
  });

  it("reports a delete that matched no row instead of claiming success", async () => {
    const { DELETE } = await load(fakeSupabase({ auditedAt: null, deletedRows: [] }));
    const res = await DELETE(request("DELETE", {}), ctx);
    expect(res.status).toBe(409);
  });
});
