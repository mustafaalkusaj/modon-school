"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Send, Loader2, Users, User, CheckCircle2 } from "lucide-react";
import { TeacherShell } from "@/components/TeacherShell";
import { getLocaleFromPath } from "@/lib/locale-routing";
import { fetchJsonWithAuthorizedSession } from "@/lib/authorized-api";
import { EmptyState } from "@/components/ui/empty-state";
import { sectionMatches } from "@/lib/section-scope";

interface TeacherClass {
  class_name: string;
  section: string | null;
  student_count: number;
}

interface Student {
  id: string;
  full_name: string;
  class_name: string | null;
  section: string | null;
  has_account: boolean;
  push_enabled?: boolean;
}

const TEMPLATES = [
  { ar: "تذكير بالواجب", title: "تذكير بالواجب", body: "نذكّركم بتسليم الواجب في موعده. مع التقدير." },
  { ar: "امتحان قادم", title: "امتحان قادم", body: "يرجى الاستعداد للامتحان القادم ومراجعة الدروس المقررة." },
  { ar: "شكر وتشجيع", title: "أحسنتم!", body: "شكراً لكم على تفاعلكم والتزامكم. استمروا بهذا التميز 🌟" },
];

function classKey(c: { class_name: string; section: string | null }) {
  return `${c.class_name}::${c.section ?? ""}`;
}

export default function TeacherSendNotificationPage() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const locale = getLocaleFromPath(pathname);
  const isAr = locale === "ar";
  const t = (ar: string, en: string) => (isAr ? ar : en);

  const [classes, setClasses] = useState<TeacherClass[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [target, setTarget] = useState("");
  const [mode, setMode] = useState<"class" | "student">("class");
  const [studentId, setStudentId] = useState("");
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    fetchJsonWithAuthorizedSession("/api/teacher/notifications/recipients")
      .then((res) => {
        const d = (res.payload as { data?: { classes?: TeacherClass[]; students?: Student[] } } | null)?.data;
        if (res.response.ok && d) {
          const cls = d.classes ?? [];
          setClasses(cls);
          setStudents(d.students ?? []);
          const preCls = searchParams.get("class_name");
          const preKey = preCls ? classKey({ class_name: preCls, section: searchParams.get("section") }) : "";
          setTarget(cls.some((c) => classKey(c) === preKey) ? preKey : cls[0] ? classKey(cls[0]) : "");
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [searchParams]);

  const current = classes.find((c) => classKey(c) === target) ?? null;
  const classStudents = useMemo(
    () =>
      current
        ? students.filter(
            (s) =>
              (s.class_name ?? "").toLowerCase() === current.class_name.toLowerCase() &&
              sectionMatches(s.section, current.section),
          )
        : [],
    [students, current],
  );
  const audience = mode === "student" ? classStudents.filter((s) => s.id === studentId) : classStudents;
  const withAccount = audience.filter((s) => s.has_account);
  const ringing = withAccount.filter((s) => s.push_enabled).length;
  const noAccount = audience.length - withAccount.length;
  const reachable = mode === "student"
    ? classStudents.filter((s) => s.id === studentId && s.has_account).length
    : classStudents.filter((s) => s.has_account).length;

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!current || !title.trim() || !message.trim()) {
      setResult({ ok: false, text: t("اختر الصف واكتب العنوان والنص", "Pick a class and write a title and message") });
      return;
    }
    if (mode === "student" && !studentId) {
      setResult({ ok: false, text: t("اختر الطالب", "Pick a student") });
      return;
    }
    setSending(true);
    setResult(null);
    try {
      const res = await fetchJsonWithAuthorizedSession("/api/teacher/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          message: message.trim(),
          class_name: current.class_name,
          section: current.section,
          student_id: mode === "student" ? studentId : undefined,
        }),
      });
      const payload = res.payload as { ok?: boolean; message?: string; error?: string } | null;
      if (res.response.ok && payload?.ok) {
        setResult({ ok: true, text: payload.message ?? t("تم الإرسال", "Sent") });
        setTitle("");
        setMessage("");
      } else {
        setResult({ ok: false, text: payload?.error ?? payload?.message ?? t("تعذر الإرسال", "Could not send") });
      }
    } catch {
      setResult({ ok: false, text: t("خطأ في الاتصال", "Connection error") });
    } finally {
      setSending(false);
    }
  }

  const field =
    "w-full rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20";

  return (
    <TeacherShell
      currentPath="/teacher/notifications/send"
      titleAr="إرسال إشعار"
      titleEn="Send Notice"
      subtitleAr="يصل الإشعار إلى تطبيق الطالب"
      subtitleEn="Delivered to the student app"
    >
      <div className="max-w-2xl mx-auto">
        {loading ? (
          <div className="h-80 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] animate-pulse" />
        ) : classes.length === 0 ? (
          <EmptyState
            icon={<Users className="h-12 w-12 text-[var(--text-tertiary)]" />}
            title={t("لم تُسند إليك صفوف بعد", "No classes assigned yet")}
            description={t("لا يمكن الإرسال إلا لطلاب صفوفك. تواصل مع الإدارة لإسناد الصفوف.", "You can only notify students of your classes.")}
          />
        ) : (
          <form onSubmit={handleSend} className="space-y-4 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4 sm:p-6">
            {result && (
              <div
                className={`flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm ${
                  result.ok ? "bg-[var(--success)]/10 text-[var(--success)]" : "bg-[var(--danger)]/10 text-[var(--danger)]"
                }`}
              >
                {result.ok && <CheckCircle2 className="h-4 w-4" />}
                {result.text}
              </div>
            )}

            <div>
              <p className="mb-2 text-sm font-semibold text-[var(--text-primary)]">{t("إلى", "To")}</p>
              <div className="flex flex-wrap gap-2">
                {classes.map((c) => (
                  <button
                    type="button"
                    key={classKey(c)}
                    onClick={() => {
                      setTarget(classKey(c));
                      setStudentId("");
                    }}
                    className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                      target === classKey(c)
                        ? "bg-[var(--primary)] text-white"
                        : "border border-[var(--card-border)] text-[var(--text-secondary)]"
                    }`}
                  >
                    {c.class_name}
                    {c.section ? ` / ${c.section}` : ""}
                  </button>
                ))}
              </div>
              <div className="mt-3 inline-flex rounded-xl bg-[var(--surface-soft,var(--background))] p-1 text-sm">
                {([
                  ["class", t("كل الصف", "Whole class"), Users],
                  ["student", t("طالب محدد", "One student"), User],
                ] as const).map(([value, label, Icon]) => (
                  <button
                    type="button"
                    key={value}
                    onClick={() => setMode(value)}
                    className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium ${
                      mode === value ? "bg-[var(--card-bg)] text-[var(--primary)] shadow-sm" : "text-[var(--text-muted)]"
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    {label}
                  </button>
                ))}
              </div>
              {mode === "student" && (
                <select value={studentId} onChange={(e) => setStudentId(e.target.value)} className={`${field} mt-3`}>
                  <option value="">{t("اختر الطالب", "Select student")}</option>
                  {classStudents.map((s) => (
                    <option key={s.id} value={s.id} disabled={!s.has_account}>
                      {s.full_name}
                      {!s.has_account ? ` (${t("بدون حساب", "no account")})` : ""}
                    </option>
                  ))}
                </select>
              )}
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-xl bg-[var(--success)]/10 p-2">
                  <p className="text-lg font-bold text-[var(--success)] tabular-nums">{ringing}</p>
                  <p className="text-[10px] leading-tight text-[var(--text-muted)]">{t("يصلهم إشعار بصوت على الهاتف", "Will ring on their phone")}</p>
                </div>
                <div className="rounded-xl bg-[var(--warning)]/10 p-2">
                  <p className="text-lg font-bold text-[var(--warning)] tabular-nums">{reachable - ringing}</p>
                  <p className="text-[10px] leading-tight text-[var(--text-muted)]">{t("داخل التطبيق فقط (لم يفعّلوا الإشعارات)", "In-app only (notifications off)")}</p>
                </div>
                <div className="rounded-xl bg-[var(--surface-soft,var(--background))] p-2">
                  <p className="text-lg font-bold text-[var(--text-secondary)] tabular-nums">{noAccount}</p>
                  <p className="text-[10px] leading-tight text-[var(--text-muted)]">{t("بدون حساب — لن يصلهم", "No account — not reached")}</p>
                </div>
              </div>
            </div>

            <div className="flex gap-2 overflow-x-auto pb-1">
              {TEMPLATES.map((tpl) => (
                <button
                  type="button"
                  key={tpl.ar}
                  onClick={() => {
                    setTitle(tpl.title);
                    setMessage(tpl.body);
                  }}
                  className="shrink-0 rounded-full border border-dashed border-[var(--primary)]/40 px-3 py-1.5 text-xs text-[var(--primary)]"
                >
                  {tpl.ar}
                </button>
              ))}
            </div>

            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={120}
              placeholder={t("عنوان الإشعار", "Title")}
              className={field}
            />
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={5}
              maxLength={1000}
              placeholder={t("نص الإشعار...", "Message...")}
              className={field}
              style={{ resize: "vertical" }}
            />

            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={sending || reachable === 0}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--primary)] px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
              >
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {sending ? t("جاري الإرسال...", "Sending...") : t("إرسال", "Send")}
              </button>
              <Link
                href={`/${locale}/teacher/notifications`}
                className="rounded-xl border border-[var(--card-border)] px-4 py-3 text-sm text-[var(--text-secondary)]"
              >
                {t("إلغاء", "Cancel")}
              </Link>
            </div>
          </form>
        )}
      </div>
    </TeacherShell>
  );
}
