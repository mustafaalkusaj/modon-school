"use client";

import { useEffect, useState, useCallback } from "react";
import { usePathname } from "next/navigation";
import {
  Bell,
  Star,
  BookOpen,
  AlertCircle,
  Megaphone,
  ExternalLink,
  CreditCard,
  CalendarDays,
  MessageSquare,
  CheckCheck,
} from "lucide-react";
import { StudentShell } from "@/components/StudentShell";
import { getLocaleFromPath } from "@/lib/locale-routing";
import {
  fetchJsonWithAuthorizedSession,
  withJsonHeaders,
} from "@/lib/authorized-api";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

interface NotificationItem {
  id: string;
  source: "announcement" | "notification";
  type: string;
  title: string;
  body: string | null;
  link_url: string | null;
  author_name: string | null;
  status: string | null;
  created_at: string;
}

const ICON_MAP: Record<string, typeof Bell> = {
  announcement: Megaphone,
  behavior: Star,
  grade: BookOpen,
  grades: BookOpen,
  payment: CreditCard,
  attendance: CalendarDays,
  message: MessageSquare,
  alert: AlertCircle,
  general: Bell,
};

function getIcon(type: string) {
  return ICON_MAP[type] ?? Bell;
}

function getIconColor(type: string): string {
  switch (type) {
    case "behavior":
      return "var(--warning)";
    case "grade":
    case "grades":
      return "var(--success)";
    case "alert":
      return "var(--danger)";
    case "payment":
      return "var(--primary)";
    default:
      return "var(--text-muted)";
  }
}

function timeAgo(dateStr: string, isAr: boolean): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;

  if (diffMs < 0) return isAr ? "الآن" : "just now";

  const minutes = Math.floor(diffMs / 60_000);
  const hours = Math.floor(diffMs / 3_600_000);
  const days = Math.floor(diffMs / 86_400_000);
  const weeks = Math.floor(days / 7);

  if (minutes < 1) return isAr ? "الآن" : "just now";
  if (minutes < 60) return isAr ? `منذ ${minutes} دقيقة` : `${minutes}m ago`;
  if (hours < 24) return isAr ? `منذ ${hours} ساعة` : `${hours}h ago`;
  if (days < 7) return isAr ? `منذ ${days} يوم` : `${days}d ago`;
  return isAr ? `منذ ${weeks} أسبوع` : `${weeks}w ago`;
}

export default function StudentNotificationsPage() {
  const pathname = usePathname();
  const locale = getLocaleFromPath(pathname);
  const isAr = locale === "ar";
  const t = (ar: string, en: string) => (isAr ? ar : en);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());

  function loadData(signal?: AbortSignal) {
    setLoading(true);
    setError(null);
    fetchJsonWithAuthorizedSession("/api/student/notifications", signal ? { signal } : undefined)
      .then((res) => {
        if (signal?.aborted) return;
        if (res.response.ok)
          setNotifications(
            (res.payload as { data: NotificationItem[] })?.data ?? [],
          );
      })
      .catch(() => {
        if (signal?.aborted) return;
        setError("حدث خطأ في تحميل البيانات");
      })
      .finally(() => {
        if (signal?.aborted) return;
        setLoading(false);
      });
  }

  useEffect(() => {
    const controller = new AbortController();
    loadData(controller.signal);
    return () => controller.abort();
  }, []);

  const markAsRead = useCallback(
    async (n: NotificationItem) => {
      if (n.source !== "notification" || readIds.has(n.id)) return;
      setReadIds((prev) => new Set(prev).add(n.id));
      try {
        // These rows come from app_notifications — mark them read there
        // (the insite endpoint only knows notification_recipients).
        await fetchJsonWithAuthorizedSession("/api/student/notifications", {
          method: "PATCH",
          headers: withJsonHeaders(),
          body: JSON.stringify({ notificationIds: [n.id] }),
        });
      } catch {
        // best-effort
      }
    },
    [readIds],
  );

  const markAllAsRead = useCallback(async () => {
    const unread = notifications.filter(
      (n) => n.source === "notification" && n.status !== "read" && !readIds.has(n.id),
    );
    if (unread.length === 0) return;
    const ids = unread.map((n) => n.id);
    setReadIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.add(id));
      return next;
    });
    try {
      for (let i = 0; i < ids.length; i += 100) {
        await fetchJsonWithAuthorizedSession("/api/student/notifications", {
          method: "PATCH",
          headers: withJsonHeaders(),
          body: JSON.stringify({ notificationIds: ids.slice(i, i + 100) }),
        });
      }
    } catch {
      // best-effort
    }
  }, [notifications, readIds]);

  const unreadCount = notifications.filter(
    (n) => n.source === "notification" && n.status !== "read" && !readIds.has(n.id),
  ).length;

  return (
    <StudentShell
      currentPath="/student/notifications"
      titleAr="إشعاراتي"
      titleEn="My Notifications"
    >
      {error && (
        <div className="bg-[var(--danger)]/5 border border-[var(--danger)]/20 text-[var(--danger)] px-4 py-3 rounded mb-4 text-sm flex items-center justify-between gap-2">
          <span>{error}</span>
          <button type="button" onClick={() => loadData()} className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium text-white" style={{ backgroundColor: "var(--primary, #2563eb)" }}>
            {t("إعادة المحاولة", "Retry")}
          </button>
        </div>
      )}
      {unreadCount > 0 && (
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-bold text-[var(--primary)]">
            {t(`${unreadCount} غير مقروء`, `${unreadCount} unread`)}
          </span>
          <button
            type="button"
            onClick={() => void markAllAsRead()}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--primary)] hover:underline"
          >
            <CheckCheck className="h-3.5 w-3.5" />
            {t("قراءة الكل", "Mark all read")}
          </button>
        </div>
      )}
      <div className="space-y-3 sm:space-y-4">
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="h-[80px] rounded-[var(--card-radius)] bg-[var(--card-bg)] border border-[var(--card-border)] animate-pulse"
              />
            ))}
          </div>
        ) : notifications.length === 0 ? (
          <EmptyState
            icon={<Bell className="h-12 w-12 text-[var(--text-tertiary)]" />}
            title={t("لا توجد إشعارات", "No notifications")}
          />
        ) : (
          notifications.map((n) => {
            const Icon = getIcon(n.type);
            const iconColor = getIconColor(n.type);
            const isUnread =
              n.source === "notification" &&
              n.status !== "read" &&
              !readIds.has(n.id);

            return (
              <Card
                key={`${n.source}-${n.id}`}
                className={`transition-all duration-150 active:scale-[0.98] hover:shadow-sm ${isUnread ? "border-[var(--primary)]/30 bg-[color-mix(in_srgb,var(--primary)_3%,var(--card-bg))]" : ""}`}
                onClick={() => void markAsRead(n)}
                role={isUnread ? "button" : undefined}
              >
                <CardContent className="p-3 sm:p-4">
                  <div className="flex items-start gap-3">
                    <div
                      className="shrink-0 flex items-center justify-center w-9 h-9 sm:w-10 sm:h-10 rounded-xl"
                      style={{
                        backgroundColor: `color-mix(in srgb, ${iconColor} 12%, transparent)`,
                      }}
                    >
                      <Icon
                        className="h-4 w-4 sm:h-5 sm:w-5"
                        style={{ color: iconColor }}
                      />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          {isUnread && (
                            <span className="w-2 h-2 rounded-full bg-[var(--primary)] shrink-0" />
                          )}
                          <h3 className="text-sm sm:text-base font-semibold text-[var(--text-primary)] line-clamp-1">
                            {n.title}
                          </h3>
                        </div>
                        <span className="text-[10px] sm:text-xs text-[var(--text-muted)] shrink-0 pt-0.5">
                          {timeAgo(n.created_at, isAr)}
                        </span>
                      </div>

                      {n.body && (
                        <p className="text-xs sm:text-sm text-[var(--text-secondary)] mt-0.5 line-clamp-2">
                          {n.body}
                        </p>
                      )}

                      <div className="flex items-center gap-2 mt-1.5">
                        {n.author_name && (
                          <span className="text-[10px] sm:text-xs text-[var(--text-muted)]">
                            {n.author_name}
                          </span>
                        )}
                        {n.link_url && (
                          <a
                            href={n.link_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[10px] sm:text-xs font-medium text-[var(--primary)] hover:underline"
                          >
                            {t("عرض", "View")}
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </StudentShell>
  );
}
