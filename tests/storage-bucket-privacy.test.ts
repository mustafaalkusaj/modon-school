import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildProtectedStorageUrl,
  isPrivateWebBucket,
} from "@/lib/protected-storage-url";

/**
 * The `avatars` bucket holds student and teacher photos (images of minors) and
 * must never be served by a permanent public URL. These tests pin the code
 * side (PRIVATE_WEB_BUCKETS) and the migration side (the bucket privacy flip)
 * so the two cannot drift apart.
 */
const PERSONAL_DATA_BUCKETS = [
  "avatars",
  "attachments",
  "student-photos",
  "teacher-documents",
  "grade-certificates",
  "notification-media",
  "financial-receipts",
];

describe("storage bucket privacy", () => {
  it.each(PERSONAL_DATA_BUCKETS)(
    "routes %s through the protected web gateway",
    (bucket) => {
      expect(isPrivateWebBucket(bucket)).toBe(true);
    },
  );

  it("builds a tenant-scoped gateway URL for avatar objects", () => {
    const url = buildProtectedStorageUrl(
      "https://example.test",
      "avatars",
      "school-uuid/1785000000-object.jpg",
    );

    const parsed = new URL(url);
    expect(parsed.pathname).toBe("/api/web/storage/file");
    expect(parsed.searchParams.get("bucket")).toBe("avatars");
    // The school id stays the leading path segment: the gateway derives
    // tenancy from it, so losing the prefix would break access control.
    expect(parsed.searchParams.get("path")).toMatch(/^school-uuid\//);
  });

  it("refuses to build a gateway URL for a bucket that is not private", () => {
    expect(() =>
      buildProtectedStorageUrl("https://example.test", "school-logos", "a.png"),
    ).toThrow(/does not use the protected web gateway/);
  });
});

describe("storage migrations", () => {
  const migrationsDir = join(process.cwd(), "supabase", "migrations");
  const flip = readFileSync(
    join(migrationsDir, "MANUAL_20261001090300_storage_bucket_privacy_flip.sql"),
    "utf8",
  );
  const buckets = readFileSync(
    join(migrationsDir, "20261001090200_storage_buckets_and_policies.sql"),
    "utf8",
  );

  it.each(PERSONAL_DATA_BUCKETS.filter((b) => b !== "financial-receipts"))(
    "flips %s to private",
    (bucket) => {
      expect(flip).toContain(`'${bucket}'`);
    },
  );

  it("never makes the public logo buckets private", () => {
    expect(flip).not.toMatch(/'(school|branch)-logos'/);
    expect(buckets).toMatch(/'school-logos',\s+'school-logos',\s+true/);
    expect(buckets).toMatch(/'branch-logos',\s+'branch-logos',\s+true/);
  });

  it("creates school-media and financial-receipts as private buckets", () => {
    expect(buckets).toMatch(/'school-media',\s+'school-media',\s+false/);
    expect(buckets).toMatch(/'financial-receipts',\s+'financial-receipts',\s+false/);
  });

  it("scopes every school-media policy to the caller's school folder", () => {
    const policies = buckets.match(/CREATE POLICY school_media_[a-z_]+/g) ?? [];
    expect(policies).toHaveLength(4);
    expect(buckets).toContain("(storage.foldername(name))[1] = (SELECT public.current_school_id())::text");
  });
});
