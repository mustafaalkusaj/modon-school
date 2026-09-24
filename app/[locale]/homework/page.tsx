"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AppSidebar } from "@/components/AppSidebar";
import { AppShellTopbar } from "@/components/AppShellTopbar";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import {
  SchoolScopeBanner,
  SchoolScopeEmptyState,
} from "@/components/SchoolScopeBanner";
import { useSchoolScope } from "@/hooks/useSchoolScope";
import { useRole } from "@/hooks/useRole";
import { fetchWithAuthorizedSession, fetchJsonWithAuthorizedSession } from "@/lib/authorized-api";
import { getLocaleFromPath, localizeAppPath } from "@/lib/locale-routing";
import { BookOpen, Search, RefreshCw, X, Plus, Pencil, Trash2, Save, Paperclip } from "@/lib/icons";

export interface HomeworkRow {
  id: string;
  title: string;
  subject: string | null;
  class_name: string | null;
  section: string | null;
  due_at: string | null;
  status: string;
  max_grade: number;
  allow_late: boolean;
  submission_count: number;
  average_grade: number | null;
  created_at: string;
}

interface HomeworkListResponse {
  ok: boolean;
  data?: HomeworkRow[];
  summary?: { total_assignments: number; total_submissions: number };
  error?: { message?: string };
}

interface ClassItem {
  id: string;
  name: string;
}
interface SectionItem {
  id: string;
  class_id: string;
  name: string;
}

const STATUS_LABELS: Record<string, string> = {
  active: "نشط",
  draft: "مسودة",
  archived: "مؤرشف",
};

export default function HomeworkPage() {
  const pathname = usePathname();
  const locale = getLocaleFromPath(pathname);
  const { profile } = useRole();
  const schoolScope = useSchoolScope(profile);

  const [rows, setRows] = useState<HomeworkRow[]>([]);
  const [summary, setSummary] = useState<{
    total_assignments: number;
    total_submissions: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [subjectFilter, setSubjectFilter] = useState("");
  const [classFilter, setClassFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  /* ── DB classes & sections ── */
  const [dbClasses, setDbClasses] = useState<ClassItem[]>([]);
  const [dbSections, setDbSections] = useState<SectionItem[]>([]);

  /* ── Create / Edit modal state ── */
  const [showFormModal, setShowFormModal] = useState(false);
  const [editingRow, setEditingRow] = useState<HomeworkRow | null>(null);
  const [formBusy, setFormBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const emptyForm = {
    title: "",
    description: "",
    subject: "",
    class_name: "",
    section: "",
    due_at: "",
    max_grade: 100,
    allow_late: false,
    status: "active" as string,
  };
  const [form, setForm] = useState(emptyForm);
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [existingAttachment, setExistingAttachment] = useState<{
    name: string;
    mime: string;
    size: number;
    bucket: string;
    path: string;
  } | null>(null);

  /* ── Delete confirmation state ── */
  const [deleteTarget, setDeleteTarget] = useState<HomeworkRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const fetchHomework = useCallback(async () => {
    if (schoolScope.shouldBlockContent) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (schoolScope.selectedSchoolId)
        params.set("schoolId", schoolScope.selectedSchoolId);
      if (subjectFilter) params.set("subject", subjectFilter);
      if (classFilter) params.set("class_name", classFilter);
      if (statusFilter) params.set("status", statusFilter);
      if (search) params.set("search", search);

      const { response, payload } =
        await fetchJsonWithAuthorizedSession<HomeworkListResponse>(
          `/api/web/homework?${params.toString()}`,
        );
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error?.message ?? "تعذر تحميل قائمة الواجبات.");
      }
      setRows(payload.data ?? []);
      setSummary(payload.summary ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "حدث خطأ غير متوقع.");
    } finally {
      setLoading(false);
    }
  }, [
    schoolScope.shouldBlockContent,
    schoolScope.selectedSchoolId,
    subjectFilter,
    classFilter,
    statusFilter,
    search,
  ]);

  const fetchStructure = useCallback(async () => {
    if (!schoolScope.selectedSchoolId) return;
    try {
      const params = new URLSearchParams({ schoolId: schoolScope.selectedSchoolId });
      const { response, payload } = await fetchJsonWithAuthorizedSession<{
        ok: boolean;
        classes?: ClassItem[];
        sections?: SectionItem[];
      }>(`/api/web/dashboard/structure?${params}`);
      if (response.ok && payload?.ok) {
        setDbClasses(payload.classes ?? []);
        setDbSections(payload.sections ?? []);
      }
    } catch {
      /* silent — filters still work from rows */
    }
  }, [schoolScope.selectedSchoolId]);

  useEffect(() => {
    void fetchHomework();
    void fetchStructure();
  }, [fetchHomework, fetchStructure]);

  const sectionsForSelectedClass = useMemo(() => {
    if (!form.class_name) return [];
    const cls = dbClasses.find((c) => c.name === form.class_name);
    if (!cls) return [];
    return dbSections.filter((s) => s.class_id === cls.id);
  }, [form.class_name, dbClasses, dbSections]);

  /* ── Open create / edit modal ── */
  const openCreate = () => {
    setEditingRow(null);
    setForm(emptyForm);
    setAttachmentFile(null);
    setExistingAttachment(null);
    setFormError(null);
    setShowFormModal(true);
  };
  const openEdit = (row: HomeworkRow) => {
    setEditingRow(row);
    setForm({
      title: row.title,
      description: "",
      subject: row.subject ?? "",
      class_name: row.class_name ?? "",
      section: row.section ?? "",
      due_at: row.due_at ? row.due_at.slice(0, 16) : "",
      max_grade: row.max_grade,
      allow_late: row.allow_late,
      status: row.status,
    });
    setAttachmentFile(null);
    const r = row as unknown as Record<string, unknown>;
    if (r.attachment_name && r.attachment_bucket && r.attachment_path) {
      setExistingAttachment({
        name: r.attachment_name as string,
        mime: (r.attachment_mime_type as string) ?? "",
        size: (r.attachment_size_bytes as number) ?? 0,
        bucket: r.attachment_bucket as string,
        path: r.attachment_path as string,
      });
    } else {
      setExistingAttachment(null);
    }
    setFormError(null);
    setShowFormModal(true);
  };

  /* ── Submit create / edit ── */
  const handleFormSubmit = async () => {
    if (!form.title.trim()) {
      setFormError("العنوان مطلوب.");
      return;
    }
    setFormBusy(true);
    setFormError(null);
    try {
      const params = new URLSearchParams();
      if (schoolScope.selectedSchoolId)
        params.set("schoolId", schoolScope.selectedSchoolId);

      let attachmentMeta: Record<string, unknown> = {};
      if (attachmentFile) {
        setUploadingFile(true);
        const fd = new FormData();
        fd.append("file", attachmentFile);
        const uploadRes = await fetchWithAuthorizedSession(
          `/api/web/homework/upload?${params.toString()}`,
          { method: "POST", body: fd },
        );
        setUploadingFile(false);
        const uploadJson = await uploadRes.json() as { ok: boolean; data?: Record<string, unknown>; error?: { message?: string } };
        if (!uploadRes.ok || !uploadJson.ok) {
          throw new Error(uploadJson.error?.message ?? "فشل رفع الملف.");
        }
        attachmentMeta = uploadJson.data ?? {};
      }

      const body: Record<string, unknown> = {
        title: form.title.trim(),
        description: form.description.trim() || null,
        subject: form.subject.trim() || null,
        class_name: form.class_name.trim() || null,
        section: form.section.trim() || null,
        due_at: form.due_at || null,
        max_grade: form.max_grade,
        allow_late: form.allow_late,
        status: form.status,
        ...attachmentMeta,
      };
      const url = editingRow
        ? `/api/web/homework/${editingRow.id}?${params.toString()}`
        : `/api/web/homework?${params.toString()}`;
      const method = editingRow ? "PUT" : "POST";
      const { response, payload } = await fetchJsonWithAuthorizedSession<{ ok: boolean; error?: { message?: string } }>(
        url,
        { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
      );
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error?.message ?? "فشل حفظ الواجب.");
      }
      setShowFormModal(false);
      void fetchHomework();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "حدث خطأ غير متوقع.");
    } finally {
      setFormBusy(false);
    }
  };

  /* ── Delete handler ── */
  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    try {
      const params = new URLSearchParams();
      if (schoolScope.selectedSchoolId)
        params.set("schoolId", schoolScope.selectedSchoolId);
      const { response, payload } = await fetchJsonWithAuthorizedSession<{ ok: boolean; error?: { message?: string } }>(
        `/api/web/homework/${deleteTarget.id}?${params.toString()}`,
        { method: "DELETE" },
      );
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error?.message ?? "فشل حذف الواجب.");
      }
      setDeleteTarget(null);
      void fetchHomework();
    } catch (err) {
      setError(err instanceof Error ? err.message : "حدث خطأ غير متوقع.");
      setDeleteTarget(null);
    } finally {
      setDeleteBusy(false);
    }
  };

  /* ── Close modals on Escape ── */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (showFormModal) setShowFormModal(false);
        if (deleteTarget) setDeleteTarget(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showFormModal, deleteTarget]);

  const subjects = useMemo(
    () => Array.from(new Set(rows.map((r) => r.subject).filter(Boolean))) as string[],
    [rows],
  );
  const classNames = useMemo(
    () => Array.from(new Set(rows.map((r) => r.class_name).filter(Boolean))) as string[],
    [rows],
  );

  return (
    <ProtectedRoute roles={["super_admin", "admin"]}>
      <div className="flex min-h-screen bg-[var(--surface-soft)]">
        <AppSidebar currentPath="/homework" />
        <div className="flex-1 flex flex-col min-w-0">
          <AppShellTopbar
            title="الواجبات"
            subtitle="إدارة كل الواجبات في المدرسة، التسليمات، والدرجات"
            scope={schoolScope}
            fixed
          />
          <main className="app-shell-frame--with-fixed-topbar flex-1 overflow-y-auto custom-scrollbar">
            <div className="p-4 sm:p-6 space-y-5">
              {error && (
                <div className="rounded-2xl border border-[var(--danger)]/20 bg-[var(--danger)]/10 p-4 text-[var(--danger)] font-bold text-sm flex items-center justify-between gap-2">
                  <span>{error}</span>
                  <button onClick={() => setError(null)} className="shrink-0">
                    <X size={16} />
                  </button>
                </div>
              )}

              <SchoolScopeBanner scope={schoolScope} showSelector={false} />

              {schoolScope.shouldBlockContent ? (
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--card-bg)] p-8">
                  <SchoolScopeEmptyState
                    scope={schoolScope}
                    title="الواجبات"
                    description="اختر مدرسة لعرض الواجبات."
                  />
                </div>
              ) : (
                <>
                  <div
                    className="rounded-2xl p-5 sm:p-6 text-white relative overflow-hidden"
                    style={{
                      background:
                        "linear-gradient(135deg, var(--primary) 0%, color-mix(in srgb, var(--primary) 70%, #000) 100%)",
                    }}
                  >
                    <div className="relative flex flex-wrap items-center gap-4">
                      <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center">
                        <BookOpen size={24} />
                      </div>
                      <div className="flex-1 min-w-[200px]">
                        <h1 className="text-xl sm:text-2xl font-black">الواجبات</h1>
                        <p className="text-sm opacity-80 mt-0.5">
                          إدارة كل الواجبات في المدرسة
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={openCreate}
                          className="rounded-xl bg-white/15 hover:bg-white/25 transition-colors px-3 py-2 text-sm font-bold flex items-center gap-2"
                        >
                          <Plus size={16} />
                          إنشاء واجب
                        </button>
                        <button
                          onClick={() => void fetchHomework()}
                          className="rounded-xl bg-white/15 hover:bg-white/25 transition-colors px-3 py-2 text-sm font-bold flex items-center gap-2"
                        >
                          <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
                          تحديث
                        </button>
                      </div>
                    </div>
                    <div className="relative grid grid-cols-2 gap-3 mt-5 max-w-md">
                      <div className="rounded-xl bg-white/15 backdrop-blur-sm p-3 text-center">
                        <p className="text-2xl font-black">
                          {summary?.total_assignments ?? rows.length}
                        </p>
                        <p className="text-xs opacity-80 mt-0.5">إجمالي الواجبات</p>
                      </div>
                      <div className="rounded-xl bg-white/15 backdrop-blur-sm p-3 text-center">
                        <p className="text-2xl font-black">
                          {summary?.total_submissions ?? 0}
                        </p>
                        <p className="text-xs opacity-80 mt-0.5">إجمالي التسليمات</p>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-[var(--border)] bg-[var(--card-bg)] p-4 flex flex-wrap gap-3 items-center">
                    <div className="relative flex-1 min-w-[200px]">
                      <Search
                        size={16}
                        className="absolute start-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
                      />
                      <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="بحث بعنوان الواجب…"
                        className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] ps-9 pe-3 py-2 text-sm"
                      />
                    </div>
                    <select
                      value={subjectFilter}
                      onChange={(e) => setSubjectFilter(e.target.value)}
                      className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
                    >
                      <option value="">كل المواد</option>
                      {subjects.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                    <select
                      value={classFilter}
                      onChange={(e) => setClassFilter(e.target.value)}
                      className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
                    >
                      <option value="">كل الصفوف</option>
                      {dbClasses.map((c) => (
                        <option key={c.id} value={c.name}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    <select
                      value={statusFilter}
                      onChange={(e) => setStatusFilter(e.target.value)}
                      className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
                    >
                      <option value="">كل الحالات</option>
                      {Object.entries(STATUS_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="rounded-2xl border border-[var(--border)] bg-[var(--card-bg)] overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-[var(--surface-soft)] text-[var(--text-muted)]">
                          <tr>
                            <th className="text-start p-3 font-bold">العنوان</th>
                            <th className="text-start p-3 font-bold">المادة</th>
                            <th className="text-start p-3 font-bold">الصف / الشعبة</th>
                            <th className="text-start p-3 font-bold">الموعد النهائي</th>
                            <th className="text-start p-3 font-bold">الحالة</th>
                            <th className="text-start p-3 font-bold">التسليمات</th>
                            <th className="text-start p-3 font-bold">متوسط الدرجات</th>
                            <th className="text-start p-3 font-bold">خيارات</th>
                          </tr>
                        </thead>
                        <tbody>
                          {loading ? (
                            <tr>
                              <td colSpan={8} className="p-6 text-center text-[var(--text-muted)]">
                                جارِ التحميل…
                              </td>
                            </tr>
                          ) : rows.length === 0 ? (
                            <tr>
                              <td colSpan={8} className="p-6 text-center text-[var(--text-muted)]">
                                لا توجد واجبات مطابقة.
                              </td>
                            </tr>
                          ) : (
                            rows.map((row) => (
                              <tr
                                key={row.id}
                                className="border-t border-[var(--border)] hover:bg-[var(--surface-soft)]"
                              >
                                <td className="p-3 font-bold">
                                  <Link
                                    href={localizeAppPath(`/homework/${row.id}`, locale)}
                                    className="text-[var(--primary)] hover:underline"
                                  >
                                    {row.title}
                                  </Link>
                                </td>
                                <td className="p-3">{row.subject ?? "—"}</td>
                                <td className="p-3">
                                  {row.class_name ?? "—"}
                                  {row.section ? ` / ${row.section}` : ""}
                                </td>
                                <td className="p-3">
                                  {row.due_at
                                    ? new Date(row.due_at).toLocaleDateString("ar-IQ-u-nu-latn")
                                    : "—"}
                                </td>
                                <td className="p-3">
                                  <span className="rounded-full bg-[var(--surface-soft)] px-2 py-0.5 text-xs font-bold">
                                    {STATUS_LABELS[row.status] ?? row.status}
                                  </span>
                                </td>
                                <td className="p-3">{row.submission_count}</td>
                                <td className="p-3">
                                  {row.average_grade !== null
                                    ? `${row.average_grade} / ${row.max_grade}`
                                    : "—"}
                                </td>
                                <td className="p-3">
                                  <div className="flex items-center gap-1">
                                    <button
                                      onClick={() => openEdit(row)}
                                      title="تعديل"
                                      className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-[var(--surface-soft)] hover:text-[var(--primary)] transition-colors"
                                    >
                                      <Pencil size={15} />
                                    </button>
                                    <button
                                      onClick={() => setDeleteTarget(row)}
                                      title="حذف"
                                      className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-[var(--danger)]/10 hover:text-[var(--danger)] transition-colors"
                                    >
                                      <Trash2 size={15} />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}
            </div>
          </main>
        </div>
      </div>
      {/* ── Create / Edit Modal ── */}
      {showFormModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          onClick={() => setShowFormModal(false)}
        >
          <div
            className="w-full max-w-lg rounded-2xl border border-[var(--border)] bg-[var(--card-bg)] shadow-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-5 border-b border-[var(--border)]">
              <h2 className="text-lg font-black">
                {editingRow ? "تعديل الواجب" : "إنشاء واجب جديد"}
              </h2>
              <button
                onClick={() => setShowFormModal(false)}
                className="rounded-lg p-1.5 hover:bg-[var(--surface-soft)] text-[var(--text-muted)]"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto custom-scrollbar">
              {formError && (
                <div className="rounded-xl border border-[var(--danger)]/20 bg-[var(--danger)]/10 p-3 text-[var(--danger)] text-sm font-bold">
                  {formError}
                </div>
              )}

              <div>
                <label className="block text-sm font-bold mb-1">العنوان *</label>
                <input
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
                  placeholder="عنوان الواجب"
                />
              </div>

              <div>
                <label className="block text-sm font-bold mb-1">الوصف</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  rows={3}
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm resize-none"
                  placeholder="وصف تفصيلي للواجب (اختياري)"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-bold mb-1">المادة</label>
                  <input
                    value={form.subject}
                    onChange={(e) => setForm({ ...form, subject: e.target.value })}
                    className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
                    placeholder="مثلاً: الرياضيات"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold mb-1">الصف</label>
                  <select
                    value={form.class_name}
                    onChange={(e) => setForm({ ...form, class_name: e.target.value, section: "" })}
                    className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
                  >
                    <option value="">اختر الصف</option>
                    {dbClasses.map((c) => (
                      <option key={c.id} value={c.name}>{c.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-bold mb-1">الشعبة</label>
                  {sectionsForSelectedClass.length > 0 ? (
                    <select
                      value={form.section}
                      onChange={(e) => setForm({ ...form, section: e.target.value })}
                      className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
                    >
                      <option value="">اختر الشعبة</option>
                      {sectionsForSelectedClass.map((s) => (
                        <option key={s.id} value={s.name}>{s.name}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      value={form.section}
                      onChange={(e) => setForm({ ...form, section: e.target.value })}
                      className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
                      placeholder={form.class_name ? "لا توجد شعب" : "اختر الصف أولاً"}
                      disabled={!form.class_name}
                    />
                  )}
                </div>
                <div>
                  <label className="block text-sm font-bold mb-1">الموعد النهائي</label>
                  <input
                    type="datetime-local"
                    value={form.due_at}
                    onChange={(e) => setForm({ ...form, due_at: e.target.value })}
                    className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-bold mb-1">الدرجة القصوى</label>
                  <input
                    type="number"
                    min={0}
                    value={form.max_grade}
                    onChange={(e) => setForm({ ...form, max_grade: Number(e.target.value) })}
                    className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold mb-1">الحالة</label>
                  <select
                    value={form.status}
                    onChange={(e) => setForm({ ...form, status: e.target.value })}
                    className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
                  >
                    {Object.entries(STATUS_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.allow_late}
                  onChange={(e) => setForm({ ...form, allow_late: e.target.checked })}
                  className="rounded border-[var(--border)]"
                />
                <span className="font-bold">السماح بالتسليم المتأخر</span>
              </label>

              {/* ── Attachment ── */}
              <div>
                <label className="block text-sm font-bold mb-1">مرفق (صورة أو PDF)</label>
                {existingAttachment && !attachmentFile && (
                  <div className="flex items-center gap-2 mb-2 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-2 text-sm">
                    <Paperclip size={14} className="text-[var(--text-muted)] shrink-0" />
                    <span className="truncate flex-1">{existingAttachment.name}</span>
                    <span className="text-[var(--text-muted)] text-xs shrink-0">
                      {(existingAttachment.size / 1024).toFixed(0)} KB
                    </span>
                  </div>
                )}
                {attachmentFile && (
                  <div className="flex items-center gap-2 mb-2 rounded-xl border border-[var(--primary)]/30 bg-[var(--primary)]/5 px-3 py-2 text-sm">
                    <Paperclip size={14} className="text-[var(--primary)] shrink-0" />
                    <span className="truncate flex-1">{attachmentFile.name}</span>
                    <button
                      type="button"
                      onClick={() => setAttachmentFile(null)}
                      className="text-[var(--text-muted)] hover:text-[var(--danger)] shrink-0"
                    >
                      <X size={14} />
                    </button>
                  </div>
                )}
                <input
                  type="file"
                  accept="image/*,.pdf"
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    if (f && f.size > 10 * 1024 * 1024) {
                      setFormError("حجم الملف يتجاوز الحد المسموح (10 ميغابايت).");
                      return;
                    }
                    setAttachmentFile(f);
                    setExistingAttachment(null);
                  }}
                  className="w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-[var(--primary)] file:text-white file:px-3 file:py-1.5 file:text-sm file:font-bold file:cursor-pointer hover:file:opacity-90"
                />
                {uploadingFile && (
                  <p className="mt-1 text-xs text-[var(--text-muted)] flex items-center gap-1">
                    <RefreshCw size={12} className="animate-spin" />
                    جارٍ رفع الملف...
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 p-5 border-t border-[var(--border)]">
              <button
                onClick={() => setShowFormModal(false)}
                className="rounded-xl border border-[var(--border)] px-4 py-2 text-sm font-bold hover:bg-[var(--surface-soft)] transition-colors"
              >
                إلغاء
              </button>
              <button
                onClick={() => void handleFormSubmit()}
                disabled={formBusy}
                className="rounded-xl bg-[var(--primary)] text-white px-4 py-2 text-sm font-bold hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center gap-2"
              >
                {formBusy ? (
                  <RefreshCw size={14} className="animate-spin" />
                ) : (
                  <Save size={14} />
                )}
                {editingRow ? "حفظ التعديلات" : "إنشاء"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Confirmation Modal ── */}
      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          onClick={() => setDeleteTarget(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--card-bg)] shadow-xl p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-black">تأكيد الحذف</h2>
            <p className="text-sm text-[var(--text-muted)]">
              هل أنت متأكد من حذف هذا الواجب؟
            </p>
            <p className="text-sm font-bold">&ldquo;{deleteTarget.title}&rdquo;</p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setDeleteTarget(null)}
                className="rounded-xl border border-[var(--border)] px-4 py-2 text-sm font-bold hover:bg-[var(--surface-soft)] transition-colors"
              >
                إلغاء
              </button>
              <button
                onClick={() => void handleDelete()}
                disabled={deleteBusy}
                className="rounded-xl bg-[var(--danger)] text-white px-4 py-2 text-sm font-bold hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center gap-2"
              >
                {deleteBusy && <RefreshCw size={14} className="animate-spin" />}
                <Trash2 size={14} />
                حذف
              </button>
            </div>
          </div>
        </div>
      )}
    </ProtectedRoute>
  );
}
