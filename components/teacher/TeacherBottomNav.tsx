"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  Home,
  Users,
  PenSquare,
  Send,
  Grid2x2,
  BookOpen,
  ClipboardCheck,
  BarChart3,
  CalendarDays,
  FileCheck2,
  MessageCircle,
  Bell,
  Wallet,
  User,
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

const CLASS_ITEMS: SubItem[] = [
  { labelAr: "صفوفي", labelEn: "Classes", icon: BookOpen, href: "/teacher/classes" },
  { labelAr: "طلابي", labelEn: "Students", icon: Users, href: "/teacher/students" },
  { labelAr: "الحضور", labelEn: "Attendance", icon: ClipboardCheck, href: "/teacher/attendance" },
  { labelAr: "الدرجات", labelEn: "Grades", icon: BarChart3, href: "/teacher/grades" },
  { labelAr: "جدولي", labelEn: "Schedule", icon: CalendarDays, href: "/teacher/schedule" },
  { labelAr: "الامتحانات", labelEn: "Exams", icon: FileCheck2, href: "/teacher/exams" },
];

const MORE_ITEMS: SubItem[] = [
  { labelAr: "الرسائل", labelEn: "Messages", icon: MessageCircle, href: "/teacher/messages" },
  { labelAr: "الإشعارات", labelEn: "Notifications", icon: Bell, href: "/teacher/notifications" },
  { labelAr: "راتبي", labelEn: "Salary", icon: Wallet, href: "/teacher/salary" },
  { labelAr: "ملفي", labelEn: "Profile", icon: User, href: "/teacher/profile" },
];

const NAV_TABS: NavTab[] = [
  { key: "home", labelAr: "الرئيسية", labelEn: "Home", icon: Home, href: "/teacher" },
  { key: "classes", labelAr: "صفوفي", labelEn: "Classes", icon: Users, items: CLASS_ITEMS },
  { key: "homework", labelAr: "الواجبات", labelEn: "Homework", icon: PenSquare, href: "/teacher/assignments" },
  { key: "send", labelAr: "إرسال إشعار", labelEn: "Notify", icon: Send, href: "/teacher/notifications?compose=1" },
  { key: "more", labelAr: "المزيد", labelEn: "More", icon: Grid2x2, items: MORE_ITEMS },
];

export function TeacherBottomNav() {
  const pathname = usePathname();
  const router = useRouter();
  const locale = getLocaleFromPath(pathname);
  const isAr = locale === "ar";
  const [openDrawer, setOpenDrawer] = useState<string | null>(null);

  function isHrefActive(href: string): boolean {
    const localized = `/${locale}${href.split("?")[0]}`;
    if (href === "/teacher") {
      return pathname === localized || pathname === `${localized}/`;
    }
    return pathname.startsWith(localized);
  }

  function isTabActive(tab: NavTab): boolean {
    if (tab.key === "send") return false;
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
            "fixed bottom-16 inset-x-0 z-50 md:hidden",
            "rounded-t-3xl border-t border-x border-[var(--card-border)]",
            "bg-[var(--card-bg)] shadow-2xl",
            "pb-[max(env(safe-area-inset-bottom,0px),0.75rem)]",
            "animate-in slide-in-from-bottom-4 duration-200",
          )}
        >
          <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-[var(--card-border)]" />
          <p className="px-5 pt-3 pb-2 text-sm font-bold text-[var(--text-primary)]">
            {isAr ? activeDrawerTab.labelAr : activeDrawerTab.labelEn}
          </p>
          <div className="grid grid-cols-3 gap-2 px-4 pb-2">
            {activeDrawerTab.items.map((item) => {
              const active = isHrefActive(item.href);
              const Icon = item.icon;
              return (
                <button
                  key={item.href}
                  onClick={() => navigate(item.href)}
                  className={cn(
                    "flex flex-col items-center justify-center gap-2 rounded-2xl py-3.5",
                    "transition-colors active:bg-[var(--surface-strong)]",
                    active
                      ? "bg-[var(--primary)]/10 text-[var(--primary)]"
                      : "bg-[var(--surface-soft)] text-[var(--text-secondary)]",
                  )}
                  aria-current={active ? "page" : undefined}
                >
                  <Icon className="h-5 w-5" strokeWidth={active ? 2.4 : 1.8} />
                  <span className="text-[11px] font-semibold leading-none">
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
        <div className="flex items-stretch justify-around h-16">
          {NAV_TABS.map((tab) => {
            const active = isTabActive(tab);
            const drawerOpen = openDrawer === tab.key;
            const Icon = tab.icon;
            const isSend = tab.key === "send";

            return (
              <button
                key={tab.key}
                onClick={() => handleTabClick(tab)}
                className={cn(
                  "flex-1 flex flex-col items-center justify-center gap-1",
                  "transition-colors",
                  active || drawerOpen
                    ? "text-[var(--primary)]"
                    : "text-[var(--text-muted)]",
                )}
                aria-current={active ? "page" : undefined}
                aria-expanded={tab.items ? drawerOpen : undefined}
              >
                {isSend ? (
                  <span className="-mt-6 flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--primary)] text-white shadow-lg shadow-[var(--primary)]/30">
                    <Icon className="h-5 w-5" strokeWidth={2.2} />
                  </span>
                ) : (
                  <Icon
                    className={cn("h-5 w-5", (active || drawerOpen) && "scale-110")}
                    strokeWidth={active || drawerOpen ? 2.4 : 1.8}
                  />
                )}
                <span
                  className={cn(
                    "text-[10px] leading-none font-medium",
                    (active || drawerOpen || isSend) && "font-semibold",
                    isSend && "text-[var(--primary)]",
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
