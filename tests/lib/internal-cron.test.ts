import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cronMatches, parseCron } from "@/lib/cron/schedule";

const at = (iso: string) => new Date(iso);

describe("cron schedule matcher (UTC)", () => {
  it("matches fixed times", () => {
    const daily = parseCron("0 21 * * *");
    expect(cronMatches(daily, at("2026-09-24T21:00:00Z"))).toBe(true);
    expect(cronMatches(daily, at("2026-09-24T21:01:00Z"))).toBe(false);
    expect(cronMatches(daily, at("2026-09-24T20:00:00Z"))).toBe(false);
  });

  it("supports steps, day-of-week and day-of-month", () => {
    const every5 = parseCron("*/5 * * * *");
    expect(cronMatches(every5, at("2026-09-24T10:35:00Z"))).toBe(true);
    expect(cronMatches(every5, at("2026-09-24T10:36:00Z"))).toBe(false);

    const friday = parseCron("0 20 * * 5");
    expect(cronMatches(friday, at("2026-09-25T20:00:00Z"))).toBe(true); // Friday
    expect(cronMatches(friday, at("2026-09-24T20:00:00Z"))).toBe(false); // Thursday

    const monthly = parseCron("0 10 1 * *");
    expect(cronMatches(monthly, at("2026-10-01T10:00:00Z"))).toBe(true);
    expect(cronMatches(monthly, at("2026-10-02T10:00:00Z"))).toBe(false);
  });

  it("treats 7 as Sunday and ORs restricted day fields", () => {
    expect(cronMatches(parseCron("0 0 * * 7"), at("2026-09-27T00:00:00Z"))).toBe(true);
    const either = parseCron("0 0 1 * 1");
    expect(cronMatches(either, at("2026-09-28T00:00:00Z"))).toBe(true); // Monday
    expect(cronMatches(either, at("2026-10-01T00:00:00Z"))).toBe(true); // 1st
  });

  it("rejects malformed expressions", () => {
    expect(() => parseCron("* * * *")).toThrow();
    expect(() => parseCron("60 * * * *")).toThrow();
    expect(() => parseCron("*/0 * * * *")).toThrow();
  });
});

describe("internal scheduler", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    delete (globalThis as Record<symbol, unknown>)[Symbol.for("modon.internalCronScheduler")];
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("only starts in production outside Vercel unless disabled", async () => {
    const { shouldStartInternalScheduler } = await import("@/lib/cron/internal-scheduler");
    expect(shouldStartInternalScheduler({ NODE_ENV: "production" } as NodeJS.ProcessEnv)).toBe(true);
    expect(shouldStartInternalScheduler({ NODE_ENV: "production", VERCEL: "1" } as NodeJS.ProcessEnv)).toBe(false);
    expect(shouldStartInternalScheduler({ NODE_ENV: "development" } as NodeJS.ProcessEnv)).toBe(false);
    expect(shouldStartInternalScheduler({ NODE_ENV: "production", INTERNAL_CRON: "off" } as NodeJS.ProcessEnv)).toBe(false);
  });

  it("calls due routes with the cron secret", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.setSystemTime(new Date("2026-09-24T20:59:30Z"));

    const { startInternalScheduler } = await import("@/lib/cron/internal-scheduler");
    startInternalScheduler({ NODE_ENV: "production", CRON_SECRET: "s3cret", PORT: "3003" } as NodeJS.ProcessEnv);

    await vi.advanceTimersByTimeAsync(40_000); // first tick lands at 21:00:10
    const urls = fetchMock.mock.calls.map(([url]) => url as string);
    expect(urls).toEqual(
      expect.arrayContaining([
        "http://127.0.0.1:3003/api/cron/scheduled-notifications",
        "http://127.0.0.1:3003/api/ops/daily-report",
        "http://127.0.0.1:3003/api/web/calendar/daily-check",
      ]),
    );
    expect(urls).not.toContain("http://127.0.0.1:3003/api/ops/weekly-report");
    expect(fetchMock.mock.calls[0][1].headers.authorization).toBe("Bearer s3cret");

    // A second start (e.g. re-imported module) must not double the schedule.
    startInternalScheduler({ NODE_ENV: "production", CRON_SECRET: "s3cret", PORT: "3003" } as NodeJS.ProcessEnv);
    fetchMock.mockClear();
    await vi.advanceTimersByTimeAsync(5 * 60_000); // through 21:05
    const notifCalls = fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/scheduled-notifications"));
    expect(notifCalls).toHaveLength(1);
  });

  it("does not start without CRON_SECRET", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { startInternalScheduler } = await import("@/lib/cron/internal-scheduler");
    startInternalScheduler({ NODE_ENV: "production" } as NodeJS.ProcessEnv);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
