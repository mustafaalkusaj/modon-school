import { describe, expect, it } from "vitest";

import {
  getManagedLoginLocalPart,
  toManagedAuthEmail,
} from "@/lib/managed-users/auth-email";

describe("toManagedAuthEmail", () => {
  it("maps Arabic student prefix to an ASCII-only email", () => {
    expect(toManagedAuthEmail("ط1234")).toBe("st1234@schoolapp.local");
  });

  it("maps Arabic teacher prefix to an ASCII-only email", () => {
    expect(toManagedAuthEmail("م5678")).toBe("tc5678@schoolapp.local");
  });

  it("replaces any other non-ASCII character", () => {
    expect(toManagedAuthEmail("ع99")).toBe("u99@schoolapp.local");
  });

  it("keeps plain ASCII identifiers", () => {
    expect(toManagedAuthEmail("driver.ali")).toBe("driver.ali@schoolapp.local");
  });

  it("returns real emails untouched", () => {
    expect(toManagedAuthEmail("user@school.edu")).toBe("user@school.edu");
  });

  it("maps an Arabic identifier that already carries the managed domain", () => {
    expect(toManagedAuthEmail("ط1234@schoolapp.local")).toBe("st1234@schoolapp.local");
  });

  it("never produces a non-ASCII email", () => {
    expect(toManagedAuthEmail(" ط 12 ")).toMatch(/^[\x21-\x7E]+$/);
  });
});

describe("getManagedLoginLocalPart", () => {
  it("returns the local part for managed emails", () => {
    expect(getManagedLoginLocalPart("ط1234@schoolapp.local")).toBe("ط1234");
  });

  it("returns null for real emails", () => {
    expect(getManagedLoginLocalPart("user@school.edu")).toBeNull();
  });

  it("returns null for bare identifiers", () => {
    expect(getManagedLoginLocalPart("ط1234")).toBeNull();
  });
});
