"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  Clock,
  CalendarDays,
  Users,
  BookOpen,
  FileText,
  ClipboardCheck,
  BarChart3,
  Send,
  PenSquare,
  Bell,
  Megaphone,
  ChevronLeft,
  ChevronRight,
  GraduationCap,
  type LucideIcon,
} from "lucide-react";
import { TeacherShell } from "@/components/TeacherShell";
import { getLocaleFromPath } from "@/lib/locale-routing";
import { fetchJsonWithAuthorizedSession } from "@/lib/authorized-api";
import { Badge } from "@/components/ui/badge";

interface ScheduleSlot {
  id: string;
  start_time: string;
  end_time: string;
  subject_name: string;
  class_name: string | null;
  room: string | null;
}

interface TeacherClass {
  class_name: string;
  sections: string[];
  subjects: string[];
  student_count: number;
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
  subjects: string[];
  classes: TeacherClass[];
  classes_count: number;
  students_count: number;
  upcoming_exams_count: number;
  unread_notifications: number;
  today_schedule: ScheduleSlot[];
  recent_assignments: RecentAssignment[];
  announcements: Announcement[];
}

function formatDate(value: string | null, isAr: boolean) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(isAr ? "ar-IQ" : "en-GB", {
    day: "numeric",
    month: "short",
  });
}

export default function TeacherDashboardPage() {
  const pathname = usePathname();
  const router = useRouter();
  const locale = getLocaleFromPath(pathname);
  const isAr = locale === "ar";
  const t = (ar: string, en: string) => (isAr ? ar : en);
  const Arrow = isAr ? ChevronLeft : ChevronRight;
  const go = (href: string) => router.push(`/${locale}${href}`);

  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetchJsonWithAuthorizedSession("/api/teacher/dashboard")
      .then((res) => {
        if (res.response.ok) {
          setData((res.payload as { data: DashboardData })?.data ?? null);
        } else {
          setFailed(true);
        }
      })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, []);

  const teacherName = data?.teacher_name ?? t("المعلم", "Teacher");
  const initials = teacherName
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("");

  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const slotMinutes = (timeStr: string) => {
    const [h, m] = (timeStr || "00:00").split(":").map(Number);
    return (h || 0) * 60 + (m || 0);
  };
  const todayLabel = now.toLocaleDateString(isAr ? "ar-IQ" : "en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  const actions: Array<{ label: string; hint: string; icon: LucideIcon; href: string; color: string }> = [
    { label: t("إرسال إشعار", "Send notice"), hint: t("لطلاب صفوفك", "To your students"), icon: Send, href: "/teacher/notifications?compose=1", color: "#0ea5e9" },
    { label: t("واجب جديد", "New homework"), hint: t("نشر واجب لصف", "Publish to a class"), icon: PenSquare, href: "/teacher/assignments/new", color: "#8b5cf6" },
    { label: t("تسجيل الحضور", "Attendance"), hint: t("حضور اليوم", "Today's roll call"), icon: ClipboardCheck, href: "/teacher/attendance", color: "#10b981" },
    { label: t("إدخال الدرجات", "Enter grades"), hint: t("امتحان أو تقييم", "Exam or quiz"), icon: BarChart3, href: "/teacher/grades", color: "#f59e0b" },
  ];

  if (loading) {
    return (
      <TeacherShell currentPath="/teacher" titleAr="الرئيسية" titleEn="Home">
        <div className="space-y-4 max-w-5xl mx-auto">
          <div className="h-40 rounded-3xl bg-[var(--card-bg)] border border-[var(--card-border)] animate-pulse" />
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-24 rounded-2xl bg-[var(--card-bg)] border border-[var(--card-border)] animate-pulse" />
            ))}
          </div>
          <div className="h-48 rounded-2xl bg-[var(--card-bg)] border border-[var(--card-border)] animate-pulse" />
        </div>
      </TeacherShell>
    );
  }

  if (!data) {
    return (
      <TeacherShell currentPath="/teacher" titleAr="الرئيسية" titleEn="Home">
        <div className="max-w-md mx-auto mt-10 rounded-3xl border border-[var(--card-border)] bg-[var(--card-bg)] p-8 text-center">
          <GraduationCap className="h-12 w-12 mx-auto text-[var(--text-tertiary)] mb-3" />
          <p className="font-semibold text-[var(--text-primary)]">
            {failed
              ? t("تعذر تحميل حساب المعلم", "Could not load teacher account")
              : t("لا توجد بيانات", "No data")}
          </p>
          <p className="text-sm text-[var(--text-muted)] mt-2">
            {t(
              "تأكد أن حسابك مرتبط بسجل معلم في المدرسة، أو تواصل مع إدارة المدرسة.",
              "Make sure your account is linked to a teacher record, or contact the school administration.",
            )}
          </p>
        </div>
      </TeacherShell>
    );
  }

  return (
    <TeacherShell currentPath="/teacher" titleAr="الرئيسية" titleEn="Home">
      <div className="space-y-5 sm:space-y-6 max-w-5xl mx-auto">
        {/* Hero */}
        <section className="relative overflow-hidden rounded-3xl p-5 sm:p-7 text-white bg-gradient-to-br from-[var(--primary)] via-[color-mix(in_srgb,var(--primary)_80%,#0f172a)] to-[#0f172a]">
          <div className="absolute -top-10 -end-10 h-40 w-40 rounded-full bg-white/10 pointer-events-none" />
          <div className="absolute -bottom-12 -start-8 h-32 w-32 rounded-full bg-white/5 pointer-events-none" />
          <div className="relative flex items-start gap-4">
            <div className="shrink-0 h-14 w-14 sm:h-16 sm:w-16 rounded-2xl bg-white/15 ring-2 ring-white/25 flex items-center justify-center text-xl font-bold">
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs sm:text-sm opacity-80">{todayLabel}</p>
              <h1 className="text-lg sm:text-2xl font-bold mt-0.5 truncate">
                {t("أهلاً أستاذ", "Welcome,")} {teacherName}
              </h1>
              {data.subjects.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {data.subjects.map((s) => (
                    <span key={s} className="rounded-full bg-white/15 px-2.5 py-0.5 text-[11px] font-medium">
                      {s}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <button
              onClick={() => go("/teacher/notifications")}
              className="relative shrink-0 h-10 w-10 rounded-xl bg-white/15 flex items-center justify-center hover:bg-white/25 transition-colors"
              aria-label={t("الإشعارات", "Notifications")}
            >
              <Bell className="h-5 w-5" />
              {data.unread_notifications > 0 && (
                <span className="absolute -top-1 -end-1 min-w-5 h-5 px-1 rounded-full bg-red-500 text-[10px] font-bold flex items-center justify-center">
                  {data.unread_notifications}
                </span>
              )}
            </button>
          </div>

          <div className="relative grid grid-cols-3 gap-2 sm:gap-3 mt-5">
            {[
              { value: data.classes_count, label: t("صف", "Classes"), href: "/teacher/classes" },
              { value: data.students_count, label: t("طالب", "Students"), href: "/teacher/students" },
              { value: data.today_schedule.length, label: t("حصة اليوم", "Today"), href: "/teacher/schedule" },
            ].map((stat) => (
              <button
                key={stat.href}
                onClick={() => go(stat.href)}
                className="rounded-2xl bg-white/10 hover:bg-white/15 backdrop-blur px-3 py-2.5 text-start transition-colors"
              >
                <p className="text-xl sm:text-2xl font-bold leading-none">{stat.value}</p>
                <p className="text-[11px] sm:text-xs opacity-80 mt-1">{stat.label}</p>
              </button>
            ))}
          </div>
        </section>

        {/* Main actions */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {actions.map((a) => (
            <button
              key={a.href}
              onClick={() => go(a.href)}
              className="group flex items-center gap-3 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-3 sm:p-4 text-start hover:shadow-md active:scale-[0.98] transition-all"
            >
              <span
                className="shrink-0 h-11 w-11 rounded-xl flex items-center justify-center"
                style={{ backgroundColor: `color-mix(in srgb, ${a.color} 14%, transparent)`, color: a.color }}
              >
                <a.icon className="h-5 w-5" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-bold text-[var(--text-primary)] truncate">{a.label}</span>
                <span className="block text-[11px] text-[var(--text-muted)] truncate">{a.hint}</span>
              </span>
            </button>
          ))}
        </section>

        {/* My classes */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="flex items-center gap-2 text-sm sm:text-base font-bold text-[var(--text-primary)]">
              <BookOpen className="h-5 w-5 text-[var(--primary)]" />
              {t("صفوفي", "My classes")}
            </h2>
            <button onClick={() => go("/teacher/classes")} className="text-xs font-semibold text-[var(--primary)]">
              {t("عرض الكل", "View all")}
            </button>
          </div>
          {data.classes.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[var(--card-border)] p-6 text-center">
              <Users className="h-8 w-8 text-[var(--text-tertiary)] mx-auto mb-2" />
              <p className="text-sm font-medium text-[var(--text-primary)]">
                {t("لم تُسند لك صفوف بعد", "No classes assigned yet")}
              </p>
              <p className="text-xs text-[var(--text-muted)] mt-1">
                {t(
                  "تقوم إدارة المدرسة بإسناد الصفوف والمواد لك من صفحة المعلمين.",
                  "The school admin assigns classes and subjects from the Teachers page.",
                )}
              </p>
            </div>
          ) : (
            <div className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1 snap-x">
              {data.classes.map((c) => (
                <button
                  key={c.class_name}
                  onClick={() => go(`/teacher/students?class_name=${encodeURIComponent(c.class_name)}`)}
                  className="snap-start shrink-0 w-48 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4 text-start hover:shadow-md transition-all"
                >
                  <p className="font-bold text-[var(--text-primary)] truncate">{c.class_name}</p>
                  {c.sections.length > 0 && (
                    <p className="text-xs text-[var(--text-muted)] mt-0.5 truncate">
                      {t("الشعب:", "Sections:")} {c.sections.join("، ")}
                    </p>
                  )}
                  <div className="flex items-center gap-1.5 mt-3 text-[var(--primary)]">
                    <Users className="h-4 w-4" />
                    <span className="text-sm font-bold">{c.student_count}</span>
                    <span className="text-xs text-[var(--text-muted)]">{t("طالب", "students")}</span>
                  </div>
                  {c.subjects.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {c.subjects.slice(0, 3).map((s) => (
                        <Badge key={s} variant="info" size="sm">{s}</Badge>
                      ))}
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </section>

        <div className="grid gap-5 lg:grid-cols-2">
          {/* Today's schedule */}
          <section className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="flex items-center gap-2 text-sm sm:text-base font-bold text-[var(--text-primary)]">
                <Clock className="h-5 w-5 text-[var(--primary)]" />
                {t("حصص اليوم", "Today's lessons")}
              </h2>
              <button onClick={() => go("/teacher/schedule")} className="text-xs font-semibold text-[var(--primary)]">
                {t("الجدول", "Schedule")}
              </button>
            </div>
            {data.today_schedule.length === 0 ? (
              <div className="py-6 text-center">
                <CalendarDays className="h-8 w-8 text-[var(--text-tertiary)] mx-auto mb-2" />
                <p className="text-sm text-[var(--text-muted)]">{t("لا توجد حصص اليوم", "No lessons today")}</p>
              </div>
            ) : (
              <ol className="space-y-2">
                {data.today_schedule.map((slot) => {
                  const isActive = nowMinutes >= slotMinutes(slot.start_time) && nowMinutes < slotMinutes(slot.end_time);
                  const isPast = nowMinutes >= slotMinutes(slot.end_time);
                  return (
                    <li
                      key={slot.id}
                      className="flex items-center gap-3 rounded-xl border p-3 transition-all"
                      style={{
                        borderColor: isActive ? "var(--primary)" : "var(--card-border)",
                        backgroundColor: isActive ? "color-mix(in srgb, var(--primary) 8%, var(--card-bg))" : undefined,
                        opacity: isPast ? 0.55 : 1,
                      }}
                    >
                      <div className="shrink-0 w-14 text-center font-mono text-xs text-[var(--text-muted)]" dir="ltr">
                        <p className="font-bold text-[var(--text-primary)]">{slot.start_time?.slice(0, 5)}</p>
                        <p>{slot.end_time?.slice(0, 5)}</p>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-[var(--text-primary)] truncate">{slot.subject_name}</p>
                        <p className="text-xs text-[var(--text-muted)] truncate">
                          {slot.class_name ?? ""}{slot.room ? ` · ${slot.room}` : ""}
                        </p>
                      </div>
                      {isActive && <Badge variant="success" size="sm">{t("الآن", "Now")}</Badge>}
                    </li>
                  );
                })}
              </ol>
            )}
          </section>

          {/* Recent homework */}
          <section className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="flex items-center gap-2 text-sm sm:text-base font-bold text-[var(--text-primary)]">
                <FileText className="h-5 w-5 text-[#8b5cf6]" />
                {t("آخر الواجبات", "Recent homework")}
              </h2>
              <button onClick={() => go("/teacher/assignments")} className="text-xs font-semibold text-[var(--primary)]">
                {t("عرض الكل", "View all")}
              </button>
            </div>
            {data.recent_assignments.length === 0 ? (
              <div className="py-6 text-center">
                <FileText className="h-8 w-8 text-[var(--text-tertiary)] mx-auto mb-2" />
                <p className="text-sm text-[var(--text-muted)]">{t("لم تنشر أي واجب بعد", "No homework yet")}</p>
                <button
                  onClick={() => go("/teacher/assignments/new")}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-[var(--primary)] px-4 py-2 text-xs font-semibold text-white"
                >
                  <PenSquare className="h-4 w-4" />
                  {t("واجب جديد", "New homework")}
                </button>
              </div>
            ) : (
              <ul className="space-y-2">
                {data.recent_assignments.map((a) => (
                  <li key={a.id}>
                    <button
                      onClick={() => go("/teacher/assignments")}
                      className="w-full flex items-center gap-3 rounded-xl border border-[var(--card-border)] p-3 text-start hover:bg-[var(--surface-strong)] transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-[var(--text-primary)] truncate">{a.title}</p>
                        <p className="text-xs text-[var(--text-muted)] truncate">
                          {[a.subject, a.class_name].filter(Boolean).join(" · ")}
                          {a.due_at ? ` · ${t("التسليم", "Due")} ${formatDate(a.due_at, isAr)}` : ""}
                        </p>
                      </div>
                      <Arrow className="h-4 w-4 text-[var(--text-muted)]" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* Announcements */}
        {data.announcements.length > 0 && (
          <section>
            <h2 className="flex items-center gap-2 mb-3 text-sm sm:text-base font-bold text-[var(--text-primary)]">
              <Megaphone className="h-5 w-5 text-[var(--warning)]" />
              {t("إعلانات المدرسة", "School announcements")}
            </h2>
            <div className="space-y-2">
              {data.announcements.map((a) => (
                <div key={a.id} className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-semibold text-[var(--text-primary)]">{a.title}</p>
                    <span className="text-[10px] text-[var(--text-muted)] shrink-0">{formatDate(a.created_at, isAr)}</span>
                  </div>
                  <p className="text-xs text-[var(--text-secondary)] mt-1 line-clamp-2">{a.body}</p>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </TeacherShell>
  );
}
