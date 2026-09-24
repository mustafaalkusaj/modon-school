"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale } from "next-intl";
import { SchoolLogo } from "@/components/brand";

export default function QrLoginPage() {
  const router = useRouter();
  const locale = useLocale();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"processing" | "error">("processing");
  const attempted = useRef(false);
  const isAr = locale === "ar";

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;

    const token = searchParams.get("t");
    const username = searchParams.get("u");
    const password = searchParams.get("p");

    if (token) {
      loginWithToken(token);
    } else if (username && password) {
      loginWithCredentials(username, password);
    } else {
      setError(isAr ? "رابط QR غير صالح" : "Invalid QR link");
      setStatus("error");
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
        router.replace(`/${locale}/student`);
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

  async function loginWithCredentials(username: string, password: string) {
    try {
      const res = await fetch("/api/auth/student-login", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: username, password }),
      });
      const data = await res.json().catch(() => null);

      if (res.ok && data?.ok) {
        router.replace(`/${locale}/student`);
        return;
      }

      const reason = data?.reason;
      if (reason === "inactive_account") {
        setError(isAr ? "الحساب معطل، راجع إدارة المدرسة" : "Account is disabled");
      } else if (reason === "invalid_credentials") {
        setError(isAr ? "بيانات الدخول غير صحيحة" : "Invalid credentials");
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

        {status === "error" && (
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
