"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  Home,
  BookOpen,
  Activity,
  MessageCircle,
  Grid2x2,
  BarChart3,
  ClipboardCheck,
  CalendarDays,
  ClipboardList,
  FileCheck2,
  FileBarChart,
  HeartHandshake,
  Calendar,
  User,
  Settings,
  CreditCard,
  Bell,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/brand/brand-utils";
import { getLocaleFromPath } from "@/lib/locale-routing";

interface SubItem {
  labelAr: string;
  labelEn: string;
  icon: LucideIcon;
  href: string;
}

interface NavTab {
  key: string;
  labelAr: string;
  labelEn: string;
  icon: LucideIcon;
  href?: string;
  items?: SubItem[];
}

const ACADEMICS_ITEMS: SubItem[] = [
  { labelAr: "الدرجات", labelEn: "Grades", icon: BarChart3, href: "/student/grades" },
  { labelAr: "الحضور", labelEn: "Attendance", icon: ClipboardCheck, href: "/student/attendance" },
  { labelAr: "الجدول", labelEn: "Schedule", icon: CalendarDays, href: "/student/schedule" },
  { labelAr: "الواجبات", labelEn: "Assignments", icon: ClipboardList, href: "/student/assignments" },
  { labelAr: "الامتحانات", labelEn: "Exams", icon: FileCheck2, href: "/student/exams" },
  { labelAr: "التقرير", labelEn: "Report", icon: FileBarChart, href: "/student/report" },
];

const ACTIVITIES_ITEMS: SubItem[] = [
  { labelAr: "السلوك", labelEn: "Behavior", icon: HeartHandshake, href: "/student/behavior" },
  { labelAr: "التقويم", labelEn: "Calendar", icon: Calendar, href: "/student/calendar" },
];

const MORE_ITEMS: SubItem[] = [
  { labelAr: "الملف الشخصي", labelEn: "Profile", icon: User, href: "/student/profile" },
  { labelAr: "الإعدادات", labelEn: "Settings", icon: Settings, href: "/student/settings" },
  { labelAr: "المدفوعات", labelEn: "Payments", icon: CreditCard, href: "/student/payments" },
  { labelAr: "الإشعارات", labelEn: "Notifications", icon: Bell, href: "/student/notifications" },
];

const NAV_TABS: NavTab[] = [
  { key: "dashboard", labelAr: "الرئيسية", labelEn: "Dashboard", icon: Home, href: "/student" },
  { key: "academics", labelAr: "الدراسة", labelEn: "Academics", icon: BookOpen, items: ACADEMICS_ITEMS },
  { key: "activities", labelAr: "الأنشطة", labelEn: "Activities", icon: Activity, items: ACTIVITIES_ITEMS },
  { key: "messages", labelAr: "الرسائل", labelEn: "Messages", icon: MessageCircle, href: "/student/messages" },
  { key: "more", labelAr: "المزيد", labelEn: "More", icon: Grid2x2, items: MORE_ITEMS },
];

export function StudentBottomNav() {
  const pathname = usePathname();
  const router = useRouter();
  const locale = getLocaleFromPath(pathname);
  const isAr = locale === "ar";
  const [openDrawer, setOpenDrawer] = useState<string | null>(null);

  function isHrefActive(href: string): boolean {
    const localized = `/${locale}${href}`;
    if (href === "/student") {
      return pathname === localized || pathname === `${localized}/`;
    }
    return pathname.startsWith(localized);
  }

  function isTabActive(tab: NavTab): boolean {
    if (tab.href) return isHrefActive(tab.href);
    return (tab.items ?? []).some((item) => isHrefActive(item.href));
  }

  function navigate(href: string) {
    setOpenDrawer(null);
    router.push(`/${locale}${href}`);
  }

  function handleTabClick(tab: NavTab) {
    if (tab.href) {
      navigate(tab.href);
      return;
    }
    setOpenDrawer((current) => (current === tab.key ? null : tab.key));
  }

  const activeDrawerTab = NAV_TABS.find((tab) => tab.key === openDrawer);

  return (
    <>
      {openDrawer && (
        <button
          type="button"
          aria-label={isAr ? "إغلاق" : "Close"}
          onClick={() => setOpenDrawer(null)}
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[1px] md:hidden"
        />
      )}

      {activeDrawerTab?.items && (
        <div
          className={cn(
            "fixed bottom-14 inset-x-0 z-50 md:hidden",
            "rounded-t-2xl border-t border-x border-[var(--card-border)]",
            "bg-[var(--card-bg)] shadow-2xl",
            "pb-[max(env(safe-area-inset-bottom,0px),0.75rem)]",
            "animate-in slide-in-from-bottom-4 duration-200",
          )}
        >
          <div className="flex items-center justify-between px-4 pt-3 pb-2">
            <span className="text-sm font-semibold text-[var(--text-primary)]">
              {isAr ? activeDrawerTab.labelAr : activeDrawerTab.labelEn}
            </span>
            <button
              type="button"
              onClick={() => setOpenDrawer(null)}
              className="text-xs text-[var(--text-muted)]"
              aria-label={isAr ? "إغلاق" : "Close"}
            >
              {isAr ? "إغلاق" : "Close"}
            </button>
          </div>

          <div className="grid grid-cols-3 gap-2 px-4 pb-2">
            {activeDrawerTab.items.map((item) => {
              const active = isHrefActive(item.href);
              const Icon = item.icon;

              return (
                <button
                  key={item.href}
                  onClick={() => navigate(item.href)}
                  className={cn(
                    "flex flex-col items-center justify-center gap-1.5 rounded-xl py-3",
                    "transition-colors duration-150",
                    "active:bg-[var(--surface-strong)]",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]",
                    active
                      ? "bg-[var(--primary)]/10 text-[var(--primary)]"
                      : "text-[var(--text-secondary)]",
                  )}
                  aria-current={active ? "page" : undefined}
                >
                  <Icon className="h-5 w-5" strokeWidth={active ? 2.4 : 1.8} />
                  <span
                    className={cn(
                      "text-[11px] leading-none",
                      active ? "font-semibold" : "font-medium",
                    )}
                  >
                    {isAr ? item.labelAr : item.labelEn}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <nav
        className={cn(
          "fixed bottom-0 inset-x-0 z-50 md:hidden",
          "border-t border-[var(--card-border)]",
          "bg-[var(--card-bg)]/95 backdrop-blur-lg",
          "pb-[env(safe-area-inset-bottom,0px)]",
        )}
      >
        <div className="flex items-stretch justify-around h-14">
          {NAV_TABS.map((tab) => {
            const active = isTabActive(tab);
            const drawerOpen = openDrawer === tab.key;
            const Icon = tab.icon;

            return (
              <button
                key={tab.key}
                onClick={() => handleTabClick(tab)}
                className={cn(
                  "flex-1 flex flex-col items-center justify-center gap-0.5",
                  "transition-colors duration-150",
                  "active:bg-[var(--surface-strong)]",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-inset",
                  active || drawerOpen
                    ? "text-[var(--primary)]"
                    : "text-[var(--text-muted)]",
                )}
                aria-current={active ? "page" : undefined}
                aria-expanded={tab.items ? drawerOpen : undefined}
              >
                <Icon
                  className={cn(
                    "h-5 w-5 transition-transform duration-150",
                    (active || drawerOpen) && "scale-110",
                  )}
                  strokeWidth={active || drawerOpen ? 2.4 : 1.8}
                />
                <span
                  className={cn(
                    "text-[10px] leading-none font-medium",
                    (active || drawerOpen) && "font-semibold",
                  )}
                >
                  {isAr ? tab.labelAr : tab.labelEn}
                </span>
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
}
