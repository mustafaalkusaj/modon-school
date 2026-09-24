/**
 * Seed QA demo accounts for local / staging testing.
 *
 * Creates a QA_DEMO_SCHOOL with one branch and four users:
 *   super_admin  qa.superadmin.demo@example.test
 *   admin        qa.admin.demo@example.test
 *   teacher      t9001@schoolapp.local
 *   student      s9001@schoolapp.local
 *
 * Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in the environment.
 *
 * Usage:
 *   node scripts/seed-demo-roles.mjs
 *   node scripts/seed-demo-roles.mjs --dry-run
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const DRY_RUN = process.argv.includes("--dry-run");

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "";
if (!DEMO_PASSWORD) {
  console.error("Missing SEED_DEMO_PASSWORD.");
  process.exit(1);
}

const USERS = [
  {
    email: "qa.superadmin.demo@example.test",
    role: "super_admin",
    label: "QA Super Admin",
  },
  {
    email: "qa.admin.demo@example.test",
    role: "admin",
    label: "QA Admin",
  },
  {
    email: "t9001@schoolapp.local",
    role: "teacher",
    label: "QA Teacher",
    username: "qa_teacher_9001",
  },
  {
    email: "s9001@schoolapp.local",
    role: "student",
    label: "QA Student",
    username: "qa_student_9001",
  },
];

async function ensureSchool() {
  const { data: existing } = await supabase
    .from("schools")
    .select("id")
    .eq("name", "QA_DEMO_SCHOOL")
    .maybeSingle();

  if (existing) {
    console.log(`School QA_DEMO_SCHOOL already exists (${existing.id}).`);
    return existing.id;
  }

  if (DRY_RUN) {
    console.log("[DRY-RUN] Would create school QA_DEMO_SCHOOL");
    return "dry-run-school-id";
  }

  const { data: school, error } = await supabase
    .from("schools")
    .insert({ name: "QA_DEMO_SCHOOL" })
    .select("id")
    .single();

  if (error) throw new Error(`Failed to create school: ${error.message}`);
  console.log(`Created school QA_DEMO_SCHOOL (${school.id}).`);
  return school.id;
}

async function ensureBranch(schoolId) {
  const { data: existing } = await supabase
    .from("branches")
    .select("id")
    .eq("school_id", schoolId)
    .eq("name", "QA_DEMO_BRANCH")
    .maybeSingle();

  if (existing) {
    console.log(`Branch QA_DEMO_BRANCH already exists (${existing.id}).`);
    return existing.id;
  }

  if (DRY_RUN) {
    console.log("[DRY-RUN] Would create branch QA_DEMO_BRANCH");
    return "dry-run-branch-id";
  }

  const { data: branch, error } = await supabase
    .from("branches")
    .insert({ school_id: schoolId, name: "QA_DEMO_BRANCH" })
    .select("id")
    .single();

  if (error) throw new Error(`Failed to create branch: ${error.message}`);
  console.log(`Created branch QA_DEMO_BRANCH (${branch.id}).`);
  return branch.id;
}

async function ensureSubscription(schoolId) {
  const { data: existing } = await supabase
    .from("subscriptions")
    .select("id")
    .eq("school_id", schoolId)
    .maybeSingle();

  if (existing) return;

  if (DRY_RUN) {
    console.log("[DRY-RUN] Would create subscription for school");
    return;
  }

  const { error } = await supabase.from("subscriptions").insert({
    school_id: schoolId,
    plan: "free",
    status: "active",
    max_students: 100,
    max_teachers: 10,
  });

  if (error) {
    console.warn(`Subscription insert failed (may be schema mismatch, continuing): ${error.message}`);
  } else {
    console.log("Created subscription.");
  }
}

async function ensureUser(user, schoolId, branchId) {
  const { data: existingAuth } = await supabase.auth.admin.listUsers();
  const existing = existingAuth?.users?.find((u) => u.email === user.email);

  if (existing) {
    console.log(`User ${user.email} already exists (${existing.id}).`);
    return existing.id;
  }

  if (DRY_RUN) {
    console.log(`[DRY-RUN] Would create user ${user.email} (${user.role})`);
    return "dry-run-user-id";
  }

  const { data: authUser, error: authErr } = await supabase.auth.admin.createUser({
    email: user.email,
    password: DEMO_PASSWORD,
    email_confirm: true,
    user_metadata: {
      full_name: user.label,
      role: user.role,
      school_id: schoolId,
    },
  });

  if (authErr || !authUser?.user) {
    throw new Error(`Failed to create user ${user.email}: ${authErr?.message ?? "no user"}`);
  }

  const authUserId = authUser.user.id;
  console.log(`Created auth user ${user.email} (${authUserId}).`);

  const { error: profileErr } = await supabase.from("user_profiles").insert({
    id: authUserId,
    email: user.email,
    full_name: user.label,
    role: user.role,
    school_id: schoolId,
    branch_id: branchId,
  });

  if (profileErr) {
    console.warn(`user_profiles insert failed (continuing): ${profileErr.message}`);
  }

  if (user.username) {
    const { error: credErr } = await supabase.from("managed_user_credentials").insert({
      auth_user_id: authUserId,
      school_id: schoolId,
      username: user.username,
      plain_password: DEMO_PASSWORD,
      role: user.role,
    });
    if (credErr) console.warn(`managed_user_credentials insert: ${credErr.message}`);

    const { error: mpErr } = await supabase.from("managed_user_profiles").insert({
      auth_user_id: authUserId,
      school_id: schoolId,
      full_name: user.label,
      role: user.role,
    });
    if (mpErr) console.warn(`managed_user_profiles insert: ${mpErr.message}`);
  }

  if (user.role === "teacher") {
    const { error: teacherErr } = await supabase.from("teachers").insert({
      school_id: schoolId,
      auth_user_id: authUserId,
      full_name: user.label,
    });
    if (teacherErr) console.warn(`teachers insert: ${teacherErr.message}`);
  }

  if (user.role === "student") {
    const { error: studentErr } = await supabase.from("students").insert({
      school_id: schoolId,
      auth_user_id: authUserId,
      full_name: user.label,
      status: "active",
    });
    if (studentErr) console.warn(`students insert: ${studentErr.message}`);
  }

  return authUserId;
}

async function main() {
  if (DRY_RUN) console.log("=== DRY RUN MODE ===\n");

  const schoolId = await ensureSchool();
  const branchId = await ensureBranch(schoolId);
  await ensureSubscription(schoolId);

  for (const user of USERS) {
    await ensureUser(user, schoolId, branchId);
  }

  console.log("\n=== Seed complete ===");
  console.log(`School: QA_DEMO_SCHOOL`);
  console.log(`Branch: QA_DEMO_BRANCH`);
  console.log("Password for all users: the value of SEED_DEMO_PASSWORD");
  console.log("\nUsers:");
  for (const user of USERS) {
    console.log(`  ${user.role.padEnd(14)} ${user.email}`);
  }
}

main().catch((err) => {
  console.error("Fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
