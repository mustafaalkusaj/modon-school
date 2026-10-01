import { describe, expect, it } from "vitest";

import { mobileAdMutationSchema } from "@/lib/mobile-ads-schema";

describe("mobile ad mutation validation", () => {
  it("accepts a minimal first-party image announcement", () => {
    expect(
      mobileAdMutationSchema.safeParse({
        type: "image",
        title: "موعد اجتماع أولياء الأمور",
        social_url: "https://school.example/meeting",
      }).success,
    ).toBe(true);
  });

  it.each([
    "javascript:alert(1)",
    "http://insecure.example/file.pdf",
    "file:///private/data",
    "intent://malicious",
  ])("rejects unsafe external URL %s", (url) => {
    expect(
      mobileAdMutationSchema.safeParse({
        type: "image",
        title: "إعلان",
        social_url: url,
      }).success,
    ).toBe(false);
  });

  it("requires media for media-specific announcement types", () => {
    expect(
      mobileAdMutationSchema.safeParse({
        type: "video",
        title: "فيديو",
      }).success,
    ).toBe(false);
    expect(
      mobileAdMutationSchema.safeParse({
        type: "document",
        title: "مستند",
      }).success,
    ).toBe(false);
    expect(
      mobileAdMutationSchema.safeParse({
        type: "countdown",
        title: "موعد",
      }).success,
    ).toBe(false);
  });

  it("rejects inverted announcement windows and unknown fields", () => {
    expect(
      mobileAdMutationSchema.safeParse({
        type: "image",
        title: "إعلان",
        starts_at: "2026-08-02T10:00:00Z",
        ends_at: "2026-08-01T10:00:00Z",
      }).success,
    ).toBe(false);

    expect(
      mobileAdMutationSchema.safeParse({
        type: "image",
        title: "إعلان",
        school_id: "attacker-controlled",
      }).success,
    ).toBe(false);
  });
});
