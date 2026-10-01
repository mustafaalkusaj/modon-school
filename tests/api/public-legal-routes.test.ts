import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (relativePath: string) =>
  fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");

describe("public store-policy routes", () => {
  it.each(["terms", "account-deletion"])(
    "provides a localized public page for %s",
    (slug) => {
      expect(fs.existsSync(path.join(process.cwd(), `app/[locale]/${slug}/page.tsx`))).toBe(true);
    },
  );

  it("keeps privacy, terms, and deletion outside the authenticated route guard", () => {
    const roles = read("types/roles.ts");
    expect(roles).toContain('"/privacy"');
    expect(roles).toContain('"/terms"');
    expect(roles).toContain('"/account-deletion"');
  });

  it("contains English and Arabic legal content", () => {
    expect(read("app/terms/page.tsx")).toContain("Terms of Use and Content Safety");
    expect(read("app/terms/page.tsx")).toContain("شروط الاستخدام وسلامة المحتوى");
    expect(read("app/account-deletion/page.tsx")).toContain("Account and data deletion request");
    expect(read("app/account-deletion/page.tsx")).toContain("طلب حذف الحساب والبيانات");
  });
});
