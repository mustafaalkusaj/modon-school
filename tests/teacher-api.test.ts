import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/rbac-session", () => ({ RBAC_COOKIE_NAME: "x", verifyRBACSession: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ createServiceSupabaseClient: vi.fn() }));
vi.mock("@/lib/managed-user-app-context", () => ({ buildManagedAppAccountContext: vi.fn() }));

import {
  filterTeacherStudents,
  summarizeTeacherClasses,
  type TeacherContext,
} from "@/lib/teacher-api";

function makeCtx(): TeacherContext {
  return {
    assignments: [
      { id: "a1", subject_id: null, subject_name: "رياضيات", class_id: null, class_name: "الأول", section_id: null, section_name: "أ", is_active: true },
      { id: "a2", subject_id: null, subject_name: "علوم", class_id: null, class_name: "الأول", section_id: null, section_name: "ب", is_active: true },
      { id: "a3", subject_id: null, subject_name: "رياضيات", class_id: null, class_name: "الثاني", section_id: null, section_name: null, is_active: true },
    ],
    students: [
      { student_id: "s1", auth_user_id: "u1", full_name: "علي", class_name: "الأول", section: "أ", status: "active" },
      { student_id: "s2", auth_user_id: null, full_name: "زيد", class_name: "الأول", section: "ب", status: "active" },
      { student_id: "s3", auth_user_id: "u3", full_name: "سارة", class_name: "الثاني", section: null, status: "active" },
    ],
  } as unknown as TeacherContext;
}

describe("summarizeTeacherClasses", () => {
  it("groups assignments per class with sections, subjects and roster counts", () => {
    const classes = summarizeTeacherClasses(makeCtx());
    expect(classes).toEqual([
      { class_name: "الأول", sections: ["أ", "ب"], subjects: ["رياضيات", "علوم"], student_count: 2 },
      { class_name: "الثاني", sections: [], subjects: ["رياضيات"], student_count: 1 },
    ]);
  });

  it("adds timetable-only classes without duplicating assigned ones", () => {
    const classes = summarizeTeacherClasses(makeCtx(), ["الأول ", "الثالث"]);
    expect(classes.map((c) => c.class_name)).toEqual(["الأول", "الثاني", "الثالث"]);
    expect(classes[2].student_count).toBe(0);
  });
});

describe("filterTeacherStudents", () => {
  it("returns the whole roster without filters", () => {
    expect(filterTeacherStudents(makeCtx())).toHaveLength(3);
  });

  it("narrows by class and section", () => {
    expect(filterTeacherStudents(makeCtx(), "الأول").map((s) => s.student_id)).toEqual(["s1", "s2"]);
    expect(filterTeacherStudents(makeCtx(), "الأول", "ب").map((s) => s.student_id)).toEqual(["s2"]);
  });
});
