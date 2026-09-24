/**
 * CDN / browser cache policy for middleware responses.
 *
 * Extracted from `proxy.ts` so it can be unit tested: importing the proxy pulls
 * in next-intl and the RBAC session chain (which reaches `server-only`), neither
 * of which loads under vitest.
 *
 * This logic caused two production incidents, so its invariants are pinned in
 * `tests/proxy-cache-headers.test.ts`:
 *
 *   2026-07-04 — responses shipped with NO Cache-Control at all, so browsers and
 *                Cloudflare applied heuristic freshness and served a stale site
 *                ("users see the old site").
 *   2026-07-25 — a shared-cache directive landed on a response carrying
 *                Set-Cookie; the CDN stored it and replayed the body without the
 *                cookie, so logins bounced straight back to /login.
 */

/** Structural shape of the parts of NextResponse this module touches. */
export type CacheableResponse = {
  headers: Headers;
  cookies: { getAll: () => unknown[] };
};

export const CDN_CACHE_RULES: Array<{
  match: (p: string, isApi: boolean) => boolean;
  sMaxAge: number;
  staleRevalidate: number;
}> = [
  {
    match: (p) => p === "/api/ping" || p === "/api/health",
    sMaxAge: 30,
    staleRevalidate: 60,
  },
  // Page-only rule. API auth endpoints must never be CDN/browser cached — a cached
  // login response gets replayed without its Set-Cookie headers, leaving the client
  // "logged in" with no session cookie and bouncing straight back to /login.
  {
    match: (p, isApi) =>
      !isApi && (p.endsWith("/login") || p.endsWith("/forgot-password")),
    sMaxAge: 300,
    staleRevalidate: 600,
  },
  { match: (_p, isApi) => !isApi, sMaxAge: 0, staleRevalidate: 0 },
];

/**
 * A response that carries Set-Cookie can never be given a shared/public cache
 * directive: the CDN would store it and replay the body to other clients WITHOUT
 * the Set-Cookie, or (worse) hand one visitor another visitor's cookie.
 */
export function responseSetsCookies(response: CacheableResponse) {
  if (response.cookies.getAll().length > 0) return true;
  // Covers Set-Cookie headers copied over verbatim (e.g. from next-intl).
  return response.headers.has("set-cookie");
}

export function applyCdnCacheHeaders(
  response: CacheableResponse,
  pathname: string,
  isApiRequest: boolean,
) {
  const hasSetCookie = responseSetsCookies(response);

  for (const rule of CDN_CACHE_RULES) {
    if (!rule.match(pathname, isApiRequest)) continue;

    if (rule.sMaxAge > 0 && !hasSetCookie) {
      response.headers.set(
        "Cache-Control",
        `public, s-maxage=${rule.sMaxAge}, stale-while-revalidate=${rule.staleRevalidate}`,
      );
      response.headers.set(
        "CDN-Cache-Control",
        `public, s-maxage=${rule.sMaxAge}`,
      );
      return;
    }

    break;
  }

  // A route handler that set its own Cache-Control made a deliberate decision —
  // ~10 data routes do this via getCacheHeaders(CACHE_STRATEGIES.*). Middleware
  // headers are applied OVER handler headers, so overwriting unconditionally
  // would silently void all of them. Respect the handler, with one exception:
  // a public/shared directive on a Set-Cookie response is never safe, so that
  // combination is still forced back to private.
  const handlerCacheControl = response.headers.get("Cache-Control");
  if (handlerCacheControl) {
    const isSharedCache = /\bpublic\b|\bs-maxage\b/i.test(handlerCacheControl);
    if (!isSharedCache || !hasSetCookie) return;
  }

  // Explicit private default. Leaving Cache-Control unset lets browsers and
  // Cloudflare apply heuristic freshness and serve a stale, possibly cross-user
  // page.
  response.headers.set(
    "Cache-Control",
    isApiRequest ? "private, no-store" : "private, no-cache, must-revalidate",
  );
  response.headers.delete("CDN-Cache-Control");
}
