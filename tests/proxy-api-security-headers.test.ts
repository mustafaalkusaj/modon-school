import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Regression guard for the 2026-07-29 audit finding SEC-F (HIGH).
 *
 * `applyBaseSecurityHeaders` was called only inside `if (!isApiRequest)`, so
 * every one of the 338 routes under `/api/**` returned with no HSTS, no
 * `X-Content-Type-Options`, no `Referrer-Policy` and no framing protection.
 *
 * `nosniff` is the one that carries real weight for a JSON API: without it a
 * browser may re-interpret an error body as HTML.
 *
 * A behavioural test would have to construct a NextRequest and stand up the
 * whole middleware (rate limiting, intl, RBAC cookie verification), so this
 * pins the wiring at the source level instead — the same shape as the other
 * audit guards in this suite.
 */

const source = readFileSync(join(process.cwd(), "proxy.ts"), "utf8");

/** Body of applyApiSecurityHeaders, sliced so assertions cannot match the page path. */
function apiHeaderFn(): string {
  const start = source.indexOf("function applyApiSecurityHeaders");
  expect(start).toBeGreaterThan(-1);
  const next = source.indexOf("export async function proxy", start);
  expect(next).toBeGreaterThan(start);
  return source.slice(start, next);
}

describe("proxy: API response security headers", () => {
  it("defines a dedicated API header helper", () => {
    expect(source).toContain("function applyApiSecurityHeaders");
  });

  it("invokes it for API requests", () => {
    expect(source).toMatch(
      /if \(isApiRequest\) \{\s*applyApiSecurityHeaders\(response, requestId\);/,
    );
  });

  it.each([
    ["X-Content-Type-Options", "nosniff"],
    ["Referrer-Policy", "strict-origin-when-cross-origin"],
    ["X-Frame-Options", "DENY"],
    ["Cross-Origin-Resource-Policy", "same-origin"],
  ])("sets %s on API responses", (header, value) => {
    const fn = apiHeaderFn();
    expect(fn).toContain(header);
    expect(fn).toContain(value);
  });

  it("sets HSTS only in production", () => {
    const fn = apiHeaderFn();
    expect(fn).toContain("Strict-Transport-Security");
    expect(fn).toMatch(
      /process\.env\.NODE_ENV === "production"[\s\S]*Strict-Transport-Security/,
    );
  });

  it("does not put the nonce-based page CSP on API responses", () => {
    // A nonce CSP is meaningless for JSON, and `default-src 'none'` would risk
    // breaking the inline PDF/spreadsheet bodies some export routes return.
    expect(apiHeaderFn()).not.toContain("Content-Security-Policy");
  });

  it("still applies the full page header set to non-API responses", () => {
    // The API branch must be additive, not a replacement.
    expect(source).toMatch(
      /if \(!isApiRequest\) \{\s*applyBaseSecurityHeaders\(/,
    );
  });
});
