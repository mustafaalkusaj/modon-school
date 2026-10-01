import { describe, expect, it } from "vitest";

import {
  buildDefaultPath,
  type AuthorizationScopeLevel,
} from "@/lib/authorization/default-path";
import type { PageCode } from "@/lib/authorization/page-access";
import {
  getAccessDecision,
  getDefaultRouteForProfile,
  type UserProfile,
} from "@/lib/auth";
import { ROLES, ROLE_PERMISSIONS, type UserRole } from "@/types/roles";

// Regression guard for the 2026-09-08 production lockout.
//
// buildDefaultPath() handed branch-scoped admins "/dashboard", but
// getAccessDecision() forbids "/dashboard" for scope_level "branch_user".
// The login page checks the default route, finds it forbidden, and redirects
// to /access-denied - so the user's own landing page locked them out and no
// amount of correct credentials could get them in.
//
// The invariant: whatever landing path we compute for a profile, that same
// profile must be allowed to open it. If this test fails, some role can log
// in successfully and still be bounced to /access-denied.

const SCOPE_LEVELS: AuthorizationScopeLevel[] = [
  "super_admin",
  "group_admin",
  "branch_user",
  "restricted",
  null,
];

function makeProfile(
  role: UserRole,
  scopeLevel: AuthorizationScopeLevel,
  allowedPages: PageCode[] = [],
): UserProfile {
  return {
    id: "user-under-test",
    full_name: "Test User",
    email: "test@example.com",
    role,
    permissions: [...ROLE_PERMISSIONS[role]],
    school_id: "school-under-test",
    is_active: true,
    school: { id: "school-under-test", name: "Test School", is_active: true },
    subscription: {
      id: "subscription-under-test",
      school_id: "school-under-test",
      status: "active",
      end_date: "2099-01-01",
    },
    allowed_pages: allowedPages,
    is_single_page_user: false,
    scope_level: scopeLevel,
    default_path: buildDefaultPath(role, allowedPages, false, scopeLevel),
  };
}

describe("default landing path is always reachable", () => {
  for (const role of ROLES) {
    for (const scopeLevel of SCOPE_LEVELS) {
      const label = `${role} / scope=${scopeLevel ?? "none"}`;

      it(`lets ${label} open its own landing page`, () => {
        const profile = makeProfile(role, scopeLevel);
        const landingPath = getDefaultRouteForProfile(profile);
        const decision = getAccessDecision(profile, landingPath);

        expect(
          decision.allowed,
          `${label} lands on ${landingPath} but getAccessDecision denied it (reason: ${decision.reason})`,
        ).toBe(true);
      });

      it(`lets ${label} open its landing page under the /ar locale prefix`, () => {
        const profile = makeProfile(role, scopeLevel);
        const landingPath = `/ar${getDefaultRouteForProfile(profile)}`;
        const decision = getAccessDecision(profile, landingPath);

        expect(
          decision.allowed,
          `${label} lands on ${landingPath} but getAccessDecision denied it (reason: ${decision.reason})`,
        ).toBe(true);
      });
    }
  }

  // The exact production failure, pinned explicitly so the regression is
  // named rather than only covered by the matrix above.
  it("never sends a branch-scoped admin to the forbidden /dashboard root", () => {
    for (const role of ["admin", "employee"] as const) {
      const landingPath = buildDefaultPath(role, [], false, "branch_user");
      expect(landingPath).not.toBe("/dashboard");
    }
  });

  // Proves the matrix above has teeth: /dashboard really is denied to
  // branch-scoped profiles, so a landing path of "/dashboard" - what the old
  // buildDefaultPath returned - genuinely fails the invariant rather than
  // slipping through. If this ever starts passing, the lockout precondition
  // changed and the guard above needs revisiting.
  it("confirms /dashboard is denied to branch-scoped profiles", () => {
    for (const role of ["admin", "employee"] as const) {
      const profile = makeProfile(role, "branch_user");
      expect(getAccessDecision(profile, "/dashboard").allowed).toBe(false);
      expect(getAccessDecision(profile, "/ar/dashboard").allowed).toBe(false);
    }
  });
});
