import { describe, expect, it } from "vitest";

import { moderateSchoolMessage } from "@/lib/content-moderation";

describe("school message moderation", () => {
  it("allows normal Arabic school communication", () => {
    expect(
      moderateSchoolMessage("السلام عليكم، واجب الرياضيات صفحة 12"),
    ).toEqual({ allowed: true });
  });

  it("blocks explicit sexual content including separator evasion", () => {
    expect(moderateSchoolMessage("p.o.r.n content")).toMatchObject({
      allowed: false,
      category: "sexual",
    });
  });

  it("blocks direct violent threats in Arabic", () => {
    expect(moderateSchoolMessage("راح اقتلك")).toMatchObject({
      allowed: false,
      category: "threat",
    });
  });
});
