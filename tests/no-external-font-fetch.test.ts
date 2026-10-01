import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Regression guard for the 2026-07-29 privacy audit finding on Google Fonts.
 *
 * Three surfaces pulled webfonts with a client-side
 * `@import url('https://fonts.googleapis.com/...')`. That makes the VIEWER's
 * browser connect to Google and send its IP address, User-Agent and a
 * `Referer` naming the page — with no DPA and no legal basis. Germany's
 * LG München I ruled exactly this transfer unlawful in 3 O 17493/20.
 *
 * The worst of the three was `lib/grades/report-card-pdf.ts`, where the
 * referring document is a NAMED CHILD'S REPORT CARD.
 *
 * The project already had the correct pattern in five other print modules:
 *
 *   @font-face { font-family: "Noto Sans Arabic";
 *                src: url("/fonts/noto-sans-arabic/NotoSansArabic-Variable.ttf")
 *                     format("truetype"); }
 *
 * so the fix was to stop being inconsistent, not to invent anything.
 *
 * Comments are stripped before scanning: the fixed files explain the finding
 * in prose that necessarily contains the domain, and matching that would make
 * the guard fail on its own documentation.
 */

const ROOT = process.cwd();
const SCAN_DIRS = ["app", "lib", "components"];
const SCAN_EXTENSIONS = [".ts", ".tsx", ".css", ".mjs", ".js"];

const EXTERNAL_FONT_HOSTS = [
  "fonts.googleapis.com",
  "fonts.gstatic.com",
  "use.typekit.net",
  "fonts.bunny.net",
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry.startsWith("."))
      continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (SCAN_EXTENSIONS.some((ext) => full.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const files = SCAN_DIRS.flatMap((dir) => {
  try {
    return walk(join(ROOT, dir));
  } catch {
    return [];
  }
});

describe("no external webfont fetches", () => {
  it("scans a meaningful number of source files", () => {
    // A silent zero would make the assertions below vacuous.
    expect(files.length).toBeGreaterThan(200);
  });

  it.each(EXTERNAL_FONT_HOSTS)("never fetches fonts from %s", (host) => {
    const offenders = files.filter((file) =>
      stripComments(readFileSync(file, "utf8")).includes(host),
    );
    expect(
      offenders.map((file) => file.replace(`${ROOT}/`, "")),
      "Self-host the font instead. Use the @font-face already in lib/print/receipt-styled.ts pointing at /fonts/noto-sans-arabic/NotoSansArabic-Variable.ttf.",
    ).toEqual([]);
  });

  it("keeps the self-hosted face available to the print surfaces", () => {
    // If this asset is moved or renamed, every print surface silently falls
    // back to a Latin font for Arabic text.
    const fontPath = join(
      ROOT,
      "public",
      "fonts",
      "noto-sans-arabic",
      "NotoSansArabic-Variable.ttf",
    );
    expect(statSync(fontPath).size).toBeGreaterThan(100_000);
  });

  it("wires the report card to the self-hosted face", () => {
    const reportCard = readFileSync(
      join(ROOT, "lib", "grades", "report-card-pdf.ts"),
      "utf8",
    );
    expect(reportCard).toContain(
      "/fonts/noto-sans-arabic/NotoSansArabic-Variable.ttf",
    );
    expect(reportCard).toContain("font-family: 'Noto Sans Arabic'");
  });
});
