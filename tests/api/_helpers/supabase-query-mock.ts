import { vi } from "vitest";

export type QueryResult = { data?: unknown; error?: unknown; count?: number | null };

export type RecordedQuery = {
  table: string;
  calls: Array<[method: string, args: unknown[]]>;
  /** True when the chain contains a write (insert/update/delete/upsert). */
  isWrite: () => boolean;
  /** Arguments of every call to `method`, in order. */
  argsOf: (method: string) => unknown[][];
};

const WRITE_METHODS = new Set(["insert", "update", "delete", "upsert"]);

/**
 * A chainable PostgREST-style query double. Every builder method returns the
 * same proxy and is recorded; awaiting it, or calling maybeSingle()/single(),
 * resolves to `result`.
 */
function createRecordedQuery(table: string, result: QueryResult) {
  const recorded: RecordedQuery = {
    table,
    calls: [],
    isWrite: () => recorded.calls.some(([method]) => WRITE_METHODS.has(method)),
    argsOf: (method) => recorded.calls.filter(([m]) => m === method).map(([, args]) => args),
  };
  const resolved = { data: null, error: null, count: null, ...result };

  const proxy: Record<string, unknown> = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") {
          return (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
            Promise.resolve(resolved).then(resolve, reject);
        }
        if (prop === "maybeSingle" || prop === "single") {
          return () => {
            recorded.calls.push([prop, []]);
            return Promise.resolve(resolved);
          };
        }
        return (...args: unknown[]) => {
          recorded.calls.push([String(prop), args]);
          return proxy;
        };
      },
    },
  );

  return { proxy, recorded };
}

/**
 * Supabase client double. `tables` maps a table name to either a single result
 * (returned for every query on that table) or a list consumed in order (the
 * last entry repeats once the list is exhausted).
 */
export function createSupabaseMock(
  tables: Record<string, QueryResult | QueryResult[]> = {},
  rpcResult: QueryResult = { data: null, error: null },
) {
  const queries: RecordedQuery[] = [];
  const cursor = new Map<string, number>();

  const from = vi.fn((table: string) => {
    const entry = tables[table];
    let result: QueryResult = { data: null, error: null };
    if (Array.isArray(entry)) {
      const index = cursor.get(table) ?? 0;
      result = entry[Math.min(index, entry.length - 1)] ?? result;
      cursor.set(table, index + 1);
    } else if (entry) {
      result = entry;
    }
    const { proxy, recorded } = createRecordedQuery(table, result);
    queries.push(recorded);
    return proxy;
  });

  const rpc = vi.fn(async (name: string, args?: Record<string, unknown>) => {
    void name;
    void args;
    return { data: null, error: null, ...rpcResult };
  });

  return {
    client: { from, rpc },
    from,
    rpc,
    queries,
    queriesFor: (table: string) => queries.filter((query) => query.table === table),
    writes: () => queries.filter((query) => query.isWrite()),
  };
}

export const SCHOOL_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const OTHER_SCHOOL_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const BRANCH_ID = "11111111-1111-4111-8111-111111111111";
export const OTHER_BRANCH_ID = "22222222-2222-4222-8222-222222222222";
export const STUDENT_ID = "33333333-3333-4333-8333-333333333333";
export const PAYMENT_ID = "44444444-4444-4444-8444-444444444444";
export const ACTOR_ID = "55555555-5555-4555-8555-555555555555";
