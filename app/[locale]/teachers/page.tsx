"use client";

import { useState, useMemo } from "react";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useRole } from "@/hooks/useRole";
import { useSchoolScope } from "@/hooks/useSchoolScope";
import { useBranchScope } from "@/hooks/useBranchScope";
import { getLocaleFromPath } from "@/lib/locale-routing";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AppSidebar } from "@/components/AppSidebar";
import { AppShellTopbar } from "@/components/AppShellTopbar";
import {
  SchoolScopeBanner,
  SchoolScopeEmptyState,
} from "@/components/SchoolScopeBanner";
import { Button } from "@/components/ui/button";
import { GraduationCap, FileSpreadsheet, CreditCard, Plus } from "@/lib/icons";
import {
  TeacherExportFieldsModal,
  type TeacherExportFieldKey,
} from "./_components/TeacherExportFieldsModal";
import { TeachersStats } from "./_components/TeachersStats";
import { TeachersFilters } from "./_components/TeachersFilters";
import { TeachersTable } from "./_components/TeachersTable";
import { TeacherFormModal } from "./_components/TeacherFormModal";
import { TeacherAccountsModal } from "./_components/TeacherAccountsModal";
import { useTeachersData } from "./_hooks/useTeachersData";
import { printTeacherCard, printTeacherInfo } from "./_utils/print";
import type { TeacherRecord, TeacherFormData } from "./_types";

const GLASS =
  "inline-flex items-center gap-2 h-9 px-4 rounded-xl text-xs font-bold transition-all active:scale-95 bg-white/[0.12] backdrop-blur-sm text-white border border-white/[0.28] shadow-sm hover:bg-white/[0.22]";
const PRIMARY =
  "inline-flex items-center gap-2 h-9 px-4 rounded-xl text-xs font-bold transition-all active:scale-95 bg-white text-[var(--primary)] shadow-md hover:opacity-90";

export default function TeachersPage() {
  const pathname = usePathname();
  const locale = getLocaleFromPath(pathname) as "ar" | "en";
  const isEn = locale === "en";

  const { profile, can } = useRole();
  const schoolScope = useSchoolScope(profile);
  const _branchScope = useBranchScope(profile);
  const canManage = can("manage_teachers");

  const {
    teachers,
    assignmentsMap,
    loading,
    error,
    search,
    setSearch,
    statusFilter,
    setStatusFilter,
    subjectFilter,
    setSubjectFilter,
    refetch,
    saveTeacher,
    deleteTeacher,
  } = useTeachersData({
    profile,
    selectedSchoolId: schoolScope.selectedSchoolId,
    scopeLoading: schoolScope.scopeLoading,
  });

  const [showForm, setShowForm] = useState(false);
  const [editingTeacher, setEditingTeacher] = useState<TeacherRecord | null>(null);
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<TeacherRecord | null>(null);
  const [showAccountsModal, setShowAccountsModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);

  const handleExcelExport = async (fields: Set<TeacherExportFieldKey>) => {
    setExportLoading(true);
    try {
      const { downloadExcelExport } = await import("@/lib/excel-client");
      const contractLabel = (c: string | null) => {
        if (!c) return "";
        if (isEn) return c.replace("_", " ");
        const map: Record<string, string> = { full_time: "دوام كامل", part_time: "دوام جزئي", substitute: "بديل", volunteer: "متطوع" };
        return map[c] ?? c;
      };
      const genderLabel = (g: string | null) => {
        if (!g) return "";
        return isEn ? (g === "male" ? "Male" : "Female") : (g === "male" ? "ذكر" : "أنثى");
      };
      const statusLabel = (s: string) => {
        if (isEn) return s;
        const map: Record<string, string> = { active: "فعّال", on_leave: "إجازة", suspended: "موقوف", resigned: "مستقيل", terminated: "منتهي" };
        return map[s] ?? s;
      };

      const allColumns: Array<{ header: string; key: string; width: number; fieldKey: TeacherExportFieldKey }> = [
        { header: isEn ? "Employee ID" : "رقم الموظف", key: "employeeId", width: 14, fieldKey: "employeeId" },
        { header: isEn ? "Full Name" : "الاسم الكامل", key: "fullName", width: 28, fieldKey: "fullName" },
        { header: isEn ? "Subject" : "المادة", key: "subject", width: 16, fieldKey: "subject" },
        { header: isEn ? "Job Title" : "المسمى الوظيفي", key: "jobTitle", width: 18, fieldKey: "jobTitle" },
        { header: isEn ? "Contract Type" : "نوع العقد", key: "contractType", width: 14, fieldKey: "contractType" },
        { header: isEn ? "Phone" : "الهاتف", key: "phone", width: 14, fieldKey: "phone" },
        { header: isEn ? "Email" : "البريد", key: "email", width: 24, fieldKey: "email" },
        { header: isEn ? "Gender" : "الجنس", key: "gender", width: 10, fieldKey: "gender" },
        { header: isEn ? "Hire Date" : "تاريخ التعيين", key: "hireDate", width: 14, fieldKey: "hireDate" },
        { header: isEn ? "Years of Experience" : "سنوات الخبرة", key: "experience", width: 14, fieldKey: "experience" },
        { header: isEn ? "Status" : "الحالة", key: "status", width: 12, fieldKey: "status" },
        { header: isEn ? "App Account" : "حساب التطبيق", key: "appAccount", width: 16, fieldKey: "appAccount" },
      ];

      const columns = allColumns.filter((c) => fields.has(c.fieldKey)).map(({ fieldKey: _, ...rest }) => rest);

      await downloadExcelExport({
        filename: isEn ? "teachers.xlsx" : "الأساتذة.xlsx",
        sheets: [{
          name: isEn ? "Teachers" : "الأساتذة",
          title: isEn ? "Teachers List" : "قائمة الأساتذة",
          columns,
          rows: teachers.map((t) => ({
            employeeId: t.employee_id ?? "",
            fullName: t.full_name,
            subject: t.subject ?? "",
            jobTitle: t.job_title ?? "",
            contractType: contractLabel(t.contract_type),
            phone: t.phone ?? "",
            email: t.email ?? "",
            gender: genderLabel(t.gender),
            hireDate: t.hire_date ?? "",
            experience: t.years_experience ?? "",
            status: statusLabel(t.status),
            appAccount: t.app_username ?? "",
          })),
        }],
      });
      setShowExportModal(false);
    } finally {
      setExportLoading(false);
    }
  };

  const schoolId = schoolScope.selectedSchoolId ?? profile?.school_id ?? "";

  const subjects = useMemo(() => {
    const set = new Set(teachers.map((t) => t.subject).filter(Boolean) as string[]);
    return Array.from(set).sort();
  }, [teachers]);

  const handleSave = async (form: TeacherFormData) => {
    setFormLoading(true);
    setFormError("");
    try {
      await saveTeacher(form, editingTeacher?.id ?? null);
      setShowForm(false);
      setEditingTeacher(null);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "تعذر الحفظ");
    } finally {
      setFormLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteTeacher(deleteTarget.id);
      setDeleteTarget(null);
    } catch {
      /* hook surfaces errors in its own state */
    }
  };

  return (
    <ProtectedRoute roles={["super_admin", "admin"]}>
      <div className="flex min-h-screen bg-[var(--surface-soft)]">
        <AppSidebar currentPath="/teachers" />
        <div className="flex-1 flex flex-col min-w-0">
          <AppShellTopbar
            title={isEn ? "Teachers" : "الأساتذة"}
            subtitle={isEn ? "Manage school teaching staff" : "إدارة الكادر التعليمي للمدرسة"}
            scope={schoolScope}
            fixed
          />
          <main className="app-shell-frame--with-fixed-topbar flex-1 overflow-y-auto custom-scrollbar">
            <div className="p-4 sm:p-6 space-y-6">
              <SchoolScopeBanner scope={schoolScope} showSelector={false} />

              {schoolScope.shouldBlockContent ? (
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--card-bg)] p-8">
                  <SchoolScopeEmptyState
                    scope={schoolScope}
                    title={isEn ? "Teachers" : "الأساتذة"}
                    description={isEn ? "Select a school to view teachers" : "اختر مدرسة لعرض الأساتذة"}
                  />
                </div>
              ) : (
                <div className="space-y-5">
                  {/* Hero Banner */}
                  <div
                    className="relative rounded-2xl overflow-hidden p-6 md:p-8"
                    style={{ background: "linear-gradient(135deg, var(--primary) 0%, color-mix(in srgb, var(--primary) 60%, var(--success)) 100%)" }}
                  >
                    <div className="absolute top-0 end-0 w-72 h-72 rounded-full opacity-[0.08] pointer-events-none" style={{ background: "white", transform: "translate(35%, -40%)" }} />
                    <div className="absolute bottom-0 start-12 w-48 h-48 rounded-full opacity-[0.06] pointer-events-none" style={{ background: "white", transform: "translateY(60%)" }} />
                    <div className="relative flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <p className="text-white/60 text-xs font-medium mb-2 tracking-widest uppercase">
                          {isEn ? "Administration · Staff" : "لوحة الإدارة · الكادر التعليمي"}
                        </p>
                        <h1 className="text-2xl md:text-3xl font-black text-white mb-1.5 leading-tight">
                          {isEn ? "Teachers" : "الأساتذة"}
                        </h1>
                        <p className="text-white/70 text-sm mb-4">
                          {isEn ? "Manage school teaching staff and accounts" : "إدارة الكادر التعليمي وحساباتهم في المدرسة"}
                        </p>
                        {canManage && (
                          <div className="flex gap-2 flex-wrap">
                            <button onClick={() => setShowExportModal(true)} className={GLASS}>
                              <FileSpreadsheet size={14} />
                              {isEn ? "Export Excel" : "تصدير Excel"}
                            </button>
                            <button onClick={() => setShowAccountsModal(true)} className={GLASS}>
                              <CreditCard size={14} />
                              {isEn ? "Account Cards" : "بطاقات الحسابات"}
                            </button>
                            <button onClick={() => { setEditingTeacher(null); setShowForm(true); }} className={PRIMARY}>
                              <Plus size={14} />
                              {isEn ? "Add Teacher" : "إضافة أستاذ"}
                            </button>
                          </div>
                        )}
                      </div>
                      <div className="hidden md:flex items-center justify-center w-20 h-20 rounded-2xl flex-shrink-0 bg-white/[0.15] backdrop-blur-sm">
                        <GraduationCap size={38} className="text-white" />
                      </div>
                    </div>
                  </div>

                  <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
                    <TeachersStats teachers={teachers} locale={locale} />
                  </motion.div>

                  <AnimatePresence>
                    {error && (
                      <motion.div
                        initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                        transition={{ duration: 0.2 }}
                        className="px-4 py-3 rounded-xl bg-[color-mix(in_srgb,var(--danger)_8%,transparent)] text-[var(--danger)] text-sm border border-[color-mix(in_srgb,var(--danger)_20%,transparent)]"
                      >
                        {error}
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <div className="rounded-2xl border border-[var(--border)] bg-[var(--card-bg)] shadow-[var(--card-shadow)] overflow-hidden">
                    <div className="p-4 border-b border-[var(--border)]">
                      <TeachersFilters
                        search={search} onSearchChange={setSearch}
                        statusFilter={statusFilter} onStatusChange={setStatusFilter}
                        subjectFilter={subjectFilter} onSubjectChange={setSubjectFilter}
                        subjects={subjects} locale={locale}
                      />
                    </div>
                    <TeachersTable
                      teachers={teachers} loading={loading} canManage={canManage} locale={locale}
                      assignmentsMap={assignmentsMap}
                      onEdit={(t) => { setEditingTeacher(t); setShowForm(true); }}
                      onDelete={(t) => setDeleteTarget(t)}
                      onPrint={(t) => printTeacherCard(t, locale)}
                      onPrintInfo={(t) => printTeacherInfo(t, locale)}
                    />
                  </div>
                </div>
              )}
            </div>
          </main>
        </div>

        <TeacherAccountsModal
          show={showAccountsModal} teachers={teachers} locale={locale}
          schoolId={schoolId} onClose={() => setShowAccountsModal(false)} onAccountsGenerated={refetch}
        />
        <TeacherExportFieldsModal
          show={showExportModal} onClose={() => setShowExportModal(false)}
          onExport={handleExcelExport} loading={exportLoading} locale={locale}
        />
        <TeacherFormModal
          show={showForm} editing={editingTeacher} loading={formLoading} error={formError}
          onConfirm={handleSave}
          onClose={() => { setShowForm(false); setEditingTeacher(null); setFormError(""); }}
          locale={locale} schoolId={schoolId}
        />

        <AnimatePresence>
          {deleteTarget && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
            >
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="bg-[var(--card-bg)] rounded-2xl border border-[var(--card-border)] shadow-xl p-6 max-w-sm w-full space-y-4"
              >
                <div className="text-lg font-bold text-[var(--text-primary)]">
                  {isEn ? "Delete Teacher?" : "حذف المعلم؟"}
                </div>
                <p className="text-sm text-[var(--text-muted)]">
                  {isEn ? `Are you sure you want to delete ${deleteTarget.full_name}?` : `هل تريد حذف ${deleteTarget.full_name}؟`}
                </p>
                <div className="flex gap-2 justify-end">
                  <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(null)}>
                    {isEn ? "Cancel" : "إلغاء"}
                  </Button>
                  <Button variant="destructive" size="sm" onClick={handleDelete}>
                    {isEn ? "Delete" : "حذف"}
                  </Button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </ProtectedRoute>
  );
}
