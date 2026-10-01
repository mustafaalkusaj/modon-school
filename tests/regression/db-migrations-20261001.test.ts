import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Static guards for the 20261001* migration series. They never touch a
 * database: they only check that every file keeps the safety contract the
 * header promises, because these files are applied by hand to a live database.
 */
const dir = join(process.cwd(), "supabase", "migrations");
const files = readdirSync(dir)
  .filter((name) => /^(MANUAL_)?20261001/.test(name) && name.endsWith(".sql"))
  .sort((a, b) => a.replace("MANUAL_", "").localeCompare(b.replace("MANUAL_", "")));

function read(name: string) {
  return readFileSync(join(dir, name), "utf8");
}

describe("20261001 migration series", () => {
  it("contains the expected files in apply order", () => {
    expect(files).toEqual([
      "20261001090000_branch_isolation_columns_and_triggers.sql",
      "20261001090100_private_schema_rls_helper_functions.sql",
      "20261001090200_storage_buckets_and_policies.sql",
      "MANUAL_20261001090300_storage_bucket_privacy_flip.sql",
      "20261001090400_audit_logs_append_only.sql",
      "20261001090500_managed_credentials_bcrypt.sql",
      "20261001090600_finance_schema_and_totals.sql",
      "20261001090700_finance_rpcs.sql",
      "20261001090800_grade_entries_triggers.sql",
      "20261001090900_exam_attempts_and_rpcs.sql",
      "20261001091000_distribution_tables.sql",
      "20261001091100_app_management_tables.sql",
      "20261001091200_account_deletion_pipeline.sql",
      "20261001091300_qr_login_tokens_additive_columns.sql",
      "20261001091400_schema_gaps_triggers_indexes.sql",
      "20261001091500_security_hardening.sql",
    ]);
  });

  it.each(files)("%s opens with a review-before-applying header", (name) => {
    const head = read(name).split("\n").slice(0, 40).join("\n");
    expect(head.startsWith("--")).toBe(true);
    expect(head).toMatch(/REVIEW BEFORE APPLYING/);
  });

  it.each(files)("%s never names another school's brand", (name) => {
    expect(read(name)).not.toMatch(/nakheel|alnakheel|school-iraq|النخيل/i);
  });

  it.each(files)("%s has balanced dollar quoting", (name) => {
    const tags = read(name).match(/\$[A-Za-z_]*\$/g) ?? [];
    const counts = new Map<string, number>();
    for (const tag of tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    for (const [tag, count] of counts) {
      expect(count % 2, `unbalanced ${tag}`).toBe(0);
    }
  });

  it.each(files)("%s has no unguarded destructive statements", (name) => {
    const sql = read(name)
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    expect(sql).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(sql).not.toMatch(/\bTRUNCATE\s+TABLE\b/i);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\s+public\.(students|payments|audit_logs)\b(?![^;]*\bWHERE\b)/i);
  });

  it("keeps privileged finance RPCs service_role-only", () => {
    const sql = read("20261001090700_finance_rpcs.sql");
    for (const fn of [
      "create_payment_atomic(\n  uuid, uuid, uuid, numeric, text, text, timestamptz, text, text\n)",
      "promote_year_execute(uuid, jsonb, uuid[], uuid[])",
      "soft_delete_student(uuid, text)",
    ]) {
      const revoke = new RegExp(
        `REVOKE ALL ON FUNCTION public\\.${fn.replace(/[()[\]]/g, "\\$&")}\\s+FROM PUBLIC, anon, authenticated`,
      );
      expect(sql).toMatch(revoke);
    }
  });

  it("makes audit_logs append-only for every role", () => {
    const sql = read("20261001090400_audit_logs_append_only.sql");
    for (const trigger of ["audit_logs_no_update", "audit_logs_no_delete", "audit_logs_no_truncate"]) {
      expect(sql).toContain(trigger);
    }
  });

  it("never nulls stored password hashes or forces a reset", () => {
    const sql = read("20261001090500_managed_credentials_bcrypt.sql")
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    expect(sql).not.toMatch(/temporary_password_hash\s*=\s*NULL/i);
    expect(sql).not.toMatch(/has_pending_setup\s*=\s*true/i);
  });
});
