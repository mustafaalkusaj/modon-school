import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Regression guard for the 2026-07-29 audit finding SEC-C (HIGH).
 *
 * Attack chain, traced end to end:
 *
 *  1. `app/api/mobile/teacher/storage/upload-url/route.ts:92` builds the object
 *     key SERVER-SIDE as `${schoolId}/${teacherId}/${folder}/...`, so a teacher
 *     never chooses their own path.
 *  2. `extractAttachmentMetadata` in lib/academic-records-server.ts took
 *     `{bucket, path}` straight from the request body with no prefix check, no
 *     `..` check and no bucket pin, and wrote it to `assignments.attachment_path`
 *     on a service-role client.
 *  3. `app/api/mobile/shared/storage/download-url/route.ts` grants a signed URL
 *     when an assignment matches the requested `attachment_path` AND targets the
 *     caller. So teacher B could create an assignment pointing at teacher A's
 *     private file, and every student that assignment targets became authorised
 *     to download it.
 *
 * The download route itself is sound — it pins the bucket, requires the school
 * prefix, rejects `..` and fails closed. The hole was on the WRITE side, which
 * is why the guard belongs where the teacher identity is known.
 *
 * A mutation test proved this file was necessary: weakening the prefix check
 * left all 995 existing tests passing.
 */

const source = readFileSync(
  join(process.cwd(), "lib", "academic-records-server.ts"),
  "utf8",
);

describe("assignment attachments stay inside the teacher's prefix", () => {
  it("defines the prefix guard", () => {
    expect(source).toContain("function isAttachmentWithinTeacherPrefix");
  });

  it("pins the bucket, the teacher prefix and rejects traversal", () => {
    expect(source).toContain('attachment.bucket === "school-media"');
    expect(source).toContain(
      "attachment.path.startsWith(`${schoolId}/${teacherId}/`)",
    );
    expect(source).toContain('!attachment.path.includes("..")');
  });

  it("treats a missing attachment as nothing to validate", () => {
    // The guard must not reject assignments that carry no attachment at all.
    const body = source.slice(
      source.indexOf("function isAttachmentWithinTeacherPrefix"),
    );
    expect(body.slice(0, 400)).toMatch(/if \(!attachment\) \{\s*return true;/);
  });

  it("is enforced on BOTH the create and the update path", () => {
    // Two call sites: createTeacherAssignmentRecord and
    // updateTeacherAssignmentRecord. Guarding only one leaves the other open.
    const calls = source.split("!isAttachmentWithinTeacherPrefix(").length - 1;
    expect(calls).toBe(2);
  });

  it("passes the resolved server-side identity, never request input", () => {
    // `ctx.schoolId` and `teacher.id` are resolved by the route context. If a
    // future edit passed a body-supplied id the guard would validate nothing.
    const occurrences = source.split("isAttachmentWithinTeacherPrefix(");
    for (const call of occurrences.slice(1)) {
      const args = call.slice(0, 160);
      if (!args.includes("attachment.attachment")) continue;
      expect(args).toContain("ctx.schoolId");
      expect(args).toContain("teacher.id");
    }
  });

  it("runs the guard before the assignments insert", () => {
    const guardIndex = source.indexOf("!isAttachmentWithinTeacherPrefix(");
    const insertIndex = source.indexOf('.from("assignments")');
    expect(guardIndex).toBeGreaterThan(-1);
    expect(insertIndex).toBeGreaterThan(-1);
    expect(guardIndex).toBeLessThan(insertIndex);
  });
});
