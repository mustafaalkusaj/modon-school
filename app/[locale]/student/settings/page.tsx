"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Settings, Lock, Eye, EyeOff, Languages, Bell } from "lucide-react";
import { StudentShell } from "@/components/StudentShell";
import { getLocaleFromPath, localizeAppPath } from "@/lib/locale-routing";
import { fetchJsonWithAuthorizedSession } from "@/lib/authorized-api";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

interface NotificationPreferences {
  grades: boolean;
  attendance: boolean;
  assignments: boolean;
  exams: boolean;
  messages: boolean;
}

const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  grades: true,
  attendance: true,
  assignments: true,
  exams: true,
  messages: true,
};

export default function StudentSettingsPage() {
  const pathname = usePathname();
  const router = useRouter();
  const locale = getLocaleFromPath(pathname);
  const isAr = locale === "ar";
  const t = (ar: string, en: string) => (isAr ? ar : en);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  function handleLocaleSwitch(nextLocale: "ar" | "en") {
    if (nextLocale === locale) return;
    router.push(localizeAppPath(pathname ?? "/student/settings", nextLocale));
  }

  const [notifPrefs, setNotifPrefs] = useState<NotificationPreferences>(
    DEFAULT_NOTIFICATION_PREFERENCES,
  );
  const [notifLoading, setNotifLoading] = useState(true);
  const [notifSaving, setNotifSaving] = useState(false);
  const [notifMessage, setNotifMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    fetchJsonWithAuthorizedSession("/api/student/settings/notifications")
      .then((res) => {
        if (res.response.ok) {
          const data = (res.payload as any)?.data;
          if (data) setNotifPrefs({ ...DEFAULT_NOTIFICATION_PREFERENCES, ...data });
        }
      })
      .finally(() => setNotifLoading(false));
  }, []);

  async function saveNotificationPreferences(next: NotificationPreferences) {
    setNotifSaving(true);
    setNotifMessage(null);
    try {
      const res = await fetchJsonWithAuthorizedSession("/api/student/settings/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      if (res.response.ok) {
        setNotifMessage({ type: "success", text: t("تم حفظ التفضيلات", "Preferences saved") });
      } else {
        setNotifMessage({ type: "error", text: t("فشل حفظ التفضيلات", "Failed to save preferences") });
      }
    } catch {
      setNotifMessage({ type: "error", text: t("حدث خطأ", "An error occurred") });
    } finally {
      setNotifSaving(false);
    }
  }

  function toggleNotifPref(key: keyof NotificationPreferences, value: boolean) {
    const next = { ...notifPrefs, [key]: value };
    setNotifPrefs(next);
    saveNotificationPreferences(next);
  }

  async function handlePasswordChange(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);

    if (newPassword.length < 6) {
      setMessage({ type: "error", text: t("كلمة المرور يجب أن تكون 6 أحرف على الأقل", "Password must be at least 6 characters") });
      return;
    }
    if (newPassword !== confirmPassword) {
      setMessage({ type: "error", text: t("كلمات المرور غير متطابقة", "Passwords do not match") });
      return;
    }

    setSaving(true);
    try {
      const res = await fetchJsonWithAuthorizedSession("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (res.response.ok) {
        setMessage({ type: "success", text: t("تم تغيير كلمة المرور بنجاح", "Password changed successfully") });
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
      } else {
        const err = (res.payload as any)?.error?.message || t("فشل تغيير كلمة المرور", "Failed to change password");
        setMessage({ type: "error", text: err });
      }
    } catch {
      setMessage({ type: "error", text: t("حدث خطأ", "An error occurred") });
    } finally {
      setSaving(false);
    }
  }

  return (
    <StudentShell
      currentPath="/student/settings"
      titleAr="الإعدادات"
      titleEn="Settings"
    >
      <div className="space-y-4 sm:space-y-6 max-w-2xl">
        <div
          className="relative overflow-hidden rounded-2xl p-5 sm:p-6"
          style={{
            background: "linear-gradient(135deg, var(--primary) 0%, color-mix(in srgb, var(--primary) 70%, var(--info)) 100%)",
          }}
        >
          <div className="absolute inset-0 opacity-10" style={{
            backgroundImage: "radial-gradient(circle at 80% 20%, white 0%, transparent 50%), radial-gradient(circle at 20% 80%, white 0%, transparent 40%)",
          }} />
          <div className="relative flex items-center gap-3">
            <div className="flex items-center justify-center w-12 h-12 rounded-full bg-white/20 backdrop-blur-sm border border-white/30">
              <Settings className="h-6 w-6 text-white" />
            </div>
            <div>
              <h2 className="text-lg sm:text-xl font-bold text-white">{t("الإعدادات", "Settings")}</h2>
              <p className="text-sm text-white/70">{t("إدارة حسابك وتفضيلاتك", "Manage your account and preferences")}</p>
            </div>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
              <Lock className="h-5 w-5 text-[var(--primary)]" />
              {t("تغيير كلمة المرور", "Change Password")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handlePasswordChange} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">
                  {t("كلمة المرور الحالية", "Current Password")}
                </label>
                <div className="relative">
                  <input
                    type={showCurrent ? "text" : "password"}
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    className="w-full px-3 py-2 pe-10 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] text-[var(--text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrent(!showCurrent)}
                    className="absolute inset-y-0 end-0 flex items-center pe-3 text-[var(--text-muted)]"
                  >
                    {showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">
                  {t("كلمة المرور الجديدة", "New Password")}
                </label>
                <div className="relative">
                  <input
                    type={showNew ? "text" : "password"}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full px-3 py-2 pe-10 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] text-[var(--text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent"
                    required
                    minLength={6}
                  />
                  <button
                    type="button"
                    onClick={() => setShowNew(!showNew)}
                    className="absolute inset-y-0 end-0 flex items-center pe-3 text-[var(--text-muted)]"
                  >
                    {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">
                  {t("تأكيد كلمة المرور", "Confirm Password")}
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] text-[var(--text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent"
                  required
                  minLength={6}
                />
              </div>

              {message && (
                <div
                  className={`p-3 rounded-lg text-sm ${
                    message.type === "success"
                      ? "bg-[color-mix(in_srgb,var(--success)_10%,transparent)] text-[var(--success)]"
                      : "bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] text-[var(--danger)]"
                  }`}
                >
                  {message.text}
                </div>
              )}

              <Button
                type="submit"
                disabled={saving || !currentPassword || !newPassword || !confirmPassword}
                className="w-full sm:w-auto"
              >
                {saving ? t("جاري الحفظ...", "Saving...") : t("تغيير كلمة المرور", "Change Password")}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
              <Languages className="h-5 w-5 text-[var(--primary)]" />
              {t("تغيير اللغة", "Language")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => handleLocaleSwitch("ar")}
                className={`rounded-lg border px-4 py-3 text-sm font-medium transition-colors ${
                  isAr
                    ? "border-[var(--primary)] bg-[color-mix(in_srgb,var(--primary)_10%,transparent)] text-[var(--primary)]"
                    : "border-[var(--card-border)] text-[var(--text-secondary)] hover:border-[var(--primary)]"
                }`}
              >
                العربية
              </button>
              <button
                type="button"
                onClick={() => handleLocaleSwitch("en")}
                className={`rounded-lg border px-4 py-3 text-sm font-medium transition-colors ${
                  !isAr
                    ? "border-[var(--primary)] bg-[color-mix(in_srgb,var(--primary)_10%,transparent)] text-[var(--primary)]"
                    : "border-[var(--card-border)] text-[var(--text-secondary)] hover:border-[var(--primary)]"
                }`}
              >
                English
              </button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
              <Bell className="h-5 w-5 text-[var(--primary)]" />
              {t("إعدادات الإشعارات", "Notification Preferences")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {notifLoading ? (
              <div className="space-y-3">
                {[0, 1, 2, 3, 4].map((i) => (
                  <div key={i} className="h-10 rounded-lg bg-[var(--card-border)]/30 animate-pulse" />
                ))}
              </div>
            ) : (
              <div className="space-y-1">
                {(
                  [
                    { key: "grades", ar: "إشعارات الدرجات", en: "Grade notifications" },
                    { key: "attendance", ar: "إشعارات الحضور", en: "Attendance notifications" },
                    { key: "assignments", ar: "إشعارات الواجبات", en: "Assignment notifications" },
                    { key: "exams", ar: "إشعارات الامتحانات", en: "Exam notifications" },
                    { key: "messages", ar: "إشعارات الرسائل", en: "Message notifications" },
                  ] as const
                ).map((item) => (
                  <div
                    key={item.key}
                    className="flex items-center justify-between py-2.5 border-b border-[var(--card-border)] last:border-b-0"
                  >
                    <span className="text-sm text-[var(--text-primary)]">
                      {t(item.ar, item.en)}
                    </span>
                    <Switch
                      checked={notifPrefs[item.key]}
                      onChange={(checked) => toggleNotifPref(item.key, checked)}
                      disabled={notifSaving}
                    />
                  </div>
                ))}
              </div>
            )}

            {notifMessage && (
              <div
                className={`mt-3 p-3 rounded-lg text-sm ${
                  notifMessage.type === "success"
                    ? "bg-[color-mix(in_srgb,var(--success)_10%,transparent)] text-[var(--success)]"
                    : "bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] text-[var(--danger)]"
                }`}
              >
                {notifMessage.text}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
              <Settings className="h-5 w-5 text-[var(--text-muted)]" />
              {t("معلومات التطبيق", "App Info")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between items-center">
                <span className="text-[var(--text-muted)]">{t("الإصدار", "Version")}</span>
                <span className="text-[var(--text-primary)] font-medium">1.0.0</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[var(--text-muted)]">{t("اللغة", "Language")}</span>
                <span className="text-[var(--text-primary)] font-medium">{isAr ? "العربية" : "English"}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </StudentShell>
  );
}
