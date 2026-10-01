import { describe, expect, it } from "vitest";
import { NextResponse } from "next/server";

import { applyCdnCacheHeaders } from "@/lib/cdn-cache-policy";

/**
 * These invariants are not academic. This helper is the direct cause of two
 * production incidents:
 *
 *   2026-07-04 — pages shipped with NO Cache-Control at all, so browsers and
 *                Cloudflare applied heuristic freshness and served a stale site.
 *   2026-07-25 — a shared-cache directive landed on a response carrying
 *                Set-Cookie; the CDN stored it and replayed the body without the
 *                cookie, so every login silently logged the user back out.
 *
 * Both were invisible to typecheck and to every other test. Pin them here.
 */

function makeResponse(init?: { cookie?: boolean; cacheControl?: string }) {
  const response = NextResponse.next();
  if (init?.cacheControl) {
    response.headers.set("Cache-Control", init.cacheControl);
  }
  if (init?.cookie) {
    response.cookies.set("lm", "restricted");
  }
  return response;
}

describe("applyCdnCacheHeaders", () => {
  describe("never gives a shared cache directive to a Set-Cookie response", () => {
    it("downgrades the public login rule when a cookie is attached", () => {
      const response = makeResponse({ cookie: true });

      applyCdnCacheHeaders(response, "/login", false);

      const cacheControl = response.headers.get("Cache-Control") ?? "";
      expect(cacheControl).not.toMatch(/public|s-maxage/i);
      expect(response.headers.get("CDN-Cache-Control")).toBeNull();
    });

    it("overrides even an explicit handler directive when it is shared and a cookie is attached", () => {
      const response = makeResponse({
        cookie: true,
        cacheControl: "public, s-maxage=300",
      });

      applyCdnCacheHeaders(response, "/api/web/students/list", true);

      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(response.headers.get("CDN-Cache-Control")).toBeNull();
    });
  });

  describe("never leaves Cache-Control unset", () => {
    it("sets an explicit private default on an unmatched page", () => {
      const response = makeResponse();

      applyCdnCacheHeaders(response, "/some/page/with/no/rule", false);

      expect(response.headers.get("Cache-Control")).toBe(
        "private, no-cache, must-revalidate",
      );
    });

    it("sets no-store on an unmatched API route", () => {
      const response = makeResponse();

      applyCdnCacheHeaders(response, "/api/web/anything", true);

      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    });
  });

  describe("respects a deliberate route-handler decision", () => {
    // ~10 data routes set their own header via getCacheHeaders(CACHE_STRATEGIES.*).
    // Middleware headers apply OVER handler headers, so a blanket default here
    // would silently void every one of them.
    it("keeps a private handler directive on an API route", () => {
      const response = makeResponse({
        cacheControl: "private, max-age=300, stale-while-revalidate=60",
      });

      applyCdnCacheHeaders(response, "/api/web/students/list", true);

      expect(response.headers.get("Cache-Control")).toBe(
        "private, max-age=300, stale-while-revalidate=60",
      );
    });

    it("keeps a shared handler directive on a rule-less path when no cookie is attached", () => {
      const response = makeResponse({ cacheControl: "public, s-maxage=30" });

      applyCdnCacheHeaders(response, "/api/web/reference-data", true);

      expect(response.headers.get("Cache-Control")).toBe("public, s-maxage=30");
    });

    it("lets a CDN_CACHE_RULES match win over the handler on /api/health", () => {
      // Rule 1 owns the health probes: postdeploy-smoke.mjs and uptime-check.mjs
      // depend on them staying shared-cacheable at s-maxage=30.
      const response = makeResponse({ cacheControl: "private, no-store" });

      applyCdnCacheHeaders(response, "/api/health", true);

      expect(response.headers.get("Cache-Control")).toBe(
        "public, s-maxage=30, stale-while-revalidate=60",
      );
    });
  });
});
