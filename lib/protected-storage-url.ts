const PRIVATE_WEB_BUCKETS = new Set([
  // `avatars` holds student/teacher photos — images of minors. It must never be
  // served by an unauthenticated public URL, so it goes through this gateway
  // like every other bucket carrying personal data.
  "avatars",
  "attachments",
  "financial-receipts",
  "grade-certificates",
  "notification-media",
  "student-photos",
  "teacher-documents",
]);

export function isPrivateWebBucket(bucket: string): boolean {
  return PRIVATE_WEB_BUCKETS.has(bucket);
}

export function buildProtectedStorageUrl(
  baseUrl: string,
  bucket: string,
  path: string,
): string {
  if (!isPrivateWebBucket(bucket)) {
    throw new Error(`Bucket ${bucket} does not use the protected web gateway.`);
  }

  const url = new URL("/api/web/storage/file", baseUrl);
  url.searchParams.set("bucket", bucket);
  url.searchParams.set("path", path);
  return url.toString();
}
