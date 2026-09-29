import { describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

// next-intl's middleware imports "next/server" without an extension, which
// vitest's ESM resolver rejects. Locale handling is not under test here.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.RBAC_COOKIE_SECRET ||= "test-secret-for-signed-in-login-redirect-0123456789";
});

vi.mock("server-only", () => ({}));
vi.mock("next-intl/middleware", () => ({
  default: () => () => NextResponse.next(),
}));

import { proxy } from "@/proxy";
import {
  RBAC_COOKIE_NAME,
  buildRBACSessionPayload,
  signRBACSession,
} from "@/lib/rbac-session";

const ORIGIN = "https://modon-school.com";

async function signStudentCookie(overrides: { userActive?: boolean } = {}) {
  const payload = buildRBACSessionPayload({
    userId: "00000000-0000-0000-0000-000000000001",
    role: "student",
    permissions: [],
    schoolId: "00000000-0000-0000-0000-0000000000aa",
    branchId: null,
    allowedBranchIds: [],
    userActive: overrides.userActive ?? true,
    schoolActive: true,
    subscriptionStatus: null,
    subscriptionEnd: null,
    scopeLevel: "restricted",
    allowedModule: null,
    allowedModules: [],
    allowedPages: [],
    defaultPath: "/student",
    isSinglePageUser: false,
    hierarchyLevel: null,
    permissionsVersion: 1,
    groupId: null,
  });
  const signed = await signRBACSession(payload);
  if (!signed) throw new Error("failed to sign test RBAC session");
  return signed;
}

function buildRequest(path: string, cookie?: string) {
  const headers = new Headers();
  if (cookie) headers.set("cookie", `${RBAC_COOKIE_NAME}=${cookie}`);
  return new NextRequest(new URL(path, ORIGIN), { headers });
}

function redirectTarget(response: Response) {
  const location = response.headers.get("location");
  return location ? new URL(location).pathname + new URL(location).search : null;
}

describe("proxy: signed-in users skip the login page", () => {
  it("sends a signed-in student from /ar/login to their home page", async () => {
    const cookie = await signStudentCookie();
    const response = await proxy(buildRequest("/ar/login", cookie));
    expect([307, 308]).toContain(response.status);
    expect(redirectTarget(response)).toBe("/ar/student");
  });

  it("also skips /ar/student-login", async () => {
    const cookie = await signStudentCookie();
    const response = await proxy(buildRequest("/ar/student-login", cookie));
    expect(redirectTarget(response)).toBe("/ar/student");
  });

  it("honours a same-origin next path", async () => {
    const cookie = await signStudentCookie();
    const response = await proxy(buildRequest("/ar/login?next=%2Far%2Fstudent%2Fgrades", cookie));
    expect(redirectTarget(response)).toBe("/ar/student/grades");
  });

  it("ignores protocol-relative and backslash next paths", async () => {
    const cookie = await signStudentCookie();
    for (const next of ["//evil.com", "/\\evil.com", "https://evil.com"]) {
      const response = await proxy(buildRequest(`/ar/login?next=${encodeURIComponent(next)}`, cookie));
      expect(redirectTarget(response)).toBe("/ar/student");
    }
  });

  it("ignores a next path that points back to login", async () => {
    const cookie = await signStudentCookie();
    const response = await proxy(buildRequest("/ar/login?next=%2Far%2Flogin", cookie));
    expect(redirectTarget(response)).toBe("/ar/student");
  });

  it("still shows the login page without a session (e.g. after logout)", async () => {
    const response = await proxy(buildRequest("/ar/login"));
    expect(response.headers.get("location")).toBeNull();
  });

  it("still shows the login page for a deactivated account", async () => {
    const cookie = await signStudentCookie({ userActive: false });
    const response = await proxy(buildRequest("/ar/login", cookie));
    expect(response.headers.get("location")).toBeNull();
  });
});
