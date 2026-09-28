import { describe, expect, it } from "vitest";
import { sectionMatches, sectionOrUnassignedFilter } from "@/lib/section-scope";

describe("sectionMatches", () => {
  it("matches every student when no target section", () => {
    expect(sectionMatches("A", null)).toBe(true);
    expect(sectionMatches(null, "")).toBe(true);
  });
  it("matches the same section case-insensitively", () => {
    expect(sectionMatches("c", "C")).toBe(true);
    expect(sectionMatches(" A ", "a")).toBe(true);
  });
  it("treats students with no section as part of every section", () => {
    expect(sectionMatches(null, "A")).toBe(true);
    expect(sectionMatches("", "B")).toBe(true);
  });
  it("excludes students of a different section", () => {
    expect(sectionMatches("B", "A")).toBe(false);
  });
});

describe("sectionOrUnassignedFilter", () => {
  it("builds a quoted PostgREST or-filter", () => {
    expect(sectionOrUnassignedFilter("A")).toBe('section.ilike."A",section.is.null,section.eq.""');
  });
  it("strips quotes so the value cannot break out", () => {
    expect(sectionOrUnassignedFilter('A",id.neq.x')).toBe('section.ilike."A,id.neq.x",section.is.null,section.eq.""');
  });
});
