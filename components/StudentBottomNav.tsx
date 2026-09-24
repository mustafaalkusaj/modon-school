"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { getLocaleFromPath } from "@/lib/locale-routing";
import {
  Home,
  BookOpen,
  GraduationCap,
  ClipboardList,
  Menu,
  X,
  CalendarDays,
  Star,
  Wallet,
  MessageSquare,
  Bell,
  BarChart3,
  User,
  Settings,
  Clock,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface NavItem {
  id: string;
  labelAr: string;
  labelEn: string;
  href: string;
  icon: LucideIcon;
}

const PRIMARY_ITEMS: NavItem[] = [
  { id: "home", labelAr: "الرئيسية", labelEn: "Home", href: "/student", icon: Home },
  { id: "assignments", labelAr: "واجباتي", labelEn: "Homework", href: "/student/assignments", icon: BookOpen },
  { id: "grades", labelAr: "درجاتي", labelEn: "Grades", href: "/student/grades", icon: GraduationCap },
  { id: "attendance", labelAr: "حضوري", labelEn: "Attend.", href: "/student/attendance", icon: ClipboardList },
];

const MORE_ITEMS: NavItem[] = [
  { id: "exams", labelAr: "امتحاناتي", labelEn: "Exams", href: "/student/exams", icon: CalendarDays },
  { id: "behavior", labelAr: "سلوكي", labelEn: "Behavior", href: "/student/behavior", icon: Star },
  { id: "schedule", labelAr: "جدولي", labelEn: "Schedule", href: "/student/schedule", icon: Clock },
  { id: "payments", labelAr: "الأقساط", labelEn: "Payments", href: "/student/payments", icon: Wallet },
  { id: "messages", labelAr: "رسائلي", labelEn: "Messages", href: "/student/messages", icon: MessageSquare },
  { id: "notifications", labelAr: "إشعاراتي", labelEn: "Notifications", href: "/student/notifications", icon: Bell },
  { id: "report", labelAr: "تقريري", labelEn: "Report", href: "/student/report", icon: BarChart3 },
  { id: "profile", labelAr: "ملفي", labelEn: "Profile", href: "/student/profile", icon: User },
  { id: "settings", labelAr: "إعداداتي", labelEn: "Settings", href: "/student/settings", icon: Settings },
];

function isActive(pathname: string, href: string, locale: string): boolean {
  const full = `/${locale}${href}`;
  if (href === "/student") return pathname === full;
  return pathname.startsWith(full);
}

export function StudentBottomNav() {
  const pathname = usePathname();
  const locale = getLocaleFromPath(pathname);
  const isAr = locale === "ar";
  const [moreOpen, setMoreOpen] = useState(false);

  const moreIsActive = MORE_ITEMS.some((item) => isActive(pathname, item.href, locale));

  return (
    <>
      {moreOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-40 md:hidden backdrop-blur-sm"
          onClick={() => setMoreOpen(false)}
        />
      )}

      <div
        className={`fixed inset-x-0 bottom-0 z-50 md:hidden transition-transform duration-300 ease-out ${
          moreOpen ? "translate-y-0" : "translate-y-full"
        }`}
      >
        <div className="bg-[var(--card-bg)] border-t border-[var(--card-border)] rounded-t-3xl shadow-2xl max-h-[70vh] overflow-y-auto">
          <div className="flex items-center justify-between px-5 pt-4 pb-3">
            <h3 className="text-sm font-bold text-[var(--text-primary)]">
              {isAr ? "المزيد" : "More"}
            </h3>
            <button
              onClick={() => setMoreOpen(false)}
              className="p-2 -m-2 rounded-full hover:bg-[var(--hover-bg)] transition-colors active:scale-90"
            >
              <X className="h-5 w-5 text-[var(--text-muted)]" />
            </button>
          </div>
          <div className="w-12 h-1 rounded-full bg-[var(--border)] mx-auto -mt-1 mb-3" />
          <div className="grid grid-cols-3 gap-2 px-4 pb-4">
            {MORE_ITEMS.map((item) => {
              const active = isActive(pathname, item.href, locale);
              const Icon = item.icon;
              return (
                <Link
                  key={item.id}
                  href={`/${locale}${item.href}`}
                  onClick={() => setMoreOpen(false)}
                  className={`flex flex-col items-center gap-2 py-3.5 px-2 rounded-2xl transition-all duration-150 active:scale-95 ${
                    active
                      ? "bg-[color-mix(in_srgb,var(--primary)_12%,transparent)] text-[var(--primary)] shadow-sm"
                      : "text-[var(--text-secondary)] hover:bg-[var(--hover-bg)]"
                  }`}
                >
                  <div className={`flex items-center justify-center w-11 h-11 rounded-2xl ${
                    active
                      ? "bg-[color-mix(in_srgb,var(--primary)_15%,transparent)]"
                      : "bg-[var(--surface-soft)]"
                  }`}>
                    <Icon className="h-[22px] w-[22px]" strokeWidth={active ? 2.5 : 1.8} />
                  </div>
                  <span className={`text-[11px] leading-tight text-center ${active ? "font-bold" : "font-medium"}`}>
                    {isAr ? item.labelAr : item.labelEn}
                  </span>
                </Link>
              );
            })}
          </div>
          <div className="h-[env(safe-area-inset-bottom,0px)]" />
        </div>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-30 md:hidden">
        <div
          className="border-t border-[var(--card-border)] shadow-[0_-4px_24px_rgba(0,0,0,0.08)]"
          style={{
            background: "color-mix(in srgb, var(--card-bg) 92%, transparent)",
            backdropFilter: "blur(20px) saturate(1.8)",
            WebkitBackdropFilter: "blur(20px) saturate(1.8)",
          }}
        >
          <div className="flex items-center justify-around px-1 pt-2 pb-1">
            {PRIMARY_ITEMS.map((item) => {
              const active = isActive(pathname, item.href, locale);
              const Icon = item.icon;
              return (
                <Link
                  key={item.id}
                  href={`/${locale}${item.href}`}
                  className="relative flex flex-col items-center gap-1 py-1 px-3 min-w-[64px] transition-all duration-200"
                >
                  <div
                    className={`flex items-center justify-center w-10 h-10 rounded-full transition-all duration-300 ${
                      active
                        ? "text-white"
                        : "text-[var(--text-muted)] active:scale-95"
                    }`}
                    style={active ? {
                      background: "linear-gradient(135deg, #7c3aed 0%, #a855f7 100%)",
                    } : undefined}
                  >
                    <Icon className="h-[20px] w-[20px]" strokeWidth={active ? 2.5 : 1.8} />
                  </div>
                  <span className={`text-[10px] leading-tight ${
                    active
                      ? "font-bold text-[var(--primary)]"
                      : "font-medium text-[var(--text-muted)]"
                  }`}>
                    {isAr ? item.labelAr : item.labelEn}
                  </span>
                </Link>
              );
            })}
            <button
              onClick={() => setMoreOpen((v) => !v)}
              className="relative flex flex-col items-center gap-1 py-1 px-3 min-w-[64px] transition-all duration-200"
            >
              <div
                className={`flex items-center justify-center w-10 h-10 rounded-full transition-all duration-300 ${
                  moreIsActive || moreOpen
                    ? "text-white"
                    : "text-[var(--text-muted)] active:scale-95"
                }`}
                style={(moreIsActive || moreOpen) ? {
                  background: "linear-gradient(135deg, #7c3aed 0%, #a855f7 100%)",
                } : undefined}
              >
                <Menu className="h-[20px] w-[20px]" strokeWidth={moreIsActive || moreOpen ? 2.5 : 1.8} />
              </div>
              <span className={`text-[10px] leading-tight ${
                moreIsActive || moreOpen
                  ? "font-bold text-[var(--primary)]"
                  : "font-medium text-[var(--text-muted)]"
              }`}>
                {isAr ? "المزيد" : "More"}
              </span>
            </button>
          </div>
          <div className="h-[env(safe-area-inset-bottom,0px)]" />
        </div>
      </nav>
    </>
  );
}
