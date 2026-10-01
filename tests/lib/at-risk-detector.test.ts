import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { detectAtRiskStudents } from "@/lib/grades/at-risk-detector";
import type { GradeEntry } from "@/lib/grades/types";

function entry(studentId: string, percentage: number | null): GradeEntry {
  return {
    student_id: studentId,
    subject_id: "math",
    percentage,
  } as unknown as GradeEntry;
}

describe("detectAtRiskStudents", () => {
  it("does not flag students whose grade has not been entered", () => {
    const report = detectAtRiskStudents(
      [entry("graded-low", 20), entry("ungraded", null), entry("passing", 80)],
      { pass_score: 50 },
    );
    expect(report.atRiskStudents.map((s) => s.studentId)).toEqual(["graded-low"]);
    expect(report.criticalCount).toBe(1);
  });
});
