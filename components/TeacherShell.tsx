"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import {
  Home,
  BookOpen,
  Users,
  ClipboardCheck,
  FileText,
  BarChart3,
  GraduationCap,
  Send,
  Bell,
  MessageSquare,
  CalendarDays,
  Plane,
  Wallet,
  User,
  Menu,
  X,
} from "lucide-react";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { ProfileMenu } from "@/components/ProfileMenu";
import { NotificationBell } from "@/components/NotificationBell";
import { EnablePushBanner } from "@/components/web-push-registration";
import { useRole } from "@/hooks/useRole";
import { useRuntimeBranding } from "@/hooks/brand/useRuntimeBranding";
import { getLocaleFromPath } from "@/lib/locale-routing";

interface TeacherShellProps {
  children: React.ReactNode;
  currentPath: string;
  titleAr: string;
  titleEn: string;
  subtitleAr?: string;
  subtitleEn?: string;
  actions?: React.ReactNode;
}

interface NavItem {
  href: string;
  ar: string;
  en: string;
  icon: LucideIcon;
}

interface NavGroup {
  ar: string;
  en: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    ar: "التدريس",
    en: "Teaching",
    items: [
      { href: "/teacher", ar: "الرئيسية", en: "Home", icon: Home },
      { href: "/teacher/classes", ar: "صفوفي", en: "My Classes", icon: BookOpen },
      { href: "/teacher/students", ar: "طلابي", en: "My Students", icon: Users },
      { href: "/teacher/attendance", ar: "الحضور والغياب", en: "Attendance", icon: ClipboardCheck },
      { href: "/teacher/assignments", ar: "الواجبات", en: "Homework", icon: FileText },
      { href: "/teacher/grades", ar: "الدرجات", en: "Grades", icon: BarChart3 },
      { href: "/teacher/exams", ar: "الامتحانات", en: "Exams", icon: GraduationCap },
      { href: "/teacher/schedule", ar: "جدول حصصي", en: "My Schedule", icon: CalendarDays },
    ],
  },
  {
    ar: "التواصل",
    en: "Communication",
    items: [
      { href: "/teacher/notifications/send", ar: "إرسال إشعار", en: "Send Notice", icon: Send },
      { href: "/teacher/notifications", ar: "إشعاراتي", en: "Notifications", icon: Bell },
      { href: "/teacher/messages", ar: "الرسائل", en: "Messages", icon: MessageSquare },
    ],
  },
  {
    ar: "حسابي",
    en: "My Account",
    items: [
      { href: "/teacher/leaves", ar: "الإجازات", en: "Leaves", icon: Plane },
      { href: "/teacher/salary", ar: "راتبي", en: "My Salary", icon: Wallet },
      { href: "/teacher/profile", ar: "ملفي الشخصي", en: "My Profile", icon: User },
    ],
  },
];

const BOTTOM_ITEMS: NavItem[] = [
  { href: "/teacher", ar: "الرئيسية", en: "Home", icon: Home },
  { href: "/teacher/classes", ar: "صفوفي", en: "Classes", icon: BookOpen },
  { href: "/teacher/attendance", ar: "الحضور", en: "Attendance", icon: ClipboardCheck },
  { href: "/teacher/assignments", ar: "الواجبات", en: "Homework", icon: FileText },
];

const ALL_ITEMS = NAV_GROUPS.flatMap((g) => g.items);

/** Longest matching href wins, so /teacher/notifications/send beats /teacher/notifications. */
function activeHref(currentPath: string): string {
  return ALL_ITEMS.map((i) => i.href)
    .filter((href) =>
      href === "/teacher"
        ? currentPath === "/teacher"
        : currentPath === href || currentPath.startsWith(`${href}/`),
    )
    .sort((a, b) => b.length - a.length)[0] ?? "";
}

function initialsOf(name: string | null | undefined) {
  return (name ?? "")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("");
}

export function TeacherShell({
  children,
  currentPath,
  titleAr,
  titleEn,
  subtitleAr,
  subtitleEn,
  actions,
}: TeacherShellProps) {
  const pathname = usePathname();
  const locale = getLocaleFromPath(pathname);
  const isAr = locale === "ar";
  const t = (ar: string, en: string) => (isAr ? ar : en);
  const { profile } = useRole();
  const branding = useRuntimeBranding();
  const [moreOpen, setMoreOpen] = useState(false);

  const active = activeHref(currentPath);
  const schoolName = branding.branchName || branding.schoolName;
  const logoUrl = branding.branchLogoUrl || branding.logoUrl;
  const teacherName = profile?.full_name || t("الأستاذ", "Teacher");
  const title = isAr ? titleAr : titleEn;
  const subtitle = isAr ? subtitleAr : subtitleEn;
  const moreIsActive = !BOTTOM_ITEMS.some((i) => i.href === active);

  const navLink = (item: NavItem, onClick?: () => void) => {
    const isActive = item.href === active;
    const Icon = item.icon;
    return (
      <Link
        key={item.href}
        href={`/${locale}${item.href}`}
        onClick={onClick}
        aria-current={isActive ? "page" : undefined}
        className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors ${
          isActive
            ? "bg-[var(--primary)] text-white font-semibold shadow-sm"
            : "text-[var(--text-secondary)] hover:bg-[color-mix(in_srgb,var(--primary)_8%,transparent)] hover:text-[var(--primary)]"
        }`}
      >
        <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={isActive ? 2.4 : 1.9} />
        <span className="truncate">{isAr ? item.ar : item.en}</span>
      </Link>
    );
  };

  return (
    <ProtectedRoute roles={["teacher"]}>
      <div className="min-h-screen bg-[var(--surface-soft,var(--background))] md:flex">
        {/* ─── Desktop sidebar: teacher-only navigation ─── */}
        <aside className="hidden md:flex md:w-64 lg:w-72 shrink-0 flex-col border-e border-[var(--card-border)] bg-[var(--card-bg)] sticky top-0 h-screen">
          <div className="p-4 border-b border-[var(--card-border)]">
            <div className="flex items-center gap-3">
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoUrl} alt="" className="h-10 w-10 rounded-xl object-contain bg-white" />
              ) : (
                <div className="h-10 w-10 rounded-xl bg-[var(--primary)] text-white flex items-center justify-center">
                  <GraduationCap className="h-5 w-5" />
                </div>
              )}
              <div className="min-w-0">
                <p className="text-sm font-bold text-[var(--text-primary)] truncate">{schoolName}</p>
                <p className="text-[11px] font-semibold text-[var(--primary)]">
                  {t("تطبيق الأستاذ", "Teacher App")}
                </p>
              </div>
            </div>
            <div className="mt-4 flex items-center gap-3 rounded-2xl bg-[color-mix(in_srgb,var(--primary)_7%,transparent)] p-3">
              <div className="h-9 w-9 shrink-0 rounded-full bg-[var(--primary)] text-white text-sm font-bold flex items-center justify-center">
                {initialsOf(teacherName)}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[var(--text-primary)] truncate">{teacherName}</p>
                <p className="text-[11px] text-[var(--text-muted)]">{t("أستاذ", "Teacher")}</p>
              </div>
            </div>
          </div>
          <nav className="flex-1 overflow-y-auto p-3 space-y-4">
            {NAV_GROUPS.map((group) => (
              <div key={group.en}>
                <p className="px-3 mb-1.5 text-[11px] font-bold text-[var(--text-muted)]">
                  {isAr ? group.ar : group.en}
                </p>
                <div className="space-y-0.5">{group.items.map((item) => navLink(item))}</div>
              </div>
            ))}
          </nav>
        </aside>

        <div className="flex-1 min-w-0 flex flex-col">
          {/* ─── Header ─── */}
          <header className="sticky top-0 z-20 bg-gradient-to-l from-[var(--primary)] to-[color-mix(in_srgb,var(--primary)_75%,#000)] text-white shadow-sm">
            <div className="flex items-center gap-3 px-4 md:px-6 py-3">
              <div className="md:hidden h-9 w-9 shrink-0 rounded-full bg-white/20 text-sm font-bold flex items-center justify-center">
                {initialsOf(teacherName)}
              </div>
              <div className="flex-1 min-w-0">
                <h1 className="text-base md:text-lg font-bold truncate">{title}</h1>
                <p className="text-[11px] md:text-xs text-white/80 truncate">
                  {subtitle ?? `${t("تطبيق الأستاذ", "Teacher App")} · ${schoolName}`}
                </p>
              </div>
              <div className="flex items-center gap-1 rounded-xl bg-[var(--card-bg)] p-1 text-[var(--text-primary)] shadow-sm">
                {profile?.id && (
                  <NotificationBell
                    userId={profile.id}
                    schoolId={profile.school?.id ?? profile.school_id ?? ""}
                    locale={locale}
                  />
                )}
                <ProfileMenu />
              </div>
            </div>
            {actions && (
              <div className="flex flex-wrap items-center gap-2 px-4 md:px-6 pb-3 [&_button]:bg-white [&_button]:text-[var(--primary)] [&_button]:rounded-xl [&_button]:px-3 [&_button]:py-1.5 [&_button]:text-sm [&_button]:font-semibold">
                {actions}
              </div>
            )}
          </header>

          <main className="flex-1 p-4 md:p-6 pb-24 md:pb-8">
            <EnablePushBanner audience="teacher" />
            {children}
          </main>
        </div>
      </div>

      {/* ─── Mobile "more" sheet ─── */}
      {moreOpen && (
        <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm md:hidden" onClick={() => setMoreOpen(false)} />
      )}
      <div
        className={`fixed inset-x-0 bottom-0 z-50 md:hidden transition-transform duration-300 ${
          moreOpen ? "translate-y-0" : "translate-y-full"
        }`}
      >
        <div className="max-h-[75vh] overflow-y-auto rounded-t-3xl border-t border-[var(--card-border)] bg-[var(--card-bg)] shadow-2xl">
          <div className="flex items-center justify-between px-5 pt-4 pb-2">
            <h3 className="text-sm font-bold text-[var(--text-primary)]">{t("كل الأقسام", "All sections")}</h3>
            <button onClick={() => setMoreOpen(false)} className="p-2 -m-2 rounded-full" aria-label={t("إغلاق", "Close")}>
              <X className="h-5 w-5 text-[var(--text-muted)]" />
            </button>
          </div>
          {NAV_GROUPS.map((group) => (
            <div key={group.en} className="px-4 pb-3">
              <p className="px-1 mb-2 text-[11px] font-bold text-[var(--text-muted)]">{isAr ? group.ar : group.en}</p>
              <div className="grid grid-cols-4 gap-2">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = item.href === active;
                  return (
                    <Link
                      key={item.href}
                      href={`/${locale}${item.href}`}
                      onClick={() => setMoreOpen(false)}
                      className={`flex flex-col items-center gap-1.5 rounded-2xl py-3 px-1 text-center active:scale-95 transition ${
                        isActive ? "bg-[color-mix(in_srgb,var(--primary)_12%,transparent)] text-[var(--primary)]" : "text-[var(--text-secondary)]"
                      }`}
                    >
                      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--surface-soft,var(--background))]">
                        <Icon className="h-5 w-5" />
                      </span>
                      <span className="text-[11px] leading-tight font-medium">{isAr ? item.ar : item.en}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
          <div className="h-[env(safe-area-inset-bottom,0px)]" />
        </div>
      </div>

      {/* ─── Mobile bottom tabs ─── */}
      <nav className="fixed inset-x-0 bottom-0 z-30 md:hidden border-t border-[var(--card-border)] bg-[var(--card-bg)]/95 backdrop-blur-lg shadow-[0_-2px_16px_rgba(0,0,0,0.08)]">
        <div className="flex items-stretch justify-around px-1 py-1">
          {BOTTOM_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = item.href === active;
            return (
              <Link
                key={item.href}
                href={`/${locale}${item.href}`}
                className={`flex flex-1 flex-col items-center gap-0.5 py-1.5 rounded-xl ${
                  isActive ? "text-[var(--primary)]" : "text-[var(--text-muted)]"
                }`}
              >
                <span className={`flex h-8 w-12 items-center justify-center rounded-full ${isActive ? "bg-[var(--primary)] text-white" : ""}`}>
                  <Icon className="h-5 w-5" strokeWidth={isActive ? 2.4 : 1.8} />
                </span>
                <span className={`text-[10px] ${isActive ? "font-bold" : "font-medium"}`}>{isAr ? item.ar : item.en}</span>
              </Link>
            );
          })}
          <button
            onClick={() => setMoreOpen((v) => !v)}
            className={`flex flex-1 flex-col items-center gap-0.5 py-1.5 rounded-xl ${
              moreIsActive || moreOpen ? "text-[var(--primary)]" : "text-[var(--text-muted)]"
            }`}
          >
            <span className={`flex h-8 w-12 items-center justify-center rounded-full ${moreIsActive || moreOpen ? "bg-[var(--primary)] text-white" : ""}`}>
              <Menu className="h-5 w-5" />
            </span>
            <span className="text-[10px] font-medium">{t("المزيد", "More")}</span>
          </button>
        </div>
        <div className="h-[max(env(safe-area-inset-bottom,0px),4px)]" />
      </nav>
    </ProtectedRoute>
  );
}
