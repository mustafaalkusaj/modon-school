"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Save, ArrowRight, ArrowLeft, Loader2, PenSquare } from "lucide-react";
import { TeacherShell } from "@/components/TeacherShell";
import { getLocaleFromPath } from "@/lib/locale-routing";
import { fetchJsonWithAuthorizedSession } from "@/lib/authorized-api";

interface AssignmentScope {
  class_name: string;
  section: string | null;
  subject: string;
}

export default function TeacherNewAssignmentPage() {
  const pathname = usePathname();
  const router = useRouter();
  const locale = getLocaleFromPath(pathname);
  const isAr = locale === "ar";
  const t = (ar: string, en: string) => (isAr ? ar : en);
  const Back = isAr ? ArrowRight : ArrowLeft;

  const [scopes, setScopes] = useState<AssignmentScope[]>([]);
  const [scopesLoading, setScopesLoading] = useState(true);
  const [scopeKey, setScopeKey] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [maxGrade, setMaxGrade] = useState("10");
  const [allowLate, setAllowLate] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const keyOf = (s: AssignmentScope) => `${s.class_name}|${s.section ?? ""}|${s.subject}`;

  useEffect(() => {
    fetchJsonWithAuthorizedSession("/api/teacher/classes")
      .then((res) => {
        const list =
          (res.payload as { data?: { assignments?: AssignmentScope[] } })?.data?.assignments ?? [];
        const unique = Array.from(new Map(list.map((s) => [keyOf(s), s])).values());
        setScopes(unique);
        if (unique[0]) setScopeKey(keyOf(unique[0]));
      })
      .catch(() => {})
      .finally(() => setScopesLoading(false));
  }, []);

  const selected = useMemo(() => scopes.find((s) => keyOf(s) === scopeKey), [scopes, scopeKey]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !selected) {
      setError(t("أدخل عنوان الواجب واختر الصف والمادة.", "Enter a title and choose a class/subject."));
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      const res = await fetchJsonWithAuthorizedSession<{ ok?: boolean; message?: string; error?: string }>(
        "/api/teacher/assignments",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: title.trim(),
            description: description.trim() || null,
            class_name: selected.class_name,
            section: selected.section,
            subject: selected.subject,
            due_at: dueDate ? new Date(`${dueDate}T23:59:00`).toISOString() : null,
            max_grade: Number(maxGrade) || 10,
            allow_late: allowLate,
          }),
        },
      );

      if (res.response.ok && res.payload?.ok) {
        router.push(`/${locale}/teacher/assignments`);
      } else {
        setError(res.payload?.message ?? res.payload?.error ?? t("حدث خطأ", "An error occurred"));
      }
    } catch {
      setError(t("حدث خطأ في الاتصال", "Connection error"));
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass =
    "w-full px-3 py-2.5 rounded-xl border border-[var(--card-border)] bg-[var(--surface-soft)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 transition-all";
  const labelClass = "block text-sm font-semibold text-[var(--text-primary)] mb-1.5";

  return (
    <TeacherShell
      currentPath="/teacher/assignments"
      titleAr="واجب جديد"
      titleEn="New Homework"
      actions={
        <button
          onClick={() => router.push(`/${locale}/teacher/assignments`)}
          className="inline-flex items-center gap-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
        >
          <Back className="h-4 w-4" />
          {t("الرجوع", "Back")}
        </button>
      }
    >
      <div className="max-w-2xl mx-auto">
        <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4 sm:p-6">
          <div className="flex items-center gap-3 mb-5">
            <span className="h-11 w-11 rounded-xl bg-[#8b5cf6]/15 text-[#8b5cf6] flex items-center justify-center">
              <PenSquare className="h-5 w-5" />
            </span>
            <div>
              <h1 className="text-base font-bold text-[var(--text-primary)]">{t("نشر واجب جديد", "Publish homework")}</h1>
              <p className="text-xs text-[var(--text-muted)]">
                {t("يصل إشعار تلقائي لطلاب الصف عند النشر.", "Students get notified automatically.")}
              </p>
            </div>
          </div>

          {scopesLoading ? (
            <div className="py-10 flex justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-[var(--primary)]" />
            </div>
          ) : scopes.length === 0 ? (
            <p className="rounded-xl bg-[var(--surface-soft)] p-4 text-sm text-[var(--text-muted)]">
              {t(
                "لا توجد صفوف أو مواد مسندة إليك. تواصل مع إدارة المدرسة لإسنادها من صفحة المعلمين.",
                "No classes or subjects are assigned to you. Ask the school admin to assign them.",
              )}
            </p>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>
              )}

              <div>
                <label className={labelClass}>{t("الصف والمادة", "Class & subject")} *</label>
                <select value={scopeKey} onChange={(e) => setScopeKey(e.target.value)} className={inputClass}>
                  {scopes.map((s) => (
                    <option key={keyOf(s)} value={keyOf(s)}>
                      {s.class_name}
                      {s.section ? ` - ${t("شعبة", "Section")} ${s.section}` : ""} · {s.subject}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className={labelClass}>{t("عنوان الواجب", "Title")} *</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={t("مثال: حل تمارين صفحة 25", "e.g. Exercises on page 25")}
                  className={inputClass}
                  maxLength={240}
                  required
                />
              </div>

              <div>
                <label className={labelClass}>{t("التفاصيل", "Details")}</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t("اكتب تعليمات الواجب للطلاب", "Instructions for students")}
                  rows={4}
                  className={inputClass}
                  style={{ resize: "vertical" }}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>{t("آخر موعد للتسليم", "Due date")}</label>
                  <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>{t("الدرجة الكاملة", "Max grade")}</label>
                  <input
                    type="number"
                    min={1}
                    value={maxGrade}
                    onChange={(e) => setMaxGrade(e.target.value)}
                    className={inputClass}
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                <input type="checkbox" checked={allowLate} onChange={(e) => setAllowLate(e.target.checked)} className="h-4 w-4 accent-[var(--primary)]" />
                {t("السماح بالتسليم المتأخر", "Allow late submissions")}
              </label>

              <button
                type="submit"
                disabled={submitting}
                className="w-full inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-[var(--primary)] text-white text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {submitting ? t("جاري النشر...", "Publishing...") : t("نشر الواجب", "Publish")}
              </button>
            </form>
          )}
        </div>
      </div>
    </TeacherShell>
  );
}
