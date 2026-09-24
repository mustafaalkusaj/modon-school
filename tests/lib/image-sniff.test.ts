import { describe, expect, it } from "vitest";

import { sniffImageType } from "@/lib/image-sniff";

const buf = (bytes: number[]) => new Uint8Array(bytes).buffer;

describe("sniffImageType", () => {
  it("detects JPEG, PNG and WebP from their magic bytes", () => {
    expect(sniffImageType(buf([0xff, 0xd8, 0xff, 0xe0]))?.mime).toBe("image/jpeg");
    expect(sniffImageType(buf([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))?.ext).toBe("png");
    expect(
      sniffImageType(buf([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))?.ext,
    ).toBe("webp");
  });

  it("rejects non-images regardless of what the client claims", () => {
    expect(sniffImageType(new TextEncoder().encode("<html><script>").buffer)).toBeNull();
    expect(sniffImageType(buf([0x25, 0x50, 0x44, 0x46]))).toBeNull(); // %PDF
    expect(sniffImageType(buf([]))).toBeNull();
  });
});
