"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import {
  Wallet,
  CreditCard,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Percent,
  AlertCircle,
} from "lucide-react";
import { StudentShell } from "@/components/StudentShell";
import { getLocaleFromPath } from "@/lib/locale-routing";
import { fetchJsonWithAuthorizedSession } from "@/lib/authorized-api";
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

interface PaymentRecord {
  id: string;
  amount: number;
  paid_date: string | null;
  status: "paid" | "pending" | "overdue";
  description: string | null;
}

interface PaymentSummary {
  total: number;
  discount: number;
  net: number;
  paid: number;
  remaining: number;
}

const STATUS_CFG: Record<
  string,
  {
    ar: string;
    en: string;
    variant: "success" | "warning" | "danger";
    icon: typeof CheckCircle2;
  }
> = {
  paid: {
    ar: "مدفوع",
    en: "Paid",
    variant: "success",
    icon: CheckCircle2,
  },
  pending: {
    ar: "معلّق",
    en: "Pending",
    variant: "warning",
    icon: Clock,
  },
  overdue: {
    ar: "متأخر",
    en: "Overdue",
    variant: "danger",
    icon: AlertTriangle,
  },
};

export default function StudentPaymentsPage() {
  const pathname = usePathname();
  const locale = getLocaleFromPath(pathname);
  const isAr = locale === "ar";
  const t = (ar: string, en: string) => (isAr ? ar : en);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [summary, setSummary] = useState<PaymentSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetchJsonWithAuthorizedSession("/api/student/payments")
      .then((res) => {
        if (res.response.ok) {
          const d = (res.payload as any)?.data;
          setPayments(d?.payments ?? []);
          setSummary(d?.summary ?? null);
        }
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  const fmt = (n: number) => `${n.toLocaleString()} IQD`;
  const paidPercent =
    summary && summary.net > 0
      ? Math.round((summary.paid / summary.net) * 100)
      : 0;

  if (error) {
    return (
      <StudentShell
        currentPath="/student/payments"
        titleAr="الأقساط"
        titleEn="Payments"
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
      currentPath="/student/payments"
      titleAr="الأقساط"
      titleEn="Payments"
    >
      <div className="space-y-6">
        {loading ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={i}
                  className="h-[100px] rounded-[var(--card-radius)] bg-[var(--card-bg)] border border-[var(--card-border)] animate-pulse"
                />
              ))}
            </div>
            <div className="h-[200px] rounded-[var(--card-radius)] bg-[var(--card-bg)] border border-[var(--card-border)] animate-pulse" />
          </div>
        ) : (
          <>
            {summary && (
              <>
                <KPIGrid>
                  <StatsCard
                    label={t("الإجمالي", "Total Fee")}
                    value={fmt(summary.total)}
                    icon={CreditCard}
                    variant="primary"
                  />
                  {summary.discount > 0 && (
                    <StatsCard
                      label={t("التخفيض", "Discount")}
                      value={fmt(summary.discount)}
                      icon={Percent}
                      variant="warning"
                    />
                  )}
                  <StatsCard
                    label={t("المدفوع", "Paid")}
                    value={fmt(summary.paid)}
                    icon={CheckCircle2}
                    variant="success"
                  />
                  <StatsCard
                    label={t("المتبقي", "Remaining")}
                    value={fmt(summary.remaining)}
                    icon={Wallet}
                    variant={summary.remaining > 0 ? "danger" : "success"}
                  />
                </KPIGrid>

                {summary.net > 0 && (
                  <div
                    className="relative overflow-hidden rounded-2xl p-4 sm:p-5"
                    style={{
                      background: paidPercent >= 100
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
                          {paidPercent}%
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-white/20 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-white/80 transition-all duration-700"
                          style={{ width: `${paidPercent}%` }}
                        />
                      </div>
                      <div className="flex justify-between mt-2 text-xs text-white/70">
                        <span>
                          {t("المدفوع:", "Paid:")} {fmt(summary.paid)}
                        </span>
                        <span>
                          {t("المتبقي:", "Remaining:")}{" "}
                          {fmt(summary.remaining)}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}

            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Wallet className="h-5 w-5 text-[var(--primary)]" />
                  <CardTitle className="text-base">
                    {t("سجل الدفعات", "Payment Records")}
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                {payments.length === 0 ? (
                  <EmptyState
                    icon={
                      <CreditCard className="h-10 w-10 text-[var(--text-tertiary)]" />
                    }
                    title={t("لا توجد دفعات", "No payments recorded")}
                    className="py-6 min-h-0"
                  />
                ) : (
                  <div className="space-y-2">
                    {payments.map((p) => {
                      const st = STATUS_CFG[p.status] ?? STATUS_CFG.pending;
                      const Icon = st.icon;
                      return (
                        <div
                          key={p.id}
                          className="flex items-center gap-3 rounded-lg border border-[var(--card-border)] p-3 hover:bg-[var(--card-bg)] transition-colors"
                        >
                          <div
                            className="shrink-0 flex items-center justify-center w-9 h-9 rounded-full"
                            style={{
                              backgroundColor: `color-mix(in srgb, var(--${st.variant}) 12%, transparent)`,
                            }}
                          >
                            <Icon
                              className="h-4 w-4"
                              style={{ color: `var(--${st.variant})` }}
                            />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                              {p.description ?? t("دفعة", "Payment")}
                            </p>
                            <p className="text-xs text-[var(--text-muted)]">
                              {p.paid_date ?? "—"}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-sm font-semibold text-[var(--text-primary)]">
                              {fmt(p.amount)}
                            </span>
                            <Badge variant={st.variant} size="sm">
                              {isAr ? st.ar : st.en}
                            </Badge>
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
