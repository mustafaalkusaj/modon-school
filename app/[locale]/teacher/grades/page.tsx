"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Save,
  Loader2,
} from "lucide-react";
import { TeacherShell } from "@/components/TeacherShell";
import { getLocaleFromPath } from "@/lib/locale-routing";
import { fetchJsonWithAuthorizedSession } from "@/lib/authorized-api";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";

interface StudentGrade {
  student_id: string;
  full_name: string;
  grade_id: string | null;
  score: number | null;
  max_score: number;
}

interface TeacherClass {
  class_name: string;
  section: string | null;
  subjects: string[];
}

const EXAM_TYPES = [
  { value: "daily", ar: "يومي", en: "Daily" },
  { value: "monthly", ar: "شهري", en: "Monthly" },
  { value: "midterm", ar: "نصف السنة", en: "Midterm" },
  { value: "final", ar: "نهائي", en: "Final" },
];

function classKey(c: { class_name: string; section: string | null }) {
  return `${c.class_name}::${c.section ?? ""}`;
}

export default function TeacherGradesPage() {
  const pathname = usePathname();
  const locale = getLocaleFromPath(pathname);
  const isAr = locale === "ar";
  const t = (ar: string, en: string) => (isAr ? ar : en);

  const [classes, setClasses] = useState<TeacherClass[]>([]);
  const [selectedClass, setSelectedClass] = useState("");
  const [selectedSubject, setSelectedSubject] = useState("");
  const [examType, setExamType] = useState(EXAM_TYPES[1].value);
  const [maxScore, setMaxScore] = useState(100);
  const [students, setStudents] = useState<StudentGrade[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const currentClass = classes.find((c) => classKey(c) === selectedClass) ?? null;
  const subjects = currentClass?.subjects ?? [];

  // Initial load: the teacher's classes and their subjects.
  useEffect(() => {
    fetchJsonWithAuthorizedSession("/api/teacher/grades")
      .then((res) => {
        const cls = (res.payload as { data?: { classes?: TeacherClass[] } } | null)?.data?.classes ?? [];
        if (res.response.ok) {
          setClasses(cls);
          if (cls.length > 0) {
            setSelectedClass(classKey(cls[0]));
            setSelectedSubject(cls[0].subjects[0] ?? "");
          }
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Load the roster + existing marks whenever the filters change.
  useEffect(() => {
    if (!currentClass || !selectedSubject) {
      setStudents([]);
      return;
    }
    setLoading(true);
    setSaveMsg(null);
    const params = new URLSearchParams({
      class_name: currentClass.class_name,
      subject: selectedSubject,
      exam_type: examType,
    });
    if (currentClass.section) params.set("section", currentClass.section);
    fetchJsonWithAuthorizedSession(`/api/teacher/grades?${params}`)
      .then((res) => {
        const list = (res.payload as { data?: { students?: StudentGrade[] } } | null)?.data?.students ?? [];
        if (res.response.ok) {
          setStudents(list);
          const existingMax = list.find((s) => s.grade_id)?.max_score;
          if (existingMax) setMaxScore(existingMax);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [currentClass, selectedSubject, examType]);

  function updateScore(studentId: string, score: number | null) {
    setStudents((prev) =>
      prev.map((s) => (s.student_id === studentId ? { ...s, score } : s)),
    );
  }

  async function handleSave() {
    const toSave = students.filter((s) => s.score != null);
    if (toSave.length === 0) {
      setSaveMsg({ type: "error", text: t("أدخل درجة واحدة على الأقل", "Enter at least one mark") });
      return;
    }
    if (toSave.some((s) => (s.score ?? 0) > maxScore || (s.score ?? 0) < 0)) {
      setSaveMsg({ type: "error", text: t(`الدرجة يجب أن تكون بين 0 و ${maxScore}`, `Marks must be between 0 and ${maxScore}`) });
      return;
    }
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await fetchJsonWithAuthorizedSession("/api/teacher/grades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: selectedSubject,
          exam_type: examType,
          grades: toSave.map((s) => ({
            student_id: s.student_id,
            grade_id: s.grade_id,
            score: s.score,
            max_score: maxScore,
          })),
        }),
      });
      const payload = res.payload as { ok?: boolean; error?: string; data?: { saved?: number } } | null;
      if (res.response.ok && payload?.ok) {
        setSaveMsg({ type: "success", text: t(`تم حفظ ${payload.data?.saved ?? toSave.length} درجة`, "Grades saved") });
      } else {
        setSaveMsg({ type: "error", text: payload?.error ?? t("حدث خطأ", "Something went wrong") });
      }
    } catch {
      setSaveMsg({ type: "error", text: t("خطأ في الاتصال", "Connection error") });
    } finally {
      setSaving(false);
    }
  }

  return (
    <TeacherShell
      currentPath="/teacher/grades"
      titleAr="الدرجات"
      titleEn="Grades"
    >
      <div className="space-y-4 max-w-3xl mx-auto">
        {/* Filters */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <select
            value={selectedClass}
            onChange={(e) => {
              setSelectedClass(e.target.value);
              const next = classes.find((c) => classKey(c) === e.target.value);
              setSelectedSubject(next?.subjects[0] ?? "");
            }}
            className="col-span-2 sm:col-span-1 rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--primary)]"
          >
            {classes.length === 0 && <option value="">{t("لا توجد صفوف مسندة", "No classes assigned")}</option>}
            {classes.map((c) => (
              <option key={classKey(c)} value={classKey(c)}>
                {c.class_name}
                {c.section ? ` / ${c.section}` : ""}
              </option>
            ))}
          </select>
          <select
            value={selectedSubject}
            onChange={(e) => setSelectedSubject(e.target.value)}
            className="col-span-2 sm:col-span-1 rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--primary)]"
          >
            {subjects.length === 0 && <option value="">{t("لا توجد مواد", "No subjects")}</option>}
            {subjects.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            value={examType}
            onChange={(e) => setExamType(e.target.value)}
            className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--primary)]"
          >
            {EXAM_TYPES.map((et) => (
              <option key={et.value} value={et.value}>
                {isAr ? et.ar : et.en}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] px-3 text-xs text-[var(--text-muted)]">
            {t("من", "Out of")}
            <input
              type="number"
              min={1}
              value={maxScore}
              onChange={(e) => setMaxScore(Math.max(1, Number(e.target.value) || 1))}
              className="w-full bg-transparent py-2.5 text-sm text-[var(--text-primary)] outline-none"
            />
          </label>
        </div>

        {/* Grades table */}
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-[56px] rounded-[var(--card-radius)] bg-[var(--card-bg)] border border-[var(--card-border)] animate-pulse"
              />
            ))}
          </div>
        ) : students.length === 0 ? (
          <EmptyState
            icon={<BarChart3 className="h-12 w-12 text-[var(--text-tertiary)]" />}
            title={t("لا يوجد طلاب لعرض الدرجات", "No students to show grades")}
          />
        ) : (
          <>
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <BarChart3 className="h-5 w-5 text-[var(--primary)]" />
                    <CardTitle className="text-sm sm:text-base">
                      {t("درجات الطلاب", "Student Grades")}
                    </CardTitle>
                  </div>
                  <span className="text-xs text-[var(--text-muted)]">
                    {students.length} {t("طالب", "students")}
                  </span>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {students.map((student) => {
                    const pct =
                      student.score != null && maxScore > 0
                        ? Math.round((student.score / maxScore) * 100)
                        : null;
                    return (
                      <div
                        key={student.student_id}
                        className="flex items-center gap-2 sm:gap-3 rounded-lg border border-[var(--card-border)] p-2.5 sm:p-3"
                      >
                        <div className="shrink-0 flex items-center justify-center w-8 h-8 rounded-full bg-[var(--primary)]/[0.1]">
                          <span className="text-[10px] font-bold text-[var(--primary)]">
                            {student.full_name
                              .split(" ")
                              .slice(0, 2)
                              .map((w) => w[0])
                              .join("")}
                          </span>
                        </div>
                        <p className="flex-1 min-w-0 text-xs sm:text-sm font-medium text-[var(--text-primary)] truncate">
                          {student.full_name}
                        </p>
                        <div className="flex items-center gap-2 shrink-0">
                          <input
                            type="number"
                            min={0}
                            max={maxScore}
                            value={student.score ?? ""}
                            onChange={(e) => {
                              const val = e.target.value === "" ? null : Number(e.target.value);
                              updateScore(student.student_id, val);
                            }}
                            placeholder="—"
                            className="w-16 rounded-lg border border-[var(--card-border)] bg-[var(--surface-soft)] px-2 py-1.5 text-center text-sm text-[var(--text-primary)] outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 transition-all"
                          />
                          <span className="text-xs text-[var(--text-muted)]">
                            / {maxScore}
                          </span>
                          {pct != null && (
                            <Badge
                              variant={
                                pct >= 80
                                  ? "success"
                                  : pct >= 50
                                    ? "warning"
                                    : "danger"
                              }
                              size="sm"
                            >
                              {pct}%
                            </Badge>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            {saveMsg && (
              <p
                className={`text-xs rounded-lg px-3 py-2 ${
                  saveMsg.type === "success"
                    ? "text-[var(--success)] bg-[var(--success)]/[0.08]"
                    : "text-[var(--danger)] bg-[var(--danger)]/[0.08]"
                }`}
              >
                {saveMsg.text}
              </p>
            )}
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-[var(--primary)] px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {saving
                ? t("جاري الحفظ...", "Saving...")
                : t("حفظ الدرجات", "Save Grades")}
            </button>
          </>
        )}
      </div>
    </TeacherShell>
  );
}
