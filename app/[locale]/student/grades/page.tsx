"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { TrendingUp, AlertCircle } from "lucide-react";
import { StudentShell } from "@/components/StudentShell";
import { getLocaleFromPath } from "@/lib/locale-routing";
import { fetchJsonWithAuthorizedSession } from "@/lib/authorized-api";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { EmptyState } from "@/components/ui/empty-state";

interface GradeRecord {
  id: string;
  subject_name: string;
  exam_name: string | null;
  score: number;
  max_score: number;
  percentage: number;
  date: string | null;
  type: string | null;
}

export default function StudentGradesPage() {
  const pathname = usePathname();
  const locale = getLocaleFromPath(pathname);
  const isAr = locale === "ar";
  const t = (ar: string, en: string) => (isAr ? ar : en);
  const [grades, setGrades] = useState<GradeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetchJsonWithAuthorizedSession("/api/student/grades")
      .then((res) => {
        if (res.response.ok)
          setGrades((res.payload as any)?.data?.grades ?? []);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  const totalGrades = grades.length;
  const avgPercentage =
    totalGrades > 0
      ? Math.round(grades.reduce((s, g) => s + g.percentage, 0) / totalGrades)
      : 0;
  const highestGrade =
    totalGrades > 0 ? Math.max(...grades.map((g) => g.percentage)) : 0;

  const subjectGroups = grades.reduce<Record<string, GradeRecord[]>>(
    (acc, g) => {
      const key = g.subject_name;
      if (!acc[key]) acc[key] = [];
      acc[key].push(g);
      return acc;
    },
    {},
  );

  if (error) {
    return (
      <StudentShell
        currentPath="/student/grades"
        titleAr="درجاتي"
        titleEn="My Grades"
      >
        <div className="flex items-center justify-center min-h-[60vh]">
          <Card className="max-w-md w-full">
            <CardContent className="pt-6 text-center">
              <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">{t("حدث خطأ", "Something went wrong")}</h3>
              <p className="text-muted-foreground mb-4">{t("تعذر تحميل البيانات. حاول مرة أخرى.", "Failed to load data. Please try again.")}</p>
              <button onClick={() => window.location.reload()} className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:opacity-90">{t("إعادة المحاولة", "Retry")}</button>
            </CardContent>
          </Card>
        </div>
      </StudentShell>
    );
  }

  return (
    <StudentShell
      currentPath="/student/grades"
      titleAr="درجاتي"
      titleEn="My Grades"
    >
      <div className="space-y-6">
        {loading ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={i}
                  className="h-[100px] rounded-[var(--card-radius)] bg-[var(--card-bg)] border border-[var(--card-border)] animate-pulse"
                />
              ))}
            </div>
            <div className="h-[300px] rounded-[var(--card-radius)] bg-[var(--card-bg)] border border-[var(--card-border)] animate-pulse" />
          </div>
        ) : grades.length === 0 ? (
          <EmptyState
            icon={
              <TrendingUp className="h-12 w-12 text-[var(--text-tertiary)]" />
            }
            title={t("لا توجد درجات مسجلة", "No grades recorded")}
          />
        ) : (
          <>
            {(() => {
              const gColor = avgPercentage >= 80 ? "var(--success)" : avgPercentage >= 50 ? "var(--warning)" : "var(--danger)";
              const gLabel = avgPercentage >= 80 ? t("ممتاز", "Excellent") : avgPercentage >= 50 ? t("جيد", "Good") : t("ضعيف", "Needs Improvement");
              return (
                <div
                  className="relative overflow-hidden rounded-2xl p-5 sm:p-6"
                  style={{
                    background: `linear-gradient(135deg, ${gColor} 0%, color-mix(in srgb, ${gColor} 70%, var(--primary)) 100%)`,
                  }}
                >
                  <div className="absolute inset-0 opacity-10" style={{
                    backgroundImage: "radial-gradient(circle at 80% 20%, white 0%, transparent 50%), radial-gradient(circle at 20% 80%, white 0%, transparent 40%)",
                  }} />
                  <div className="relative">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-sm font-medium text-white/75">{t("المعدل العام", "Overall Average")}</span>
                      <span className="px-2.5 py-0.5 rounded-full bg-white/20 backdrop-blur-sm text-xs font-semibold text-white border border-white/20">
                        {gLabel}
                      </span>
                    </div>
                    <div className="flex items-end gap-2">
                      <span className="text-4xl sm:text-5xl font-bold tabular-nums text-white">{avgPercentage}</span>
                      <span className="text-lg sm:text-xl font-semibold mb-1 text-white/80">%</span>
                    </div>
                    <div className="mt-3 h-1.5 rounded-full bg-white/20 overflow-hidden">
                      <div className="h-full rounded-full bg-white/80 transition-all duration-700" style={{ width: `${avgPercentage}%` }} />
                    </div>
                    <div className="flex justify-between mt-2 text-xs text-white/70">
                      <span>{totalGrades} {t("درجة", "grades")}</span>
                      <span>{t("أعلى:", "Highest:")} {highestGrade}%</span>
                    </div>
                  </div>
                </div>
              );
            })()}

            {Object.entries(subjectGroups).map(([subject, subGrades]) => {
              const subAvg = Math.round(
                subGrades.reduce((s, g) => s + g.percentage, 0) /
                  subGrades.length,
              );
              return (
                <Card key={subject} className="transition-all duration-150 active:scale-[0.98]">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">{subject}</CardTitle>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-[var(--text-muted)]">
                          {t("المعدل", "Avg")}
                        </span>
                        <Badge
                          variant={
                            subAvg >= 80
                              ? "success"
                              : subAvg >= 50
                                ? "warning"
                                : "danger"
                          }
                          size="sm"
                        >
                          {subAvg}%
                        </Badge>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {subGrades.map((g) => (
                        <div key={g.id} className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-sm text-[var(--text-primary)] truncate">
                                {g.exam_name ?? g.type ?? t("اختبار", "Exam")}
                              </span>
                              {g.date && (
                                <span className="text-xs text-[var(--text-muted)] shrink-0">
                                  {g.date}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="text-sm font-semibold text-[var(--text-primary)]">
                                {g.score}/{g.max_score}
                              </span>
                              <Badge
                                variant={
                                  g.percentage >= 80
                                    ? "success"
                                    : g.percentage >= 50
                                      ? "warning"
                                      : "danger"
                                }
                                size="sm"
                              >
                                {g.percentage}%
                              </Badge>
                            </div>
                          </div>
                          <Progress
                            value={g.percentage}
                            className="h-1.5"
                          />
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </>
        )}
      </div>
    </StudentShell>
  );
}
