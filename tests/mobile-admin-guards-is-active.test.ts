import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Regression guard for the 2026-07-29 audit finding SEC-A (HIGH).
 *
 * Deactivating a staff account must revoke mobile access immediately.
 *
 * The student / teacher / parent path already enforced this: those routes go
 * through `resolveMobileRouteContext` -> `buildManagedAppAccountContext`, and
 * `lib/managed-user-app-context.ts` denies on
 * `!input.authUserIsActive || input.user?.is_active === false`.
 *
 * The two ADMIN guards bypass that helper and query
 * `managed_user_profiles` / `user_profiles` directly. Both selected the role
 * but never `is_active`, so they only ever checked the SCHOOL's is_active and
 * the subscription — a deactivated admin or super_admin kept full mobile
 * access on every request, indefinitely.
 *
 * `lib/mobile-admin-server.ts` gates 17 `/api/mobile/admin/**` routes and
 * `lib/mobile-super-admin-server.ts` gates the `/api/mobile/super_admin/**`
 * routes, so a regression here silently reopens every one of them.
 *
 * Nullability matters and the two tables differ:
 *   managed_user_profiles.is_active  boolean NOT NULL DEFAULT true
 *   user_profiles.is_active          boolean NULL     DEFAULT true
 * Hence the deny must be an explicit `=== false`, never a falsy check, or a
 * legacy NULL row would be locked out.
 */

function readLib(name: string): string {
  return readFileSync(join(process.cwd(), "lib", name), "utf8");
}

const adminGuard = readLib("mobile-admin-server.ts");
const superAdminGuard = readLib("mobile-super-admin-server.ts");

const GUARDS: ReadonlyArray<readonly [string, string]> = [
  ["mobile-admin-server.ts", adminGuard],
  ["mobile-super-admin-server.ts", superAdminGuard],
];

describe("mobile admin guards: is_active enforcement", () => {
  it.each(GUARDS)(
    "%s selects is_active from the profile table",
    (_name, src) => {
      expect(src).toMatch(/\.select\([^)]*is_active/);
    },
  );

  it.each(GUARDS)(
    "%s denies on an explicit is_active === false",
    (_name, src) => {
      // The super_admin guard stores the flag of the record that granted the
      // role in `grantingIsActive`, so match either spelling — what matters is
      // the strict `=== false`, not the identifier.
      expect(src).toMatch(/(?:is_active|IsActive)\s*===\s*false/);
    },
  );

  it.each(GUARDS)(
    "%s never treats is_active as a plain falsy check",
    (_name, src) => {
      // `!profile.is_active` would deny a legacy NULL row in user_profiles,
      // locking out real super_admins. Only `=== false` is correct.
      expect(src).not.toMatch(/!\s*\w*\.?is_active\b(?!\s*===)/);
    },
  );

  it("admin guard rejects a deactivated account before returning a context", () => {
    // Ordering matters: the deny must come before the guard hands back a
    // usable context. Use lastIndexOf for the success marker — the FIRST
    // `ok: true` in the file is the return-type union on the signature, not
    // the actual return statement.
    const denyIndex = adminGuard.indexOf("is_active === false");
    const successIndex = adminGuard.lastIndexOf("ok: true");
    expect(denyIndex).toBeGreaterThan(-1);
    expect(successIndex).toBeGreaterThan(-1);
    expect(denyIndex).toBeLessThan(successIndex);
  });

  it("super_admin guard reads the flag from the profile that grants the role", () => {
    // In this codebase the role is resolved from managed_user_profiles only, so
    // the very row whose role is checked must also supply the is_active flag.
    expect(superAdminGuard).toMatch(/\.select\("role, is_active"\)/);
    const roleCheck = superAdminGuard.indexOf('profile.role !== "super_admin"');
    const activeCheck = superAdminGuard.search(/is_active\?: boolean/);
    expect(roleCheck).toBeGreaterThan(-1);
    expect(activeCheck).toBeGreaterThan(roleCheck);
  });

  it("the shared non-admin path still enforces is_active", () => {
    // Guards the invariant this finding relied on: the student/teacher/parent
    // path was already correct, and must stay correct.
    const appContext = readLib("managed-user-app-context.ts");
    expect(appContext).toMatch(/is_active\s*===\s*false/);
  });
});
