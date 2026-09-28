"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Save, ArrowRight } from "lucide-react";
import { TeacherShell } from "@/components/TeacherShell";
import { getLocaleFromPath } from "@/lib/locale-routing";
import { fetchJsonWithAuthorizedSession } from "@/lib/authorized-api";
import { Card, CardContent } from "@/components/ui/card";

interface TeacherClass {
  id: string;
  class_name: string;
  section: string | null;
  subjects: string[];
}

export default function TeacherNewAssignmentPage() {
  const pathname = usePathname();
  const router = useRouter();
  const locale = getLocaleFromPath(pathname);
  const isAr = locale === "ar";
  const t = (ar: string, en: string) => (isAr ? ar : en);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [selectedClassIdx, setSelectedClassIdx] = useState<number>(-1);
  const [subject, setSubject] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const [classes, setClasses] = useState<TeacherClass[]>([]);
  const [loadingClasses, setLoadingClasses] = useState(true);

  useEffect(() => {
    fetchJsonWithAuthorizedSession("/api/teacher/classes")
      .then((res) => {
        if (res.response.ok) {
          setClasses((res.payload as any)?.data?.classes ?? []);
        }
      })
      .catch(() => {})
      .finally(() => setLoadingClasses(false));
  }, []);

  const selectedClass = selectedClassIdx >= 0 ? classes[selectedClassIdx] : null;
  const availableSubjects = selectedClass?.subjects ?? [];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !dueDate || !selectedClass || !subject) {
      setError(t("يرجى ملء الحقول المطلوبة", "Please fill required fields"));
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      const res = await fetchJsonWithAuthorizedSession("/api/teacher/homework", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || null,
          class_name: selectedClass.class_name,
          section: selectedClass.section || null,
          subject,
          // End of the chosen day, Baghdad time.
          due_at: `${dueDate}T23:59:00+03:00`,
        }),
      });

      if (res.response.ok && (res.payload as { ok?: boolean } | null)?.ok !== false) {
        router.push(`/${locale}/teacher/assignments`);
      } else {
        const payload = res.payload as { error?: string; message?: string } | null;
        setError(payload?.message ?? payload?.error ?? t("حدث خطأ", "An error occurred"));
      }
    } catch {
      setError(t("حدث خطأ في الاتصال", "Connection error"));
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass =
    "w-full px-3 py-2.5 rounded-[var(--card-radius)] border border-[var(--card-border)] bg-[var(--card-bg)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:ring-2 focus:ring-[var(--primary)] transition-shadow";

  const labelClass = "block text-sm font-medium text-[var(--text-primary)] mb-1.5";

  return (
    <TeacherShell
      currentPath="/teacher/assignments"
      titleAr="واجب جديد"
      titleEn="New Assignment"
      actions={
        <button
          onClick={() => router.push(`/${locale}/teacher/assignments`)}
          className="inline-flex items-center gap-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
        >
          <ArrowRight className="h-4 w-4" />
          {t("الرجوع", "Back")}
        </button>
      }
    >
      <div className="max-w-2xl mx-auto">
        <Card className="rounded-2xl">
          <CardContent className="p-4 sm:p-6">
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="p-3 rounded-[var(--card-radius)] bg-red-50 border border-red-200 text-red-700 text-sm">
                  {error}
                </div>
              )}

              <div>
                <label className={labelClass}>
                  {t("عنوان الواجب", "Assignment Title")} *
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={t("أدخل عنوان الواجب", "Enter assignment title")}
                  className={inputClass}
                  required
                />
              </div>

              <div>
                <label className={labelClass}>
                  {t("الوصف", "Description")}
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t("أدخل وصف الواجب", "Enter description")}
                  rows={4}
                  className={inputClass}
                  style={{ resize: "vertical" }}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>
                    {t("الصف", "Class")} *
                  </label>
                  <select
                    value={selectedClassIdx}
                    onChange={(e) => {
                      const idx = Number(e.target.value);
                      setSelectedClassIdx(idx);
                      const subs = classes[idx]?.subjects ?? [];
                      setSubject(subs.length === 1 ? subs[0] : "");
                    }}
                    className={inputClass}
                    disabled={loadingClasses}
                    required
                  >
                    <option value={-1}>
                      {loadingClasses
                        ? t("جاري التحميل...", "Loading...")
                        : t("اختر الصف", "Select class")}
                    </option>
                    {classes.map((cls, idx) => (
                      <option key={cls.id} value={idx}>
                        {cls.class_name}
                        {cls.section ? ` - ${cls.section}` : ""}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className={labelClass}>
                    {t("المادة", "Subject")} *
                  </label>
                  <select
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    className={inputClass}
                    disabled={!selectedClass || availableSubjects.length === 0}
                    required
                  >
                    <option value="">
                      {!selectedClass
                        ? t("اختر الصف أولاً", "Select class first")
                        : availableSubjects.length === 0
                          ? t("لا توجد مواد", "No subjects")
                          : t("اختر المادة", "Select subject")}
                    </option>
                    {availableSubjects.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className={labelClass}>
                  {t("تاريخ التسليم", "Due Date")} *
                </label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className={inputClass}
                  required
                />
              </div>

              <p className="text-xs text-[var(--text-muted)]">
                {t("سيصل إشعار بالواجب إلى جميع طلاب الصف المحدد فور الحفظ.", "Students of the selected class are notified as soon as you save.")}
              </p>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-[var(--card-radius)] bg-[var(--primary)] text-white text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  <Save className="h-4 w-4" />
                  {submitting
                    ? t("جاري الحفظ...", "Saving...")
                    : t("حفظ الواجب", "Save Assignment")}
                </button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </TeacherShell>
  );
}
