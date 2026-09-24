"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, usePathname, useRouter } from "next/navigation";
import { AppSidebar } from "@/components/AppSidebar";
import { AppShellTopbar } from "@/components/AppShellTopbar";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { useSchoolScope } from "@/hooks/useSchoolScope";
import { useRole } from "@/hooks/useRole";
import { fetchJsonWithAuthorizedSession } from "@/lib/authorized-api";
import { getLocaleFromPath, localizeAppPath } from "@/lib/locale-routing";
import { ArrowLeft, X, Pencil, Trash2, Save, RefreshCw, Check, Paperclip } from "@/lib/icons";

interface SubmissionRow {
  id: string;
  student_id: string;
  student_name: string | null;
  notes: string | null;
  file_url: string | null;
  file_name: string | null;
  submitted_at: string;
  is_late: boolean;
  grade: number | null;
  feedback: string | null;
  status: string;
  graded_at: string | null;
}

interface HomeworkDetailResponse {
  ok: boolean;
  data?: {
    assignment: {
      id: string;
      title: string;
      description: string | null;
      subject: string | null;
      class_name: string | null;
      section: string | null;
      due_at: string | null;
      status: string;
      max_grade: number;
      allow_late: boolean;
      teacher_name: string | null;
      created_at: string;
      attachment_bucket: string | null;
      attachment_path: string | null;
      attachment_name: string | null;
      attachment_mime_type: string | null;
      attachment_size_bytes: number | null;
    };
    submissions: SubmissionRow[];
    stats: {
      submission_count: number;
      graded_count: number;
      average_grade: number | null;
    };
  };
  error?: { message?: string };
}

const STATUS_LABELS: Record<string, string> = {
  active: "نشط",
  draft: "مسودة",
  archived: "مؤرشف",
};

export default function HomeworkDetailPage() {
  const params = useParams<{ id: string }>();
  const pathname = usePathname();
  const locale = getLocaleFromPath(pathname);
  const router = useRouter();
  const { profile } = useRole();
  const schoolScope = useSchoolScope(profile);

  const [data, setData] = useState<HomeworkDetailResponse["data"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* ── Edit modal state ── */
  const [showEditModal, setShowEditModal] = useState(false);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    title: "",
    description: "",
    subject: "",
    class_name: "",
    section: "",
    due_at: "",
    max_grade: 100,
    allow_late: false,
    status: "active" as string,
  });

  /* ── Delete state ── */
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);

  /* ── Grading state ── */
  const [grades, setGrades] = useState<Record<string, { grade: string; feedback: string }>>({});
  const [gradingBusy, setGradingBusy] = useState<Record<string, boolean>>({});
  const [gradingSuccess, setGradingSuccess] = useState<Record<string, boolean>>({});
  const [gradingError, setGradingError] = useState<Record<string, string | null>>({});

  const fetchDetail = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const query = schoolScope.selectedSchoolId
        ? `?schoolId=${schoolScope.selectedSchoolId}`
        : "";
      const { response, payload } =
        await fetchJsonWithAuthorizedSession<HomeworkDetailResponse>(
          `/api/web/homework/${params.id}${query}`,
        );
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error?.message ?? "تعذر تحميل تفاصيل الواجب.");
      }
      setData(payload.data ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "حدث خطأ غير متوقع.");
    } finally {
      setLoading(false);
    }
  }, [params.id, schoolScope.selectedSchoolId]);

  useEffect(() => {
    void fetchDetail();
  }, [fetchDetail]);

  /* ── Initialize grade inputs when submissions load ── */
  useEffect(() => {
    if (!data?.submissions) return;
    const initial: Record<string, { grade: string; feedback: string }> = {};
    for (const s of data.submissions) {
      initial[s.id] = {
        grade: s.grade !== null ? String(s.grade) : "",
        feedback: s.feedback ?? "",
      };
    }
    setGrades(initial);
  }, [data?.submissions]);

  /* ── Open edit modal ── */
  const openEditModal = () => {
    if (!data?.assignment) return;
    const a = data.assignment;
    setEditForm({
      title: a.title,
      description: a.description ?? "",
      subject: a.subject ?? "",
      class_name: a.class_name ?? "",
      section: a.section ?? "",
      due_at: a.due_at ? a.due_at.slice(0, 16) : "",
      max_grade: a.max_grade,
      allow_late: a.allow_late,
      status: a.status,
    });
    setEditError(null);
    setShowEditModal(true);
  };

  /* ── Submit edit ── */
  const handleEditSubmit = async () => {
    if (!editForm.title.trim()) {
      setEditError("العنوان مطلوب.");
      return;
    }
    setEditBusy(true);
    setEditError(null);
    try {
      const qp = new URLSearchParams();
      if (schoolScope.selectedSchoolId) qp.set("schoolId", schoolScope.selectedSchoolId);
      const body = {
        title: editForm.title.trim(),
        description: editForm.description.trim() || null,
        subject: editForm.subject.trim() || null,
        class_name: editForm.class_name.trim() || null,
        section: editForm.section.trim() || null,
        due_at: editForm.due_at || null,
        max_grade: editForm.max_grade,
        allow_late: editForm.allow_late,
        status: editForm.status,
      };
      const { response, payload } = await fetchJsonWithAuthorizedSession<{ ok: boolean; error?: { message?: string } }>(
        `/api/web/homework/${params.id}?${qp.toString()}`,
        { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
      );
      if (!response.ok || !payload?.ok) throw new Error(payload?.error?.message ?? "فشل حفظ التعديلات.");
      setShowEditModal(false);
      void fetchDetail();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "حدث خطأ غير متوقع.");
    } finally {
      setEditBusy(false);
    }
  };

  /* ── Delete handler ── */
  const handleDelete = async () => {
    setDeleteBusy(true);
    try {
      const qp = new URLSearchParams();
      if (schoolScope.selectedSchoolId) qp.set("schoolId", schoolScope.selectedSchoolId);
      const { response, payload } = await fetchJsonWithAuthorizedSession<{ ok: boolean; error?: { message?: string } }>(
        `/api/web/homework/${params.id}?${qp.toString()}`,
        { method: "DELETE" },
      );
      if (!response.ok || !payload?.ok) throw new Error(payload?.error?.message ?? "فشل حذف الواجب.");
      router.push(localizeAppPath("/homework", locale));
    } catch (err) {
      setError(err instanceof Error ? err.message : "حدث خطأ غير متوقع.");
      setShowDeleteConfirm(false);
    } finally {
      setDeleteBusy(false);
    }
  };

  /* ── Grade a submission ── */
  const handleGrade = async (submissionId: string) => {
    const g = grades[submissionId];
    if (!g || g.grade === "") return;
    const gradeNum = Number(g.grade);
    if (isNaN(gradeNum) || gradeNum < 0) return;
    setGradingBusy((prev) => ({ ...prev, [submissionId]: true }));
    setGradingError((prev) => ({ ...prev, [submissionId]: null }));
    setGradingSuccess((prev) => ({ ...prev, [submissionId]: false }));
    try {
      const qp = new URLSearchParams();
      if (schoolScope.selectedSchoolId) qp.set("schoolId", schoolScope.selectedSchoolId);
      const { response, payload } = await fetchJsonWithAuthorizedSession<{ ok: boolean; error?: { message?: string } }>(
        `/api/web/homework/${params.id}/grade?${qp.toString()}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            submission_id: submissionId,
            grade: gradeNum,
            feedback: g.feedback.trim() || null,
          }),
        },
      );
      if (!response.ok || !payload?.ok) throw new Error(payload?.error?.message ?? "فشل حفظ التقييم.");
      setGradingSuccess((prev) => ({ ...prev, [submissionId]: true }));
      setTimeout(() => setGradingSuccess((prev) => ({ ...prev, [submissionId]: false })), 2000);
      void fetchDetail();
    } catch (err) {
      setGradingError((prev) => ({
        ...prev,
        [submissionId]: err instanceof Error ? err.message : "حدث خطأ.",
      }));
    } finally {
      setGradingBusy((prev) => ({ ...prev, [submissionId]: false }));
    }
  };

  /* ── Close modals on Escape ── */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (showEditModal) setShowEditModal(false);
        if (showDeleteConfirm) setShowDeleteConfirm(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showEditModal, showDeleteConfirm]);

  const assignment = data?.assignment;

  return (
    <ProtectedRoute roles={["super_admin", "admin"]}>
      <div className="flex min-h-screen bg-[var(--surface-soft)]">
        <AppSidebar currentPath="/homework" />
        <div className="flex-1 flex flex-col min-w-0">
          <AppShellTopbar
            title={assignment?.title ?? "تفاصيل الواجب"}
            subtitle={assignment?.subject ?? undefined}
            scope={schoolScope}
            fixed
          />
          <main className="app-shell-frame--with-fixed-topbar flex-1 overflow-y-auto custom-scrollbar">
            <div className="p-4 sm:p-6 space-y-5">
              <button
                onClick={() => router.back()}
                className="inline-flex items-center gap-2 text-sm font-bold text-[var(--text-muted)] hover:text-[var(--text)]"
              >
                <ArrowLeft size={16} />
                رجوع لقائمة الواجبات
              </button>

              {error && (
                <div className="rounded-2xl border border-[var(--danger)]/20 bg-[var(--danger)]/10 p-4 text-[var(--danger)] font-bold text-sm flex items-center justify-between gap-2">
                  <span>{error}</span>
                  <button onClick={() => setError(null)} className="shrink-0">
                    <X size={16} />
                  </button>
                </div>
              )}

              {loading ? (
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--card-bg)] p-8 text-center text-[var(--text-muted)]">
                  جارِ التحميل…
                </div>
              ) : assignment ? (
                <>
                  <div className="rounded-2xl border border-[var(--border)] bg-[var(--card-bg)] p-5 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <h1 className="text-lg font-black">{assignment.title}</h1>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={openEditModal}
                          className="rounded-xl border border-[var(--border)] px-3 py-1.5 text-sm font-bold flex items-center gap-1.5 hover:bg-[var(--surface-soft)] transition-colors"
                        >
                          <Pencil size={14} />
                          تعديل
                        </button>
                        <button
                          onClick={() => setShowDeleteConfirm(true)}
                          className="rounded-xl border border-[var(--danger)]/30 text-[var(--danger)] px-3 py-1.5 text-sm font-bold flex items-center gap-1.5 hover:bg-[var(--danger)]/10 transition-colors"
                        >
                          <Trash2 size={14} />
                          حذف
                        </button>
                      </div>
                    </div>
                    {assignment.description && (
                      <p className="text-sm text-[var(--text-muted)]">
                        {assignment.description}
                      </p>
                    )}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm pt-2">
                      <Field label="المادة" value={assignment.subject ?? "—"} />
                      <Field
                        label="الصف / الشعبة"
                        value={`${assignment.class_name ?? "—"}${
                          assignment.section ? ` / ${assignment.section}` : ""
                        }`}
                      />
                      <Field
                        label="الموعد النهائي"
                        value={
                          assignment.due_at
                            ? new Date(assignment.due_at).toLocaleString("ar-IQ-u-nu-latn")
                            : "—"
                        }
                      />
                      <Field label="المعلم" value={assignment.teacher_name ?? "—"} />
                      <Field label="الدرجة القصوى" value={String(assignment.max_grade)} />
                      <Field
                        label="التسليم المتأخر"
                        value={assignment.allow_late ? "مسموح" : "غير مسموح"}
                      />
                      <Field label="عدد التسليمات" value={String(data?.stats.submission_count ?? 0)} />
                      <Field
                        label="متوسط الدرجات"
                        value={
                          data?.stats.average_grade !== null &&
                          data?.stats.average_grade !== undefined
                            ? `${data.stats.average_grade} / ${assignment.max_grade}`
                            : "—"
                        }
                      />
                    </div>
                    {assignment.attachment_name && assignment.attachment_path && (
                      <div className="pt-3 border-t border-[var(--border)]">
                        <p className="text-xs font-bold text-[var(--text-muted)] mb-2">المرفق</p>
                        {assignment.attachment_mime_type?.startsWith("image/") ? (
                          <a
                            href={`/api/web/storage/file?bucket=${encodeURIComponent(assignment.attachment_bucket ?? "attachments")}&path=${encodeURIComponent(assignment.attachment_path)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={`/api/web/storage/file?bucket=${encodeURIComponent(assignment.attachment_bucket ?? "attachments")}&path=${encodeURIComponent(assignment.attachment_path)}`}
                              alt={assignment.attachment_name}
                              className="max-h-48 rounded-xl border border-[var(--border)] object-contain"
                            />
                            <span className="text-xs text-[var(--primary)] mt-1 inline-flex items-center gap-1">
                              <Paperclip size={12} />
                              {assignment.attachment_name}
                              {assignment.attachment_size_bytes != null && (
                                <span className="text-[var(--text-muted)]">
                                  ({(assignment.attachment_size_bytes / 1024).toFixed(0)} KB)
                                </span>
                              )}
                            </span>
                          </a>
                        ) : (
                          <a
                            href={`/api/web/storage/file?bucket=${encodeURIComponent(assignment.attachment_bucket ?? "attachments")}&path=${encodeURIComponent(assignment.attachment_path)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-2 text-sm text-[var(--primary)] hover:bg-[var(--surface)] transition-colors"
                          >
                            <Paperclip size={14} />
                            <span className="truncate max-w-[200px]">{assignment.attachment_name}</span>
                            {assignment.attachment_size_bytes != null && (
                              <span className="text-[var(--text-muted)] text-xs">
                                ({(assignment.attachment_size_bytes / 1024).toFixed(0)} KB)
                              </span>
                            )}
                          </a>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="rounded-2xl border border-[var(--border)] bg-[var(--card-bg)] overflow-hidden">
                    <div className="p-4 border-b border-[var(--border)] font-bold">
                      التسليمات ({data?.submissions.length ?? 0})
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-[var(--surface-soft)] text-[var(--text-muted)]">
                          <tr>
                            <th className="text-start p-3 font-bold">الطالب</th>
                            <th className="text-start p-3 font-bold">تاريخ التسليم</th>
                            <th className="text-start p-3 font-bold">متأخر</th>
                            <th className="text-start p-3 font-bold">الملاحظات</th>
                            <th className="text-start p-3 font-bold">الدرجة</th>
                            <th className="text-start p-3 font-bold">الحالة</th>
                            <th className="text-start p-3 font-bold min-w-[280px]">التقييم</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(data?.submissions ?? []).length === 0 ? (
                            <tr>
                              <td colSpan={7} className="p-6 text-center text-[var(--text-muted)]">
                                لا توجد تسليمات بعد.
                              </td>
                            </tr>
                          ) : (
                            data?.submissions.map((s) => (
                              <tr
                                key={s.id}
                                className="border-t border-[var(--border)] hover:bg-[var(--surface-soft)]"
                              >
                                <td className="p-3 font-bold">{s.student_name ?? "—"}</td>
                                <td className="p-3">
                                  {new Date(s.submitted_at).toLocaleString("ar-IQ-u-nu-latn")}
                                </td>
                                <td className="p-3">
                                  {s.is_late ? (
                                    <span className="rounded-full bg-[var(--danger)]/10 text-[var(--danger)] px-2 py-0.5 text-xs font-bold">
                                      متأخر
                                    </span>
                                  ) : (
                                    "—"
                                  )}
                                </td>
                                <td className="p-3 max-w-[240px] truncate" title={s.notes ?? undefined}>
                                  {s.notes ?? "—"}
                                </td>
                                <td className="p-3">
                                  {s.grade !== null ? `${s.grade} / ${assignment.max_grade}` : "—"}
                                </td>
                                <td className="p-3">
                                  <span className="rounded-full bg-[var(--surface-soft)] px-2 py-0.5 text-xs font-bold">
                                    {s.status === "graded"
                                      ? "مصحح"
                                      : s.status === "returned"
                                        ? "مُعاد"
                                        : "بانتظار التصحيح"}
                                  </span>
                                </td>
                                <td className="p-3">
                                  <div className="space-y-2">
                                    <div className="flex items-center gap-2">
                                      <input
                                        type="number"
                                        min={0}
                                        max={assignment.max_grade}
                                        placeholder="الدرجة"
                                        value={grades[s.id]?.grade ?? ""}
                                        onChange={(e) =>
                                          setGrades((prev) => ({
                                            ...prev,
                                            [s.id]: { ...prev[s.id], grade: e.target.value },
                                          }))
                                        }
                                        className="w-20 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm"
                                      />
                                      <span className="text-xs text-[var(--text-muted)]">
                                        / {assignment.max_grade}
                                      </span>
                                    </div>
                                    <textarea
                                      placeholder="ملاحظات (اختياري)"
                                      rows={1}
                                      value={grades[s.id]?.feedback ?? ""}
                                      onChange={(e) =>
                                        setGrades((prev) => ({
                                          ...prev,
                                          [s.id]: { ...prev[s.id], feedback: e.target.value },
                                        }))
                                      }
                                      className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm resize-none"
                                    />
                                    <div className="flex items-center gap-2">
                                      <button
                                        onClick={() => void handleGrade(s.id)}
                                        disabled={gradingBusy[s.id] || !grades[s.id]?.grade}
                                        className="rounded-xl bg-[var(--primary)] text-white px-3 py-1.5 text-xs font-bold hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center gap-1.5"
                                      >
                                        {gradingBusy[s.id] ? (
                                          <RefreshCw size={12} className="animate-spin" />
                                        ) : (
                                          <Save size={12} />
                                        )}
                                        حفظ التقييم
                                      </button>
                                      {gradingSuccess[s.id] && (
                                        <span className="text-xs text-[var(--success)] font-bold flex items-center gap-1">
                                          <Check size={12} />
                                          تم الحفظ
                                        </span>
                                      )}
                                      {gradingError[s.id] && (
                                        <span className="text-xs text-[var(--danger)] font-bold">
                                          {gradingError[s.id]}
                                        </span>
                                      )}
                                    </div>
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
              ) : (
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--card-bg)] p-8 text-center text-[var(--text-muted)]">
                  لم يتم العثور على الواجب.
                </div>
              )}
            </div>
          </main>
        </div>
      </div>
      {/* ── Edit Modal ── */}
      {showEditModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          onClick={() => setShowEditModal(false)}
        >
          <div
            className="w-full max-w-lg rounded-2xl border border-[var(--border)] bg-[var(--card-bg)] shadow-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-5 border-b border-[var(--border)]">
              <h2 className="text-lg font-black">تعديل الواجب</h2>
              <button
                onClick={() => setShowEditModal(false)}
                className="rounded-lg p-1.5 hover:bg-[var(--surface-soft)] text-[var(--text-muted)]"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto custom-scrollbar">
              {editError && (
                <div className="rounded-xl border border-[var(--danger)]/20 bg-[var(--danger)]/10 p-3 text-[var(--danger)] text-sm font-bold">
                  {editError}
                </div>
              )}

              <div>
                <label className="block text-sm font-bold mb-1">العنوان *</label>
                <input
                  value={editForm.title}
                  onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-bold mb-1">الوصف</label>
                <textarea
                  value={editForm.description}
                  onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                  rows={3}
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm resize-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-bold mb-1">المادة</label>
                  <input
                    value={editForm.subject}
                    onChange={(e) => setEditForm({ ...editForm, subject: e.target.value })}
                    className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold mb-1">الصف</label>
                  <input
                    value={editForm.class_name}
                    onChange={(e) => setEditForm({ ...editForm, class_name: e.target.value })}
                    className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-bold mb-1">الشعبة</label>
                  <input
                    value={editForm.section}
                    onChange={(e) => setEditForm({ ...editForm, section: e.target.value })}
                    className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold mb-1">الموعد النهائي</label>
                  <input
                    type="datetime-local"
                    value={editForm.due_at}
                    onChange={(e) => setEditForm({ ...editForm, due_at: e.target.value })}
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
                    value={editForm.max_grade}
                    onChange={(e) => setEditForm({ ...editForm, max_grade: Number(e.target.value) })}
                    className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold mb-1">الحالة</label>
                  <select
                    value={editForm.status}
                    onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
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
                  checked={editForm.allow_late}
                  onChange={(e) => setEditForm({ ...editForm, allow_late: e.target.checked })}
                  className="rounded border-[var(--border)]"
                />
                <span className="font-bold">السماح بالتسليم المتأخر</span>
              </label>
            </div>

            <div className="flex items-center justify-end gap-2 p-5 border-t border-[var(--border)]">
              <button
                onClick={() => setShowEditModal(false)}
                className="rounded-xl border border-[var(--border)] px-4 py-2 text-sm font-bold hover:bg-[var(--surface-soft)] transition-colors"
              >
                إلغاء
              </button>
              <button
                onClick={() => void handleEditSubmit()}
                disabled={editBusy}
                className="rounded-xl bg-[var(--primary)] text-white px-4 py-2 text-sm font-bold hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center gap-2"
              >
                {editBusy ? (
                  <RefreshCw size={14} className="animate-spin" />
                ) : (
                  <Save size={14} />
                )}
                حفظ التعديلات
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Confirmation Modal ── */}
      {showDeleteConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          onClick={() => setShowDeleteConfirm(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--card-bg)] shadow-xl p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-black">تأكيد الحذف</h2>
            <p className="text-sm text-[var(--text-muted)]">
              هل أنت متأكد من حذف هذا الواجب؟ سيتم حذف جميع التسليمات المرتبطة.
            </p>
            <p className="text-sm font-bold">&ldquo;{assignment?.title}&rdquo;</p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setShowDeleteConfirm(false)}
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

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[var(--text-muted)] text-xs">{label}</p>
      <p className="font-bold">{value}</p>
    </div>
  );
}
