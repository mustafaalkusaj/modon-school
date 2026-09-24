"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import {
  User,
  Mail,
  Phone,
  School,
  GraduationCap,
  Hash,
  CalendarDays,
  AlertCircle,
  Pencil,
  Camera,
  X,
  CheckCircle2,
} from "lucide-react";
import { StudentShell } from "@/components/StudentShell";
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

interface StudentProfile {
  full_name: string | null;
  email: string | null;
  phone: string | null;
  personal_email: string | null;
  class_name: string | null;
  school_name: string | null;
  enrollment_date: string | null;
  student_id: string | null;
  avatar_url: string | null;
}

const MAX_AVATAR_BYTES = 3 * 1024 * 1024; // 3MB, matches the API limit
const ALLOWED_AVATAR_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export default function StudentProfilePage() {
  const pathname = usePathname();
  const locale = getLocaleFromPath(pathname);
  const isAr = locale === "ar";
  const t = (ar: string, en: string) => (isAr ? ar : en);
  const [profile, setProfile] = useState<StudentProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [isEditing, setIsEditing] = useState(false);
  const [editPhone, setEditPhone] = useState("");
  const [editPersonalEmail, setEditPersonalEmail] = useState("");
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchJsonWithAuthorizedSession("/api/student/profile")
      .then((res) => {
        if (res.response.ok)
          setProfile((res.payload as any)?.data ?? null);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  function startEditing() {
    if (!profile) return;
    setEditPhone(profile.phone ?? "");
    setEditPersonalEmail(profile.personal_email ?? "");
    setAvatarPreview(null);
    setAvatarDataUrl(null);
    setSaveError(null);
    setSaveSuccess(false);
    setIsEditing(true);
  }

  function cancelEditing() {
    setIsEditing(false);
    setAvatarPreview(null);
    setAvatarDataUrl(null);
    setSaveError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!ALLOWED_AVATAR_TYPES.has(file.type)) {
      setSaveError(
        t(
          "نوع الصورة غير مدعوم (JPEG أو PNG أو WebP فقط)",
          "Unsupported image type (JPEG, PNG, or WebP only)",
        ),
      );
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      setSaveError(t("حجم الصورة يتجاوز 3 م.ب.", "Image exceeds 3MB"));
      return;
    }

    try {
      const dataUrl = await readFileAsDataUrl(file);
      setAvatarDataUrl(dataUrl);
      setAvatarPreview(dataUrl);
      setSaveError(null);
    } catch {
      setSaveError(t("تعذرت قراءة الصورة", "Could not read the image"));
    }
  }

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);

    try {
      const body: Record<string, string> = {
        phone: editPhone.trim(),
        personal_email: editPersonalEmail.trim(),
      };
      if (avatarDataUrl) body.avatar_base64 = avatarDataUrl;

      const res = await fetchJsonWithAuthorizedSession("/api/student/profile/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.response.ok || !(res.payload as any)?.ok) {
        const errCode = (res.payload as any)?.error;
        const msgs: Record<string, string> = {
          validation_error: t("يرجى التحقق من البيانات المدخلة", "Please check the entered data"),
          invalid_image: t("صورة غير صالحة", "Invalid image"),
          invalid_image_type: t("نوع الصورة غير مدعوم", "Unsupported image type"),
          image_too_large: t("حجم الصورة كبير جداً", "Image too large"),
          upload_failed: t("تعذر رفع الصورة", "Failed to upload image"),
          update_failed: t("تعذر حفظ التعديلات", "Failed to save changes"),
        };
        setSaveError(msgs[errCode] ?? t("حدث خطأ أثناء الحفظ", "Something went wrong while saving"));
        return;
      }

      setProfile((res.payload as any).data ?? null);
      setIsEditing(false);
      setAvatarPreview(null);
      setAvatarDataUrl(null);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch {
      setSaveError(t("حدث خطأ في الاتصال", "Connection error"));
    } finally {
      setSaving(false);
    }
  }

  const initials =
    profile?.full_name
      ?.split(" ")
      .map((w) => w[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() ?? "?";

  const fields: Array<{
    label: string;
    value: string | null;
    icon: typeof User;
    dir?: string;
  }> = [
    {
      label: t("الاسم الكامل", "Full Name"),
      value: profile?.full_name ?? null,
      icon: User,
    },
    {
      label: t("البريد الإلكتروني (المدرسي)", "Email (School)"),
      value: profile?.email ?? null,
      icon: Mail,
      dir: "ltr",
    },
    {
      label: t("البريد الشخصي", "Personal Email"),
      value: profile?.personal_email ?? null,
      icon: Mail,
      dir: "ltr",
    },
    {
      label: t("رقم الهاتف", "Phone"),
      value: profile?.phone ?? null,
      icon: Phone,
      dir: "ltr",
    },
    {
      label: t("المدرسة", "School"),
      value: profile?.school_name ?? null,
      icon: School,
    },
    {
      label: t("الصف", "Class"),
      value: profile?.class_name ?? null,
      icon: GraduationCap,
    },
    {
      label: t("رقم الطالب", "Student ID"),
      value: profile?.student_id ?? null,
      icon: Hash,
      dir: "ltr",
    },
    {
      label: t("تاريخ التسجيل", "Enrollment Date"),
      value: profile?.enrollment_date ?? null,
      icon: CalendarDays,
    },
  ];

  return (
    <StudentShell
      currentPath="/student/profile"
      titleAr="ملفي الشخصي"
      titleEn="My Profile"
    >
      <div className="max-w-2xl mx-auto space-y-4 sm:space-y-6">
        {loading ? (
          <div className="space-y-4">
            <div className="h-32 rounded-[var(--card-radius)] bg-[var(--card-bg)] border border-[var(--card-border)] animate-pulse" />
            <div className="h-[400px] rounded-[var(--card-radius)] bg-[var(--card-bg)] border border-[var(--card-border)] animate-pulse" />
          </div>
        ) : error ? (
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
        ) : profile ? (
          <>
            <Card>
              <CardContent className="pt-[var(--card-padding)]">
                <div className="flex justify-end">
                  {!isEditing && (
                    <button
                      type="button"
                      onClick={startEditing}
                      className="flex items-center gap-1.5 text-xs font-medium text-[var(--primary)] hover:opacity-80 transition-opacity"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      {t("تعديل", "Edit")}
                    </button>
                  )}
                </div>

                <div className="flex flex-col items-center py-2">
                  <div className="relative">
                    {avatarPreview || profile.avatar_url ? (
                      <img
                        src={avatarPreview ?? profile.avatar_url ?? undefined}
                        alt=""
                        className="w-20 h-20 rounded-full object-cover border-4 border-[var(--primary)]/20"
                      />
                    ) : (
                      <div className="w-20 h-20 rounded-full bg-[var(--primary)]/[0.12] flex items-center justify-center text-xl sm:text-2xl font-bold text-[var(--primary)]">
                        {initials}
                      </div>
                    )}
                    {isEditing && (
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="absolute bottom-0 end-0 flex items-center justify-center w-7 h-7 rounded-full bg-[var(--primary)] text-white shadow-md hover:opacity-90"
                        aria-label={t("تغيير الصورة", "Change photo")}
                      >
                        <Camera className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={handleAvatarChange}
                    />
                  </div>
                  <h2 className="text-xl font-bold text-[var(--text-primary)] mt-3">
                    {profile.full_name ?? "—"}
                  </h2>
                  {profile.class_name && (
                    <Badge variant="primary" size="sm" className="mt-1.5">
                      {profile.class_name}
                    </Badge>
                  )}
                </div>

                {isEditing && (
                  <div className="mt-4 space-y-3 border-t border-[var(--card-border)] pt-4">
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-[var(--text-muted)]">
                        {t("رقم هاتف الطالب", "Student Phone")}
                      </label>
                      <input
                        type="tel"
                        dir="ltr"
                        value={editPhone}
                        onChange={(e) => setEditPhone(e.target.value)}
                        className="w-full rounded-xl border border-[var(--card-border)] bg-[var(--surface-soft)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 transition-all"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-[var(--text-muted)]">
                        {t("البريد الشخصي", "Personal Email")}
                      </label>
                      <input
                        type="email"
                        dir="ltr"
                        value={editPersonalEmail}
                        onChange={(e) => setEditPersonalEmail(e.target.value)}
                        className="w-full rounded-xl border border-[var(--card-border)] bg-[var(--surface-soft)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 transition-all"
                      />
                    </div>

                    {saveError && (
                      <p className="text-xs text-[var(--danger)] bg-[var(--danger)]/[0.08] rounded-lg px-3 py-2">
                        {saveError}
                      </p>
                    )}

                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={handleSave}
                        disabled={saving}
                        className="flex-1 rounded-xl bg-[var(--primary)] px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {saving ? t("جاري الحفظ...", "Saving...") : t("حفظ", "Save")}
                      </button>
                      <button
                        type="button"
                        onClick={cancelEditing}
                        disabled={saving}
                        className="flex items-center justify-center gap-1.5 rounded-xl border border-[var(--card-border)] px-4 py-2.5 text-sm font-semibold text-[var(--text-primary)] hover:bg-[var(--surface-soft)] transition-all disabled:opacity-50"
                      >
                        <X className="h-4 w-4" />
                        {t("إلغاء", "Cancel")}
                      </button>
                    </div>
                  </div>
                )}

                {saveSuccess && !isEditing && (
                  <p className="mt-3 text-xs text-[var(--success)] bg-[var(--success)]/[0.08] rounded-lg px-3 py-2 flex items-center gap-1.5 justify-center">
                    <CheckCircle2 size={14} />
                    {t("تم حفظ التعديلات بنجاح", "Changes saved successfully")}
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <User className="h-5 w-5 text-[var(--primary)]" />
                  <CardTitle className="text-sm sm:text-base">
                    {t("المعلومات الشخصية", "Personal Information")}
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <div className="divide-y divide-[var(--card-border)]">
                  {fields.map((f) => {
                    const Icon = f.icon;
                    return (
                      <div
                        key={f.label}
                        className="flex items-center gap-2 sm:gap-3 py-3 first:pt-0 last:pb-0"
                      >
                        <div className="shrink-0 flex items-center justify-center w-9 h-9 rounded-lg bg-[var(--primary)]/[0.08]">
                          <Icon className="h-4 w-4 text-[var(--primary)]" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-[var(--text-muted)]">
                            {f.label}
                          </p>
                          <p
                            className="text-xs sm:text-sm font-medium text-[var(--text-primary)] truncate"
                            dir={f.dir}
                          >
                            {f.value ?? "—"}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </>
        ) : (
          <EmptyState
            icon={
              <User className="h-12 w-12 text-[var(--text-tertiary)]" />
            }
            title={t("لا توجد بيانات", "No profile data")}
          />
        )}
      </div>
    </StudentShell>
  );
}
