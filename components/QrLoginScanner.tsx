"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { QrCode, X, AlertCircle } from "@/lib/icons";

const QR_SCHEME_PREFIX = "schoolapp://login?t=";
const QR_WEB_PATTERN = /^https?:\/\/[^/]+\/[^/]*\/qr-login\?t=(.+)$/;
const QR_CREDENTIAL_PREFIX = "schoolapp://login?";

interface QrLoginScannerProps {
  onSuccess: (profile: any) => void;
  onError: (message: string) => void;
  isRTL: boolean;
}

export function QrLoginScanner({
  onSuccess,
  isRTL,
}: QrLoginScannerProps) {
  const [scanning, setScanning] = useState(false);
  const [loading, setLoading] = useState(false);
  const [scanError, setScanError] = useState("");
  const [debugText, setDebugText] = useState("");
  const scannerRef = useRef<any>(null);
  const handleScanRef = useRef<(text: string) => void>(() => {});
  const t = (ar: string, en: string) => (isRTL ? ar : en);

  const stopScanner = useCallback(async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
      } catch {}
      try {
        scannerRef.current.clear();
      } catch {}
      scannerRef.current = null;
    }
  }, []);

  const handleQrToken = useCallback(
    async (token: string) => {
      if (loading) return;
      setLoading(true);
      setScanError("");
      await stopScanner();
      try {
        const res = await fetch("/api/auth/qr-login", {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.ok || !data?.profile) {
          const reason = data?.reason;
          if (reason === "inactive_account")
            setScanError(t("الحساب غير نشط", "Account is inactive"));
          else if (reason === "invalid_credentials")
            setScanError(t("رمز QR غير صالح", "Invalid QR code"));
          else setScanError(t("فشل تسجيل الدخول", "Login failed"));
          setLoading(false);
          return;
        }
        onSuccess(data.profile);
      } catch {
        setScanError(t("خطأ في الاتصال", "Connection error"));
        setLoading(false);
      }
    },
    [loading, onSuccess, stopScanner, t],
  );

  const handleCredentialLogin = useCallback(
    async (username: string, password: string) => {
      if (loading) return;
      setLoading(true);
      setScanError("");
      await stopScanner();
      try {
        const res = await fetch("/api/auth/student-login", {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: username, password }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.ok || !data?.profile) {
          const reason = data?.reason;
          if (reason === "inactive_account")
            setScanError(t("الحساب غير نشط", "Account is inactive"));
          else if (reason === "invalid_credentials")
            setScanError(
              t("اسم المستخدم أو كلمة المرور غير صحيحة", "Invalid credentials"),
            );
          else setScanError(t("فشل تسجيل الدخول", "Login failed"));
          setLoading(false);
          return;
        }
        onSuccess(data.profile);
      } catch {
        setScanError(t("خطأ في الاتصال", "Connection error"));
        setLoading(false);
      }
    },
    [loading, onSuccess, stopScanner, t],
  );

  const handleScanResult = useCallback(
    (decodedText: string) => {
      if (decodedText.startsWith(QR_SCHEME_PREFIX)) {
        const token = decodedText.slice(QR_SCHEME_PREFIX.length);
        if (token.length > 0) {
          handleQrToken(decodeURIComponent(token));
          return;
        }
      }
      const webMatch = decodedText.match(QR_WEB_PATTERN);
      if (webMatch?.[1]) {
        handleQrToken(decodeURIComponent(webMatch[1]));
        return;
      }
      const webCredMatch = decodedText.match(/^https?:\/\/[^/]+\/[^/]*\/qr-login\?(.+)$/);
      if (webCredMatch) {
        try {
          const qs = new URLSearchParams(webCredMatch[1]);
          const u = qs.get("u");
          const p = qs.get("p");
          if (u && p) {
            handleCredentialLogin(u, p);
            return;
          }
          const tk = qs.get("t");
          if (tk) {
            handleQrToken(tk);
            return;
          }
        } catch {}
      }
      if (decodedText.startsWith(QR_CREDENTIAL_PREFIX)) {
        try {
          const qs = new URLSearchParams(
            decodedText.slice("schoolapp://login?".length),
          );
          const u = qs.get("u");
          const p = qs.get("p");
          if (u && p) {
            handleCredentialLogin(u, p);
            return;
          }
        } catch {}
      }
      if (/^https?:\/\/[^/]+\/[^/]*\/student-login\b/.test(decodedText)) {
        stopScanner();
        window.location.href = decodedText;
        return;
      }
      setScanError(
        t(
          `رمز QR غير معروف: ${decodedText.slice(0, 60)}`,
          `Unknown QR: ${decodedText.slice(0, 60)}`,
        ),
      );
    },
    [handleQrToken, handleCredentialLogin, stopScanner, t],
  );

  handleScanRef.current = handleScanResult;

  const startScanner = useCallback(async () => {
    setScanError("");
    setScanning(true);

    try {
      const { Html5Qrcode } = await import("html5-qrcode");
      const scannerId = "qr-scanner-region";

      await stopScanner();

      const html5QrCode = new Html5Qrcode(scannerId);
      scannerRef.current = html5QrCode;

      await html5QrCode.start(
        { facingMode: "environment" },
        {
          fps: 10,
          qrbox: { width: 250, height: 250 },
          aspectRatio: 1,
        },
        (decodedText) => {
          setDebugText(decodedText.slice(0, 80));
          handleScanRef.current(decodedText);
        },
        () => {},
      );
    } catch (err: any) {
      const msg = err?.message || "";
      if (msg.includes("NotAllowedError") || msg.includes("Permission")) {
        setScanError(
          t("يرجى السماح بالوصول إلى الكاميرا", "Please allow camera access"),
        );
      } else if (msg.includes("NotFoundError")) {
        setScanError(t("لم يتم العثور على كاميرا", "No camera found"));
      } else {
        setScanError(t("تعذر تشغيل الماسح", "Could not start scanner"));
      }
      setScanning(false);
    }
  }, [handleScanResult, stopScanner, t]);

  useEffect(() => {
    return () => {
      stopScanner();
    };
  }, [stopScanner]);

  const handleClose = useCallback(() => {
    stopScanner();
    setScanning(false);
    setScanError("");
    setLoading(false);
  }, [stopScanner]);

  if (loading) {
    return (
      <div className="flex flex-col items-center gap-3 py-8">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-[var(--primary)] border-t-transparent" />
        <p className="text-sm font-semibold text-[var(--text-secondary)]">
          {t("جاري تسجيل الدخول...", "Logging in...")}
        </p>
      </div>
    );
  }

  if (scanning) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-[var(--text-secondary)]">
            {t("وجّه الكاميرا نحو رمز QR", "Point camera at QR code")}
          </p>
          <button
            type="button"
            onClick={handleClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[var(--text-tertiary)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
          >
            <X size={18} />
          </button>
        </div>

        <div
          id="qr-scanner-region"
          className="overflow-hidden rounded-xl border border-[var(--border)]"
        />

        {debugText && (
          <div className="rounded-lg bg-blue-50 px-3 py-2 text-xs font-mono text-blue-800 break-all">
            QR: {debugText}
          </div>
        )}

        {scanError && (
          <div className="flex items-center gap-2 rounded-lg border border-[color-mix(in_srgb,var(--danger)_18%,transparent)] bg-[color-mix(in_srgb,var(--danger)_12%,transparent)] px-3 py-2 text-sm font-semibold text-[var(--danger)]">
            <AlertCircle size={16} />
            {scanError}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="relative flex items-center gap-3">
        <div className="h-px flex-1 bg-[var(--border)]" />
        <span className="text-xs font-semibold text-[var(--text-tertiary)]">
          {t("أو", "or")}
        </span>
        <div className="h-px flex-1 bg-[var(--border)]" />
      </div>

      <button
        type="button"
        onClick={startScanner}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm font-bold text-[var(--text-primary)] transition-all hover:border-[var(--primary)] hover:bg-[var(--primary-soft)] hover:text-[var(--primary)] active:scale-[0.98]"
      >
        <QrCode size={20} />
        {t("تسجيل الدخول بـ QR", "Login with QR Code")}
      </button>

      {scanError && (
        <div className="flex items-center gap-2 rounded-lg border border-[color-mix(in_srgb,var(--danger)_18%,transparent)] bg-[color-mix(in_srgb,var(--danger)_12%,transparent)] px-3 py-2 text-sm font-semibold text-[var(--danger)]">
          <AlertCircle size={16} />
          {scanError}
        </div>
      )}
    </div>
  );
}
