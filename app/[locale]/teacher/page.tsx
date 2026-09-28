"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Clock,
  CalendarDays,
  Users,
  FileText,
  ClipboardCheck,
  BarChart3,
  Send,
  Megaphone,
  ChevronLeft,
  ChevronRight,
  BookOpen,
  Plus,
} from "lucide-react";
import { TeacherShell } from "@/components/TeacherShell";
import { getLocaleFromPath } from "@/lib/locale-routing";
import { fetchJsonWithAuthorizedSession } from "@/lib/authorized-api";
import { EmptyState } from "@/components/ui/empty-state";

interface ScheduleSlot {
  id: string;
  start_time: string;
  end_time: string;
  subject_name: string;
  class_name: string | null;
  room: string | null;
}

interface TeacherClass {
  id: string;
  class_name: string;
  section: string | null;
  student_count: number;
  subjects: string[];
}

interface RecentAssignment {
  id: string;
  title: string;
  subject: string | null;
  due_at: string | null;
  class_name: string | null;
}

interface Announcement {
  id: string;
  title: string;
  body: string;
  created_at: string;
}

interface DashboardData {
  teacher_name: string | null;
  classes_count: number;
  students_count: number;
  upcoming_exams_count: number;
  subjects: string[];
  classes: TeacherClass[];
  today_schedule: ScheduleSlot[];
  recent_assignments: RecentAssignment[];
  announcements: Announcement[];
}

function slotMinutes(timeStr: string) {
  const [h, m] = (timeStr || "00:00").split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

export default function TeacherDashboardPage() {
  const pathname = usePathname();
  const locale = getLocaleFromPath(pathname);
  const isAr = locale === "ar";
  const t = (ar: string, en: string) => (isAr ? ar : en);
  const Arrow = isAr ? ChevronLeft : ChevronRight;

  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetchJsonWithAuthorizedSession("/api/teacher/dashboard")
      .then((res) => {
        const raw = (res.payload as { data?: DashboardData } | null)?.data;
        if (res.response.ok && raw) setData(raw);
        else setFailed(true);
      })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, []);

  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? t("صباح الخير", "Good morning") : t("مساء الخير", "Good evening");
  const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();
  const todayLabel = new Date().toLocaleDateString(isAr ? "ar-IQ" : "en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  const actions = [
    { label: t("تسجيل الحضور", "Take attendance"), icon: ClipboardCheck, href: "/teacher/attendance", color: "#10b981" },
    { label: t("واجب جديد", "New homework"), icon: Plus, href: "/teacher/assignments/new", color: "#8b5cf6" },
    { label: t("إرسال إشعار", "Send notice"), icon: Send, href: "/teacher/notifications/send", color: "#f59e0b" },
    { label: t("رصد الدرجات", "Enter grades"), icon: BarChart3, href: "/teacher/grades", color: "#0ea5e9" },
  ];

  return (
    <TeacherShell currentPath="/teacher" titleAr="الرئيسية" titleEn="Home">
      <div className="space-y-5 max-w-5xl mx-auto">
        {loading ? (
          <div className="space-y-4">
            {[96, 88, 160].map((h, i) => (
              <div key={i} style={{ height: h }} className="rounded-2xl bg-[var(--card-bg)] border border-[var(--card-border)] animate-pulse" />
            ))}
          </div>
        ) : !data ? (
          <EmptyState
            title={t("تعذر تحميل بيانات الأستاذ", "Could not load teacher data")}
            description={
              failed
                ? t("تأكد من ربط حسابك بسجل أستاذ في المدرسة، أو أعد تسجيل الدخول.", "Make sure your account is linked to a teacher record, or sign in again.")
                : undefined
            }
          />
        ) : (
          <>
            {/* Greeting */}
            <section className="rounded-3xl border border-[var(--card-border)] bg-[var(--card-bg)] p-5">
              <p className="text-xs text-[var(--text-muted)]">{todayLabel}</p>
              <h2 className="mt-1 text-lg sm:text-xl font-bold text-[var(--text-primary)]">
                {isAr
                  ? `${greeting}، أستاذ ${data.teacher_name ?? ""}`
                  : `${greeting}, ${data.teacher_name ?? ""}`}
              </h2>
              {data.subjects.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {data.subjects.map((s) => (
                    <span key={s} className="rounded-full bg-[color-mix(in_srgb,var(--primary)_10%,transparent)] px-2.5 py-1 text-[11px] font-semibold text-[var(--primary)]">
                      {s}
                    </span>
                  ))}
                </div>
              )}
              <div className="mt-4 grid grid-cols-3 gap-2 sm:gap-3">
                {[
                  { n: data.classes_count, l: t("صف وشعبة", "Classes"), icon: BookOpen, href: "/teacher/classes" },
                  { n: data.students_count, l: t("طالب", "Students"), icon: Users, href: "/teacher/students" },
                  { n: data.upcoming_exams_count, l: t("امتحان قادم", "Upcoming exams"), icon: CalendarDays, href: "/teacher/exams" },
                ].map((s) => (
                  <Link key={s.href} href={`/${locale}${s.href}`} className="rounded-2xl bg-[var(--surface-soft,var(--background))] p-3 text-center hover:ring-2 hover:ring-[var(--primary)]/30 transition">
                    <s.icon className="mx-auto h-5 w-5 text-[var(--primary)]" />
                    <p className="mt-1 text-xl sm:text-2xl font-extrabold text-[var(--text-primary)] tabular-nums">{s.n}</p>
                    <p className="text-[11px] text-[var(--text-muted)]">{s.l}</p>
                  </Link>
                ))}
              </div>
            </section>

            {/* Quick actions */}
            <section className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
              {actions.map((a) => (
                <Link
                  key={a.href}
                  href={`/${locale}${a.href}`}
                  className="flex items-center gap-3 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-3 active:scale-[0.98] hover:shadow-md transition"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white" style={{ background: a.color }}>
                    <a.icon className="h-5 w-5" />
                  </span>
                  <span className="text-sm font-semibold text-[var(--text-primary)]">{a.label}</span>
                </Link>
              ))}
            </section>

            {/* My classes */}
            <section>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-sm sm:text-base font-bold text-[var(--text-primary)]">
                  <BookOpen className="h-5 w-5 text-[var(--primary)]" />
                  {t("صفوفي", "My classes")}
                </h3>
                <Link href={`/${locale}/teacher/classes`} className="text-xs font-semibold text-[var(--primary)]">
                  {t("عرض الكل", "View all")}
                </Link>
              </div>
              {data.classes.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-[var(--card-border)] p-6 text-center text-sm text-[var(--text-muted)]">
                  {t("لم تُسند إليك صفوف بعد. تواصل مع إدارة المدرسة لإسناد الصفوف والمواد.", "No classes assigned yet. Ask the school administration to assign your classes and subjects.")}
                </div>
              ) : (
                <div className="flex gap-2 sm:gap-3 overflow-x-auto pb-1 -mx-1 px-1 snap-x">
                  {data.classes.map((c) => {
                    const params = new URLSearchParams({ class_name: c.class_name });
                    if (c.section) params.set("section", c.section);
                    return (
                      <Link
                        key={c.id}
                        href={`/${locale}/teacher/students?${params}`}
                        className="snap-start shrink-0 w-44 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4 hover:border-[var(--primary)] transition"
                      >
                        <p className="font-bold text-[var(--text-primary)]">
                          {c.class_name}
                          {c.section && <span className="text-[var(--text-muted)] font-medium"> / {c.section}</span>}
                        </p>
                        <p className="mt-1 text-xs text-[var(--text-muted)]">
                          {c.student_count} {t("طالب", "students")}
                        </p>
                        <p className="mt-2 text-[11px] text-[var(--primary)] truncate">{c.subjects.join("، ")}</p>
                      </Link>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Today's schedule */}
            <section>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-sm sm:text-base font-bold text-[var(--text-primary)]">
                  <Clock className="h-5 w-5 text-[var(--primary)]" />
                  {t("حصص اليوم", "Today's periods")}
                </h3>
                <Link href={`/${locale}/teacher/schedule`} className="text-xs font-semibold text-[var(--primary)]">
                  {t("الجدول الكامل", "Full schedule")}
                </Link>
              </div>
              {data.today_schedule.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-[var(--card-border)] p-6 text-center text-sm text-[var(--text-muted)]">
                  {t("لا توجد حصص مسجلة لك اليوم", "No periods scheduled for you today")}
                </div>
              ) : (
                <div className="space-y-2">
                  {data.today_schedule.map((slot) => {
                    const start = slotMinutes(slot.start_time);
                    const end = slotMinutes(slot.end_time);
                    const isNow = slot.start_time && nowMinutes >= start && nowMinutes < end;
                    const isPast = slot.end_time && nowMinutes >= end;
                    return (
                      <div
                        key={slot.id}
                        className={`flex items-center gap-3 rounded-2xl border p-3 ${
                          isNow ? "border-[var(--primary)] bg-[color-mix(in_srgb,var(--primary)_8%,var(--card-bg))]" : "border-[var(--card-border)] bg-[var(--card-bg)]"
                        } ${isPast ? "opacity-60" : ""}`}
                      >
                        <div className="w-16 shrink-0 text-center font-mono text-xs text-[var(--text-muted)]" dir="ltr">
                          {slot.start_time?.slice(0, 5)}
                          <br />
                          {slot.end_time?.slice(0, 5)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-[var(--text-primary)] truncate">{slot.subject_name}</p>
                          <p className="text-xs text-[var(--text-muted)] truncate">
                            {slot.class_name}
                            {slot.room ? ` · ${slot.room}` : ""}
                          </p>
                        </div>
                        {isNow && (
                          <span className="rounded-full bg-[var(--primary)] px-2 py-0.5 text-[10px] font-bold text-white">
                            {t("الآن", "Now")}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Recent homework */}
            <section>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-sm sm:text-base font-bold text-[var(--text-primary)]">
                  <FileText className="h-5 w-5 text-[var(--primary)]" />
                  {t("آخر الواجبات", "Recent homework")}
                </h3>
                <Link href={`/${locale}/teacher/assignments`} className="text-xs font-semibold text-[var(--primary)]">
                  {t("عرض الكل", "View all")}
                </Link>
              </div>
              {data.recent_assignments.length === 0 ? (
                <Link
                  href={`/${locale}/teacher/assignments/new`}
                  className="block rounded-2xl border border-dashed border-[var(--card-border)] p-6 text-center text-sm text-[var(--primary)] font-semibold"
                >
                  + {t("أضف أول واجب لطلابك", "Add your first homework")}
                </Link>
              ) : (
                <div className="space-y-2">
                  {data.recent_assignments.map((a) => (
                    <Link
                      key={a.id}
                      href={`/${locale}/teacher/assignments`}
                      className="flex items-center gap-3 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-3"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-[var(--text-primary)] truncate">{a.title}</p>
                        <p className="text-xs text-[var(--text-muted)] truncate">
                          {[a.subject, a.class_name, a.due_at ? new Date(a.due_at).toLocaleDateString(isAr ? "ar-IQ" : "en-GB") : null]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </div>
                      <Arrow className="h-4 w-4 text-[var(--text-muted)]" />
                    </Link>
                  ))}
                </div>
              )}
            </section>

            {/* Announcements */}
            {data.announcements.length > 0 && (
              <section>
                <h3 className="mb-2 flex items-center gap-2 text-sm sm:text-base font-bold text-[var(--text-primary)]">
                  <Megaphone className="h-5 w-5 text-[var(--warning)]" />
                  {t("إعلانات المدرسة", "School announcements")}
                </h3>
                <div className="space-y-2">
                  {data.announcements.map((a) => (
                    <div key={a.id} className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-3">
                      <p className="text-sm font-semibold text-[var(--text-primary)]">{a.title}</p>
                      <p className="mt-1 text-xs text-[var(--text-secondary)] line-clamp-2">{a.body}</p>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </TeacherShell>
  );
}
