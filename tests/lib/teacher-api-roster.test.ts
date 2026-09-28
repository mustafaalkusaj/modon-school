import { describe, expect, it, vi } from "vitest";
import type { MobileRouteContext } from "@/lib/mobile-api-server";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/rbac-session", () => ({ RBAC_COOKIE_NAME: "x", verifyRBACSession: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ createServiceSupabaseClient: vi.fn() }));
vi.mock("@/lib/managed-user-app-context", () => ({ buildManagedAppAccountContext: vi.fn() }));

const { summarizeTeacherClasses, filterTeacherStudents } = await import("@/lib/teacher-api");

function assignment(class_name: string, subject_name: string, section_name: string | null = null, is_active = true) {
  return { id: `${class_name}-${subject_name}`, subject_id: null, subject_name, class_id: null, class_name, section_id: null, section_name, is_active };
}

function student(id: string, class_name: string, section: string | null) {
  return { student_id: id, auth_user_id: `auth-${id}`, full_name: id, class_name, section, status: null };
}

const app = {
  account: {
    teacher: {
      id: "t1",
      assignments: [
        assignment("الثالث", "رياضيات"),
        assignment("الثالث", "علوم"),
        assignment("الرابع", "رياضيات", "C"),
        assignment("الخامس", "رياضيات", null, false),
      ],
      assigned_students: [
        student("a", "الثالث", "A"),
        student("b", "الثالث", "B"),
        student("c", "الرابع", "c"),
        student("d", "الرابع", "A"),
      ],
    },
  },
} as unknown as MobileRouteContext;

describe("summarizeTeacherClasses", () => {
  it("groups active assignments per class/section with subjects and counts", () => {
    const classes = summarizeTeacherClasses(app);
    expect(classes).toHaveLength(2);
    const third = classes.find((c) => c.class_name === "الثالث");
    expect(third).toMatchObject({ section: null, student_count: 2, subjects: ["رياضيات", "علوم"] });
    // Section matching is case-insensitive ("C" assignment vs "c" student).
    const fourth = classes.find((c) => c.class_name === "الرابع");
    expect(fourth).toMatchObject({ section: "C", student_count: 1 });
  });
});

describe("filterTeacherStudents", () => {
  it("filters the roster by class and optional section", () => {
    expect(filterTeacherStudents(app)).toHaveLength(4);
    expect(filterTeacherStudents(app, "الثالث").map((s) => s.student_id)).toEqual(["a", "b"]);
    expect(filterTeacherStudents(app, "الرابع", "C").map((s) => s.student_id)).toEqual(["c"]);
    expect(filterTeacherStudents(app, "السادس")).toHaveLength(0);
  });
});
