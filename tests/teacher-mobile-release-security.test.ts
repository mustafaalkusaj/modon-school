import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
// The mobile app lives in its own repository. Point MOBILE_REPO_ROOT at its
// checkout to run the assertions about its files; without it (CI checks out the
// web app only) they are reported as skipped instead of failing on ENOENT.
const mobileRoot = process.env.MOBILE_REPO_ROOT
  ? path.resolve(root, process.env.MOBILE_REPO_ROOT)
  : null;
const hasMobileRepo =
  mobileRoot !== null && fs.existsSync(path.join(mobileRoot, "lib"));

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function readMobile(relativePath: string) {
  return fs.readFileSync(path.join(mobileRoot as string, relativePath), "utf8");
}

describe("teacher mobile release security contract", () => {
  it("enforces grade ranges in the application layer", () => {
    const server = read("lib/academic-records-server.ts");
    expect(server).toContain("score === null || score < 0");
    expect(server).toContain("score > maxScore");
  });

  it.skipIf(!hasMobileRepo)(
    "makes mobile teacher and message writes API-only (mobile repo)",
    () => {
      const teacherData = readMobile("lib/teacher-data.ts");
      const messaging = readMobile("lib/messaging.ts");
      expect(teacherData).not.toContain(
        "recordAttendance API fell back to Supabase",
      );
      expect(teacherData).not.toContain(
        "createAssignment API fell back to Supabase",
      );
      expect(teacherData).not.toContain(
        "createGrade API fell back to Supabase",
      );
      expect(messaging).not.toContain("sendMessage API fell back to Supabase");
      expect(messaging).not.toMatch(/\.from\(['"]messages['"]\)\s*\.insert/);
    },
  );

  it("enforces message blocks and provides report/block endpoints", () => {
    const server = read("lib/mobile-api-server.ts");
    expect(server).toContain(
      'untypedTable(ctx.serviceSupabase, "messaging_blocks")',
    );
    expect(server).toContain("moderateSchoolMessage(body)");
    expect(
      fs.existsSync(
        path.join(root, "app/api/mobile/shared/messages/report/route.ts"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(root, "app/api/mobile/shared/messages/block/route.ts"),
      ),
    ).toBe(true);
  });

  it("creates exams through the atomic RPC", () => {
    const route = read("app/api/mobile/teacher/exams/route.ts");
    expect(route).toContain('rpc("create_exam_atomic"');
  });

  it.skipIf(!hasMobileRepo)(
    "uses server-issued signed storage URLs (mobile repo)",
    () => {
      const storage = readMobile("lib/storage.ts");
      expect(storage).not.toContain("supabase.storage");
      expect(storage).toContain("/api/mobile/teacher/storage/upload-url");
      expect(storage).toContain("/api/mobile/teacher/storage/finalize");
      expect(storage).toContain("/api/mobile/shared/storage/download-url");
    },
  );

  it("validates and strips uploaded images server-side", () => {
    const finalize = read("app/api/mobile/teacher/storage/finalize/route.ts");
    expect(finalize).toContain("hasExpectedMagic");
    expect(finalize).toContain("stripImageMetadata");
    expect(finalize).toContain('productionFailureMode: "fail-closed"');
  });
});
