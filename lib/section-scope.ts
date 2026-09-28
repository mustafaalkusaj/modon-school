/**
 * Section matching for class-scoped features (teacher rosters, notifications,
 * homework visibility).
 *
 * Many students are registered with a class but no section yet. Until the
 * administration assigns their sections, a student with no section is treated
 * as belonging to every section of their class — so a teacher assigned to
 * "الاول / A" still sees, notifies and grades them. Once the student gets a
 * real section the normal exact (case-insensitive) match applies.
 */

function norm(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

/** True when `studentSection` should be treated as inside `targetSection`. */
export function sectionMatches(
  studentSection: string | null | undefined,
  targetSection: string | null | undefined,
): boolean {
  const target = norm(targetSection);
  if (!target) return true;
  const student = norm(studentSection);
  return !student || student === target;
}

/**
 * PostgREST `.or()` filter for the same rule: exact section (case-insensitive)
 * or no section at all. The value is double-quoted so it cannot inject extra
 * filter terms.
 */
export function sectionOrUnassignedFilter(section: string): string {
  const quoted = `"${section.trim().replace(/["\\]/g, "")}"`;
  return `section.ilike.${quoted},section.is.null,section.eq.""`;
}
