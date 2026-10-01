import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const onRateLimited = { error: "too_many_attempts", message: "محاولات كثيرة" };

function request(ip: string) {
  return new NextRequest("https://example.test/api/auth/student-login", {
    method: "POST",
    headers: { "x-forwarded-for": ip },
  });
}

async function load() {
  vi.resetModules();
  return import("@/lib/rate-limit");
}

describe("enforceLoginRateLimits", () => {
  beforeEach(() => {
    // The limiter is a no-op outside production (see isLocalhost), and the
    // deployed PM2 server has no Redis, so exercise the in-memory path.
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "");
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
    vi.stubEnv("REDIS_URL", "");
    vi.stubEnv("RATE_LIMIT_TRUSTED_PROXY_SECRET", "");
  });

  it("limits one account even when every attempt comes from a new IP", async () => {
    const { enforceLoginRateLimits } = await load();
    const results = [];
    // Per-account limit is 30 attempts per 15 minutes (ACCOUNT_LOGIN_RATE_LIMIT).
    for (let i = 0; i < 32; i++) {
      results.push(
        await enforceLoginRateLimits(request(`198.51.100.${i + 1}`), {
          namespace: "t-account",
          account: "s12345",
          onRateLimited,
        }),
      );
    }
    expect(results.slice(0, 30).every((r) => r === null)).toBe(true);
    expect(results[30]?.status).toBe(429);
  });

  it("limits one IP spraying many accounts", async () => {
    const { enforceLoginRateLimits } = await load();
    let blockedAt = -1;
    for (let i = 0; i < 110; i++) {
      const res = await enforceLoginRateLimits(request("203.0.113.7"), {
        namespace: "t-ip",
        account: `s${10000 + i}`,
        onRateLimited,
      });
      if (res && blockedAt < 0) blockedAt = i;
    }
    expect(blockedAt).toBe(100);
  });
});
