import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  openTemporaryPassword,
  sealTemporaryPassword,
} from "@/lib/managed-users/password-vault";

const KEY = Buffer.alloc(32, 7).toString("base64");

describe("password vault", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("round-trips and never stores plaintext", () => {
    vi.stubEnv("TEMP_PASSWORD_ENCRYPTION_KEY", KEY);
    const sealed = sealTemporaryPassword("839052");
    expect(sealed).toMatch(/^enc:v1:/);
    expect(sealed).not.toContain("839052");
    expect(openTemporaryPassword(sealed)).toBe("839052");
  });

  it("stores nothing when the key is missing", () => {
    vi.stubEnv("TEMP_PASSWORD_ENCRYPTION_KEY", "");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(sealTemporaryPassword("839052")).toBeNull();
  });

  it("returns legacy plaintext as-is and empty string for tampered values", () => {
    vi.stubEnv("TEMP_PASSWORD_ENCRYPTION_KEY", KEY);
    expect(openTemporaryPassword("123456")).toBe("123456");
    const sealed = sealTemporaryPassword("839052")!;
    expect(openTemporaryPassword(sealed.slice(0, -4) + "AAAA")).toBe("");
    expect(openTemporaryPassword(null)).toBe("");
  });
});
