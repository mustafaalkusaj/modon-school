"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import {
  CalendarDays,
  Clock,
  BookOpen,
  Star,
  Wallet,
  TrendingUp,
  Award,
  GraduationCap,
  CheckCircle2,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  MessageSquare,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { StudentShell } from "@/components/StudentShell";
import { getLocaleFromPath } from "@/lib/locale-routing";
import {
  fetchJsonWithAuthorizedSession,
  fetchWithAuthorizedSession,
  withJsonHeaders,
} from "@/lib/authorized-api";
import { useRole } from "@/hooks/useRole";
import { StatsCard, KPIGrid } from "@/components/ui/stats-card";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { EmptyState } from "@/components/ui/empty-state";
import { AdsBanner, type AdItem } from "@/components/student/AdsBanner";

interface ScheduleSlot {
  id: string;
  start_time: string;
  end_time: string;
  subject_name: string;
  teacher_name: string | null;
  room: string | null;
}

interface RecentGrade {
  id: string;
  subject_name: string;
  exam_type: string | null;
  score: number;
  max_score: number;
  percentage: number;
  date: string;
}

interface RecentBehavior {
  id: string;
  type: "positive" | "negative";
  points: number;
  reason: string | null;
  date: string;
}

interface UpcomingExam {
  id: string;
  subject_name: string;
  exam_date: string;
  exam_type: string | null;
}

interface DashboardData {
  student_name: string | null;
  class_name: string | null;
  attendance_rate: number | null;
  attendance_total: number;
  attendance_present: number;
  attendance_absent: number;
  upcoming_exams_count: number;
  upcoming_exams: UpcomingExam[];
  behavior_points: number | null;
  total_fee: number;
  total_paid: number;
  remaining_balance: number | null;
  today_schedule: ScheduleSlot[];
  recent_grades: RecentGrade[];
  recent_behavior: RecentBehavior[];
}

const QUICK_ACTIONS = [
  { labelAr: "جدولي", labelEn: "Schedule", href: "/student/schedule", icon: Clock, color: "var(--primary)" },
  { labelAr: "واجباتي", labelEn: "Homework", href: "/student/assignments", icon: BookOpen, color: "var(--info)" },
  { labelAr: "امتحاناتي", labelEn: "Exams", href: "/student/exams", icon: CalendarDays, color: "var(--warning)" },
  { labelAr: "سلوكي", labelEn: "Behavior", href: "/student/behavior", icon: Star, color: "var(--success)" },
  { labelAr: "رسائلي", labelEn: "Messages", href: "/student/messages", icon: MessageSquare, color: "#8b5cf6" },
  { labelAr: "الأقساط", labelEn: "Payments", href: "/student/payments", icon: Wallet, color: "var(--danger)" },
] as const;

const MOTIVATIONAL_QUOTES = [
  "العلم نور والجهل ظلام",
  "من جد وجد ومن زرع حصد",
  "اطلبوا العلم من المهد إلى اللحد",
  "التعليم هو السلاح الأقوى لتغيير العالم",
  "النجاح ليس نهاية الطريق، بل بداية رحلة جديدة",
  "كل يوم هو فرصة جديدة للتعلم",
] as const;

export default function StudentDashboardPage() {
  const pathname = usePathname();
  const locale = getLocaleFromPath(pathname);
  const isAr = locale === "ar";
  const { profile } = useRole();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [ads, setAds] = useState<AdItem[]>([]);

  useEffect(() => {
    fetchJsonWithAuthorizedSession("/api/student/dashboard")
      .then((res) => {
        if (res.response.ok) setData((res.payload as any)?.data ?? null);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));

    fetchJsonWithAuthorizedSession("/api/student/ads")
      .then((res) => {
        if (res.response.ok) {
          const items = (res.payload as any)?.items ?? [];
          setAds(items);
        }
      })
      .catch(() => setError(true));
  }, []);

  function handleReact(adId: string, reaction: string | null) {
    setAds((prev) =>
      prev.map((ad) =>
        ad.id === adId
          ? {
              ...ad,
              my_reaction: reaction,
              reaction_count:
                (ad as any).reaction_count +
                (reaction ? 1 : -1),
            }
          : ad,
      ),
    );
    if (reaction) {
      void fetchWithAuthorizedSession("/api/student/ads/react", {
        method: "POST",
        headers: withJsonHeaders(),
        body: JSON.stringify({ adId, reaction }),
      });
    } else {
      void fetchWithAuthorizedSession(
        `/api/student/ads/react?adId=${adId}`,
        { method: "DELETE" },
      );
    }
  }

  const greeting = isAr
    ? `مرحباً، ${profile?.full_name ?? "طالب"}`
    : `Welcome, ${profile?.full_name ?? "Student"}`;

  const t = (ar: string, en: string) => (isAr ? ar : en);
  const Arrow = isAr ? ChevronLeft : ChevronRight;

  if (error) {
    return (
      <StudentShell currentPath="/student" titleAr="الرئيسية" titleEn="Home">
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
    <StudentShell currentPath="/student" titleAr="الرئيسية" titleEn="Home">
      <div className="space-y-4 sm:space-y-6">
        {/* Welcome Card */}
        <div className="relative overflow-hidden rounded-2xl p-4 sm:p-6"
          style={{
            background: "linear-gradient(135deg, var(--primary) 0%, color-mix(in srgb, var(--primary) 70%, var(--success)) 100%)",
          }}
        >
          <div className="absolute inset-0 opacity-10"
            style={{
              backgroundImage: "radial-gradient(circle at 80% 20%, white 0%, transparent 50%), radial-gradient(circle at 20% 80%, white 0%, transparent 40%)",
            }}
          />
          <div className="relative flex items-center gap-3 sm:gap-4">
            <div className="flex h-11 w-11 sm:h-14 sm:w-14 items-center justify-center rounded-full bg-white/20 backdrop-blur-sm border border-white/30 shrink-0">
              <GraduationCap className="h-6 w-6 sm:h-7 sm:w-7 text-white" />
            </div>
            <div className="min-w-0">
              <h1 className="text-base sm:text-xl font-bold text-white truncate">
                {greeting}
              </h1>
              {data?.class_name && (
                <p className="text-xs sm:text-sm text-white/75 mt-0.5">
                  {t("الصف:", "Class:")} {data.class_name}
                </p>
              )}
            </div>
          </div>
          {data && data.attendance_rate != null && (
            <div className="relative mt-3 sm:mt-4 flex items-center gap-3">
              <div className="flex-1 h-1.5 rounded-full bg-white/20 overflow-hidden">
                <div
                  className="h-full rounded-full bg-white/80"
                  style={{
                    width: `${data.attendance_rate}%`,
                    animation: "bar-grow 1s ease-out 0.3s both",
                  }}
                />
              </div>
              <span className="text-xs font-bold text-white/90 tabular-nums shrink-0">
                {data.attendance_rate}% {t("حضور", "attendance")}
              </span>
            </div>
          )}
        </div>

        {/* Promotional Ads Banner */}
        <AdsBanner ads={ads} isAr={isAr} onReact={handleReact} />

        {/* Quick Actions */}
        <div
          className="flex gap-3 overflow-x-auto pb-1"
          style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
        >
          <style>{`
            @keyframes bar-grow {
              from { width: 0%; }
            }
          `}</style>
          {QUICK_ACTIONS.map((action) => {
            const Icon = action.icon;
            return (
              <Link
                key={action.href}
                href={`/${locale}${action.href}`}
                className="flex flex-col items-center gap-1.5 min-w-[72px] group"
              >
                <div
                  className="flex items-center justify-center w-12 h-12 rounded-full transition-transform duration-200 group-hover:scale-110 group-active:scale-95"
                  style={{
                    background: `linear-gradient(135deg, ${action.color}, color-mix(in srgb, ${action.color} 70%, white))`,
                    boxShadow: `0 4px 12px color-mix(in srgb, ${action.color} 25%, transparent)`,
                  }}
                >
                  <Icon className="h-5 w-5 text-white" />
                </div>
                <span className="text-[11px] font-medium text-[var(--text-secondary)] text-center leading-tight whitespace-nowrap">
                  {isAr ? action.labelAr : action.labelEn}
                </span>
              </Link>
            );
          })}
        </div>

        {loading ? (
          <div className="space-y-4 sm:space-y-6">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="h-[90px] sm:h-[120px] rounded-[var(--card-radius)] bg-[var(--card-bg)] border border-[var(--card-border)] animate-pulse"
                />
              ))}
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
              {Array.from({ length: 2 }).map((_, i) => (
                <div
                  key={i}
                  className="h-[200px] rounded-[var(--card-radius)] bg-[var(--card-bg)] border border-[var(--card-border)] animate-pulse"
                />
              ))}
            </div>
          </div>
        ) : data ? (
          <>
            {/* KPI Cards */}
            <div>
              <h2 className="text-sm font-semibold text-[var(--text-secondary)] mb-2">
                {t("إحصائياتي", "My Stats")}
              </h2>
            <KPIGrid>
              <StatsCard
                label={t("نسبة الحضور", "Attendance")}
                value={
                  data.attendance_rate != null ? `${data.attendance_rate}%` : "—"
                }
                icon={CheckCircle2}
                variant="success"
                description={t(
                  `${data.attendance_present} من ${data.attendance_total} يوم`,
                  `${data.attendance_present} of ${data.attendance_total} days`,
                )}
              />
              <StatsCard
                label={t("امتحانات قادمة", "Upcoming Exams")}
                value={String(data.upcoming_exams_count)}
                icon={GraduationCap}
                variant="info"
                description={
                  data.upcoming_exams[0]
                    ? `${t("التالي:", "Next:")} ${data.upcoming_exams[0].subject_name}`
                    : undefined
                }
              />
              <StatsCard
                label={t("نقاط السلوك", "Behavior")}
                value={
                  data.behavior_points != null
                    ? data.behavior_points > 0
                      ? `+${data.behavior_points}`
                      : String(data.behavior_points)
                    : "—"
                }
                icon={Award}
                variant={
                  (data.behavior_points ?? 0) >= 0 ? "success" : "danger"
                }
              />
              <StatsCard
                label={t("الرصيد المتبقي", "Balance")}
                value={
                  data.remaining_balance != null
                    ? `${data.remaining_balance.toLocaleString()}`
                    : "—"
                }
                icon={Wallet}
                variant={
                  (data.remaining_balance ?? 0) > 0 ? "warning" : "success"
                }
                description={
                  data.total_fee > 0
                    ? `${t("من", "of")} ${data.total_fee.toLocaleString()} IQD`
                    : undefined
                }
              />
            </KPIGrid>
            </div>

            {/* Daily Motivation */}
            <div className="flex items-center gap-3 rounded-xl border border-[var(--card-border)] bg-[color-mix(in_srgb,var(--warning)_5%,var(--card-bg))] p-3 sm:p-4">
              <div className="flex items-center justify-center w-9 h-9 rounded-full bg-[color-mix(in_srgb,var(--warning)_12%,transparent)] shrink-0">
                <Sparkles className="h-[18px] w-[18px] text-[var(--warning)]" />
              </div>
              <p className="text-sm text-[var(--text-secondary)] leading-relaxed italic">
                &ldquo;{MOTIVATIONAL_QUOTES[new Date().getDate() % MOTIVATIONAL_QUOTES.length]}&rdquo;
              </p>
            </div>

            {/* Payment Progress */}
            {data.total_fee > 0 && (() => {
              const paidPct = Math.round((data.total_paid / data.total_fee) * 100);
              return (
                <div
                  className="relative overflow-hidden rounded-2xl p-4 sm:p-5"
                  style={{
                    background: paidPct >= 100
                      ? "linear-gradient(135deg, var(--success) 0%, color-mix(in srgb, var(--success) 70%, var(--primary)) 100%)"
                      : "linear-gradient(135deg, var(--primary) 0%, color-mix(in srgb, var(--primary) 70%, var(--info)) 100%)",
                  }}
                >
                  <div
                    className="absolute inset-0 opacity-10"
                    style={{
                      backgroundImage:
                        "radial-gradient(circle at 80% 20%, white 0%, transparent 50%)",
                    }}
                  />
                  <div className="relative">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-white/75">
                        {t("تقدم الدفع", "Payment Progress")}
                      </span>
                      <span className="text-lg font-bold text-white tabular-nums">
                        {paidPct}%
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-white/20 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-white/80 transition-all duration-700"
                        style={{ width: `${paidPct}%` }}
                      />
                    </div>
                    <div className="flex justify-between mt-2 text-xs text-white/70">
                      <span>
                        {t("المدفوع:", "Paid:")}{" "}
                        {data.total_paid.toLocaleString()} IQD
                      </span>
                      <span>
                        {t("المتبقي:", "Remaining:")}{" "}
                        {(data.remaining_balance ?? 0).toLocaleString()} IQD
                      </span>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Two-column: Today's Schedule + Upcoming Exams */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
              {/* Today's Schedule */}
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <Clock className="h-5 w-5 text-[var(--primary)]" />
                    <CardTitle className="text-base">
                      {t("جدول اليوم", "Today's Schedule")}
                    </CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  {data.today_schedule.length === 0 ? (
                    <EmptyState
                      icon={
                        <CalendarDays className="h-10 w-10 text-[var(--text-tertiary)]" />
                      }
                      title={t("لا توجد حصص اليوم", "No classes today")}
                      className="py-6 min-h-0"
                    />
                  ) : (
                    <div className="space-y-2">
                      {data.today_schedule.map((slot) => (
                        <div
                          key={slot.id}
                          className="flex items-center gap-3 rounded-lg border border-[var(--card-border)] p-3 hover:bg-[var(--card-bg)] transition-all duration-150 active:scale-[0.98]"
                        >
                          <div className="shrink-0 text-center min-w-[70px]">
                            <p className="text-xs font-mono font-semibold text-[var(--primary)]">
                              {slot.start_time?.slice(0, 5)}
                            </p>
                            <p className="text-[10px] text-[var(--text-muted)]">
                              {slot.end_time?.slice(0, 5)}
                            </p>
                          </div>
                          <div className="h-8 w-px bg-[var(--border)]" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                              {slot.subject_name}
                            </p>
                            {slot.teacher_name && (
                              <p className="text-xs text-[var(--text-muted)] truncate">
                                {slot.teacher_name}
                              </p>
                            )}
                          </div>
                          {slot.room && (
                            <Badge variant="neutral" size="sm">
                              {slot.room}
                            </Badge>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Upcoming Exams */}
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <BookOpen className="h-5 w-5 text-[var(--info)]" />
                    <CardTitle className="text-base">
                      {t("الامتحانات القادمة", "Upcoming Exams")}
                    </CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  {data.upcoming_exams.length === 0 ? (
                    <EmptyState
                      icon={
                        <GraduationCap className="h-10 w-10 text-[var(--text-tertiary)]" />
                      }
                      title={t(
                        "لا توجد امتحانات قادمة",
                        "No upcoming exams",
                      )}
                      className="py-6 min-h-0"
                    />
                  ) : (
                    <div className="space-y-2">
                      {data.upcoming_exams.map((exam) => {
                        const daysLeft = Math.ceil(
                          (new Date(exam.exam_date).getTime() - Date.now()) /
                            86400000,
                        );
                        return (
                          <div
                            key={exam.id}
                            className="flex items-center gap-3 rounded-lg border border-[var(--card-border)] p-3 hover:bg-[var(--card-bg)] transition-all duration-150 active:scale-[0.98]"
                          >
                            <div className="shrink-0 flex flex-col items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--info)_8%,transparent)] px-3 py-1.5 min-w-[56px]">
                              <span className="text-lg font-bold text-[var(--info)]">
                                {daysLeft}
                              </span>
                              <span className="text-[10px] text-[var(--info)]">
                                {t("يوم", "days")}
                              </span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                                {exam.subject_name}
                              </p>
                              <p className="text-xs text-[var(--text-muted)]">
                                {exam.exam_date}
                                {exam.exam_type ? ` · ${exam.exam_type}` : ""}
                              </p>
                            </div>
                            <Arrow className="h-4 w-4 text-[var(--text-muted)]" />
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Two-column: Recent Grades + Recent Behavior */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
              {/* Recent Grades */}
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <TrendingUp className="h-5 w-5 text-[var(--success)]" />
                    <CardTitle className="text-base">
                      {t("آخر الدرجات", "Recent Grades")}
                    </CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  {data.recent_grades.length === 0 ? (
                    <EmptyState
                      icon={
                        <TrendingUp className="h-10 w-10 text-[var(--text-tertiary)]" />
                      }
                      title={t("لا توجد درجات بعد", "No grades yet")}
                      className="py-6 min-h-0"
                    />
                  ) : (
                    <div className="space-y-3">
                      {data.recent_grades.map((g) => (
                        <div key={g.id} className="flex items-center gap-3">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                              {g.subject_name}
                            </p>
                            <p className="text-xs text-[var(--text-muted)]">
                              {g.exam_type ?? ""} · {g.date}
                            </p>
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
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Recent Behavior */}
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <Star className="h-5 w-5 text-[var(--warning)]" />
                    <CardTitle className="text-base">
                      {t("آخر السلوك", "Recent Behavior")}
                    </CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  {data.recent_behavior.length === 0 ? (
                    <EmptyState
                      icon={
                        <Star className="h-10 w-10 text-[var(--text-tertiary)]" />
                      }
                      title={t("لا توجد سجلات سلوك", "No behavior records")}
                      className="py-6 min-h-0"
                    />
                  ) : (
                    <div className="space-y-3">
                      {data.recent_behavior.map((b) => (
                        <div key={b.id} className="flex items-center gap-3">
                          <div
                            className={`shrink-0 flex items-center justify-center w-8 h-8 rounded-full ${
                              b.type === "positive"
                                ? "bg-[color-mix(in_srgb,var(--success)_12%,transparent)]"
                                : "bg-[color-mix(in_srgb,var(--danger)_12%,transparent)]"
                            }`}
                          >
                            {b.type === "positive" ? (
                              <CheckCircle2 className="h-4 w-4 text-[var(--success)]" />
                            ) : (
                              <AlertCircle className="h-4 w-4 text-[var(--danger)]" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                              {b.reason ?? t("بدون سبب", "No reason")}
                            </p>
                            <p className="text-xs text-[var(--text-muted)]">
                              {b.date}
                            </p>
                          </div>
                          <span
                            className={`text-sm font-bold ${
                              b.type === "positive"
                                ? "text-[var(--success)]"
                                : "text-[var(--danger)]"
                            }`}
                          >
                            {b.type === "positive"
                              ? `+${b.points}`
                              : `-${b.points}`}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </>
        ) : (
          <EmptyState
            title={t("لا توجد بيانات حالياً", "No data available")}
          />
        )}
      </div>
    </StudentShell>
  );
}
