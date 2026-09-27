"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { BarChart3, Save, Loader2, Users } from "lucide-react";
import { TeacherShell } from "@/components/TeacherShell";
import { getLocaleFromPath } from "@/lib/locale-routing";
import { fetchJsonWithAuthorizedSession } from "@/lib/authorized-api";
import { EmptyState } from "@/components/ui/empty-state";

interface ClassOption {
  class_name: string;
  sections: string[];
  subjects: string[];
  student_count: number;
}

interface RosterStudent {
  student_id: string;
  full_name: string;
  section: string | null;
}

interface RecentGrade {
  id: string;
  student_name: string;
  subject: string;
  exam_type: string | null;
  score: number;
  max_score: number;
  percentage: number | null;
  date: string | null;
}

interface GradesPayload {
  classes: ClassOption[];
  class_name: string;
  students: RosterStudent[];
  recent_grades: RecentGrade[];
}

const EXAM_TYPES = [
  { ar: "يومي", en: "Daily" },
  { ar: "شهري أول", en: "Monthly 1" },
  { ar: "شهري ثاني", en: "Monthly 2" },
  { ar: "نصف السنة", en: "Midterm" },
  { ar: "نهائي", en: "Final" },
];

const fieldClass =
  "w-full rounded-xl border border-[var(--card-border)] bg-[var(--surface-soft)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 transition-all";

export default function TeacherGradesPage() {
  const pathname = usePathname();
  const locale = getLocaleFromPath(pathname);
  const isAr = locale === "ar";
  const t = (ar: string, en: string) => (isAr ? ar : en);

  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [className, setClassName] = useState("");
  const [subject, setSubject] = useState("");
  const [examType, setExamType] = useState(EXAM_TYPES[0].ar);
  const [maxScore, setMaxScore] = useState("100");
  const [students, setStudents] = useState<RosterStudent[]>([]);
  const [scores, setScores] = useState<Record<string, string>>({});
  const [recent, setRecent] = useState<RecentGrade[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (className) params.set("class_name", className);
    if (subject) params.set("subject", subject);
    fetchJsonWithAuthorizedSession(`/api/teacher/grades?${params.toString()}`)
      .then((res) => {
        const d = (res.payload as { data?: GradesPayload })?.data;
        if (!d) return;
        setClasses(d.classes);
        setStudents(d.students);
        setRecent(d.recent_grades);
        if (!className && d.class_name) setClassName(d.class_name);
        const cls = d.classes.find((c) => c.class_name === (className || d.class_name));
        if (cls && (!subject || !cls.subjects.includes(subject))) setSubject(cls.subjects[0] ?? "");
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [className, subject, reloadKey]);

  const currentClass = classes.find((c) => c.class_name === className);

  async function handleSave() {
    const max = Number(maxScore);
    const entries = students
      .filter((s) => scores[s.student_id]?.trim())
      .map((s) => ({ student_id: s.student_id, score: Number(scores[s.student_id]) }));

    if (entries.length === 0) {
      setSaveMsg({ type: "error", text: t("أدخل درجة طالب واحد على الأقل.", "Enter at least one score.") });
      return;
    }
    if (entries.some((e) => Number.isNaN(e.score) || e.score < 0 || (max > 0 && e.score > max))) {
      setSaveMsg({ type: "error", text: t("توجد درجة غير صحيحة أو أكبر من الدرجة الكاملة.", "A score is invalid or above the max.") });
      return;
    }

    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await fetchJsonWithAuthorizedSession<{ ok?: boolean; message?: string; error?: string }>(
        "/api/teacher/grades",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subject, exam_type: examType, max_score: max, grades: entries }),
        },
      );
      if (res.response.ok && res.payload?.ok) {
        setSaveMsg({ type: "success", text: res.payload.message ?? t("تم حفظ الدرجات", "Grades saved") });
        setScores({});
        setReloadKey((k) => k + 1);
      } else {
        setSaveMsg({ type: "error", text: res.payload?.error ?? t("حدث خطأ", "Something went wrong") });
      }
    } catch {
      setSaveMsg({ type: "error", text: t("خطأ في الاتصال", "Connection error") });
    } finally {
      setSaving(false);
    }
  }

  return (
    <TeacherShell currentPath="/teacher/grades" titleAr="الدرجات" titleEn="Grades">
      <div className="space-y-4 max-w-3xl mx-auto">
        {!loading && classes.length === 0 ? (
          <EmptyState
            icon={<BarChart3 className="h-12 w-12 text-[var(--text-tertiary)]" />}
            title={t("لا توجد صفوف مسندة إليك", "No classes assigned to you")}
          />
        ) : (
          <>
            <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4 grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-semibold text-[var(--text-muted)] space-y-1">
                <span>{t("الصف", "Class")}</span>
                <select value={className} onChange={(e) => { setClassName(e.target.value); setScores({}); }} className={fieldClass}>
                  {classes.map((c) => (
                    <option key={c.class_name} value={c.class_name}>{c.class_name}</option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-semibold text-[var(--text-muted)] space-y-1">
                <span>{t("المادة", "Subject")}</span>
                <select value={subject} onChange={(e) => setSubject(e.target.value)} className={fieldClass}>
                  {(currentClass?.subjects ?? []).map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-semibold text-[var(--text-muted)] space-y-1">
                <span>{t("نوع التقييم", "Assessment")}</span>
                <select value={examType} onChange={(e) => setExamType(e.target.value)} className={fieldClass}>
                  {EXAM_TYPES.map((type) => (
                    <option key={type.ar} value={type.ar}>{isAr ? type.ar : type.en}</option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-semibold text-[var(--text-muted)] space-y-1">
                <span>{t("الدرجة الكاملة", "Max score")}</span>
                <input type="number" min={1} value={maxScore} onChange={(e) => setMaxScore(e.target.value)} className={fieldClass} />
              </label>
            </div>

            <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)]">
              <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--card-border)]">
                <h2 className="flex items-center gap-2 text-sm font-bold text-[var(--text-primary)]">
                  <Users className="h-4 w-4 text-[var(--primary)]" />
                  {t("إدخال الدرجات", "Enter scores")}
                </h2>
                <span className="text-xs text-[var(--text-muted)]">{students.length} {t("طالب", "students")}</span>
              </div>
              {loading ? (
                <div className="py-10 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-[var(--primary)]" /></div>
              ) : students.length === 0 ? (
                <p className="p-6 text-center text-sm text-[var(--text-muted)]">{t("لا يوجد طلاب في هذا الصف", "No students in this class")}</p>
              ) : (
                <ul className="divide-y divide-[var(--card-border)]">
                  {students.map((s, i) => (
                    <li key={s.student_id} className="flex items-center gap-3 px-4 py-2.5">
                      <span className="w-6 text-xs text-[var(--text-muted)]">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-[var(--text-primary)] truncate">{s.full_name}</p>
                        {s.section && <p className="text-[11px] text-[var(--text-muted)]">{t("شعبة", "Section")} {s.section}</p>}
                      </div>
                      <input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        value={scores[s.student_id] ?? ""}
                        onChange={(e) => setScores((prev) => ({ ...prev, [s.student_id]: e.target.value }))}
                        placeholder="—"
                        className="w-20 rounded-lg border border-[var(--card-border)] bg-[var(--surface-soft)] px-2 py-1.5 text-center text-sm outline-none focus:border-[var(--primary)]"
                      />
                      <span className="text-xs text-[var(--text-muted)] w-10">/ {maxScore}</span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="p-4 border-t border-[var(--card-border)] space-y-3">
                {saveMsg && (
                  <div className={`rounded-xl px-3 py-2 text-sm ${saveMsg.type === "success" ? "bg-[color-mix(in_srgb,var(--success)_12%,transparent)] text-[var(--success)]" : "bg-red-50 text-red-700"}`}>
                    {saveMsg.text}
                  </div>
                )}
                <button
                  onClick={handleSave}
                  disabled={saving || students.length === 0 || !subject}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--primary)] px-6 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  {t("حفظ الدرجات", "Save grades")}
                </button>
              </div>
            </div>

            {recent.length > 0 && (
              <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4">
                <h2 className="text-sm font-bold text-[var(--text-primary)] mb-3">{t("آخر الدرجات المسجلة", "Recent grades")}</h2>
                <ul className="space-y-2">
                  {recent.slice(0, 30).map((g) => (
                    <li key={g.id} className="flex items-center gap-3 rounded-xl bg-[var(--surface-soft)] px-3 py-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-[var(--text-primary)] truncate">{g.student_name}</p>
                        <p className="text-[11px] text-[var(--text-muted)] truncate">
                          {[g.subject, g.exam_type, g.date?.slice(0, 10)].filter(Boolean).join(" · ")}
                        </p>
                      </div>
                      <span className="text-sm font-bold text-[var(--text-primary)]" dir="ltr">{g.score}/{g.max_score}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </TeacherShell>
  );
}
