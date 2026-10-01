import { normalizeClassKey } from "@/lib/mobile-api-server";

/**
 * Mirrors the class/section matching in `queryStudentAssignments`: an exact
 * student_id match always wins; otherwise the row must be a class-wide one
 * (student_id null) whose normalized class matches, and whose section either is
 * unset (whole-class) or matches the student's section.
 */
export function isAssignmentVisibleToStudent(
  row: Record<string, unknown>,
  student: { id: string; class_name?: string | null; section?: string | null },
): boolean {
  const rowStudentId =
    typeof row.student_id === "string" ? row.student_id.trim() : "";
  if (rowStudentId) {
    return rowStudentId === student.id;
  }

  const studentClassKey = student.class_name
    ? normalizeClassKey(student.class_name)
    : null;
  if (!studentClassKey) return false;
  if (normalizeClassKey(row.class_name) !== studentClassKey) return false;

  const rowSection = row.section;
  if (rowSection == null) return true; // whole-class assignment

  const studentSectionKey = student.section
    ? normalizeClassKey(student.section)
    : null;
  return (
    studentSectionKey !== null &&
    normalizeClassKey(rowSection) === studentSectionKey
  );
}
