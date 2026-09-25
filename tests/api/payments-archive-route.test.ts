import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { compressArchiveData, decompressArchiveData } from "@/lib/payments/archive-compression";

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

vi.mock("@/lib/managed-users-server", () => ({ resolveSchoolScopedActorContext }));
vi.mock("@/lib/rate-limit", () => ({ enforceRateLimit }));
vi.mock("@/lib/route-permissions", () => ({ routeUserHasPermission }));
vi.mock("@/lib/server-cache", () => ({ invalidateSchoolCacheDomains }));

const ARCHIVE_ID = "77777777-7777-4777-8777-777777777777";
const ARCHIVE_YEAR = new Date().getFullYear() - 1;

let db: ReturnType<typeof createSupabaseMock>;

function mockActor(options: { allowedBranchIds?: string[]; actorBranchId?: string | null } = {}) {
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

function jsonRequest(method: string, body: unknown) {
  return new NextRequest("http://localhost/api/web/payments/archive", {
    method,
    headers: { "content-type": "application/json", authorization: "Bearer token" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  enforceRateLimit.mockResolvedValue(null);
  routeUserHasPermission.mockResolvedValue(true);
  db = createSupabaseMock();
  mockActor();
});

describe("POST /api/web/payments/archive", () => {
  function setupArchiveDb(overrides: {
    archiveCount?: number;
    existingForYear?: QueryResult;
    payments?: QueryResult;
    promotionUpdate?: QueryResult;
  } = {}) {
    db = createSupabaseMock({
      account_archives: [
        { count: overrides.archiveCount ?? 0 },
        ...(overrides.archiveCount !== undefined && overrides.archiveCount >= 5
          ? [overrides.existingForYear ?? { data: null }]
          : []),
        { data: null }, // existing archive for the year
        { data: { id: ARCHIVE_ID, school_id: SCHOOL_ID, archive_year: ARCHIVE_YEAR } }, // insert
      ],
      payments: overrides.payments ?? {
        data: [
          { id: "p1", student_id: STUDENT_ID, amount: 300 },
          { id: "p2", student_id: STUDENT_ID, amount: 200 },
        ],
      },
      students: [
        { data: [{ id: STUDENT_ID, full_name: "طالب", class_name: "الأول" }] },
        { data: [{ id: STUDENT_ID, class_name: "الأول", status: "active" }] },
        overrides.promotionUpdate ?? { data: null, error: null },
      ],
    });
    mockActor();
  }

  async function post(body: unknown) {
    const { POST } = await import("@/app/api/web/payments/archive/route");
    const response = await POST(jsonRequest("POST", body));
    return { response, payload: await response.json() };
  }

  const validBody = { school_id: SCHOOL_ID, archive_year: ARCHIVE_YEAR };

  it.each([
    ["missing school", { archive_year: ARCHIVE_YEAR }],
    ["non-integer year", { school_id: SCHOOL_ID, archive_year: 2024.5 }],
    ["future year", { school_id: SCHOOL_ID, archive_year: new Date().getFullYear() + 1 }],
    ["zero year", { school_id: SCHOOL_ID, archive_year: 0 }],
  ])("rejects %s with 400", async (_label, body) => {
    const { response } = await post(body);

    expect(response.status).toBe(400);
    expect(resolveSchoolScopedActorContext).not.toHaveBeenCalled();
  });

  it("returns 401 for an unauthenticated caller", async () => {
    resolveSchoolScopedActorContext.mockResolvedValue({ ok: false, status: 401, message: "login required" });

    const { response } = await post(validBody);

    expect(response.status).toBe(401);
    expect(db.from).not.toHaveBeenCalled();
  });

  it("rejects archiving another school", async () => {
    const { response } = await post({ ...validBody, school_id: OTHER_SCHOOL_ID });

    expect(response.status).toBe(403);
    expect(db.from).not.toHaveBeenCalled();
  });

  it("requires delete_payments permission", async () => {
    routeUserHasPermission.mockResolvedValue(false);

    const { response } = await post(validBody);

    expect(response.status).toBe(403);
    expect(routeUserHasPermission).toHaveBeenCalledWith(db.client, ACTOR_ID, "delete_payments");
    expect(db.from).not.toHaveBeenCalled();
  });

  it("rejects archiving a branch outside the actor's scope", async () => {
    const { response } = await post({ ...validBody, branch_id: OTHER_BRANCH_ID });

    expect(response.status).toBe(403);
    expect(db.from).not.toHaveBeenCalled();
  });

  it("returns 400 when the year has no payments and writes nothing", async () => {
    setupArchiveDb({ payments: { data: [] } });

    const { response } = await post(validBody);

    expect(response.status).toBe(400);
    expect(db.writes()).toHaveLength(0);
  });

  it("blocks a sixth archive for a new year", async () => {
    setupArchiveDb({ archiveCount: 5, existingForYear: { data: null } });

    const { response } = await post(validBody);

    expect(response.status).toBe(400);
    expect(db.queriesFor("payments")).toHaveLength(0);
    expect(db.writes()).toHaveLength(0);
  });

  it("archives the year within the actor's school/branch and promotes students", async () => {
    setupArchiveDb();

    const { response, payload } = await post(validBody);

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ ok: true, created: true, archive: { id: ARCHIVE_ID } });

    const paymentsQuery = db.queriesFor("payments")[0];
    expect(paymentsQuery.argsOf("eq")).toEqual(
      expect.arrayContaining([
        ["school_id", SCHOOL_ID],
        ["branch_id", BRANCH_ID],
      ]),
    );
    expect(paymentsQuery.argsOf("is")).toContainEqual(["deleted_at", null]);

    const promotion = db.queriesFor("students").find((query) => query.isWrite())!;
    expect(promotion.argsOf("update")[0][0]).toEqual({ class_name: expect.any(String) });
    expect(promotion.argsOf("eq")).toContainEqual(["school_id", SCHOOL_ID]);
    expect(promotion.argsOf("in")).toContainEqual(["id", [STUDENT_ID]]);

    const insert = db.queriesFor("account_archives").find((query) => query.isWrite())!;
    const inserted = insert.argsOf("insert")[0][0] as Record<string, unknown>;
    expect(inserted).toMatchObject({
      school_id: SCHOOL_ID,
      branch_id: BRANCH_ID,
      archive_year: ARCHIVE_YEAR,
      total_students: 1,
      total_payments: 2,
      total_amount: 500,
    });
    expect(decompressArchiveData(inserted.data)).toMatchObject({ year: ARCHIVE_YEAR });
    expect(invalidateSchoolCacheDomains).toHaveBeenCalledWith(SCHOOL_ID, expect.any(Array));
  });

  it("does not save the archive when the student promotion fails", async () => {
    setupArchiveDb({ promotionUpdate: { error: { message: "boom" } } });

    const { response } = await post(validBody);

    expect(response.status).toBe(500);
    expect(db.queriesFor("account_archives").some((query) => query.isWrite())).toBe(false);
    expect(invalidateSchoolCacheDomains).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/web/payments/archive", () => {
  async function patch(body: unknown) {
    const { PATCH } = await import("@/app/api/web/payments/archive/route");
    const response = await PATCH(jsonRequest("PATCH", body));
    return { response, payload: await response.json() };
  }

  const validBody = {
    archive_id: ARCHIVE_ID,
    school_id: SCHOOL_ID,
    data: {
      students: [{ id: STUDENT_ID, full_name: "طالب", total_fee: 1000, paid_fee: 400, discount_value: 100 }],
      payments: [
        { id: "p1", student_id: STUDENT_ID, amount: 400, payment_method: "bitcoin" },
      ],
    },
  };

  function setupPatchDb(lookup: QueryResult = {
    data: {
      id: ARCHIVE_ID,
      archive_year: ARCHIVE_YEAR,
      branch_id: BRANCH_ID,
      data: compressArchiveData({ summary: { student_promotion: { promoted: 3 } } }),
    },
  }) {
    db = createSupabaseMock({
      account_archives: [lookup, { data: { id: ARCHIVE_ID, school_id: SCHOOL_ID } }],
    });
    mockActor();
  }

  it("rejects an invalid archive id with 400", async () => {
    const { response } = await patch({ ...validBody, archive_id: "nope" });

    expect(response.status).toBe(400);
    expect(resolveSchoolScopedActorContext).not.toHaveBeenCalled();
  });

  it("rejects a payload without data with 400", async () => {
    const { response } = await patch({ archive_id: ARCHIVE_ID, school_id: SCHOOL_ID });

    expect(response.status).toBe(400);
  });

  it("rejects editing another school's archive", async () => {
    const { response } = await patch({ ...validBody, school_id: OTHER_SCHOOL_ID });

    expect(response.status).toBe(403);
    expect(db.from).not.toHaveBeenCalled();
  });

  it("requires delete_payments permission", async () => {
    routeUserHasPermission.mockResolvedValue(false);

    const { response } = await patch(validBody);

    expect(response.status).toBe(403);
    expect(db.from).not.toHaveBeenCalled();
  });

  it("returns 404 when the archive is not in the actor's school", async () => {
    setupPatchDb({ data: null });

    const { response } = await patch(validBody);

    expect(response.status).toBe(404);
    expect(db.queriesFor("account_archives")[0].argsOf("eq")).toContainEqual(["school_id", SCHOOL_ID]);
    expect(db.writes()).toHaveLength(0);
  });

  it("recomputes totals and updates the snapshot scoped to the actor's school", async () => {
    setupPatchDb();

    const { response, payload } = await patch(validBody);

    expect(response.status).toBe(200);
    const update = db.queriesFor("account_archives").find((query) => query.isWrite())!;
    const written = update.argsOf("update")[0][0] as Record<string, unknown>;
    expect(written).toMatchObject({
      total_students: 1,
      total_payments: 1,
      total_amount: 400,
      updated_by: ACTOR_ID,
    });
    expect(update.argsOf("eq")).toEqual([
      ["id", ARCHIVE_ID],
      ["school_id", SCHOOL_ID],
    ]);

    // Sanitized snapshot: remaining recomputed, unknown payment method coerced, promotion summary kept.
    expect(payload.archive.data.students[0]).toMatchObject({ remaining_fee: 500 });
    expect(payload.archive.data.payments[0]).toMatchObject({ payment_method: "cash" });
    expect(payload.archive.data.summary.student_promotion).toEqual({ promoted: 3 });
  });
});

describe("GET /api/web/payments/archive", () => {
  async function get(query: string) {
    const { GET } = await import("@/app/api/web/payments/archive/route");
    const response = await GET(new NextRequest(`http://localhost/api/web/payments/archive?${query}`));
    return { response, payload: await response.json() };
  }

  it("rejects an invalid archive id with 400", async () => {
    const { response } = await get(`archiveId=bad&schoolId=${SCHOOL_ID}`);

    expect(response.status).toBe(400);
  });

  it("rejects reading another school's archive", async () => {
    const { response } = await get(`archiveId=${ARCHIVE_ID}&schoolId=${OTHER_SCHOOL_ID}`);

    expect(response.status).toBe(403);
    expect(db.from).not.toHaveBeenCalled();
  });

  it("scopes the lookup to the actor's school and branch and decompresses data", async () => {
    db = createSupabaseMock({
      account_archives: {
        data: { id: ARCHIVE_ID, school_id: SCHOOL_ID, branch_id: BRANCH_ID, data: compressArchiveData({ year: 2025 }) },
      },
    });
    mockActor();

    const { response, payload } = await get(`archiveId=${ARCHIVE_ID}&schoolId=${SCHOOL_ID}`);

    expect(response.status).toBe(200);
    expect(payload.archive.data).toEqual({ year: 2025 });
    expect(db.queriesFor("account_archives")[0].argsOf("eq")).toEqual([
      ["id", ARCHIVE_ID],
      ["school_id", SCHOOL_ID],
      ["branch_id", BRANCH_ID],
    ]);
  });
});
