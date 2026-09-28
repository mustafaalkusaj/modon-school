import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ManagedUserRecord } from "@/lib/managed-users";

// Server-coupled modules pulled in by managed-user-app-context — stub them so the
// module loads in a plain test environment without `server-only` blowing up.
vi.mock("server-only", () => ({}));

const createServiceSupabaseClientMock = vi.fn();
vi.mock("@/lib/supabase-server", () => ({
  createServiceSupabaseClient: createServiceSupabaseClientMock,
}));

vi.mock("@/lib/admin-infrastructure", () => ({
  isMissingTableError: () => false,
}));

vi.mock("@/lib/managed-users-server", () => ({
  fetchManagedAccountSchoolBrand: vi.fn(),
  fetchTeacherAssignments: vi.fn(),
  findMatchingTeacherIdsForStudent: vi.fn(),
  getTeacherTableCapabilities: vi.fn(),
  resolveManagedAccountBase: vi.fn(),
  tableHasColumn: vi.fn(),
}));

type QueryResult = { data: unknown; error: unknown };

// Minimal chainable PostgREST-ish query double that records filter calls.
function makeQuery(result: QueryResult) {
  const eqCalls: Array<[string, unknown]> = [];
  const filterCalls: Array<[string, ...unknown[]]> = [];
  const query: Record<string, unknown> = {
    eqCalls,
    filterCalls,
    select: () => query,
    in: () => query,
    eq: (col: string, val: unknown) => {
      eqCalls.push([col, val]);
      return query;
    },
    neq: (col: string, val: unknown) => {
      filterCalls.push(["neq", col, val]);
      return query;
    },
    is: (col: string, val: unknown) => {
      filterCalls.push(["is", col, val]);
      return query;
    },
    or: (expr: string) => {
      filterCalls.push(["or", expr]);
      return query;
    },
    maybeSingle: () => Promise.resolve(result),
    then: (onF: (v: QueryResult) => unknown, onR?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(onF, onR),
  };
  return query as {
    eqCalls: Array<[string, unknown]>;
    filterCalls: Array<[string, ...unknown[]]>;
  } & Record<string, unknown>;
}

const SCHOOL_ID = "11111111-1111-1111-1111-111111111111";
const TEACHER_ID = "33333333-3333-3333-3333-333333333333";
const BRANCH_A = "22222222-2222-2222-2222-222222222222";

function buildTeacherRecord(sectionName: string | null = null): ManagedUserRecord {
  return {
    auth_user_id: "auth-teacher-1",
    school_id: SCHOOL_ID,
    role: "teacher",
    full_name: "معلم تجريبي",
    email: "t@example.test",
    phone: null,
    is_active: true,
    created_at: null,
    updated_at: null,
    student: null,
    app_account: null,
    teacher: {
      id: TEACHER_ID,
      full_name: "معلم تجريبي",
      email: null,
      phone: null,
      specialization: null,
      notes: null,
      is_active: true,
      assignments: [
        {
          id: "assignment-1",
          subject_id: null,
          subject_name: "رياضيات",
          class_id: null,
          class_name: "الأول",
          section_id: null,
          section_name: sectionName,
          is_active: true,
        },
      ],
    },
  };
}

// Wires a fake service client. No student_teacher_links rows -> the resolver
// falls through to the assignment (class_name) match path, which is the one that
// must be branch-scoped. `teacherBranchId` controls what the teachers lookup returns.
function wireClient(teacherBranchId: string | null) {
  const studentQueries: Array<ReturnType<typeof makeQuery>> = [];
  const client = {
    from: (table: string) => {
      if (table === "student_teacher_links") {
        return makeQuery({ data: [], error: null });
      }
      if (table === "teachers") {
        return makeQuery({ data: { branch_id: teacherBranchId }, error: null });
      }
      if (table === "students") {
        const q = makeQuery({ data: [], error: null });
        studentQueries.push(q);
        return q;
      }
      return makeQuery({ data: [], error: null });
    },
  };
  createServiceSupabaseClientMock.mockReturnValue(client);
  return { studentQueries };
}

describe("fetchTeacherAssignedStudents — branch isolation", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("constrains the class-name roster query to the teacher's branch", async () => {
    const { studentQueries } = wireClient(BRANCH_A);
    const { fetchTeacherAssignedStudents } = await import("@/lib/managed-user-app-context");

    await fetchTeacherAssignedStudents(buildTeacherRecord());

    expect(studentQueries).toHaveLength(1);
    const eqCalls = studentQueries[0].eqCalls;
    expect(eqCalls).toContainEqual(["school_id", SCHOOL_ID]);
    expect(eqCalls).toContainEqual(["class_name", "الأول"]);
    // The fix: the roster must be scoped to the teacher's branch.
    expect(eqCalls).toContainEqual(["branch_id", BRANCH_A]);
  });

  it("omits the branch filter when the teacher has no branch (legacy single-branch)", async () => {
    const { studentQueries } = wireClient(null);
    const { fetchTeacherAssignedStudents } = await import("@/lib/managed-user-app-context");

    await fetchTeacherAssignedStudents(buildTeacherRecord());

    expect(studentQueries).toHaveLength(1);
    const eqCalls = studentQueries[0].eqCalls;
    expect(eqCalls).toContainEqual(["class_name", "الأول"]);
    expect(eqCalls.some(([col]) => col === "branch_id")).toBe(false);
  });

  it("excludes soft-deleted students from the roster", async () => {
    const { studentQueries } = wireClient(BRANCH_A);
    const { fetchTeacherAssignedStudents } = await import("@/lib/managed-user-app-context");

    await fetchTeacherAssignedStudents(buildTeacherRecord());

    expect(studentQueries[0].filterCalls).toContainEqual(["is", "deleted_at", null]);
  });

  it("includes students without a section in a section-scoped assignment", async () => {
    const { studentQueries } = wireClient(BRANCH_A);
    const { fetchTeacherAssignedStudents } = await import("@/lib/managed-user-app-context");

    await fetchTeacherAssignedStudents(buildTeacherRecord("A"));

    const q = studentQueries[0];
    expect(q.eqCalls.some(([col]) => col === "section")).toBe(false);
    expect(q.filterCalls).toContainEqual(["or", 'section.ilike."A",section.is.null,section.eq.""']);
  });
});
