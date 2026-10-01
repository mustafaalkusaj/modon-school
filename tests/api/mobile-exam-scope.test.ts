import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  resolveMobileRouteContext: vi.fn(),
}));

vi.mock("@/lib/mobile-api-server", () => ({
  resolveMobileRouteContext: state.resolveMobileRouteContext,
  parseMobileListParams: vi.fn(() => ({
    page: 1,
    limit: 20,
    offset: 0,
    search: "",
  })),
  normalizeClassKey: (value: unknown) =>
    typeof value === "string" ? value.trim().toLowerCase() : "",
}));

describe("mobile exam object scoping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("adds the authenticated teacher creator predicate before loading exam details", async () => {
    const eqCalls: Array<[string, unknown]> = [];
    const examQuery = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: vi.fn(async () => ({ data: null, error: null })),
    };
    examQuery.select.mockReturnValue(examQuery);
    examQuery.eq.mockImplementation((field: string, value: unknown) => {
      eqCalls.push([field, value]);
      return examQuery;
    });
    const serviceSupabase = {
      from: vi.fn(() => examQuery),
    };
    state.resolveMobileRouteContext.mockResolvedValue({
      ok: true,
      value: {
        authUserId: "teacher-auth-1",
        schoolId: "school-1",
        serviceSupabase,
      },
    });

    const { GET } =
      await import("@/app/api/mobile/teacher/exams/[examId]/route");
    const response = await GET(
      new NextRequest(
        "http://localhost/api/mobile/teacher/exams/exam-from-teacher-2",
      ),
      { params: Promise.resolve({ examId: "exam-from-teacher-2" }) },
    );

    expect(response.status).toBe(404);
    expect(eqCalls).toContainEqual(["id", "exam-from-teacher-2"]);
    expect(eqCalls).toContainEqual(["school_id", "school-1"]);
    expect(eqCalls).toContainEqual(["created_by", "teacher-auth-1"]);
    expect(serviceSupabase.from).toHaveBeenCalledTimes(1);
  });

  it("returns only explicitly school-wide exams to a classless student", async () => {
    const rows = [
      { id: "school-wide", class_name: null, title: "School-wide" },
      { id: "class-a", class_name: "Grade 1 A", title: "Class A" },
      { id: "class-b", class_name: "Grade 2 B", title: "Class B" },
    ];
    const examQuery: Record<string, unknown> = {};
    for (const method of ["select", "eq", "order"]) {
      examQuery[method] = vi.fn(() => examQuery);
    }
    examQuery.then = (resolve: (value: unknown) => void) =>
      resolve({ data: rows, error: null });
    const serviceSupabase = {
      from: vi.fn((table: string) => {
        if (table !== "exams") {
          throw new Error(`Unexpected table: ${table}`);
        }
        return examQuery;
      }),
    };
    state.resolveMobileRouteContext.mockResolvedValue({
      ok: true,
      value: {
        authUserId: "student-auth-1",
        schoolId: "school-1",
        serviceSupabase,
        account: {
          student: {
            id: null,
            class_name: null,
          },
        },
      },
    });

    const { GET } = await import("@/app/api/mobile/student/exams/route");
    const response = await GET(
      new NextRequest("http://localhost/api/mobile/student/exams"),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0]).toMatchObject({
      id: "school-wide",
      title: "School-wide",
    });
  });
});
