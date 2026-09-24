"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Calendar, User, MapPin, Clock, AlertCircle } from "lucide-react";
import { StudentShell } from "@/components/StudentShell";
import { getLocaleFromPath } from "@/lib/locale-routing";
import { fetchJsonWithAuthorizedSession } from "@/lib/authorized-api";
import { EmptyState } from "@/components/ui/empty-state";
import { Card, CardContent } from "@/components/ui/card";

interface ScheduleSlot {
  id: string;
  day_of_week: string;
  start_time: string;
  end_time: string;
  subject_name: string;
  teacher_name: string | null;
  room: string | null;
}

const DAY_LABELS: Record<string, { ar: string; en: string }> = {
  sunday: { ar: "الأحد", en: "Sunday" },
  monday: { ar: "الاثنين", en: "Monday" },
  tuesday: { ar: "الثلاثاء", en: "Tuesday" },
  wednesday: { ar: "الأربعاء", en: "Wednesday" },
  thursday: { ar: "الخميس", en: "Thursday" },
  saturday: { ar: "السبت", en: "Saturday" },
};

const DAY_SHORT: Record<string, { ar: string; en: string }> = {
  sunday: { ar: "أحد", en: "Sun" },
  monday: { ar: "اثن", en: "Mon" },
  tuesday: { ar: "ثلا", en: "Tue" },
  wednesday: { ar: "أرب", en: "Wed" },
  thursday: { ar: "خمي", en: "Thu" },
  saturday: { ar: "سبت", en: "Sat" },
};

const DAY_ORDER = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "saturday",
];

const JS_DAY_MAP: Record<number, string> = {
  0: "sunday",
  1: "monday",
  2: "tuesday",
  3: "wednesday",
  4: "thursday",
  5: "friday",
  6: "saturday",
};

const SUBJECT_COLORS: Record<string, { bg: string; text: string; accent: string }> = {
  "الرياضيات": { bg: "#3B82F620", text: "#2563EB", accent: "#3B82F6" },
  "العلوم": { bg: "#10B98120", text: "#059669", accent: "#10B981" },
  "اللغة العربية": { bg: "#F59E0B20", text: "#D97706", accent: "#F59E0B" },
  "اللغة الانكليزية": { bg: "#8B5CF620", text: "#7C3AED", accent: "#8B5CF6" },
  "اللغة الإنجليزية": { bg: "#8B5CF620", text: "#7C3AED", accent: "#8B5CF6" },
  "التربية الإسلامية": { bg: "#06B6D420", text: "#0891B2", accent: "#06B6D4" },
  "التربية الاسلامية": { bg: "#06B6D420", text: "#0891B2", accent: "#06B6D4" },
  "الاجتماعيات": { bg: "#F9731620", text: "#EA580C", accent: "#F97316" },
  "التربية الفنية": { bg: "#EC489920", text: "#DB2777", accent: "#EC4899" },
  "التربية الرياضية": { bg: "#22C55E20", text: "#16A34A", accent: "#22C55E" },
  "الحاسوب": { bg: "#6366F120", text: "#4F46E5", accent: "#6366F1" },
};

const FALLBACK_COLORS = [
  { bg: "#64748B20", text: "#475569", accent: "#64748B" },
  { bg: "#0EA5E920", text: "#0284C7", accent: "#0EA5E9" },
  { bg: "#A855F720", text: "#9333EA", accent: "#A855F7" },
  { bg: "#EF444420", text: "#DC2626", accent: "#EF4444" },
  { bg: "#14B8A620", text: "#0D9488", accent: "#14B8A6" },
];

function getSubjectColor(name: string) {
  if (SUBJECT_COLORS[name]) return SUBJECT_COLORS[name];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return FALLBACK_COLORS[Math.abs(hash) % FALLBACK_COLORS.length];
}

function isCurrentSlot(slot: ScheduleSlot, todayKey: string): boolean {
  if (slot.day_of_week.toLowerCase() !== todayKey) return false;
  const now = new Date();
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const [sh, sm] = (slot.start_time ?? "").split(":").map(Number);
  const [eh, em] = (slot.end_time ?? "").split(":").map(Number);
  if (isNaN(sh) || isNaN(eh)) return false;
  return nowMins >= sh * 60 + sm && nowMins < eh * 60 + em;
}

function formatTime(t: string) {
  return t?.slice(0, 5) ?? "";
}

export default function StudentSchedulePage() {
  const pathname = usePathname();
  const locale = getLocaleFromPath(pathname);
  const isAr = locale === "ar";
  const t = (ar: string, en: string) => (isAr ? ar : en);
  const [slots, setSlots] = useState<ScheduleSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [activeDay, setActiveDay] = useState<string | null>(null);

  const todayKey = JS_DAY_MAP[new Date().getDay()] ?? "";

  useEffect(() => {
    fetchJsonWithAuthorizedSession("/api/student/schedule")
      .then((res) => {
        if (res.response.ok)
          setSlots((res.payload as any)?.data?.slots ?? []);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  const grouped = DAY_ORDER.reduce<Record<string, ScheduleSlot[]>>(
    (acc, day) => {
      const daySlots = slots.filter(
        (s) => s.day_of_week.toLowerCase() === day,
      );
      if (daySlots.length > 0) {
        acc[day] = daySlots.sort((a, b) =>
          a.start_time.localeCompare(b.start_time),
        );
      }
      return acc;
    },
    {},
  );

  if (error) {
    return (
      <StudentShell
        currentPath="/student/schedule"
        titleAr="جدولي الأسبوعي"
        titleEn="Weekly Schedule"
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

  const availableDays = DAY_ORDER.filter((d) => grouped[d]);
  const selectedDay =
    activeDay && grouped[activeDay]
      ? activeDay
      : grouped[todayKey]
        ? todayKey
        : availableDays[0] ?? null;

  return (
    <StudentShell
      currentPath="/student/schedule"
      titleAr="جدولي الأسبوعي"
      titleEn="Weekly Schedule"
    >
      <div className="space-y-4">
        {/* Day selector tabs */}
        {!loading && availableDays.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
            {availableDays.map((day) => {
              const label = DAY_SHORT[day];
              const isSelected = day === selectedDay;
              const isToday = day === todayKey;
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => setActiveDay(day)}
                  className="flex flex-col items-center gap-1 px-4 py-2.5 rounded-2xl border-2 transition-all duration-200 shrink-0 min-w-[64px]"
                  style={{
                    borderColor: isSelected
                      ? "var(--primary)"
                      : "var(--border)",
                    background: isSelected
                      ? "color-mix(in srgb, var(--primary) 10%, transparent)"
                      : "var(--card-bg)",
                    transform: isSelected ? "scale(1.05)" : "scale(1)",
                  }}
                >
                  <span
                    className="text-xs font-bold"
                    style={{
                      color: isSelected
                        ? "var(--primary)"
                        : "var(--text-muted)",
                    }}
                  >
                    {label ? (isAr ? label.ar : label.en) : day.slice(0, 3)}
                  </span>
                  {isToday && (
                    <div
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ background: "var(--primary)" }}
                    />
                  )}
                  <span
                    className="text-[10px]"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {grouped[day]?.length ?? 0} {t("حصص", "cls")}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="h-[80px] rounded-2xl bg-[var(--card-bg)] border border-[var(--border)] animate-pulse"
              />
            ))}
          </div>
        ) : availableDays.length === 0 ? (
          <EmptyState
            icon={
              <Calendar className="h-12 w-12 text-[var(--text-tertiary)]" />
            }
            title={t("لا يوجد جدول حالياً", "No schedule available")}
          />
        ) : selectedDay && grouped[selectedDay] ? (
          <div className="space-y-2">
            {/* Day header */}
            <div className="flex items-center gap-3 px-1 mb-3">
              <div
                className="flex items-center justify-center w-10 h-10 rounded-xl"
                style={{
                  background:
                    selectedDay === todayKey
                      ? "linear-gradient(135deg, var(--primary), color-mix(in srgb, var(--primary) 70%, var(--info)))"
                      : "color-mix(in srgb, var(--primary) 12%, transparent)",
                }}
              >
                <Calendar
                  className="h-5 w-5"
                  style={{
                    color:
                      selectedDay === todayKey ? "white" : "var(--primary)",
                  }}
                />
              </div>
              <div>
                <h2 className="text-lg font-bold text-[var(--text-primary)]">
                  {DAY_LABELS[selectedDay]
                    ? isAr
                      ? DAY_LABELS[selectedDay].ar
                      : DAY_LABELS[selectedDay].en
                    : selectedDay}
                  {selectedDay === todayKey && (
                    <span
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ms-2 align-middle"
                      style={{
                        background:
                          "color-mix(in srgb, var(--primary) 15%, transparent)",
                        color: "var(--primary)",
                      }}
                    >
                      {t("اليوم", "Today")}
                    </span>
                  )}
                </h2>
                <p className="text-xs text-[var(--text-muted)]">
                  {grouped[selectedDay].length} {t("حصص دراسية", "classes")}
                </p>
              </div>
            </div>

            {/* Timeline */}
            <div className="relative">
              {grouped[selectedDay].map((slot, idx) => {
                const colors = getSubjectColor(slot.subject_name);
                const isCurrent = isCurrentSlot(slot, todayKey);
                const isLast = idx === grouped[selectedDay].length - 1;

                return (
                  <div key={slot.id} className="relative flex gap-3">
                    {/* Timeline dot + line */}
                    <div className="flex flex-col items-center shrink-0 w-12">
                      <div
                        className="w-3 h-3 rounded-full border-2 z-10 shrink-0"
                        style={{
                          borderColor: isCurrent
                            ? colors.accent
                            : "var(--border)",
                          background: isCurrent
                            ? colors.accent
                            : "var(--card-bg)",
                          boxShadow: isCurrent
                            ? `0 0 0 4px ${colors.bg}`
                            : "none",
                        }}
                      />
                      {!isLast && (
                        <div
                          className="w-0.5 flex-1 min-h-[20px]"
                          style={{ background: "var(--border)" }}
                        />
                      )}
                    </div>

                    {/* Slot card */}
                    <div
                      className="flex-1 mb-3 rounded-2xl border overflow-hidden transition-all duration-200"
                      style={{
                        borderColor: isCurrent
                          ? colors.accent + "40"
                          : "var(--border)",
                        background: isCurrent ? colors.bg : "var(--card-bg)",
                        boxShadow: isCurrent
                          ? `0 4px 12px ${colors.accent}15`
                          : "none",
                      }}
                    >
                      <div
                        className="h-1 w-full"
                        style={{ background: colors.accent }}
                      />

                      <div className="p-3 sm:p-4">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <div
                                className="flex items-center justify-center w-7 h-7 rounded-lg shrink-0"
                                style={{ background: colors.bg }}
                              >
                                <span
                                  className="text-xs font-bold"
                                  style={{ color: colors.text }}
                                >
                                  {idx + 1}
                                </span>
                              </div>
                              <h3
                                className="text-sm font-bold truncate"
                                style={{
                                  color: isCurrent
                                    ? colors.text
                                    : "var(--text-primary)",
                                }}
                              >
                                {slot.subject_name}
                              </h3>
                              {isCurrent && (
                                <span
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 animate-pulse"
                                  style={{
                                    background: colors.accent + "20",
                                    color: colors.text,
                                  }}
                                >
                                  <span
                                    className="w-1.5 h-1.5 rounded-full"
                                    style={{ background: colors.accent }}
                                  />
                                  {t("الآن", "Now")}
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-3 mt-2 flex-wrap">
                              <div className="flex items-center gap-1">
                                <Clock className="h-3 w-3 text-[var(--text-muted)]" />
                                <span className="text-xs font-mono text-[var(--text-muted)]">
                                  {formatTime(slot.start_time)} —{" "}
                                  {formatTime(slot.end_time)}
                                </span>
                              </div>

                              {slot.teacher_name && (
                                <div className="flex items-center gap-1">
                                  <User className="h-3 w-3 text-[var(--text-muted)]" />
                                  <span className="text-xs text-[var(--text-muted)] truncate max-w-[120px]">
                                    {slot.teacher_name}
                                  </span>
                                </div>
                              )}

                              {slot.room && (
                                <div className="flex items-center gap-1">
                                  <MapPin className="h-3 w-3 text-[var(--text-muted)]" />
                                  <span
                                    className="text-xs font-medium px-1.5 py-0.5 rounded-md"
                                    style={{
                                      background:
                                        "color-mix(in srgb, var(--text-muted) 10%, transparent)",
                                      color: "var(--text-muted)",
                                    }}
                                  >
                                    {slot.room}
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>
    </StudentShell>
  );
}
