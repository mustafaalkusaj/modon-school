"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import {
  CalendarOff,
  Clock,
  CheckCircle2,
  XCircle,
  Plus,
  Loader2,
} from "lucide-react";
import { TeacherShell } from "@/components/TeacherShell";
import { getLocaleFromPath } from "@/lib/locale-routing";
import { fetchJsonWithAuthorizedSession } from "@/lib/authorized-api";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";

interface LeaveRecord {
  id: string;
  leave_type: string;
  reason: string | null;
  start_date: string;
  end_date: string;
  days_count: number;
  status: "pending" | "approved" | "rejected";
  created_at: string;
}

const STATUS_MAP: Record<
  LeaveRecord["status"],
  { ar: string; en: string; variant: "success" | "warning" | "danger" }
> = {
  pending: { ar: "قيد الانتظار", en: "Pending", variant: "warning" },
  approved: { ar: "موافق عليها", en: "Approved", variant: "success" },
  rejected: { ar: "مرفوضة", en: "Rejected", variant: "danger" },
};

const LEAVE_TYPES: Record<string, { ar: string; en: string }> = {
  sick: { ar: "مرضية", en: "Sick" },
  annual: { ar: "سنوية", en: "Annual" },
  personal: { ar: "شخصية", en: "Personal" },
  emergency: { ar: "طارئة", en: "Emergency" },
};

function statusIcon(status: LeaveRecord["status"]) {
  switch (status) {
    case "approved":
      return <CheckCircle2 className="h-4 w-4 text-[var(--success)]" />;
    case "rejected":
      return <XCircle className="h-4 w-4 text-[var(--danger)]" />;
    default:
      return <Clock className="h-4 w-4 text-[var(--warning)]" />;
  }
}

export default function TeacherLeavesPage() {
  const pathname = usePathname();
  const locale = getLocaleFromPath(pathname);
  const isAr = locale === "ar";
  const t = (ar: string, en: string) => (isAr ? ar : en);

  const [leaves, setLeaves] = useState<LeaveRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [leaveType, setLeaveType] = useState("sick");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");

  function fetchLeaves() {
    setLoading(true);
    fetchJsonWithAuthorizedSession("/api/teacher/leaves")
      .then((res) => {
        if (res.response.ok) {
          setLeaves((res.payload as any)?.data?.leaves ?? []);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    fetchLeaves();
  }, []);

  function computeDays(start: string, end: string): number {
    if (!start || !end) return 0;
    const diff = new Date(end).getTime() - new Date(start).getTime();
    return Math.max(1, Math.ceil(diff / (1000 * 60 * 60 * 24)) + 1);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!startDate || !endDate) return;

    setSubmitting(true);
    try {
      const daysCount = computeDays(startDate, endDate);
      await fetchJsonWithAuthorizedSession("/api/teacher/leaves", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leave_type: leaveType,
          reason: reason || null,
          start_date: startDate,
          end_date: endDate,
          days_count: daysCount,
        }),
      });
      setShowForm(false);
      setLeaveType("sick");
      setStartDate("");
      setEndDate("");
      setReason("");
      fetchLeaves();
    } catch {
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <TeacherShell
      currentPath="/teacher/leaves"
      titleAr="الإجازات"
      titleEn="Leaves"
    >
      <div className="space-y-4 max-w-3xl mx-auto">
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setShowForm((prev) => !prev)}
            className="flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-2 text-sm font-medium text-white transition-colors hover:opacity-90"
          >
            <Plus className="h-4 w-4" />
            {t("طلب إجازة", "Request Leave")}
          </button>
        </div>

        {showForm && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm sm:text-base">
                {t("طلب إجازة جديدة", "New Leave Request")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-3">
                <div>
                  <label className="block text-xs text-[var(--text-muted)] mb-1">
                    {t("نوع الإجازة", "Leave Type")}
                  </label>
                  <select
                    value={leaveType}
                    onChange={(e) => setLeaveType(e.target.value)}
                    className="w-full rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:ring-2 focus:ring-[var(--primary)]/30"
                  >
                    {Object.entries(LEAVE_TYPES).map(([key, val]) => (
                      <option key={key} value={key}>
                        {isAr ? val.ar : val.en}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-[var(--text-muted)] mb-1">
                      {t("من", "From")}
                    </label>
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      required
                      className="w-full rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:ring-2 focus:ring-[var(--primary)]/30"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--text-muted)] mb-1">
                      {t("إلى", "To")}
                    </label>
                    <input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      required
                      className="w-full rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:ring-2 focus:ring-[var(--primary)]/30"
                    />
                  </div>
                </div>

                {startDate && endDate && (
                  <p className="text-xs text-[var(--text-muted)]">
                    {t("عدد الأيام:", "Days:")}{" "}
                    <span className="font-bold text-[var(--text-primary)]">
                      {computeDays(startDate, endDate)}
                    </span>
                  </p>
                )}

                <div>
                  <label className="block text-xs text-[var(--text-muted)] mb-1">
                    {t("السبب", "Reason")}
                  </label>
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={3}
                    className="w-full rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:ring-2 focus:ring-[var(--primary)]/30 resize-none"
                  />
                </div>

                <button
                  type="submit"
                  disabled={submitting || !startDate || !endDate}
                  className="w-full flex items-center justify-center gap-2 rounded-lg bg-[var(--primary)] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:opacity-90 disabled:opacity-50"
                >
                  {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                  {t("إرسال الطلب", "Submit Request")}
                </button>
              </form>
            </CardContent>
          </Card>
        )}

        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-[120px] rounded-[var(--card-radius)] bg-[var(--card-bg)] border border-[var(--card-border)] animate-pulse"
              />
            ))}
          </div>
        ) : leaves.length === 0 ? (
          <EmptyState
            icon={<CalendarOff className="h-12 w-12 text-[var(--text-tertiary)]" />}
            title={t("لا توجد إجازات", "No leave records")}
          />
        ) : (
          <div className="space-y-3">
            {leaves.map((rec) => {
              const st = STATUS_MAP[rec.status] ?? STATUS_MAP.pending;
              const lt = LEAVE_TYPES[rec.leave_type];
              return (
                <Card key={rec.id}>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {statusIcon(rec.status)}
                        <CardTitle className="text-sm sm:text-base">
                          {lt
                            ? isAr
                              ? lt.ar
                              : lt.en
                            : rec.leave_type}
                        </CardTitle>
                      </div>
                      <Badge variant={st.variant} size="sm">
                        {isAr ? st.ar : st.en}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs sm:text-sm">
                        <span className="text-[var(--text-muted)]">
                          {t("المدة", "Duration")}
                        </span>
                        <span className="font-medium text-[var(--text-primary)]" dir="ltr">
                          {rec.start_date} → {rec.end_date}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-xs sm:text-sm">
                        <span className="text-[var(--text-muted)]">
                          {t("عدد الأيام", "Days")}
                        </span>
                        <span className="font-bold text-[var(--text-primary)]">
                          {rec.days_count}
                        </span>
                      </div>
                      {rec.reason && (
                        <div className="pt-1 border-t border-[var(--card-border)]">
                          <p className="text-xs text-[var(--text-muted)]">
                            {t("السبب:", "Reason:")}
                          </p>
                          <p className="text-xs sm:text-sm text-[var(--text-primary)] mt-0.5">
                            {rec.reason}
                          </p>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </TeacherShell>
  );
}
