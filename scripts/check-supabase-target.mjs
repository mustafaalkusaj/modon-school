import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

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

const cwd = process.cwd();
const linkedPath = path.join(cwd, "supabase", ".temp", "project-ref");
const env = {
  ...parseEnvFile(path.join(cwd, ".env")),
  ...parseEnvFile(path.join(cwd, ".env.local")),
  ...process.env,
};
const runtimeUrl = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL || "";
const runtimeRef = env.SUPABASE_PROJECT_REF || runtimeUrl.match(/^https:\/\/([a-z0-9]+)\.supabase\.co/i)?.[1] || "";
const linkedRef = fs.existsSync(linkedPath) ? fs.readFileSync(linkedPath, "utf8").trim() : "";

if (!runtimeRef) {
  console.error("Supabase preflight failed: runtime project reference is missing.");
  process.exit(1);
}
if (!linkedRef) {
  console.error("Supabase preflight failed: run supabase link for the intended environment first.");
  process.exit(1);
}
if (runtimeRef !== linkedRef) {
  console.error(`Supabase preflight failed: runtime and linked project references differ (${runtimeRef} != ${linkedRef}).`);
  process.exit(1);
}

const migrationList = spawnSync(
  "npx",
  ["-y", "supabase@latest", "migration", "list", "--linked", "--output-format", "json"],
  { cwd, encoding: "utf8", timeout: 120_000, maxBuffer: 10 * 1024 * 1024 },
);
if (migrationList.error || migrationList.status !== 0) {
  console.error("Supabase preflight failed: could not verify remote migration history.");
  process.exit(1);
}

let migrationPayload;
try {
  migrationPayload = JSON.parse(migrationList.stdout);
} catch {
  console.error("Supabase preflight failed: migration history response was not valid JSON.");
  process.exit(1);
}
const migrations = Array.isArray(migrationPayload?.migrations) ? migrationPayload.migrations : [];
const approvedPending = new Set([]);
const localOnly = migrations.filter((row) => row.local && !row.remote && !approvedPending.has(row.local));
const remoteOnly = migrations.filter((row) => row.remote && !row.local);
if (localOnly.length > 0 || remoteOnly.length > 0) {
  const sample = (rows, key) => rows.slice(0, 5).map((row) => row[key]).join(", ");
  console.error(
    `Supabase preflight failed: migration history is divergent ` +
    `(unexpected local-only=${localOnly.length}, remote-only=${remoteOnly.length}).`,
  );
  if (localOnly.length) console.error(`Local-only sample: ${sample(localOnly, "local")}`);
  if (remoteOnly.length) console.error(`Remote-only sample: ${sample(remoteOnly, "remote")}`);
  console.error("Repair/reconcile migration history before any db push; no migrations were applied.");
  process.exit(1);
}

console.log(`Supabase target and migration history verified: ${runtimeRef}`);
