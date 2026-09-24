import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

function splitSql(source) {
  const statements = [];
  let current = "";
  let quote = null;
  let dollarTag = null;
  let lineComment = false;
  let blockComment = false;

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];

    if (lineComment) {
      current += char;
      if (char === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      current += char;
      if (char === "*" && next === "/") {
        current += next;
        i += 1;
        blockComment = false;
      }
      continue;
    }
    if (dollarTag) {
      if (source.startsWith(dollarTag, i)) {
        current += dollarTag;
        i += dollarTag.length - 1;
        dollarTag = null;
      } else {
        current += char;
      }
      continue;
    }
    if (quote) {
      current += char;
      if (char === quote) {
        if (next === quote) {
          current += next;
          i += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }

    if (char === "-" && next === "-") {
      current += char + next;
      i += 1;
      lineComment = true;
      continue;
    }
    if (char === "/" && next === "*") {
      current += char + next;
      i += 1;
      blockComment = true;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      current += char;
      continue;
    }
    if (char === "$") {
      const match = source.slice(i).match(/^\$[A-Za-z0-9_]*\$/);
      if (match) {
        dollarTag = match[0];
        current += dollarTag;
        i += dollarTag.length - 1;
        continue;
      }
    }
    if (char === ";") {
      if (current.trim()) statements.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }

  if (current.trim()) statements.push(current.trim());
  return statements;
}

function withoutLeadingComments(statement) {
  let value = statement.trimStart();
  while (value.startsWith("--") || value.startsWith("/*")) {
    if (value.startsWith("--")) {
      const newline = value.indexOf("\n");
      value = newline === -1 ? "" : value.slice(newline + 1).trimStart();
      continue;
    }
    const end = value.indexOf("*/");
    value = end === -1 ? "" : value.slice(end + 2).trimStart();
  }
  return value.trim();
}

function isTransactionControl(statement) {
  const normalized = withoutLeadingComments(statement)
    .replace(/\s+/g, " ")
    .toUpperCase();
  return /^(?:BEGIN|START TRANSACTION|COMMIT|ROLLBACK)(?: WORK| TRANSACTION)?$/.test(
    normalized,
  );
}

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("Usage: node scripts/validate-migrations-rollback.mjs <migration.sql> [...]");
  process.exit(1);
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "school-migration-validation-"));
try {
  const combinedStatements = [];
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    const statements = splitSql(source);
    const executable = statements.filter(
      (statement) => !isTransactionControl(statement),
    );
    const removedControls = statements.length - executable.length;
    console.log(
      `${file}: queued ${executable.length} statements` +
        (removedControls > 0
          ? ` (${removedControls} transaction controls removed)`
          : ""),
    );
    combinedStatements.push(
      `-- BEGIN ${file}`,
      ...executable.map((statement) => `${statement};`),
      `-- END ${file}`,
    );
  }

  const validationFile = path.join(tempDir, "validate-all.sql");
  fs.writeFileSync(
    validationFile,
    [
      "BEGIN;",
      "SET LOCAL lock_timeout = '5s';",
      "SET LOCAL statement_timeout = '60s';",
      ...combinedStatements,
      "ROLLBACK;",
      "",
    ].join("\n"),
    { mode: 0o600 },
  );

  const result = spawnSync(
    "supabase",
    ["db", "query", "--linked", "--file", validationFile],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 90_000,
      maxBuffer: 10 * 1024 * 1024,
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.stderr.write(
      result.stderr || result.stdout || "Migration validation failed.\n",
    );
    process.exitCode = result.status || 1;
  } else {
    console.log(
      `All ${files.length} migrations validated sequentially; transaction rolled back.`,
    );
  }
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
