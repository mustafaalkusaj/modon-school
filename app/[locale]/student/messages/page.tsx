"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { MessageSquare, Search, AlertCircle, Plus } from "lucide-react";
import { StudentShell } from "@/components/StudentShell";
import { getLocaleFromPath } from "@/lib/locale-routing";
import {
  fetchJsonWithAuthorizedSession,
  fetchWithAuthorizedSession,
} from "@/lib/authorized-api";
import { EmptyState } from "@/components/ui/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { Modal, ModalHeader, ModalBody, ModalFooter } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

interface Thread {
  id: string;
  title: string;
  lastMessage: string;
  lastMessageAt: string;
  otherParticipantName: string;
  unreadCount: number;
}

interface TeacherOption {
  id: string;
  name: string;
}

function getInitials(name: string): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
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

export default function StudentMessagesPage() {
  const pathname = usePathname();
  const router = useRouter();
  const locale = getLocaleFromPath(pathname);
  const isAr = locale === "ar";
  const t = (ar: string, en: string) => (isAr ? ar : en);

  const [threads, setThreads] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [search, setSearch] = useState("");

  const [composeOpen, setComposeOpen] = useState(false);
  const [teachers, setTeachers] = useState<TeacherOption[]>([]);
  const [teachersLoading, setTeachersLoading] = useState(false);
  const [recipientId, setRecipientId] = useState("");
  const [subject, setSubject] = useState("");
  const [messageBody, setMessageBody] = useState("");
  const [sending, setSending] = useState(false);
  const [composeError, setComposeError] = useState("");

  useEffect(() => {
    fetchJsonWithAuthorizedSession("/api/student/messages")
      .then((res) => {
        if (res.response.ok) {
          setThreads((res.payload as { data: Thread[] })?.data ?? []);
        }
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  const openCompose = () => {
    setComposeOpen(true);
    setComposeError("");
    setRecipientId("");
    setSubject("");
    setMessageBody("");

    if (teachers.length === 0) {
      setTeachersLoading(true);
      fetchJsonWithAuthorizedSession("/api/student/messages/teachers")
        .then((res) => {
          if (res.response.ok) {
            setTeachers((res.payload as { data: TeacherOption[] })?.data ?? []);
          }
        })
        .catch(() => {})
        .finally(() => setTeachersLoading(false));
    }
  };

  const handleSendNew = async () => {
    if (!recipientId || !subject.trim() || !messageBody.trim() || sending) {
      setComposeError(
        t("يرجى تعبئة جميع الحقول", "Please fill in all fields"),
      );
      return;
    }

    setSending(true);
    setComposeError("");

    try {
      const res = await fetchWithAuthorizedSession("/api/student/messages/new", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipient_id: recipientId,
          subject: subject.trim(),
          body: messageBody.trim(),
        }),
      });

      const json = await res.json().catch(() => null);
      if (res.ok && json?.data?.conversationId) {
        setComposeOpen(false);
        router.push(`/${locale}/student/messages/${json.data.conversationId}`);
      } else {
        setComposeError(
          t("فشل إرسال الرسالة. حاول مرة أخرى.", "Failed to send message. Please try again."),
        );
      }
    } catch {
      setComposeError(
        t("فشل إرسال الرسالة. حاول مرة أخرى.", "Failed to send message. Please try again."),
      );
    } finally {
      setSending(false);
    }
  };

  const filtered = search.trim()
    ? threads.filter((th) =>
        th.otherParticipantName
          .toLowerCase()
          .includes(search.trim().toLowerCase()),
      )
    : threads;

  if (error) {
    return (
      <StudentShell
        currentPath="/student/messages"
        titleAr="رسائلي"
        titleEn="My Messages"
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
      currentPath="/student/messages"
      titleAr="رسائلي"
      titleEn="My Messages"
    >
      <div className="space-y-4">
        <div className="relative">
          <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-muted)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("بحث بالاسم...", "Search by name...")}
            className="w-full ps-9 pe-3 py-2.5 rounded-[var(--card-radius)] border border-[var(--card-border)] bg-[var(--card-bg)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:ring-2 focus:ring-[var(--primary)] transition-shadow"
          />
        </div>

        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-[72px] rounded-[var(--card-radius)] bg-[var(--card-bg)] border border-[var(--card-border)] animate-pulse"
              />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={
              <MessageSquare className="h-12 w-12 text-[var(--text-tertiary)]" />
            }
            title={t("لا توجد رسائل", "No messages")}
          />
        ) : (
          <div className="space-y-2">
            {filtered.map((th) => (
              <button
                key={th.id}
                onClick={() =>
                  router.push(`/${locale}/student/messages/${th.id}`)
                }
                className={`w-full flex items-center gap-3 p-3 rounded-2xl border bg-[var(--card-bg)] transition-all duration-150 active:scale-[0.98] text-start ${
                  th.unreadCount > 0
                    ? "border-[var(--primary)]/20 shadow-sm"
                    : "border-[var(--card-border)] hover:bg-[var(--surface-soft)]"
                }`}
              >
                <div className={`shrink-0 h-11 w-11 rounded-full flex items-center justify-center text-white text-sm font-semibold ${
                  th.unreadCount > 0 ? "ring-2 ring-[var(--primary)]/30 ring-offset-1 ring-offset-[var(--card-bg)]" : ""
                }`} style={{ backgroundColor: "var(--primary)" }}>
                  {getInitials(th.otherParticipantName)}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`text-sm truncate ${
                        th.unreadCount > 0
                          ? "font-bold text-[var(--text-primary)]"
                          : "text-[var(--text-primary)]"
                      }`}
                    >
                      {th.otherParticipantName || th.title}
                    </span>
                    <span className="text-[10px] text-[var(--text-muted)] shrink-0 tabular-nums">
                      {timeAgo(th.lastMessageAt, isAr)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-0.5">
                    <span className={`text-xs truncate ${
                      th.unreadCount > 0 ? "text-[var(--text-secondary)] font-medium" : "text-[var(--text-muted)]"
                    }`}>
                      {th.lastMessage ||
                        t("لا توجد رسائل بعد", "No messages yet")}
                    </span>
                    {th.unreadCount > 0 && (
                      <span className="shrink-0 inline-flex items-center justify-center h-5 min-w-[20px] px-1.5 rounded-full bg-[var(--primary)] text-white text-[10px] font-bold shadow-sm">
                        {th.unreadCount}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={openCompose}
        aria-label={t("رسالة جديدة", "New Message")}
        className="fixed bottom-24 end-6 z-[var(--z-modal,40)] h-14 w-14 rounded-full bg-[var(--primary)] text-white shadow-lg flex items-center justify-center hover:opacity-90 active:scale-95 transition-all duration-150"
      >
        <Plus className="h-6 w-6" />
      </button>

      <Modal open={composeOpen} onClose={() => setComposeOpen(false)} size="md">
        <ModalHeader
          title={t("رسالة جديدة", "New Message")}
          onClose={() => setComposeOpen(false)}
        />
        <ModalBody className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-[var(--text-primary)]">
              {t("إلى", "To")}
            </label>
            <Select
              value={recipientId}
              onChange={(e) => setRecipientId(e.target.value)}
              disabled={teachersLoading}
            >
              <option value="">
                {teachersLoading
                  ? t("جارٍ التحميل...", "Loading...")
                  : t("اختر المعلم", "Select a teacher")}
              </option>
              {teachers.map((tch) => (
                <option key={tch.id} value={tch.id}>
                  {tch.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-[var(--text-primary)]">
              {t("الموضوع", "Subject")}
            </label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder={t("اكتب موضوع الرسالة...", "Enter subject...")}
              className="w-full h-[var(--input-height)] px-3 rounded-[var(--input-radius)] border border-[var(--input-border)] bg-[var(--surface-soft)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)] transition-shadow"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-[var(--text-primary)]">
              {t("الرسالة", "Message")}
            </label>
            <Textarea
              value={messageBody}
              onChange={(e) => setMessageBody(e.target.value)}
              placeholder={t("اكتب رسالتك...", "Type your message...")}
              rows={4}
            />
          </div>

          {composeError && (
            <p className="text-sm text-red-500">{composeError}</p>
          )}
        </ModalBody>
        <ModalFooter>
          <button
            type="button"
            onClick={() => setComposeOpen(false)}
            className="px-4 py-2 rounded-[var(--input-radius)] border border-[var(--card-border)] text-sm text-[var(--text-primary)] hover:bg-[var(--surface-soft)] transition-colors"
          >
            {t("إلغاء", "Cancel")}
          </button>
          <button
            type="button"
            onClick={handleSendNew}
            disabled={sending}
            className="px-4 py-2 rounded-[var(--input-radius)] bg-[var(--primary)] text-white text-sm hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {sending
              ? t("جارٍ الإرسال...", "Sending...")
              : t("إرسال", "Send")}
          </button>
        </ModalFooter>
      </Modal>
    </StudentShell>
  );
}
