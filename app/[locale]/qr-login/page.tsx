"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale } from "next-intl";
import { SchoolLogo } from "@/components/brand";
import { DEFAULT_PATH_BY_ROLE, type UserRole } from "@/types/roles";

export default function QrLoginPage() {
  const router = useRouter();
  const locale = useLocale();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"processing" | "error" | "no-token">("processing");
  const attempted = useRef(false);
  const isAr = locale === "ar";

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;

    // Only the opaque token is accepted. Username/password pairs in the URL
    // are never read, so they cannot leak through history or referrers.
    const token = searchParams.get("t");

    if (token) {
      loginWithToken(token);
    } else {
      setError(isAr ? "رابط QR غير صالح" : "Invalid QR link");
      setStatus("no-token");
    }
  }, []);

  async function loginWithToken(token: string) {
    try {
      const res = await fetch("/api/auth/qr-login", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json().catch(() => null);

      if (res.ok && data?.ok) {
        const role = data.profile?.role as UserRole | undefined;
        const dest = (role && DEFAULT_PATH_BY_ROLE[role]) || "/student";
        router.replace(`/${locale}${dest}`);
        return;
      }

      const code = data?.code;
      if (code === "QR_LOGIN_INVALID_TOKEN") {
        setError(isAr ? "رمز QR غير صالح أو منتهي الصلاحية" : "Invalid or expired QR code");
      } else if (code === "QR_LOGIN_PROFILE_INACTIVE") {
        setError(isAr ? "الحساب معطل، راجع إدارة المدرسة" : "Account is disabled");
      } else {
        setError(isAr ? "فشل تسجيل الدخول" : "Login failed");
      }
      setStatus("error");
    } catch {
      setError(isAr ? "خطأ في الاتصال" : "Connection error");
      setStatus("error");
    }
  }

  return (
    <div
      dir={isAr ? "rtl" : "ltr"}
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(135deg, #065F46 0%, #047857 30%, #10B981 100%)",
        padding: "1rem",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: "1.5rem",
          boxShadow: "0 25px 50px -12px rgba(0,0,0,0.25)",
          width: "100%",
          maxWidth: "420px",
          padding: "2.5rem 2rem",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "1.5rem",
          textAlign: "center",
        }}
      >
        <div
          style={{
            width: 72,
            height: 72,
            borderRadius: "1rem",
            overflow: "hidden",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#D1FAE5",
          }}
        >
          <SchoolLogo size={56} alt="" />
        </div>

        {status === "processing" && (
          <>
            <div
              style={{
                width: 40,
                height: 40,
                border: "4px solid #10B981",
                borderTopColor: "transparent",
                borderRadius: "50%",
                animation: "qr-spin 0.8s linear infinite",
              }}
            />
            <style>{`@keyframes qr-spin { to { transform: rotate(360deg) } }`}</style>
            <p style={{ fontSize: "1.1rem", fontWeight: 600, color: "#065F46", margin: 0 }}>
              {isAr ? "جاري تسجيل الدخول..." : "Signing in..."}
            </p>
          </>
        )}

        {(status === "error" || status === "no-token") && (
          <>
            <div
              style={{
                width: "100%",
                background: "#FEF2F2",
                color: "#DC2626",
                padding: "0.75rem 1rem",
                borderRadius: "0.75rem",
                fontSize: "0.95rem",
                border: "1px solid #FECACA",
              }}
            >
              {error}
            </div>
            <a
              href={`/${locale}/student-login`}
              style={{
                display: "inline-block",
                padding: "0.75rem 2rem",
                background: "#065F46",
                color: "#fff",
                borderRadius: "0.75rem",
                fontSize: "0.95rem",
                fontWeight: 600,
                textDecoration: "none",
              }}
            >
              {isAr ? "تسجيل الدخول يدوياً" : "Login manually"}
            </a>
          </>
        )}
      </div>
    </div>
  );
}
