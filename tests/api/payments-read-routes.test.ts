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
const exportPaymentStudents = vi.fn();
const parsePaymentsListFilters = vi.fn();
const buildStyledWorkbook = vi.fn();

vi.mock("@/lib/managed-users-server", () => ({ resolveSchoolScopedActorContext }));
vi.mock("@/lib/rate-limit", () => ({ enforceRateLimit }));
vi.mock("@/lib/route-permissions", () => ({ routeUserHasPermission }));
vi.mock("@/lib/payments/overview", () => ({ exportPaymentStudents, parsePaymentsListFilters }));
vi.mock("@/lib/excel-builder", () => ({ buildStyledWorkbook }));

let db: ReturnType<typeof createSupabaseMock>;

function setup(tables: Record<string, QueryResult | QueryResult[]> = {}) {
  db = createSupabaseMock(tables);
  resolveSchoolScopedActorContext.mockImplementation(async (schoolId: string | null) =>
    schoolId === SCHOOL_ID
      ? {
          ok: true,
          value: {
            actorSupabase: db.client,
            actorUserId: ACTOR_ID,
            targetSchoolId: SCHOOL_ID,
            actorBranchId: BRANCH_ID,
            allowedBranchIds: [BRANCH_ID],
          },
        }
      : { ok: false, status: 403, message: "school forbidden" },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  enforceRateLimit.mockResolvedValue(null);
  routeUserHasPermission.mockResolvedValue(true);
  parsePaymentsListFilters.mockReturnValue({});
  setup();
});

describe("GET /api/web/payments/students/[studentId]", () => {
  async function get(studentId: string, schoolId = SCHOOL_ID) {
    const { GET } = await import("@/app/api/web/payments/students/[studentId]/route");
    const request = new NextRequest(`http://localhost/api/web/payments/students/${studentId}?schoolId=${schoolId}`);
    const response = await GET(request, { params: Promise.resolve({ studentId }) });
    return { response, payload: await response.json() };
  }

  it("rejects a non-UUID student id with 400", async () => {
    const { response } = await get("bad-id");

    expect(response.status).toBe(400);
    expect(resolveSchoolScopedActorContext).not.toHaveBeenCalled();
  });

  it("rejects reading another school's student payments", async () => {
    const { response } = await get(STUDENT_ID, OTHER_SCHOOL_ID);

    expect(response.status).toBe(403);
    expect(db.from).not.toHaveBeenCalled();
  });

  it("returns 404 when the student is not in the actor's school", async () => {
    setup({ students: { data: null } });

    const { response } = await get(STUDENT_ID);

    expect(response.status).toBe(404);
    expect(db.queriesFor("students")[0].argsOf("eq")).toContainEqual(["school_id", SCHOOL_ID]);
    expect(db.queriesFor("payments")).toHaveLength(0);
  });

  it("returns 403 for a student in a branch the actor cannot access", async () => {
    setup({ students: { data: { id: STUDENT_ID, branch_id: OTHER_BRANCH_ID } } });

    const { response } = await get(STUDENT_ID);

    expect(response.status).toBe(403);
    expect(db.queriesFor("payments")).toHaveLength(0);
  });

  it("lists only non-deleted payments of the student within school and branch scope", async () => {
    const payments = [{ id: "p1", amount: 100 }];
    setup({
      students: { data: { id: STUDENT_ID, branch_id: BRANCH_ID } },
      payments: { data: payments },
    });

    const { response, payload } = await get(STUDENT_ID);

    expect(response.status).toBe(200);
    expect(payload).toEqual({ ok: true, payments });
    const query = db.queriesFor("payments")[0];
    expect(query.argsOf("eq")).toEqual([
      ["school_id", SCHOOL_ID],
      ["student_id", STUDENT_ID],
      ["branch_id", BRANCH_ID],
    ]);
    expect(query.argsOf("is")).toEqual([["deleted_at", null]]);
  });
});

describe("GET /api/web/payments/export", () => {
  async function get(query: string) {
    const { GET } = await import("@/app/api/web/payments/export/route");
    const response = await GET(new NextRequest(`http://localhost/api/web/payments/export?${query}`));
    return response;
  }

  it("rejects exporting another school's payments", async () => {
    const response = await get(`schoolId=${OTHER_SCHOOL_ID}`);

    expect(response.status).toBe(403);
    expect(exportPaymentStudents).not.toHaveBeenCalled();
  });

  it("requires view_payments permission", async () => {
    routeUserHasPermission.mockResolvedValue(false);

    const response = await get(`schoolId=${SCHOOL_ID}`);

    expect(response.status).toBe(403);
    expect(routeUserHasPermission).toHaveBeenCalledWith(db.client, ACTOR_ID, "view_payments");
    expect(exportPaymentStudents).not.toHaveBeenCalled();
  });

  it("rejects a branch outside the actor's scope", async () => {
    const response = await get(`schoolId=${SCHOOL_ID}&branchId=${OTHER_BRANCH_ID}`);

    expect(response.status).toBe(403);
    expect(exportPaymentStudents).not.toHaveBeenCalled();
  });

  it("exports with the actor's school and branch scope", async () => {
    exportPaymentStudents.mockResolvedValue([{ id: STUDENT_ID, full_name: "طالب" }]);

    const response = await get(`schoolId=${SCHOOL_ID}`);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ ok: true, students: [{ id: STUDENT_ID, full_name: "طالب" }] });
    expect(exportPaymentStudents).toHaveBeenCalledWith(
      db.client,
      SCHOOL_ID,
      expect.objectContaining({ branchId: BRANCH_ID, branchIds: [BRANCH_ID] }),
      expect.any(Object),
    );
  });
});
