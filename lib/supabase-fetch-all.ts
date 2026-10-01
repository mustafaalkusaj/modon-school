/**
 * PostgREST caps every response at `max_rows` (1000 on this project, see
 * supabase/config.toml), silently. Any query whose rows are summed or looped
 * over in JS must page through the full result, or totals are wrong as soon
 * as a school passes 1000 payments / expenses / students.
 *
 * `build` must return a fresh query each call (builders are single-use) and
 * should include a stable `.order(...)`, e.g. by primary key, so pages do not
 * overlap or skip rows.
 */
export const SUPABASE_MAX_ROWS = 1000;

type RangeableQuery<T, E> = {
  range(
    from: number,
    to: number,
  ): PromiseLike<{ data: T[] | null; error: E | null; count?: number | null }>;
};

export async function fetchAllRows<T, E>(
  build: () => RangeableQuery<T, E>,
  options: { maxRows?: number } = {},
): Promise<{ data: T[] | null; error: E | null; count: number | null }> {
  const maxRows = options.maxRows ?? 200_000;
  const rows: T[] = [];
  let exactCount: number | null = null;

  for (let from = 0; from < maxRows; from += SUPABASE_MAX_ROWS) {
    const { data, error, count } = await build().range(
      from,
      from + SUPABASE_MAX_ROWS - 1,
    );
    if (error) return { data: null, error, count: null };
    if (exactCount === null && typeof count === "number") exactCount = count;
    const page = data ?? [];
    rows.push(...page);
    if (page.length < SUPABASE_MAX_ROWS) break;
  }

  return { data: rows, error: null, count: exactCount ?? rows.length };
}
