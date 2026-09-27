"use client";

import { useEffect, useState, useCallback } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Bell, CheckCheck, Send, Loader2, X } from "lucide-react";
import { TeacherShell } from "@/components/TeacherShell";
import { getLocaleFromPath } from "@/lib/locale-routing";
import { fetchJsonWithAuthorizedSession } from "@/lib/authorized-api";
import { EmptyState } from "@/components/ui/empty-state";

interface ClassOption {
  class_name: string;
  sections: string[];
  student_count: number;
}

interface StudentOption {
  id: string;
  full_name: string;
  section: string | null;
  has_app_account: boolean;
}

type Target = "class" | "section" | "student";

const fieldClass =
  "w-full rounded-xl border border-[var(--card-border)] bg-[var(--surface-soft)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 transition-all";

function ComposeNotification({ isAr, onClose }: { isAr: boolean; onClose: () => void }) {
  const t = (ar: string, en: string) => (isAr ? ar : en);
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [target, setTarget] = useState<Target>("class");
  const [className, setClassName] = useState("");
  const [section, setSection] = useState("");
  const [studentId, setStudentId] = useState("");
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    fetchJsonWithAuthorizedSession("/api/teacher/classes")
      .then((res) => {
        const list = ((res.payload as { data?: { classes?: ClassOption[] } })?.data?.classes ?? []);
        setClasses(list);
        if (list[0]) setClassName(list[0].class_name);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!className) return;
    setSection("");
    setStudentId("");
    fetchJsonWithAuthorizedSession(`/api/teacher/students?class_name=${encodeURIComponent(className)}`)
      .then((res) => {
        setStudents(((res.payload as { data?: { students?: StudentOption[] } })?.data?.students ?? []));
      })
      .catch(() => setStudents([]));
  }, [className]);

  const selectedClass = classes.find((c) => c.class_name === className);
  const sections = selectedClass?.sections.length
    ? selectedClass.sections
    : Array.from(new Set(students.map((s) => s.section).filter((v): v is string => Boolean(v))));

  const recipients =
    target === "student"
      ? students.filter((s) => s.id === studentId)
      : target === "section"
        ? students.filter((s) => section && s.section === section)
        : students;
  const reachable = recipients.filter((s) => s.has_app_account).length;

  async function send() {
    setResult(null);
    if (!title.trim() || !message.trim()) {
      setResult({ ok: false, text: t("اكتب عنوان الإشعار ونصه.", "Enter a title and message.") });
      return;
    }
    if (target === "section" && !section) {
      setResult({ ok: false, text: t("اختر الشعبة.", "Choose a section.") });
      return;
    }
    if (target === "student" && !studentId) {
      setResult({ ok: false, text: t("اختر الطالب.", "Choose a student.") });
      return;
    }
    setSending(true);
    try {
      const res = await fetchJsonWithAuthorizedSession<{ ok?: boolean; message?: string }>(
        "/api/teacher/notifications",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: title.trim(),
            message: message.trim(),
            class_name: target === "student" ? undefined : className,
            section: target === "section" ? section : undefined,
            student_id: target === "student" ? studentId : undefined,
          }),
        },
      );
      const payload = res.payload ?? {};
      if (res.response.ok && payload.ok) {
        setResult({ ok: true, text: payload.message ?? t("تم الإرسال", "Sent") });
        setTitle("");
        setMessage("");
      } else {
        setResult({ ok: false, text: payload.message ?? t("تعذر إرسال الإشعار", "Could not send") });
      }
    } catch {
      setResult({ ok: false, text: t("خطأ في الاتصال", "Connection error") });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="rounded-2xl border border-[var(--primary)]/25 bg-[var(--card-bg)] p-4 sm:p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h2 className="flex items-center gap-2 text-base font-bold text-[var(--text-primary)]">
          <span className="h-9 w-9 rounded-xl bg-[var(--primary)]/10 text-[var(--primary)] flex items-center justify-center">
            <Send className="h-4 w-4" />
          </span>
          {t("إرسال إشعار للطلاب", "Notify students")}
        </h2>
        <button onClick={onClose} className="h-8 w-8 rounded-lg flex items-center justify-center text-[var(--text-muted)] hover:bg-[var(--surface-strong)]" aria-label={t("إغلاق", "Close")}>
          <X className="h-4 w-4" />
        </button>
      </div>

      {classes.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">
          {t("لا توجد صفوف مسندة إليك حتى الآن، لذلك لا يمكن إرسال إشعارات.", "No classes are assigned to you yet.")}
        </p>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-1 rounded-xl bg-[var(--surface-soft)] p-1">
            {([
              ["class", t("الصف كامل", "Whole class")],
              ["section", t("شعبة", "Section")],
              ["student", t("طالب", "Student")],
            ] as Array<[Target, string]>).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTarget(key)}
                className={`rounded-lg py-2 text-xs sm:text-sm font-semibold transition-colors ${
                  target === key ? "bg-[var(--card-bg)] text-[var(--primary)] shadow-sm" : "text-[var(--text-muted)]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <select value={className} onChange={(e) => setClassName(e.target.value)} className={fieldClass}>
              {classes.map((c) => (
                <option key={c.class_name} value={c.class_name}>
                  {c.class_name} ({c.student_count})
                </option>
              ))}
            </select>
            {target === "section" && (
              <select value={section} onChange={(e) => setSection(e.target.value)} className={fieldClass}>
                <option value="">{t("اختر الشعبة", "Choose section")}</option>
                {sections.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            )}
            {target === "student" && (
              <select value={studentId} onChange={(e) => setStudentId(e.target.value)} className={fieldClass}>
                <option value="">{t("اختر الطالب", "Choose student")}</option>
                {students.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.full_name}{s.has_app_account ? "" : t(" (بدون حساب)", " (no account)")}
                  </option>
                ))}
              </select>
            )}
          </div>

          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={120}
            placeholder={t("عنوان الإشعار", "Title")}
            className={fieldClass}
          />
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={3}
            maxLength={1000}
            placeholder={t("نص الإشعار...", "Message...")}
            className={fieldClass}
            style={{ resize: "vertical" }}
          />

          <p className="text-xs text-[var(--text-muted)]">
            {t(
              `سيصل الإشعار إلى ${reachable} من ${recipients.length} طالب (الطلاب الذين لديهم حساب في التطبيق).`,
              `Will reach ${reachable} of ${recipients.length} students (those with an app account).`,
            )}
          </p>

          {result && (
            <div
              className={`rounded-xl px-3 py-2 text-sm ${
                result.ok
                  ? "bg-[color-mix(in_srgb,var(--success)_12%,transparent)] text-[var(--success)]"
                  : "bg-[color-mix(in_srgb,var(--danger,#ef4444)_12%,transparent)] text-[var(--danger,#ef4444)]"
              }`}
            >
              {result.text}
            </div>
          )}

          <button
            type="button"
            onClick={send}
            disabled={sending}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--primary)] px-6 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {t("إرسال", "Send")}
          </button>
        </div>
      )}
    </div>
  );
}

interface Notification {
  id: string;
  title: string;
  body: string | null;
  created_at: string;
  is_read: boolean;
}

function timeAgo(dateStr: string, isAr: boolean): string {
  if (!dateStr) return "";
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60_000);

  if (diffMin < 1) return isAr ? "الآن" : "now";
  if (diffMin < 60) return isAr ? `${diffMin} د` : `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return isAr ? `${diffHr} س` : `${diffHr}h`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return isAr ? `${diffDay} ي` : `${diffDay}d`;
  const diffMonth = Math.floor(diffDay / 30);
  return isAr ? `${diffMonth} ش` : `${diffMonth}mo`;
}

export default function TeacherNotificationsPage() {
  const pathname = usePathname();
  const locale = getLocaleFromPath(pathname);
  const isAr = locale === "ar";
  const t = (ar: string, en: string) => (isAr ? ar : en);
  const searchParams = useSearchParams();
  const [composeOpen, setComposeOpen] = useState(searchParams.get("compose") === "1");

  useEffect(() => {
    if (searchParams.get("compose") === "1") setComposeOpen(true);
  }, [searchParams]);

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchJsonWithAuthorizedSession("/api/teacher/notifications")
      .then((res) => {
        if (res.response.ok) {
          setNotifications(
            ((res.payload as { data: Notification[] })?.data ?? []),
          );
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const markAsRead = useCallback(async (id: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)),
    );

    try {
      await fetchJsonWithAuthorizedSession("/api/teacher/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, is_read: true }),
      });
    } catch {
      // Optimistic update stays; silent on network failure
    }
  }, []);

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  return (
    <TeacherShell
      currentPath="/teacher/notifications"
      titleAr="الاشعارات"
      titleEn="Notifications"
      subtitleAr={unreadCount > 0 ? `${unreadCount} غير مقروء` : undefined}
      subtitleEn={unreadCount > 0 ? `${unreadCount} unread` : undefined}
      actions={
        !composeOpen ? (
          <button
            onClick={() => setComposeOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--primary)] px-3 py-2 text-xs sm:text-sm font-semibold text-white"
          >
            <Send className="h-4 w-4" />
            {t("إرسال إشعار", "Send")}
          </button>
        ) : undefined
      }
    >
      <div className="space-y-3 max-w-3xl mx-auto">
        {composeOpen && (
          <ComposeNotification isAr={isAr} onClose={() => setComposeOpen(false)} />
        )}
        <h2 className="pt-1 text-sm font-bold text-[var(--text-primary)]">
          {t("الإشعارات الواردة", "Inbox")}
        </h2>
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="h-20 rounded-[var(--card-radius)] bg-[var(--card-bg)] border border-[var(--card-border)] animate-pulse"
              />
            ))}
          </div>
        ) : notifications.length === 0 ? (
          <EmptyState
            icon={
              <Bell className="h-12 w-12 text-[var(--text-tertiary)]" />
            }
            title={t("لا توجد اشعارات", "No notifications")}
            description={t(
              "ليس لديك اي اشعارات حالياً",
              "You don't have any notifications right now",
            )}
          />
        ) : (
          <div className="space-y-2">
            {notifications.map((n) => (
              <button
                key={n.id}
                onClick={() => {
                  if (!n.is_read) markAsRead(n.id);
                }}
                className={`w-full text-start p-4 rounded-[var(--card-radius)] border transition-colors ${
                  n.is_read
                    ? "border-[var(--card-border)] bg-[var(--card-bg)] opacity-70"
                    : "border-[var(--primary)]/30 bg-[var(--primary)]/5 hover:bg-[var(--primary)]/10"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p
                        className={`text-xs sm:text-sm ${
                          n.is_read
                            ? "font-medium text-[var(--text-primary)]"
                            : "font-semibold text-[var(--text-primary)]"
                        }`}
                      >
                        {n.title}
                      </p>
                      {!n.is_read && (
                        <span className="shrink-0 h-2 w-2 rounded-full bg-[var(--primary)]" />
                      )}
                    </div>
                    {n.body && (
                      <p className="text-xs text-[var(--text-muted)] mt-1 line-clamp-2">
                        {n.body}
                      </p>
                    )}
                    <p className="text-xs text-[var(--text-muted)] mt-1.5">
                      {timeAgo(n.created_at, isAr)}
                    </p>
                  </div>
                  {n.is_read && (
                    <CheckCheck className="h-4 w-4 text-[var(--text-muted)] shrink-0 mt-0.5" />
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </TeacherShell>
  );
}
