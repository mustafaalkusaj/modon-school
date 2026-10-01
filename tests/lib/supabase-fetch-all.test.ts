import { describe, expect, it } from "vitest";

import { fetchAllRows, SUPABASE_MAX_ROWS } from "@/lib/supabase-fetch-all";

function fakeTable(total: number) {
  const rows = Array.from({ length: total }, (_, i) => ({ id: i, amount: 1 }));
  const calls: Array<[number, number]> = [];
  const build = () => ({
    range: async (from: number, to: number) => {
      calls.push([from, to]);
      return {
        data: rows.slice(from, Math.min(to + 1, from + SUPABASE_MAX_ROWS)),
        error: null,
        count: total,
      };
    },
  });
  return { build, calls };
}

describe("fetchAllRows", () => {
  it("returns every row past the 1000-row cap", async () => {
    const { build, calls } = fakeTable(2_345);
    const result = await fetchAllRows(build);
    expect(result.data).toHaveLength(2_345);
    expect(result.count).toBe(2_345);
    expect(calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it("makes one call when everything fits in one page", async () => {
    const { build, calls } = fakeTable(12);
    const result = await fetchAllRows(build);
    expect(result.data).toHaveLength(12);
    expect(calls).toHaveLength(1);
  });

  it("returns the error and no partial data", async () => {
    const result = await fetchAllRows(() => ({
      range: async () => ({ data: null, error: { message: "boom" }, count: null }),
    }));
    expect(result.data).toBeNull();
    expect(result.error).toEqual({ message: "boom" });
  });
});
