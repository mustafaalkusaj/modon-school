import { afterEach, describe, expect, it, vi } from "vitest";

import {
  addDaysBaghdadIso,
  addMonthsBaghdadIsoMonth,
  baghdadIsoDate,
  baghdadIsoMonth,
  endOfDayBaghdad,
  todayBaghdadIso,
  toBaghdadTimestamp,
} from "@/lib/tz";

afterEach(() => {
  vi.useRealTimers();
});

describe("baghdadIsoDate", () => {
  it("returns the Baghdad day, not the UTC day, just after midnight", () => {
    // 01:30 Baghdad on Sunday 2026-08-02 is still 22:30 UTC on Saturday.
    // The raw-UTC pattern filed this under 2026-08-01.
    expect(baghdadIsoDate(new Date("2026-08-01T22:30:00.000Z"))).toBe(
      "2026-08-02",
    );
  });

  it("agrees with UTC once Baghdad and UTC share a calendar day", () => {
    expect(baghdadIsoDate(new Date("2026-08-02T09:00:00.000Z"))).toBe(
      "2026-08-02",
    );
  });

  it("does not roll over early — 23:59 UTC is already the next Baghdad day", () => {
    expect(baghdadIsoDate(new Date("2026-08-02T23:59:59.999Z"))).toBe(
      "2026-08-03",
    );
  });

  it("holds across a month boundary", () => {
    expect(baghdadIsoDate(new Date("2026-07-31T21:00:00.000Z"))).toBe(
      "2026-08-01",
    );
  });
});

describe("todayBaghdadIso", () => {
  it("reads the Baghdad date during the first three hours of the day", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-01T21:30:00.000Z")); // 00:30 Baghdad, Aug 2
    expect(todayBaghdadIso()).toBe("2026-08-02");
    expect(new Date().toISOString().split("T")[0]).toBe("2026-08-01");
  });
});

describe("addDaysBaghdadIso", () => {
  it("returns yesterday in Baghdad terms", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-01T21:30:00.000Z")); // 00:30 Baghdad, Aug 2
    expect(addDaysBaghdadIso(-1)).toBe("2026-08-01");
    expect(addDaysBaghdadIso(0)).toBe("2026-08-02");
    expect(addDaysBaghdadIso(1)).toBe("2026-08-03");
  });
});

describe("baghdadIsoMonth", () => {
  it("files a payment taken in the 21:00–23:59 UTC window under the next month", () => {
    // 2026-06-30T21:30Z is 00:30 Baghdad on 1 July — July revenue.
    // Slicing the timestamptz directly ("2026-06") charted it a month early.
    expect(baghdadIsoMonth(new Date("2026-06-30T21:30:00.000Z"))).toBe(
      "2026-07",
    );
    expect(new Date("2026-06-30T21:30:00.000Z").toISOString().slice(0, 7)).toBe(
      "2026-06",
    );
  });

  it("leaves 20:59 UTC on the last day of the month in that month", () => {
    // 23:59 Baghdad on 30 June — still June.
    expect(baghdadIsoMonth(new Date("2026-06-30T20:59:59.999Z"))).toBe(
      "2026-06",
    );
  });

  it("crosses the year boundary", () => {
    expect(baghdadIsoMonth(new Date("2025-12-31T21:00:00.000Z"))).toBe(
      "2026-01",
    );
  });
});

describe("addMonthsBaghdadIsoMonth", () => {
  it("walks back whole Baghdad months", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-30T21:30:00.000Z")); // 00:30 Baghdad, 1 July
    expect(addMonthsBaghdadIsoMonth(0)).toBe("2026-07");
    expect(addMonthsBaghdadIsoMonth(-1)).toBe("2026-06");
    expect(addMonthsBaghdadIsoMonth(-6)).toBe("2026-01");
    expect(addMonthsBaghdadIsoMonth(-7)).toBe("2025-12");
    expect(addMonthsBaghdadIsoMonth(1)).toBe("2026-08");
  });

  it("does not skip a month when today is the 31st", () => {
    // `d.setMonth(d.getMonth() - 1)` on 31 March lands on 3 March, which would
    // emit "2026-03" twice and drop February from the six-month window.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-31T12:00:00.000Z"));
    const keys = [5, 4, 3, 2, 1, 0].map((i) => addMonthsBaghdadIsoMonth(-i));
    expect(keys).toEqual([
      "2025-10",
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
      "2026-03",
    ]);
    expect(new Set(keys).size).toBe(6);
  });

  it("agrees with baghdadIsoMonth for the current month", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-12-31T21:00:00.000Z")); // 00:00 Baghdad, 1 Jan 2027
    expect(addMonthsBaghdadIsoMonth(0)).toBe(baghdadIsoMonth());
    expect(addMonthsBaghdadIsoMonth(0)).toBe("2027-01");
  });
});

describe("existing helpers still behave", () => {
  it("endOfDayBaghdad maps to 20:59:59.999Z", () => {
    expect(endOfDayBaghdad(new Date("2026-04-30T00:00:00.000Z")).toISOString())
      .toBe("2026-04-30T20:59:59.999Z");
  });

  it("toBaghdadTimestamp appends the offset to naive datetimes", () => {
    expect(toBaghdadTimestamp("2026-06-17T09:00")).toBe(
      "2026-06-17T09:00:00+03:00",
    );
    expect(toBaghdadTimestamp("2026-06-17T09:00:00Z")).toBe(
      "2026-06-17T09:00:00Z",
    );
  });
});
