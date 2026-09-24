/**
 * Supabase schema drift guard.
 *
 * Extracts every `.from("table") ... .select("cols")` pair from app/api and lib,
 * then validates the resolved table.column pairs against information_schema on the
 * target database.
 *
 * Usage:
 *   node scripts/check-schema-drift.mjs [--json] [--verbose]
 *
 * Exit codes: 0 = no drift, 1 = drift found or check could not run.
 */

import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const SCAN_TARGETS = [
  { dir: "app/api", match: (file) => file === "route.ts" },
  { dir: "lib", match: (file) => file.endsWith(".ts") && !file.endsWith(".d.ts") },
];
const SCHEMA = "public";

function parseEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  return Object.fromEntries(
    fs.readFileSync(file, "utf8")
      .split(/\r?\n/)
      .filter((line) => line && !line.trimStart().startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^["']|["']$/g, "")];
      }),
  );
}

function collectFiles(cwd) {
  const files = [];
  for (const target of SCAN_TARGETS) {
    const root = path.join(cwd, target.dir);
    if (!fs.existsSync(root)) continue;
    const stack = [root];
    while (stack.length > 0) {
      const current = stack.pop();
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "node_modules" || entry.name === "__tests__") continue;
          stack.push(full);
        } else if (entry.isFile() && target.match(entry.name)) {
          files.push(full);
        }
      }
    }
  }
  return files.sort();
}

function staticString(node, consts) {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node)) {
    return staticString(node.expression, consts);
  }
  if (ts.isIdentifier(node)) return consts?.get(node.text) ?? null;
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = staticString(node.left, consts);
    const right = staticString(node.right, consts);
    return left === null || right === null ? null : left + right;
  }
  if (ts.isTemplateExpression(node)) {
    let out = node.head.text;
    for (const span of node.templateSpans) {
      const value = staticString(span.expression, consts);
      if (value === null) return null;
      out += value + span.literal.text;
    }
    return out;
  }
  return null;
}

function collectStringConsts(sourceFile) {
  const consts = new Map();
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const value = staticString(node.initializer, consts);
      if (value !== null) consts.set(node.name.text, value);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return consts;
}

function calleeName(node) {
  if (!ts.isCallExpression(node)) return null;
  const target = node.expression;
  if (ts.isPropertyAccessExpression(target)) return target.name.text;
  if (ts.isElementAccessExpression(target)) return staticString(target.argumentExpression, null);
  return null;
}

function resolveFromTable(selectCall, consts) {
  let node = selectCall.expression;
  while (node) {
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      node = node.expression;
      continue;
    }
    if (ts.isCallExpression(node)) {
      if (calleeName(node) === "from") {
        return { table: staticString(node.arguments[0], consts), found: true };
      }
      node = node.expression;
      continue;
    }
    if (ts.isNonNullExpression(node) || ts.isParenthesizedExpression(node) || ts.isAsExpression(node)) {
      node = node.expression;
      continue;
    }
    return { table: null, found: false };
  }
  return { table: null, found: false };
}

function extractSelects(file, source) {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const consts = collectStringConsts(sourceFile);
  const results = [];
  const visit = (node) => {
    if (ts.isCallExpression(node) && calleeName(node) === "select") {
      const { table, found } = resolveFromTable(node, consts);
      const columns = staticString(node.arguments[0], consts);
      const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
      if (found) results.push({ file, line, table, columns, hasColumnsArg: node.arguments.length > 0 });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return results;
}

function splitTopLevel(input) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let buffer = "";
  for (const char of input) {
    if (quote) {
      buffer += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      buffer += char;
      continue;
    }
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(buffer);
      buffer = "";
      continue;
    }
    buffer += char;
  }
  parts.push(buffer);
  return parts.map((part) => part.trim()).filter(Boolean);
}

function stripAlias(item) {
  let depth = 0;
  let quote = null;
  for (let i = 0; i < item.length; i += 1) {
    const char = item[i];
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === ":" && depth === 0) {
      if (item[i + 1] === ":") { i += 1; continue; }
      return { alias: item.slice(0, i).trim(), rest: item.slice(i + 1).trim() };
    }
  }
  return { alias: null, rest: item };
}

function normalizeColumn(raw) {
  let value = raw.trim();
  if (!value) return null;
  value = value.split("::")[0].trim();
  value = value.split("->")[0].trim();
  value = value.replace(/\.(asc|desc|nullsfirst|nullslast)$/i, "");
  value = value.replace(/^"(.*)"$/s, "$1");
  if (!value) return null;
  if (value === "*") return null;
  if (value.endsWith("()")) return null;
  if (/\.(count|sum|avg|min|max)$/i.test(value)) return null;
  if (value === "count") return null;
  if (!/^[A-Za-z_][A-Za-z0-9_ ]*$/.test(value)) return { unparsed: raw.trim() };
  return { column: value };
}

function resolveSelect(table, columns, knownTables) {
  const pairs = [];
  const skipped = [];

  const walk = (currentTable, list, pathLabel) => {
    for (const item of splitTopLevel(list)) {
      const { rest } = stripAlias(item);
      const open = rest.indexOf("(");

      if (open === -1) {
        if (rest === "*" || rest.startsWith("...")) continue;
        const parsed = normalizeColumn(rest);
        if (!parsed) continue;
        if (parsed.unparsed) {
          skipped.push({ reason: "unparsed column expression", detail: `${pathLabel}: ${parsed.unparsed}` });
          continue;
        }
        if (currentTable === null) continue;
        pairs.push({ table: currentTable, column: parsed.column });
        continue;
      }

      const close = rest.lastIndexOf(")");
      const inner = close > open ? rest.slice(open + 1, close) : "";
      let relation = rest.slice(0, open).trim();
      relation = relation.replace(/^\.\.\./, "");
      relation = relation.split("!")[0].trim();
      relation = relation.replace(/^"(.*)"$/s, "$1");

      if (/\.(count|sum|avg|min|max)$/i.test(relation)) continue;

      if (knownTables.has(relation)) {
        walk(relation, inner, `${pathLabel}.${relation}`);
      } else {
        skipped.push({ reason: "embed target is not a table name", detail: `${pathLabel}.${relation}(...)` });
        walk(null, inner, `${pathLabel}.${relation}`);
      }
    }
  };

  walk(table, columns, table);
  return { pairs, skipped };
}

async function introspect(connectionString) {
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const tableRows = await client.query(
      "select table_name from information_schema.tables where table_schema = $1",
      [SCHEMA],
    );
    const columnRows = await client.query(
      "select table_name, column_name from information_schema.columns where table_schema = $1",
      [SCHEMA],
    );
    const tables = new Set(tableRows.rows.map((row) => row.table_name));
    const columns = new Map();
    for (const row of columnRows.rows) {
      if (!columns.has(row.table_name)) columns.set(row.table_name, new Set());
      columns.get(row.table_name).add(row.column_name);
    }
    return { tables, columns };
  } finally {
    await client.end();
  }
}

const args = new Set(process.argv.slice(2));
const asJson = args.has("--json");
const verbose = args.has("--verbose");
const cwd = process.cwd();

const env = {
  ...parseEnvFile(path.join(cwd, ".env")),
  ...parseEnvFile(path.join(cwd, ".env.local")),
  ...process.env,
};
const connectionString =
  env.SCHEMA_CHECK_DATABASE_URL || env.DATABASE_URL || env.DIRECT_URL || "";

if (!connectionString) {
  console.error("Schema drift check failed: no database connection string found.");
  console.error("Set SCHEMA_CHECK_DATABASE_URL, or DATABASE_URL/DIRECT_URL in .env / .env.local.");
  process.exit(1);
}

const files = collectFiles(cwd);
const queries = [];
for (const file of files) {
  queries.push(...extractSelects(file, fs.readFileSync(file, "utf8")));
}

let schema;
try {
  schema = await introspect(connectionString);
} catch (error) {
  console.error(`Schema drift check failed: could not read information_schema (${error?.constructor?.name ?? "error"}).`);
  console.error(String(error?.message ?? error).split("\n").filter(Boolean).pop());
  process.exit(1);
}

const missingTables = [];
const missingColumns = [];
const skipped = [];

for (const query of queries) {
  const where = `${path.relative(cwd, query.file)}:${query.line}`;
  if (query.table === null) {
    skipped.push({ where, reason: "table name is not a static string" });
    continue;
  }
  if (!schema.tables.has(query.table)) {
    missingTables.push({ where, table: query.table });
    continue;
  }
  if (!query.hasColumnsArg) continue;
  if (query.columns === null) {
    skipped.push({ where, reason: `select list on "${query.table}" is not a static string` });
    continue;
  }

  const { pairs, skipped: localSkips } = resolveSelect(query.table, query.columns, schema.tables);
  for (const skip of localSkips) skipped.push({ where, reason: `${skip.reason} (${skip.detail})` });
  for (const pair of pairs) {
    const tableColumns = schema.columns.get(pair.table);
    if (!tableColumns) {
      missingTables.push({ where, table: pair.table });
      continue;
    }
    if (!tableColumns.has(pair.column)) {
      missingColumns.push({ where, table: pair.table, column: pair.column });
    }
  }
}

const dedupe = (rows) => [...new Map(rows.map((row) => [JSON.stringify(row), row])).values()];
const badTables = dedupe(missingTables);
const badColumns = dedupe(missingColumns);
const skips = dedupe(skipped);

if (asJson) {
  console.log(JSON.stringify({
    filesScanned: files.length,
    queriesFound: queries.length,
    missingTables: badTables,
    missingColumns: badColumns,
    skipped: skips,
  }, null, 2));
} else {
  console.log(`Scanned ${files.length} files, found ${queries.length} .from(...).select(...) queries.`);
  if (badTables.length > 0) {
    console.error(`\nMissing tables (${badTables.length}):`);
    for (const row of badTables) {
      const note = row.table.includes(".") ? " (schema-qualified names are not reachable through PostgREST)" : "";
      console.error(`  ${row.where}  ->  table "${row.table}" does not exist in schema ${SCHEMA}${note}`);
    }
  }
  if (badColumns.length > 0) {
    console.error(`\nMissing columns (${badColumns.length}):`);
    for (const row of badColumns) console.error(`  ${row.where}  ->  ${row.table}.${row.column} does not exist`);
  }
  if (skips.length > 0) {
    console.log(`\nSkipped (not validated, ${skips.length}):${verbose ? "" : " run with --verbose to list"}`);
    if (verbose) for (const row of skips) console.log(`  ${row.where}  ->  ${row.reason}`);
  }
  if (badTables.length === 0 && badColumns.length === 0) {
    console.log("\nOK: every resolved table.column pair exists in the target database.");
  }
}

process.exit(badTables.length > 0 || badColumns.length > 0 ? 1 : 0);
