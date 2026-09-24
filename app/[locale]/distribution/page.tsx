"use client";

import { usePathname } from "next/navigation";
import { AppSidebar } from "@/components/AppSidebar";
import { AppShellTopbar } from "@/components/AppShellTopbar";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import {
  SchoolScopeBanner,
  SchoolScopeEmptyState,
} from "@/components/SchoolScopeBanner";
import { useSchoolScope } from "@/hooks/useSchoolScope";
import { useRole } from "@/hooks/useRole";
import { getLocaleFromPath } from "@/lib/locale-routing";
import { ClipboardList } from "@/lib/icons";

type Locale = "ar" | "en";

const T: Record<string, Record<Locale, string>> = {
  pageTitle: { ar: "تسليم الزي والكتب", en: "Uniform & Books Distribution" },
  pageSubtitle: {
    ar: "إدارة تسليم الزي المدرسي والكتب المنهجية للطلاب",
    en: "Manage uniform and textbook distribution to students",
  },
  comingSoon: { ar: "قريباً", en: "Coming Soon" },
  comingSoonDesc: {
    ar: "نعمل على تجهيز نظام تسليم الزي والكتب المنهجية. سيتيح لك تتبع تسليم كل قطعة زي وكتاب لكل طالب.",
    en: "We are preparing the uniform and textbook distribution system. It will allow you to track delivery of every uniform item and book to each student.",
  },
  selectSchool: {
    ar: "اختر مدرسة لعرض بيانات التسليم",
    en: "Select a school to view distribution data",
  },
};

export default function DistributionPage() {
  const { profile } = useRole();
  const pathname = usePathname();
  const locale = (getLocaleFromPath(pathname) || "ar") as Locale;
  const schoolScope = useSchoolScope(profile);

  const t = (key: string) => T[key]?.[locale] ?? key;

  return (
    <ProtectedRoute roles={["super_admin", "admin", "employee"]}>
      <div className="flex min-h-screen bg-[var(--surface-soft)]">
        <AppSidebar currentPath="/distribution" />
        <div className="flex-1 flex flex-col min-w-0">
          <AppShellTopbar
            title={t("pageTitle")}
            subtitle={t("pageSubtitle")}
            scope={schoolScope}
            fixed
          />
          <main className="app-shell-frame--with-fixed-topbar flex-1 overflow-y-auto custom-scrollbar">
            <div className="p-4 sm:p-6 space-y-5">
              <SchoolScopeBanner scope={schoolScope} showSelector={false} />

              {schoolScope.shouldBlockContent ? (
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--card-bg)] p-8">
                  <SchoolScopeEmptyState
                    scope={schoolScope}
                    title={t("pageTitle")}
                    description={t("selectSchool")}
                  />
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                  <div
                    className="w-20 h-20 rounded-3xl flex items-center justify-center mb-6"
                    style={{
                      background:
                        "linear-gradient(135deg, var(--primary), color-mix(in srgb, var(--primary) 70%, #000))",
                    }}
                  >
                    <ClipboardList size={36} className="text-white" />
                  </div>
                  <h2 className="text-2xl font-black text-[var(--text-primary)] mb-2">
                    {t("comingSoon")}
                  </h2>
                  <p className="text-sm text-[var(--text-secondary)] max-w-md leading-relaxed">
                    {t("comingSoonDesc")}
                  </p>
                </div>
              )}
            </div>
          </main>
        </div>
      </div>
    </ProtectedRoute>
  );
}
