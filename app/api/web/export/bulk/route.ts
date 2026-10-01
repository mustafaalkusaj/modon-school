/**
 * Bulk data export route.
 * GET /api/web/export/bulk?type=students|teachers|expenses|incomes&schoolId=X
 * GET /api/web/export/bulk?type=...&schoolId=X&template=true  → empty template (headers only)
 * Returns a styled .xlsx file for the requested data type.
 */

import { fetchAllRows } from "@/lib/supabase-fetch-all";
import { NextRequest, NextResponse } from "next/server";

import { buildStyledWorkbook } from "@/lib/excel-builder";
import { enforceRateLimit } from "@/lib/rate-limit";
import { resolveSchoolScopedActorContext } from "@/lib/managed-users-server";
import {
  applyBranchScopeToQuery,
  resolveBranchScope,
} from "@/lib/branch-scope";
import { routeUserHasPermission } from "@/lib/route-permissions";
import { RBAC_COOKIE_NAME, verifyRBACSession } from "@/lib/rbac-session";
import {
  STUDENT_FIELD_MAP,
  TEACHER_FIELD_MAP,
  filterFieldsArray,
} from "@/lib/perm-check";
import type { DeepPermissionMap } from "@/types/deep-permissions";
import type { Permission } from "@/types/roles";
import { jsonServerError } from "@/lib/route-utils";
import { excludeDeletedStudents } from "@/lib/students/soft-delete";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: { message } }, { status });
}

function xlsxResponse(buffer: ArrayBuffer, filename: string) {
  return new NextResponse(buffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}

const VALID_TYPES = [
  "students",
  "teachers",
  "expenses",
  "incomes",
  "payments",
] as const;
type ExportType = (typeof VALID_TYPES)[number];

// ─── Sheet definitions (columns only, used for both export and template) ─────

const SHEET_DEFS = {
  students: {
    name: "الطلاب",
    title: "قائمة الطلاب",
    templateTitle: "نموذج استيراد الطلاب",
    filename: "قائمة_الطلاب",
    templateFilename: "نموذج_الطلاب",
    columns: [
      { header: "اسم الطالب", key: "full_name", width: 32 },
      { header: "الصف", key: "class_name", width: 18 },
      { header: "الشعبة", key: "section_name", width: 12 },
      { header: "الهاتف", key: "phone", width: 18 },
      { header: "الهاتف الثانوي", key: "phone_secondary", width: 18 },
      { header: "الحالة", key: "status", width: 14 },
      { header: "تاريخ التسجيل", key: "enrollment_date", width: 18 },
    ],
  },
  teachers: {
    name: "المعلمون",
    title: "قائمة المعلمون",
    templateTitle: "نموذج استيراد المعلمين",
    filename: "قائمة_المعلمين",
    templateFilename: "نموذج_المعلمين",
    columns: [
      { header: "اسم المعلم", key: "full_name", width: 32 },
      { header: "المادة", key: "subject", width: 22 },
      { header: "الهاتف", key: "phone", width: 18 },
      { header: "الإيميل", key: "email", width: 28 },
      { header: "الوظيفة", key: "job_title", width: 20 },
      { header: "الحالة", key: "status", width: 14 },
    ],
  },
  expenses: {
    name: "المصاريف",
    title: "سجل المصاريف",
    templateTitle: "نموذج المصاريف",
    filename: "سجل_المصاريف",
    templateFilename: "نموذج_المصاريف",
    columns: [
      { header: "نوع المصروف", key: "type_name", width: 24 },
      { header: "المبلغ", key: "amount", width: 18, numFmt: "#,##0" },
      { header: "التاريخ", key: "expense_date", width: 18 },
      { header: "المستلم", key: "recipient", width: 22 },
      { header: "رقم الوصل", key: "receipt_number", width: 16 },
      { header: "ملاحظات", key: "notes", width: 28 },
    ],
  },
  incomes: {
    name: "الإيرادات",
    title: "سجل الإيرادات",
    templateTitle: "نموذج الإيرادات",
    filename: "سجل_الإيرادات",
    templateFilename: "نموذج_الإيرادات",
    columns: [
      { header: "نوع الإيراد", key: "type_name", width: 24 },
      { header: "المبلغ", key: "amount", width: 18, numFmt: "#,##0" },
      { header: "التاريخ", key: "income_date", width: 18 },
      { header: "المصدر", key: "source", width: 22 },
      { header: "رقم الوصل", key: "receipt_number", width: 16 },
      { header: "ملاحظات", key: "notes", width: 28 },
    ],
  },
  payments: {
    name: "المدفوعات",
    title: "فواتير أقساط الطلاب",
    templateTitle: "نموذج المدفوعات",
    filename: "سجل_المدفوعات",
    templateFilename: "نموذج_المدفوعات",
    columns: [
      { header: "اسم الطالب", key: "student_name", width: 32 },
      { header: "الصف", key: "class_name", width: 18 },
      { header: "المبلغ الكلي", key: "total_fee", width: 18, numFmt: "#,##0" },
      { header: "المدفوع", key: "paid_fee", width: 18, numFmt: "#,##0" },
      { header: "المتبقي", key: "remaining_fee", width: 18, numFmt: "#,##0" },
      { header: "التخفيض", key: "discount", width: 15, numFmt: "#,##0" },
      { header: "ملاحظات", key: "notes", width: 28 },
    ],
  },
} satisfies Record<
  ExportType,
  {
    name: string;
    title: string;
    templateTitle: string;
    filename: string;
    templateFilename: string;
    columns: { header: string; key: string; width: number; numFmt?: string }[];
  }
>;

/**
 * Per-dataset read permission. A role being allow-listed for the route is not
 * enough — the caller must additionally hold the permission for the dataset
 * they are asking for.
 */
const EXPORT_PERMISSION: Record<ExportType, Permission> = {
  students: "view_students",
  teachers: "view_teachers",
  expenses: "view_expenses",
  incomes: "view_incomes",
  payments: "view_payments",
};

/** Field-level grants per dataset, applied when deep permissions are configured. */
const EXPORT_FIELD_MAP: Partial<
  Record<ExportType, { pageKey: string; fields: Record<string, string> }>
> = {
  students: { pageKey: "students", fields: STUDENT_FIELD_MAP },
  teachers: { pageKey: "teachers", fields: TEACHER_FIELD_MAP },
};

/**
 * Drops the values (and their columns) the caller has no field-level grant for.
 * A null map means deep permissions are not configured for this session, in
 * which case the role-level gate above is the only applicable check.
 */
function applyFieldGrants<T extends Record<string, unknown>>(
  type: ExportType,
  rows: T[],
  columns: { header: string; key: string; width: number; numFmt?: string }[],
  deepPermissions: DeepPermissionMap | null,
) {
  const spec = EXPORT_FIELD_MAP[type];
  if (!spec || !deepPermissions) return { rows, columns };

  const filtered = filterFieldsArray(
    rows,
    deepPermissions,
    spec.pageKey,
    spec.fields,
  );
  const removed = new Set(
    Object.keys(spec.fields).filter(
      (field) =>
        deepPermissions[spec.pageKey]?.fields[spec.fields[field]] !== true,
    ),
  );
  return {
    rows: filtered,
    columns: columns.filter((col) => !removed.has(col.key)),
  };
}

export async function GET(req: NextRequest) {
  const schoolId = req.nextUrl.searchParams.get("schoolId");
  const type = req.nextUrl.searchParams.get("type") as ExportType | null;
  const isTemplate = req.nextUrl.searchParams.get("template") === "true";
  const themeId = req.nextUrl.searchParams.get("theme") ?? "navy";
  const fontFamily = req.nextUrl.searchParams.get("font") ?? "Arial";
  const rowDensity = req.nextUrl.searchParams.get("density") ?? "normal";
  const borderStyle = req.nextUrl.searchParams.get("border") ?? "thin";
  const rowStyle = req.nextUrl.searchParams.get("rowStyle") ?? "striped";

  if (!type || !VALID_TYPES.includes(type)) {
    return jsonError("نوع التصدير غير صالح.", 400);
  }

  const context = await resolveSchoolScopedActorContext(
    schoolId,
    {
      allowedRoles: ["super_admin", "admin", "employee"],
      roleDeniedMessage: "تصدير البيانات يتطلب صلاحيات كافية.",
    },
    req.headers.get("authorization"),
  );

  if (!context.ok) {
    return jsonError(
      "message" in context
        ? context.message
        : "تعذر التحقق من صلاحيات المستخدم.",
      "status" in context ? context.status : 500,
    );
  }

  const { actorSupabase, actorUserId, targetSchoolId } = context.value;

  const branchScope = resolveBranchScope(context.value);
  if (!branchScope.ok) {
    return jsonError(branchScope.message, branchScope.status);
  }

  const rateLimited = await enforceRateLimit(req, {
    namespace: "export-bulk",
    windowMs: 60_000,
    maxHits: 20,
    identifier: actorUserId,
  });
  if (rateLimited) return rateLimited;

  // Per-dataset permission — the route-level role allow-list alone would let
  // any allow-listed role export every dataset.
  const canExportDataset = await routeUserHasPermission(
    actorSupabase,
    actorUserId,
    EXPORT_PERMISSION[type],
  );
  if (!canExportDataset) {
    return jsonError("ليس لديك صلاحية تصدير هذه البيانات.", 403);
  }

  const rbacSession = await verifyRBACSession(
    req.cookies.get(RBAC_COOKIE_NAME)?.value,
  );
  const deepPermissions = rbacSession?.deepPermissions ?? null;

  const def = SHEET_DEFS[type];
  const dateStr = new Date()
    .toLocaleDateString("ar-IQ-u-nu-latn")
    .replace(/\//g, "_");

  // ── Template mode: return empty sheet with headers only ────────────────────
  if (isTemplate) {
    const templateGrants = applyFieldGrants(
      type,
      [] as Record<string, unknown>[],
      def.columns,
      deepPermissions,
    );
    const buffer = await buildStyledWorkbook({
      themeId,
      fontFamily,
      rowDensity,
      borderStyle,
      rowStyle,
      sheets: [
        {
          name: def.name,
          title: def.templateTitle,
          columns: templateGrants.columns,
          rows: [],
        },
      ],
    });
    return xlsxResponse(buffer as ArrayBuffer, `${def.templateFilename}.xlsx`);
  }

  // ── Data export ────────────────────────────────────────────────────────────
  try {
    if (type === "students") {
      // Paged: `.limit(5000)` was silently capped at 1000 rows.
      const { data, error } = await fetchAllRows(() =>
        applyBranchScopeToQuery(
          excludeDeletedStudents(
            actorSupabase.from("students").select(
              // `students` names these section/phone2 and has no enrollment date
              // of its own; alias to keep the exported column headers unchanged.
              "full_name, class_name, section_name:section, phone, phone_secondary:phone2, status, enrollment_date:created_at",
            ),
          )
            .eq("school_id", targetSchoolId)
            .returns<
              {
                full_name: string | null;
                class_name: string | null;
                section_name: string | null;
                phone: string | null;
                phone_secondary: string | null;
                status: string | null;
                enrollment_date: string | null;
              }[]
            >(),
          branchScope.value,
        ).order("id"),
      );
      if (error) throw new Error(error.message);
      const rows = (data ?? []).map((r) => ({
        full_name: r.full_name ?? "",
        class_name: r.class_name ?? "",
        section_name: r.section_name ?? "",
        phone: r.phone ?? "",
        phone_secondary: r.phone_secondary ?? "",
        status: r.status ?? "",
        enrollment_date: r.enrollment_date ?? "",
      }));
      const granted = applyFieldGrants(
        type,
        rows,
        def.columns,
        deepPermissions,
      );
      const buffer = await buildStyledWorkbook({
        themeId,
        fontFamily,
        rowDensity,
        borderStyle,
        rowStyle,
        sheets: [{ ...def, columns: granted.columns, rows: granted.rows }],
      });
      return xlsxResponse(
        buffer as ArrayBuffer,
        `${def.filename}_${dateStr}.xlsx`,
      );
    }

    if (type === "teachers") {
      const { data, error } = await applyBranchScopeToQuery(
        actorSupabase
          .from("teachers")
          .select("full_name, subject, phone, email, status, job_title")
          .eq("school_id", targetSchoolId)
          .limit(2000),
        branchScope.value,
      );
      if (error) throw new Error(error.message);
      const rows = (data ?? []).map((r) => ({
        full_name: r.full_name ?? "",
        subject: r.subject ?? "",
        phone: r.phone ?? "",
        email: r.email ?? "",
        job_title: r.job_title ?? "",
        status: r.status ?? "",
      }));
      const granted = applyFieldGrants(
        type,
        rows,
        def.columns,
        deepPermissions,
      );
      const buffer = await buildStyledWorkbook({
        themeId,
        fontFamily,
        rowDensity,
        borderStyle,
        rowStyle,
        sheets: [{ ...def, columns: granted.columns, rows: granted.rows }],
      });
      return xlsxResponse(
        buffer as ArrayBuffer,
        `${def.filename}_${dateStr}.xlsx`,
      );
    }

    if (type === "expenses") {
      // Paged, and soft-deleted rows excluded (they were exported).
      const { data, error } = await fetchAllRows(() =>
        applyBranchScopeToQuery(
          actorSupabase
            .from("expenses")
            .select(
              "amount, expense_date, notes, recipient, receipt_number, expense_types(name)",
            )
            .eq("school_id", targetSchoolId)
            .is("deleted_at", null),
          branchScope.value,
        ).order("id"),
      );
      if (error) throw new Error(error.message);
      const rows = (data ?? []).map((r) => {
        const t = r.expense_types as { name?: string } | null;
        return {
          type_name: t?.name ?? "",
          amount:
            typeof r.amount === "number" ? r.amount : Number(r.amount) || 0,
          expense_date: r.expense_date ?? "",
          recipient: r.recipient ?? "",
          receipt_number: r.receipt_number ?? "",
          notes: r.notes ?? "",
        };
      });
      const buffer = await buildStyledWorkbook({
        themeId,
        fontFamily,
        rowDensity,
        borderStyle,
        rowStyle,
        sheets: [{ ...def, rows }],
      });
      return xlsxResponse(
        buffer as ArrayBuffer,
        `${def.filename}_${dateStr}.xlsx`,
      );
    }

    if (type === "incomes") {
      // Paged, and soft-deleted rows excluded (they were exported).
      const { data, error } = await fetchAllRows(() =>
        applyBranchScopeToQuery(
          actorSupabase
            .from("incomes")
            .select(
              "amount, income_date, source, notes, receipt_number, income_types(name)",
            )
            .eq("school_id", targetSchoolId)
            .is("deleted_at", null),
          branchScope.value,
        ).order("id"),
      );
      if (error) throw new Error(error.message);
      const rows = (data ?? []).map((r) => {
        const t = r.income_types as { name?: string } | null;
        return {
          type_name: t?.name ?? "",
          amount:
            typeof r.amount === "number" ? r.amount : Number(r.amount) || 0,
          income_date: r.income_date ?? "",
          source: r.source ?? "",
          receipt_number: r.receipt_number ?? "",
          notes: r.notes ?? "",
        };
      });
      const buffer = await buildStyledWorkbook({
        themeId,
        fontFamily,
        rowDensity,
        borderStyle,
        rowStyle,
        sheets: [{ ...def, rows }],
      });
      return xlsxResponse(
        buffer as ArrayBuffer,
        `${def.filename}_${dateStr}.xlsx`,
      );
    }

    // payments → redirect to dedicated export route (no direct DB query here)
    return jsonError("لتصدير المدفوعات استخدم /api/web/payments/export.", 400);
  } catch (err) {
    return jsonServerError(
      "web-export-bulk",
      err,
      "تعذر إنشاء ملف التصدير.",
      500,
    );
  }
}
