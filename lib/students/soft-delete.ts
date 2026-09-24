/**
 * Single source of truth for "is this student deleted?".
 *
 * WHY THIS EXISTS
 * ---------------
 * `students` carries TWO independent soft-delete markers:
 *   - `status = 'deleted'` (a value of the status enum, surfaced as a UI tab)
 *   - `deleted_at` / `deleted_by` (timestamp columns)
 *
 * The canonical delete path (`DELETE /api/web/students/[studentId]`) writes BOTH,
 * so `status` is treated as the primary mechanism here: it is the only one the
 * UI can filter and group on, the "deleted" tab and the restore flow are built
 * on it, and the overwhelming majority of call sites already read it.
 *
 * `deleted_at` is retained as delete *metadata* (when, by whom) and as a
 * defensive second gate, because a handful of writers historically stamped only
 * `deleted_at`. Production still carries rows in exactly that state, which is
 * why the exclusion predicate below checks BOTH columns: a student removed by
 * either mechanism must disappear from every list, fee total, roster and export.
 *
 * Reads should go through these helpers rather than hand-rolling the filter.
 */

/** The status value that marks a student as soft-deleted. */
export const DELETED_STUDENT_STATUS = "deleted";

type StudentQueryLike = {
  eq: (column: string, value: unknown) => StudentQueryLike;
  neq: (column: string, value: unknown) => StudentQueryLike;
  is: (column: string, value: unknown) => StudentQueryLike;
  or: (filters: string) => StudentQueryLike;
};

/**
 * Hides students soft-deleted by EITHER mechanism.
 *
 * Apply to any query that should show live students: lists, rosters, fee
 * totals, exports, counts.
 */
export function excludeDeletedStudents<TQuery>(query: TQuery): TQuery {
  return (query as unknown as StudentQueryLike)
    .neq("status", DELETED_STUDENT_STATUS)
    .is("deleted_at", null) as unknown as TQuery;
}

/**
 * Shows ONLY soft-deleted students, by either mechanism — the "deleted" tab and
 * the restore flow. Deliberately the mirror of `excludeDeletedStudents` so a row
 * can never fall through both.
 */
export function onlyDeletedStudents<TQuery>(query: TQuery): TQuery {
  return (query as unknown as StudentQueryLike).or(
    `status.eq.${DELETED_STUDENT_STATUS},deleted_at.not.is.null`,
  ) as unknown as TQuery;
}

/** Row-level equivalent, for rows already fetched into memory. */
export function isStudentDeleted(row: {
  status?: unknown;
  deleted_at?: unknown;
}): boolean {
  return (
    row.status === DELETED_STUDENT_STATUS ||
    (row.deleted_at !== null && row.deleted_at !== undefined)
  );
}
