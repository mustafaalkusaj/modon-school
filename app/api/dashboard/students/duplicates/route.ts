import { NextRequest, NextResponse } from "next/server";
import { resolveManagedUsersActorContext } from "@/lib/managed-users-server";
import {
  applyBranchScopeToQuery,
  resolveBranchScope,
} from "@/lib/branch-scope";
import { enforceRateLimit } from "@/lib/rate-limit";
import { createServiceSupabaseClient } from "@/lib/supabase-server";
import { excludeDeletedStudents } from "@/lib/students/soft-delete";

function normalizeArabic(text: string): string {
  return text
    .replace(/[ً-ٰٟ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/ـ/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("ar");
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: { message } }, { status });
}

export async function GET(req: NextRequest) {
  const schoolId = req.nextUrl.searchParams.get("schoolId");
  const context = await resolveManagedUsersActorContext(
    schoolId,
    req.headers.get("authorization"),
  );

  if (!context.ok) {
    return jsonError(
      "message" in context ? context.message : "تعذر التحقق من الصلاحيات.",
      401,
    );
  }

  const requestedBranchId =
    req.nextUrl.searchParams.get("branchId") ??
    req.nextUrl.searchParams.get("branch_id");
  const branchScope = resolveBranchScope(context.value, requestedBranchId);
  if (!branchScope.ok) {
    return jsonError(branchScope.message, branchScope.status);
  }

  const rateLimited = await enforceRateLimit(req, {
    namespace: "students-duplicates",
    windowMs: 60_000,
    maxHits: 10,
  });
  if (rateLimited) return rateLimited;

  const supabase = createServiceSupabaseClient();
  const resolvedSchoolId = context.value.targetSchoolId;

  let query = supabase
    .from("students")
    .select("id, full_name, class_name, section, phone, status, created_at, paid_fee, total_fee, discount_value")
    .eq("school_id", resolvedSchoolId)
    .order("full_name", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(10000);

  query = excludeDeletedStudents(query);
  query = applyBranchScopeToQuery(query, branchScope.value);

  const { data: students, error } = await query;

  if (error) {
    return jsonError(error.message, 500);
  }

  const nameGroups = new Map<
    string,
    Array<{
      id: string;
      full_name: string;
      class_name: string | null;
      section: string | null;
      phone: string | null;
      status: string | null;
      created_at: string | null;
      paid_fee: number | null;
      total_fee: number | null;
      discount_value: number | null;
      receipts: Array<{ amount: number | null; receipt_number: string | null; manual_receipt_number: string | null }>;
    }>
  >();

  for (const s of students ?? []) {
    const raw = s.full_name?.trim().replace(/\s+/g, " ") ?? "";
    if (!raw) continue;
    const key = normalizeArabic(raw);
    if (!key) continue;
    const group = nameGroups.get(key) ?? [];
    group.push({ ...s, receipts: [] });
    nameGroups.set(key, group);
  }

  const duplicateStudentIds: string[] = [];
  for (const [, group] of Array.from(nameGroups)) {
    if (group.length > 1) {
      for (const s of group) duplicateStudentIds.push(s.id);
    }
  }

  if (duplicateStudentIds.length > 0) {
    const { data: payments } = await supabase
      .from("payments")
      .select("student_id, amount, receipt_number, manual_receipt_number")
      .eq("school_id", resolvedSchoolId)
      .in("student_id", duplicateStudentIds)
      .is("deleted_at", null);

    if (payments) {
      const paymentMap = new Map<string, typeof payments>();
      for (const p of payments) {
        const arr = paymentMap.get(p.student_id) ?? [];
        arr.push(p);
        paymentMap.set(p.student_id, arr);
      }
      for (const [, group] of Array.from(nameGroups)) {
        for (const s of group) {
          s.receipts = (paymentMap.get(s.id) ?? []).map((p) => ({
            amount: p.amount,
            receipt_number: p.receipt_number,
            manual_receipt_number: p.manual_receipt_number,
          }));
        }
      }
    }
  }

  const duplicates: Array<{
    name: string;
    count: number;
    students: (typeof nameGroups extends Map<string, infer V> ? V : never);
  }> = [];

  for (const [, group] of Array.from(nameGroups)) {
    if (group.length > 1) {
      const displayName = group[0].full_name;
      duplicates.push({ name: displayName, count: group.length, students: group });
    }
  }

  duplicates.sort((a, b) => b.count - a.count);

  return NextResponse.json({
    ok: true,
    totalDuplicateGroups: duplicates.length,
    totalDuplicateStudents: duplicates.reduce((sum, d) => sum + d.count, 0),
    duplicates,
  });
}
