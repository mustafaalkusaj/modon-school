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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useDistributionData } from "./_hooks/useDistributionData";
import DeliveryTab from "./_components/DeliveryTab";
import GapsTab from "./_components/GapsTab";
import StockTab from "./_components/StockTab";
import ReportsTab from "./_components/ReportsTab";
import SettingsTab from "./_components/SettingsTab";
import { useEffect } from "react";

type Locale = "ar" | "en";

const T: Record<string, Record<Locale, string>> = {
  pageTitle: { ar: "تسليم الزي والكتب", en: "Uniform & Books Distribution" },
  pageSubtitle: {
    ar: "إدارة تسليم الزي المدرسي والكتب المنهجية للطلاب",
    en: "Manage uniform and textbook distribution to students",
  },
  selectSchool: {
    ar: "اختر مدرسة لعرض بيانات التسليم",
    en: "Select a school to view distribution data",
  },
  tabDelivery: { ar: "التسليم", en: "Delivery" },
  tabGaps: { ar: "النواقص", en: "Gaps" },
  tabStock: { ar: "المخزن", en: "Stock" },
  tabReports: { ar: "التقارير", en: "Reports" },
  tabSettings: { ar: "الضبط", en: "Settings" },
  loading: { ar: "جارٍ التحميل...", en: "Loading..." },
};

export default function DistributionPage() {
  const { profile } = useRole();
  const pathname = usePathname();
  const locale = (getLocaleFromPath(pathname) || "ar") as Locale;
  const schoolScope = useSchoolScope(profile);
  const schoolId = schoolScope.selectedSchoolId ?? null;

  const {
    loading,
    items,
    records,
    students,
    stock,
    settings,
    seedDefaults,
    toggleDelivery,
    bulkDeliver,
    updateRecord,
    updateStock,
    saveItem,
    deleteItem,
    saveSettings,
  } = useDistributionData(schoolId);

  useEffect(() => {
    if (schoolId && !loading && items.length === 0) {
      void seedDefaults(schoolId);
    }
  }, [schoolId, loading, items.length, seedDefaults]);

  const t = (key: string) => T[key]?.[locale] ?? key;

  const schoolName =
    schoolScope.selectedSchool?.name ?? "مدارس مدن الأهلية";

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
              ) : loading ? (
                <div className="flex items-center justify-center py-20">
                  <div className="text-[var(--text-secondary)] text-sm">
                    {t("loading")}
                  </div>
                </div>
              ) : (
                <Tabs defaultValue="delivery">
                  <TabsList>
                    <TabsTrigger value="delivery">
                      {t("tabDelivery")}
                    </TabsTrigger>
                    <TabsTrigger value="gaps">{t("tabGaps")}</TabsTrigger>
                    <TabsTrigger value="stock">{t("tabStock")}</TabsTrigger>
                    <TabsTrigger value="reports">
                      {t("tabReports")}
                    </TabsTrigger>
                    <TabsTrigger value="settings">
                      {t("tabSettings")}
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="delivery">
                    <DeliveryTab
                      students={students}
                      items={items}
                      records={records}
                      settings={settings}
                      onToggleDelivery={toggleDelivery}
                      onBulkDeliver={bulkDeliver}
                      onUpdateRecord={updateRecord}
                    />
                  </TabsContent>

                  <TabsContent value="gaps">
                    <GapsTab
                      students={students}
                      items={items}
                      records={records}
                    />
                  </TabsContent>

                  <TabsContent value="stock">
                    <StockTab
                      items={items}
                      stock={stock}
                      records={records}
                      students={students}
                      settings={settings}
                      onUpdateStock={updateStock}
                    />
                  </TabsContent>

                  <TabsContent value="reports">
                    <ReportsTab
                      students={students}
                      items={items}
                      records={records}
                      settings={settings}
                      schoolName={schoolName}
                    />
                  </TabsContent>

                  <TabsContent value="settings">
                    <SettingsTab
                      items={items}
                      settings={settings}
                      schoolId={schoolId!}
                      onSaveItem={saveItem}
                      onDeleteItem={deleteItem}
                      onSaveSettings={saveSettings}
                      onSeedDefaults={seedDefaults}
                    />
                  </TabsContent>
                </Tabs>
              )}
            </div>
          </main>
        </div>
      </div>
    </ProtectedRoute>
  );
}
