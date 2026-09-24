"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import {
  CheckCircle2,
  XCircle,
  Clock,
  CalendarCheck,
  TrendingUp,
  AlertCircle,
} from "lucide-react";
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
import { EmptyState } from "@/components/ui/empty-state";

interface AttendanceRecord {
  id: string;
  date: string;
  status: "present" | "absent" | "late" | "excused";
  subject_name: string | null;
  note: string | null;
}

interface AttendanceSummary {
  total_days: number;
  present: number;
  absent: number;
  late: number;
  excused: number;
  rate: number;
}

const STATUS_MAP: Record<
  string,
  {
    ar: string;
    en: string;
    variant: "success" | "danger" | "warning" | "info";
    icon: typeof CheckCircle2;
  }
> = {
  present: { ar: "حاضر", en: "Present", variant: "success", icon: CheckCircle2 },
  absent: { ar: "غائب", en: "Absent", variant: "danger", icon: XCircle },
  late: { ar: "متأخر", en: "Late", variant: "warning", icon: Clock },
  excused: { ar: "إجازة", en: "Excused", variant: "info", icon: CalendarCheck },
};

export default function StudentAttendancePage() {
  const pathname = usePathname();
  const locale = getLocaleFromPath(pathname);
  const isAr = locale === "ar";
  const t = (ar: string, en: string) => (isAr ? ar : en);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [summary, setSummary] = useState<AttendanceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetchJsonWithAuthorizedSession("/api/student/attendance")
      .then((res) => {
        if (res.response.ok) {
          const d = (res.payload as any)?.data;
          setRecords(d?.records ?? []);
          setSummary(d?.summary ?? null);
        }
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  if (error) {
    return (
      <StudentShell
        currentPath="/student/attendance"
        titleAr="حضوري"
        titleEn="My Attendance"
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
      currentPath="/student/attendance"
      titleAr="حضوري"
      titleEn="My Attendance"
    >
      <div className="space-y-6">
        {loading ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="h-[100px] rounded-[var(--card-radius)] bg-[var(--card-bg)] border border-[var(--card-border)] animate-pulse"
                />
              ))}
            </div>
            <div className="h-[300px] rounded-[var(--card-radius)] bg-[var(--card-bg)] border border-[var(--card-border)] animate-pulse" />
          </div>
        ) : (
          <>
            {summary && (
              <>
                {(() => {
                  const aColor = summary.rate >= 80 ? "var(--success)" : summary.rate >= 60 ? "var(--warning)" : "var(--danger)";
                  const aLabel = summary.rate >= 80 ? t("ممتاز", "Excellent") : summary.rate >= 60 ? t("مقبول", "Fair") : t("ضعيف", "Poor");
                  return (
                    <div
                      className="relative overflow-hidden rounded-2xl p-5 sm:p-6"
                      style={{
                        background: `linear-gradient(135deg, ${aColor} 0%, color-mix(in srgb, ${aColor} 70%, var(--primary)) 100%)`,
                      }}
                    >
                      <div className="absolute inset-0 opacity-10" style={{
                        backgroundImage: "radial-gradient(circle at 80% 20%, white 0%, transparent 50%), radial-gradient(circle at 20% 80%, white 0%, transparent 40%)",
                      }} />
                      <div className="relative">
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-sm font-medium text-white/75">{t("نسبة الحضور", "Attendance Rate")}</span>
                          <span className="px-2.5 py-0.5 rounded-full bg-white/20 backdrop-blur-sm text-xs font-semibold text-white border border-white/20">
                            {aLabel}
                          </span>
                        </div>
                        <div className="flex items-end gap-2">
                          <span className="text-4xl sm:text-5xl font-bold tabular-nums text-white">{summary.rate}</span>
                          <span className="text-lg sm:text-xl font-semibold mb-1 text-white/80">%</span>
                        </div>
                        <div className="mt-3 h-1.5 rounded-full bg-white/20 overflow-hidden">
                          <div className="h-full rounded-full bg-white/80 transition-all duration-700" style={{ width: `${summary.rate}%` }} />
                        </div>
                        <div className="grid grid-cols-4 gap-2 mt-3">
                          <div className="text-center">
                            <span className="block text-lg font-bold text-white">{summary.total_days}</span>
                            <span className="text-[10px] text-white/60">{t("الكل", "Total")}</span>
                          </div>
                          <div className="text-center">
                            <span className="block text-lg font-bold text-white">{summary.present}</span>
                            <span className="text-[10px] text-white/60">{t("حضور", "Present")}</span>
                          </div>
                          <div className="text-center">
                            <span className="block text-lg font-bold text-white">{summary.absent}</span>
                            <span className="text-[10px] text-white/60">{t("غياب", "Absent")}</span>
                          </div>
                          <div className="text-center">
                            <span className="block text-lg font-bold text-white">{summary.late}</span>
                            <span className="text-[10px] text-white/60">{t("تأخر", "Late")}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </>
            )}

            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-[var(--primary)]" />
                  <CardTitle className="text-base">
                    {t("سجل الحضور", "Attendance Records")}
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                {records.length === 0 ? (
                  <EmptyState
                    icon={
                      <CalendarCheck className="h-10 w-10 text-[var(--text-tertiary)]" />
                    }
                    title={t("لا توجد سجلات حضور", "No attendance records")}
                    className="py-6 min-h-0"
                  />
                ) : (
                  <div className="space-y-2">
                    {records.map((r) => {
                      const st = STATUS_MAP[r.status] ?? STATUS_MAP.present;
                      const Icon = st.icon;
                      return (
                        <div
                          key={r.id}
                          className="flex items-center gap-3 rounded-lg border border-[var(--card-border)] p-3 hover:bg-[var(--card-bg)] transition-colors"
                        >
                          <div
                            className="shrink-0 flex items-center justify-center w-9 h-9 rounded-full"
                            style={{
                              backgroundColor: `color-mix(in srgb, var(--${st.variant}) 12%, transparent)`,
                            }}
                          >
                            <Icon
                              className="h-4.5 w-4.5"
                              style={{ color: `var(--${st.variant})` }}
                            />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-[var(--text-primary)]">
                                {r.date}
                              </span>
                              <Badge variant={st.variant} size="sm">
                                {isAr ? st.ar : st.en}
                              </Badge>
                            </div>
                            {(r.subject_name || r.note) && (
                              <p className="text-xs text-[var(--text-muted)] mt-0.5 truncate">
                                {r.subject_name ?? ""}
                                {r.subject_name && r.note ? " · " : ""}
                                {r.note ?? ""}
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </StudentShell>
  );
}
