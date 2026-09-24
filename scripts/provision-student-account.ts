/**
 * Provision managed student accounts.
 *
 * Modes:
 *   npx tsx scripts/provision-student-account.ts <student-id>
 *   npx tsx scripts/provision-student-account.ts --first-unprovisioned <school-id>
 *   npx tsx scripts/provision-student-account.ts --bulk <school-id> [--limit N]
 *
 * Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in the environment.
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function generateUsername(fullName: string, studentId: string): string {
  const cleaned = fullName
    .replace(/[^a-zA-Z0-9؀-ۿ\s]/g, "")
    .trim()
    .replace(/\s+/g, "_")
    .slice(0, 16)
    .toLowerCase();
  const suffix = studentId.replace(/-/g, "").slice(0, 6);
  return cleaned ? `${cleaned}_${suffix}` : `student_${suffix}`;
}

function generatePassword(): string {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  let password = "";
  const bytes = new Uint8Array(10);
  globalThis.crypto.getRandomValues(bytes);
  for (let i = 0; i < bytes.length; i++) password += chars[bytes[i] % chars.length];
  return password;
}

interface ProvisionResult {
  studentId: string;
  fullName: string;
  username: string;
  password: string;
  authUserId: string;
}

async function provisionStudent(studentId: string): Promise<ProvisionResult> {
  const { data: student, error: studentErr } = await supabase
    .from("students")
    .select("id, full_name, school_id, status, auth_user_id")
    .eq("id", studentId)
    .single();

  if (studentErr || !student) {
    throw new Error(`Student ${studentId} not found: ${studentErr?.message ?? "null"}`);
  }
  if (student.auth_user_id) {
    throw new Error(`Student ${studentId} already provisioned (auth_user_id=${student.auth_user_id}).`);
  }
  if (student.status === "deleted") {
    throw new Error(`Student ${studentId} is soft-deleted.`);
  }

  const username = generateUsername(student.full_name, student.id);
  const password = generatePassword();
  const email = `${username}@schoolapp.local`;

  const { data: authUser, error: authErr } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: student.full_name,
      role: "student",
      school_id: student.school_id,
      student_id: student.id,
    },
  });

  if (authErr || !authUser?.user) {
    throw new Error(`Failed to create auth user for ${studentId}: ${authErr?.message ?? "no user returned"}`);
  }

  const authUserId = authUser.user.id;

  const { error: updateErr } = await supabase
    .from("students")
    .update({ auth_user_id: authUserId })
    .eq("id", studentId);

  if (updateErr) {
    console.error(`WARNING: auth user ${authUserId} created but students row not linked: ${updateErr.message}`);
  }

  const { error: credErr } = await supabase
    .from("managed_user_credentials")
    .insert({
      auth_user_id: authUserId,
      school_id: student.school_id,
      username,
      plain_password: password,
      role: "student",
    });

  if (credErr) {
    console.error(`WARNING: credentials not saved for ${authUserId}: ${credErr.message}`);
  }

  const { error: profileErr } = await supabase
    .from("managed_user_profiles")
    .insert({
      auth_user_id: authUserId,
      school_id: student.school_id,
      full_name: student.full_name,
      role: "student",
    });

  if (profileErr) {
    console.error(`WARNING: managed profile not created for ${authUserId}: ${profileErr.message}`);
  }

  return { studentId, fullName: student.full_name, username, password, authUserId };
}

async function findFirstUnprovisioned(schoolId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("students")
    .select("id")
    .eq("school_id", schoolId)
    .is("auth_user_id", null)
    .neq("status", "deleted")
    .order("created_at", { ascending: true })
    .limit(1);

  if (error) throw new Error(`Query failed: ${error.message}`);
  return data?.[0]?.id ?? null;
}

async function findUnprovisionedBulk(schoolId: string, limit: number): Promise<string[]> {
  const { data, error } = await supabase
    .from("students")
    .select("id")
    .eq("school_id", schoolId)
    .is("auth_user_id", null)
    .neq("status", "deleted")
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) throw new Error(`Query failed: ${error.message}`);
  return (data ?? []).map((row) => row.id);
}

async function main() {
  const args = process.argv.slice(2);

  if (args[0] === "--first-unprovisioned") {
    const schoolId = args[1];
    if (!schoolId) {
      console.error("Usage: --first-unprovisioned <school-id>");
      process.exit(1);
    }
    const id = await findFirstUnprovisioned(schoolId);
    if (!id) {
      console.log("No unprovisioned students found.");
      return;
    }
    const result = await provisionStudent(id);
    console.log("Provisioned:", JSON.stringify(result, null, 2));
    return;
  }

  if (args[0] === "--bulk") {
    const schoolId = args[1];
    if (!schoolId) {
      console.error("Usage: --bulk <school-id> [--limit N]");
      process.exit(1);
    }
    const limitIdx = args.indexOf("--limit");
    const limit = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) || 50 : 50;

    const ids = await findUnprovisionedBulk(schoolId, limit);
    if (ids.length === 0) {
      console.log("No unprovisioned students found.");
      return;
    }
    console.log(`Provisioning ${ids.length} students...`);

    const results: ProvisionResult[] = [];
    const errors: Array<{ id: string; error: string }> = [];

    for (const id of ids) {
      try {
        results.push(await provisionStudent(id));
        process.stdout.write(".");
      } catch (err) {
        errors.push({ id, error: String(err instanceof Error ? err.message : err) });
        process.stdout.write("x");
      }
    }

    console.log();
    console.log(`\nDone: ${results.length} provisioned, ${errors.length} failed.`);
    if (errors.length > 0) console.log("Errors:", JSON.stringify(errors, null, 2));
    if (results.length > 0) console.log("Results:", JSON.stringify(results, null, 2));
    return;
  }

  const studentId = args[0];
  if (!studentId) {
    console.error("Usage: npx tsx scripts/provision-student-account.ts <student-id>");
    console.error("       npx tsx scripts/provision-student-account.ts --first-unprovisioned <school-id>");
    console.error("       npx tsx scripts/provision-student-account.ts --bulk <school-id> [--limit N]");
    process.exit(1);
  }

  const result = await provisionStudent(studentId);
  console.log("Provisioned:", JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error("Fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
