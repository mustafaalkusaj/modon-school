import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Regression guard for the 2026-07-29 audit finding NEW-SEC-0 (CRITICAL).
 *
 * `lib/dashboard-admin-server.ts` runs on a SERVICE-ROLE Supabase client, so
 * RLS is bypassed and the application predicate is the only tenant boundary.
 * Four `classes` mutations shipped without `.eq("school_id", ...)`:
 *
 *   - saveDashboardClass     `.delete().in("id", legacyClassIds)`
 *   - deleteDashboardClass   `.delete().in("id", legacyIds)`
 *   - saveDashboardSection   `.update({ section }).eq("id", sectionId)`
 *   - deleteDashboardSection `.delete().eq("id", options.sectionId)`
 *
 * All four take their ids straight from the request body — `POST
 * /api/web/dashboard/structure` validates them as `z.array(z.string().trim())`
 * with no UUID check and no ownership lookup. An admin of school A could pass
 * school B's class ids and silently destroy another tenant's rows.
 *
 * Two earlier audit sweeps read this file and missed these branches, so the
 * guard is a source scan rather than a behavioural test: a behavioural test
 * only covers the paths it happens to exercise, while this fails on any NEW
 * mutation a future edit adds without the predicate.
 */

const SOURCE_PATH = join(process.cwd(), "lib", "dashboard-admin-server.ts");

const source = readFileSync(SOURCE_PATH, "utf8");

/**
 * Removes line and block comments.
 *
 * Chains are delimited by `;`, and prose inside a `//` comment can contain one
 * — which would truncate the chain before its trailing predicates and produce
 * a false failure. Stripping comments first makes the scan depend on code
 * only. (This is not a false alarm the guard invented: the first run of this
 * test failed for exactly that reason.)
 */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/**
 * Splits the file into the statement chains that start at `.from("classes")`.
 * A chain ends at the first `;` — every mutation in this file is a single
 * awaited statement, so that boundary is exact once comments are gone.
 */
function extractClassesChains(text: string): string[] {
  const chains: string[] = [];
  const marker = '.from("classes")';
  let cursor = text.indexOf(marker);

  while (cursor !== -1) {
    const end = text.indexOf(";", cursor);
    chains.push(text.slice(cursor, end === -1 ? text.length : end));
    cursor = text.indexOf(marker, cursor + marker.length);
  }

  return chains;
}

const chains = extractClassesChains(stripComments(source));

const mutations = chains.filter(
  (chain) => chain.includes(".delete()") || chain.includes(".update("),
);

const inserts = chains.filter((chain) => chain.includes(".insert("));

describe("dashboard-admin-server: classes tenant scoping", () => {
  it("finds the classes mutations it is meant to guard", () => {
    // Fails loudly if the file is refactored such that the scan stops seeing
    // anything — a silent zero would make every assertion below vacuous.
    expect(mutations.length).toBeGreaterThanOrEqual(6);
    expect(inserts.length).toBeGreaterThanOrEqual(3);
  });

  it.each(mutations.map((chain, index) => [index, chain] as const))(
    "classes mutation #%i carries an unconditional school_id predicate",
    (_index, chain) => {
      expect(chain).toContain('.eq("school_id"');
    },
  );

  it("scopes every delete by school_id", () => {
    const deletes = chains.filter((chain) => chain.includes(".delete()"));
    expect(deletes.length).toBeGreaterThan(0);
    for (const chain of deletes) {
      expect(chain).toContain('.eq("school_id"');
    }
  });

  it("scopes every update by school_id", () => {
    const updates = chains.filter((chain) => chain.includes(".update("));
    expect(updates.length).toBeGreaterThan(0);
    for (const chain of updates) {
      expect(chain).toContain('.eq("school_id"');
    }
  });

  it("never mutates classes by id alone", () => {
    // The exact shape of the original defect: an id filter with no tenant
    // filter anywhere in the same statement.
    for (const chain of chains) {
      if (!chain.includes(".delete()") && !chain.includes(".update(")) {
        continue;
      }
      const filtersById =
        chain.includes('.eq("id"') || chain.includes('.in("id"');
      if (filtersById) {
        expect(chain).toContain('.eq("school_id"');
      }
    }
  });

  it("sets school_id from the resolved server value on every insert", () => {
    // Inserts need school_id in the PAYLOAD, not as a predicate. Each payload
    // must take it from `options.schoolId` (resolved server-side) and never
    // from caller-supplied request data.
    const payloadShapes = [
      /const classPayload: Record<string, unknown> = \{[^}]*school_id: options\.schoolId/s,
      /\.from\("classes"\)\.insert\(\{\s*school_id: options\.schoolId/s,
    ];

    expect(payloadShapes.some((pattern) => pattern.test(source))).toBe(true);

    // No insert payload may read school_id out of a request body.
    expect(source).not.toMatch(/school_id:\s*(body|payload|input|req)\./);
  });
});
