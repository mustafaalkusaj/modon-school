import { NextRequest, NextResponse } from "next/server";

import {
  applyBranchScopeToQuery,
  resolveBranchScope,
  type ResolvedBranchScope,
} from "@/lib/branch-scope";
import { enforceRateLimit } from "@/lib/rate-limit";
import { resolveSchoolScopedActorContext } from "@/lib/managed-users-server";
import type { RouteSupabaseClient } from "@/lib/managed-users/types";
import { routeUserHasPermission } from "@/lib/route-permissions";
import { buildSchoolCacheTag, rememberWithTtl } from "@/lib/server-cache";
import { createServiceSupabaseClient } from "@/lib/supabase-server";
import { fetchAllRows } from "@/lib/supabase-fetch-all";
import { buildResolvedStudentFinancials } from "@/lib/students/financials";
import { todayBaghdadIso } from "@/lib/tz";
import { excludeDeletedStudents } from "@/lib/students/soft-delete";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type ReportsMetrics = {
  studentsCount: number;
  activeStudents: number;
  totalFees: number;
  totalPaid: number;
  totalRemaining: number;
  paymentsCount: number;
  paymentVolume: number;
  todayPayments: number;
  expensesCount: number;
  expenseVolume: number;
  expenseTypeCount: number;
  salariesCount: number;
  salaryVolume: number;
  currentMonthSalaryCount: number;
  netBalance: number;

  // Top 3 summary cards
  netRevenue: number;
  netPayments: number;
  totalBalance: number;

  // Salary by month
  salaryByMonth: Array<{ month: string; total: number }>;

  // Current students revenue
  currentStudentsTotalFees: number;
  currentStudentsCollected: number;
  currentStudentsDiscounts: number;
  currentStudentsRemaining: number;

  // Transferred students revenue
  transferredStudentsTotalFees: number;
  transferredStudentsCollected: number;
  transferredStudentsDiscounts: number;
  transferredStudentsRemaining: number;

  // Other revenue (incomes)
  incomesCount: number;
  otherRevenueTotal: number;

  // Expenses by type
  expensesByType: Array<{ name: string; total: number }>;
};

function readRelationName(value: unknown) {
  if (Array.isArray(value)) {
    return readRelationName(value[0] ?? null);
  }
  if (typeof value !== "object" || value === null) {
    return "";
  }

  const relation = value as { name?: unknown };
  return typeof relation.name === "string" ? relation.name : "";
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: { message } }, { status });
}

type SettledQueryValue = {
  data: unknown;
  error: { message?: string } | null;
  count?: number | null;
};
type SettledQueryResult = PromiseSettledResult<SettledQueryValue>;

/** Helper: safely unwrap a settled Supabase result. */
function unwrapSettled<T>(
  result: PromiseSettledResult<{
    data: T | null;
    error: unknown;
    count?: number | null;
  }>,
): { data: T | null; count: number; ok: boolean; errorMessage: string | null } {
  if (result.status !== "fulfilled") {
    return { data: null, count: 0, ok: false, errorMessage: null };
  }
  const { data, error, count } = result.value;
  if (error) {
    const msg =
      typeof error === "object" &&
      error !== null &&
      "message" in error &&
      typeof error.message === "string"
        ? error.message
        : null;
    return { data: null, count: 0, ok: false, errorMessage: msg };
  }
  return { data, count: count ?? 0, ok: true, errorMessage: null };
}

/**
 * Manually sum a numeric field across fetched rows.
 *
 * NOTE: We intentionally do NOT use PostgREST embedded aggregate syntax
 * (`.select("amount.sum()")`) here. That syntax requires `db_aggregates_enabled`
 * on the Supabase project and otherwise fails with PGRST123 ("aggregate
 * functions disabled"), which silently zeroes financial totals when the
 * error is swallowed upstream (this exact bug has bitten sibling projects
 * before). Instead we fetch the raw `amount` column — already scoped tightly
 * by school_id + deleted_at IS NULL (and branch scope) below — and reduce it
 * in JS, which works regardless of the project's aggregate-function setting.
 */
function sumAmountField(data: unknown, field: string = "amount"): number {
  if (!Array.isArray(data)) return 0;
  return data.reduce((total: number, row) => {
    if (typeof row !== "object" || row === null) return total;
    const val = (row as Record<string, unknown>)[field];
    return total + (Number(val) || 0);
  }, 0);
}

async function loadFallbackMetrics(
  actorSupabase: RouteSupabaseClient,
  schoolId: string,
  branchScope: ResolvedBranchScope,
  currentMonth: string,
  todayDate: string,
) {
  // Compute tomorrow for date-range filter on today's payments
  const tomorrowDate = (() => {
    const d = new Date(todayDate + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  })();

  // ---------------------------------------------------------------------------
  // Fire all queries in parallel.
  //
  // Payments / expenses / incomes use SQL COUNT (via `{ count: "exact" }`,
  // a real supabase-js feature that returns a row count from the response
  // headers) but sum `amount` in JS rather than via PostgREST embedded
  // aggregate syntax (`.select("amount.sum()")`). That syntax requires
  // `db_aggregates_enabled` on the Supabase project and otherwise fails with
  // PGRST123, which can silently zero these totals — see sumAmountField()
  // above. Each query is already scoped to a single school_id (+ soft-delete
  // filter + branch scope), so fetching the raw rows and reducing them in JS
  // is safe and not a real memory/perf concern.
  //
  // Students + class_fees stay row-level because the resolved-fee logic
  // (COALESCE class_fee vs student.total_fee) cannot be expressed in the
  // PostgREST query builder.
  //
  // Salaries stay row-level (small dataset) because per-row net = gross -
  // deductions must be computed before grouping by month.
  // ---------------------------------------------------------------------------
  const [
    studentsResult,
    classFeesResult,
    paymentsAggResult,
    todayPaymentsResult,
    expensesAggResult,
    expensesByTypeResult,
    salariesResult,
    currentMonthSalaryResult,
    incomesAggResult,
  ] = await Promise.allSettled([
    // 0 — Students (row-level: needs class_fees resolution)
    fetchAllRows(() =>
      applyBranchScopeToQuery(
        excludeDeletedStudents(
          actorSupabase
            .from("students")
            .select("class_name, total_fee, paid_fee, discount_value, status"),
        )
          .eq("school_id", schoolId)
          .neq("status", "deleted"),
        branchScope,
      ).order("id"),
    ),
    // 1 — Class fees lookup (small table)
    applyBranchScopeToQuery(
      actorSupabase
        .from("class_fees")
        .select("class_name, total_fee")
        .eq("school_id", schoolId),
      branchScope,
    ),
    // 2 — Payments: COUNT via { count: "exact" }; amount summed in JS below
    //     across every page (fetchAllRows), not just the first 1000 rows.
    fetchAllRows(() =>
      applyBranchScopeToQuery(
        actorSupabase
          .from("payments")
          .select("amount", { count: "exact" })
          .eq("school_id", schoolId)
          .is("deleted_at", null),
        branchScope,
      ).order("id"),
    ),
    // 3 — Today's payments: SQL COUNT only (head: true = no data transferred)
    applyBranchScopeToQuery(
      actorSupabase
        .from("payments")
        .select("*", { count: "exact", head: true })
        .eq("school_id", schoolId)
        .is("deleted_at", null)
        // Baghdad day bounds; bare dates were read as UTC midnight, so
        // payments made 00:00–03:00 Baghdad time counted as yesterday.
        .gte("created_at", `${todayDate}T00:00:00+03:00`)
        .lt("created_at", `${tomorrowDate}T00:00:00+03:00`),
      branchScope,
    ),
    // 4 — Expenses: COUNT via { count: "exact" }; amount summed in JS below
    fetchAllRows(() =>
      applyBranchScopeToQuery(
        actorSupabase
          .from("expenses")
          .select("amount", { count: "exact" })
          .eq("school_id", schoolId)
          .is("deleted_at", null),
        branchScope,
      ).order("id"),
    ),
    // 5 — Expenses grouped by type: fetch rows and group+sum in JS below
    //     (avoids PostgREST embedded aggregate syntax, see sumAmountField)
    fetchAllRows(() =>
      applyBranchScopeToQuery(
        actorSupabase
          .from("expenses")
          .select("expense_types(name), amount")
          .eq("school_id", schoolId)
          .is("deleted_at", null),
        branchScope,
      ).order("id"),
    ),
    // 6 — Salaries (row-level: needs per-row net = gross - deductions)
    fetchAllRows(() =>
      applyBranchScopeToQuery(
        actorSupabase
          .from("salaries")
          .select("gross_salary, deductions, month")
          .eq("school_id", schoolId),
        branchScope,
      ).order("id"),
    ),
    // 7 — Current-month salary: SQL COUNT only
    applyBranchScopeToQuery(
      actorSupabase
        .from("salaries")
        .select("*", { count: "exact", head: true })
        .eq("school_id", schoolId)
        .eq("month", currentMonth),
      branchScope,
    ),
    // 8 — Incomes: COUNT via { count: "exact" }; amount summed in JS below
    fetchAllRows(() =>
      applyBranchScopeToQuery(
        actorSupabase
          .from("incomes")
          .select("amount", { count: "exact" })
          .eq("school_id", schoolId)
          .is("deleted_at", null),
        branchScope,
      ).order("id"),
    ),
  ]);

  // ---- Unwrap results -------------------------------------------------------

  const studentsU = unwrapSettled(studentsResult as SettledQueryResult);
  const classFeesU = unwrapSettled(classFeesResult as SettledQueryResult);
  const paymentsAggU = unwrapSettled(paymentsAggResult as SettledQueryResult);
  const todayPaymentsU = unwrapSettled(
    todayPaymentsResult as SettledQueryResult,
  );
  const expensesAggU = unwrapSettled(expensesAggResult as SettledQueryResult);
  const expensesByTypeU = unwrapSettled(
    expensesByTypeResult as SettledQueryResult,
  );
  const salariesU = unwrapSettled(salariesResult as SettledQueryResult);
  const currentMonthSalaryU = unwrapSettled(
    currentMonthSalaryResult as SettledQueryResult,
  );
  const incomesAggU = unwrapSettled(incomesAggResult as SettledQueryResult);

  const students = (studentsU.data ?? []) as Array<Record<string, unknown>>;
  const classFees = (classFeesU.data ?? []) as Array<Record<string, unknown>>;
  const salaries = (salariesU.data ?? []) as Array<Record<string, unknown>>;

  // ---- Payments (SQL aggregated) --------------------------------------------

  const paymentsCount = paymentsAggU.count;
  const paymentVolume = sumAmountField(paymentsAggU.data);
  const todayPayments = todayPaymentsU.count;

  // ---- Expenses (JS-aggregated, see sumAmountField) --------------------------

  const expensesCount = expensesAggU.count;
  const expenseVolume = sumAmountField(expensesAggU.data);

  // Expenses grouped by type — one row per expense with { expense_types: {name}, amount }
  const expensesByTypeRaw = (expensesByTypeU.data ?? []) as Array<
    Record<string, unknown>
  >;
  const expensesByTypeMap = new Map<string, number>();
  for (const row of expensesByTypeRaw) {
    const typeName = readRelationName(row.expense_types) || "أخرى";
    expensesByTypeMap.set(
      typeName,
      (expensesByTypeMap.get(typeName) ?? 0) + (Number(row.amount) || 0),
    );
  }
  const expensesByType = Array.from(expensesByTypeMap.entries())
    .map(([name, total]) => ({ name, total }))
    .sort((a, b) => b.total - a.total);
  const expenseTypeCount = expensesByTypeMap.size;

  // ---- Incomes (JS-aggregated, see sumAmountField) ----------------------------

  const incomesCount = incomesAggU.count;
  const otherRevenueTotal = sumAmountField(incomesAggU.data);

  // ---- Salaries (row-level: per-row net needed) -----------------------------

  const salaryByMonthMap = new Map<string, number>();
  let salaryVolume = 0;
  for (const s of salaries) {
    const net = Math.max(
      0,
      Number(s.gross_salary ?? 0) - Number(s.deductions ?? 0),
    );
    salaryVolume += net;
    const month = String(s.month ?? "");
    if (month) {
      salaryByMonthMap.set(month, (salaryByMonthMap.get(month) ?? 0) + net);
    }
  }
  const salaryByMonth = Array.from(salaryByMonthMap.entries())
    .map(([month, total]) => ({ month, total }))
    .sort((a, b) => a.month.localeCompare(b.month));

  const currentMonthSalaryCount = currentMonthSalaryU.count;

  // ---- Students (row-level: class_fees resolution logic) --------------------

  const classFeeMap = new Map<string, number>();
  for (const cf of classFees) {
    if (cf.class_name && typeof cf.total_fee === "number") {
      classFeeMap.set(String(cf.class_name), cf.total_fee);
    }
  }

  let totalFees = 0;
  let totalPaid = 0;
  let totalRemaining = 0;

  let currentStudentsTotalFees = 0;
  let currentStudentsCollected = 0;
  let currentStudentsDiscounts = 0;
  let currentStudentsRemaining = 0;

  let transferredStudentsTotalFees = 0;
  let transferredStudentsCollected = 0;
  let transferredStudentsDiscounts = 0;
  let transferredStudentsRemaining = 0;

  for (const student of students) {
    const s = student;
    const className = typeof s.class_name === "string" ? s.class_name : "";
    const classFeeTotal = className ? classFeeMap.get(className) : undefined;
    const resolved = buildResolvedStudentFinancials(
      {
        total_fee: Number(s.total_fee ?? 0),
        paid_fee: Number(s.paid_fee ?? 0),
        discount_value: Number(s.discount_value ?? 0),
      },
      classFeeTotal,
    );

    if (s.status === "transferred") {
      // Transferred students: completely isolated from all global accumulators.
      // Their data only appears in the dedicated "الطلاب المنقولين" card.
      transferredStudentsTotalFees += resolved.paid_fee;
      transferredStudentsCollected += resolved.paid_fee;
      transferredStudentsDiscounts += Number(s.discount_value ?? 0);
      transferredStudentsRemaining += 0; // always 0 — remaining is written off
      // Do NOT add to totalPaid — transferred students are excluded from all revenue totals
    } else {
      currentStudentsTotalFees += resolved.resolved_total_fee;
      currentStudentsCollected += resolved.paid_fee;
      currentStudentsDiscounts += Number(s.discount_value ?? 0);
      currentStudentsRemaining += resolved.remaining_fee;
      // Current students contribute to all global accumulators
      totalFees += resolved.resolved_total_fee;
      totalPaid += resolved.paid_fee;
      totalRemaining += resolved.remaining_fee;
    }
  }

  // ---- Assemble final metrics -----------------------------------------------

  const netRevenue = totalPaid;
  const netPayments = expenseVolume + salaryVolume;

  const metrics = {
    studentsCount: students.length,
    activeStudents: students.filter((item) => item.status === "active").length,
    totalFees,
    totalPaid,
    totalRemaining,
    paymentsCount,
    paymentVolume,
    todayPayments,
    expensesCount,
    expenseVolume,
    expenseTypeCount,
    salariesCount: salaries.length,
    salaryVolume,
    currentMonthSalaryCount,
    incomesCount,

    netRevenue,
    netPayments,
    totalBalance: netRevenue - netPayments,

    salaryByMonth,

    currentStudentsTotalFees,
    currentStudentsCollected,
    currentStudentsDiscounts,
    currentStudentsRemaining,

    transferredStudentsTotalFees,
    transferredStudentsCollected,
    transferredStudentsDiscounts,
    transferredStudentsRemaining,

    otherRevenueTotal,

    expensesByType,
  };

  const finalMetrics = {
    ...metrics,
    netBalance:
      metrics.paymentVolume - metrics.expenseVolume - metrics.salaryVolume,
  } satisfies ReportsMetrics;

  // ---- Warnings for failed queries ------------------------------------------

  const warningInputs: Array<{ result: SettledQueryResult; label: string }> = [
    { result: studentsResult, label: "بيانات الطلاب" },
    { result: classFeesResult, label: "بيانات رسوم الفئات" },
    { result: paymentsAggResult, label: "بيانات الدفعات" },
    { result: expensesAggResult, label: "بيانات المصروفات" },
    { result: salariesResult, label: "بيانات الرواتب" },
    { result: incomesAggResult, label: "بيانات الواردات" },
  ];
  const warnings = warningInputs
    .map(({ result, label }) => {
      if (result.status !== "fulfilled") return `تعذر تحميل ${label} حالياً.`;
      if (result.value.error)
        return result.value.error.message || `تعذر تحميل ${label} حالياً.`;
      return null;
    })
    .filter(Boolean);

  return { metrics: finalMetrics, warnings };
}

export async function GET(req: NextRequest) {
  const t0 = performance.now();
  const tAuthStart = performance.now();

  const schoolId = req.nextUrl.searchParams.get("schoolId");
  const context = await resolveSchoolScopedActorContext(
    schoolId,
    {
      allowedRoles: ["super_admin", "admin"],
      roleDeniedMessage: "التقارير متاحة للإدارة فقط.",
    },
    req.headers.get("authorization"),
  );
  const tAuthEnd = performance.now();

  if (!context.ok) {
    return jsonError(
      "message" in context
        ? context.message
        : "تعذر التحقق من صلاحيات المستخدم.",
      "status" in context ? context.status : 500,
    );
  }

  const requestedBranchId =
    req.nextUrl.searchParams.get("branchId") ??
    req.nextUrl.searchParams.get("branch_id");
  const branchScope = resolveBranchScope(context.value, requestedBranchId);
  if (!branchScope.ok) {
    return jsonError(branchScope.message, branchScope.status);
  }

  const { actorSupabase, actorUserId, targetSchoolId } = context.value;
  const canViewReports = await routeUserHasPermission(
    actorSupabase,
    actorUserId,
    "view_reports",
  );
  if (!canViewReports) {
    return jsonError("ليس لديك صلاحية عرض التقارير.", 403);
  }
  const rateLimited = await enforceRateLimit(req, {
    namespace: "reports-overview",
    windowMs: 60_000,
    maxHits: 90,
    identifier: actorUserId,
  });
  if (rateLimited) {
    return rateLimited;
  }

  const todayDate = todayBaghdadIso();
  const currentMonth = todayDate.slice(0, 7);

  try {
    const payload = await rememberWithTtl(
      `reports-overview:${targetSchoolId}:${branchScope.value.cacheKeySuffix}:${todayDate}`,
      30_000,
      async () => {
        // Use service role client for data queries (authorization already validated above)
        const dataSupabase = createServiceSupabaseClient();

        const fallback = await loadFallbackMetrics(
          dataSupabase,
          targetSchoolId,
          branchScope.value,
          currentMonth,
          todayDate,
        );
        return {
          metrics: fallback.metrics,
          warnings: fallback.warnings,
        };
      },
      {
        tags: [buildSchoolCacheTag(targetSchoolId, "reports-overview")],
      },
    );

    const tEnd = performance.now();
    const totalTime = tEnd - t0;
    const authTime = tAuthEnd - tAuthStart;
    const dataTime = tEnd - tAuthEnd;

    return NextResponse.json(
      {
        ok: true,
        ...payload,
      },
      {
        headers: {
          "Cache-Control": "private, no-store, max-age=0, must-revalidate",
          Pragma: "no-cache",
          "Server-Timing": `auth;dur=${Math.round(authTime)}, data;dur=${Math.round(dataTime)}, total;dur=${Math.round(totalTime)}`,
        },
      },
    );
  } catch {
    return jsonError("تعذر تحميل ملخص التقارير.", 500);
  }
}
