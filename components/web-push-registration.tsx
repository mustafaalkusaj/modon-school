"use client";

import { useEffect, useState } from "react";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export type PushSupport =
  | "unsupported" // browser has no Push API
  | "ios-needs-install" // iPhone/iPad Safari: push only works from the Home Screen app
  | "denied" // user blocked notifications in browser settings
  | "prompt" // can ask — needs a tap
  | "granted";

function isIos() {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isStandalone() {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function getPushSupport(): PushSupport {
  if (typeof window === "undefined") return "unsupported";
  if (isIos() && !isStandalone()) return "ios-needs-install";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    return "unsupported";
  }
  if (Notification.permission === "denied") return "denied";
  if (Notification.permission === "granted") return "granted";
  return "prompt";
}

async function getRegistration() {
  const regs = await navigator.serviceWorker.getRegistrations();
  for (const reg of regs) {
    if (reg.active?.scriptURL && !reg.active.scriptURL.includes("v=2")) {
      await reg.unregister();
    }
  }
  const registration = await navigator.serviceWorker.register("/sw.js?v=2");
  await navigator.serviceWorker.ready;
  return registration;
}

async function saveSubscription(subscription: PushSubscription): Promise<boolean> {
  const key = subscription.toJSON();
  try {
    const res = await fetch("/api/web/push-subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subscription: { endpoint: key.endpoint, keys: key.keys },
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Subscribe this device to Web Push. With `askPermission` it may show the
 * browser's permission dialog — call it only from a tap/click handler, since
 * browsers (Safari always, Chrome increasingly) ignore requests without one.
 */
export async function enablePushNotifications(askPermission: boolean): Promise<boolean> {
  if (!VAPID_PUBLIC_KEY) return false;
  const support = getPushSupport();
  if (support !== "granted" && !(askPermission && support === "prompt")) return false;

  try {
    if (support === "prompt") {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") return false;
    }
    const registration = await getRegistration();
    const subscription =
      (await registration.pushManager.getSubscription()) ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
      }));
    return await saveSubscription(subscription);
  } catch {
    return false;
  }
}

/**
 * Mounted once in the root layout: silently refreshes the subscription when
 * permission was already granted (no dialog). Asking for permission is left
 * to <EnablePushBanner>, which does it from a real tap.
 */
export function WebPushRegistration() {
  useEffect(() => {
    const timer = setTimeout(() => {
      void enablePushNotifications(false);
    }, 3000);
    return () => clearTimeout(timer);
  }, []);

  return null;
}

const DISMISS_KEY = "push-banner-dismissed-at";

/**
 * In-app prompt that explains why notifications matter and turns them on
 * with a tap. On iPhone it explains "Add to Home Screen" first, because
 * Safari only delivers push to installed web apps.
 */
export function EnablePushBanner({ audience }: { audience: "student" | "teacher" }) {
  const [support, setSupport] = useState<PushSupport | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    const s = getPushSupport();
    setSupport(s);
    let dismissedRecently = false;
    try {
      const at = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
      dismissedRecently = Date.now() - at < 3 * 24 * 60 * 60 * 1000;
    } catch {
      // storage unavailable — just show the banner
    }
    if (s === "granted") {
      // Already allowed: make sure this device is saved, then stay hidden.
      void enablePushNotifications(false).then((ok) => setSubscribed(ok));
      setHidden(true);
      return;
    }
    setHidden(dismissedRecently || s === "unsupported" || !VAPID_PUBLIC_KEY);
  }, []);

  if (hidden || subscribed || !support) return null;

  const who = audience === "student" ? "أساتذتك والمدرسة" : "الإدارة";

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // ignore
    }
    setHidden(true);
  };

  return (
    <div className="mb-4 rounded-2xl border border-[var(--primary)]/30 bg-[color-mix(in_srgb,var(--primary)_8%,var(--card-bg))] p-4" dir="rtl">
      <div className="flex items-start gap-3">
        <span className="text-2xl" aria-hidden>🔔</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-[var(--text-primary)]">فعّل الإشعارات على هذا الجهاز</p>
          {support === "ios-needs-install" ? (
            <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">
              على الآيفون تصل الإشعارات فقط بعد إضافة التطبيق للشاشة الرئيسية: اضغط زر المشاركة
              <span className="mx-1 font-bold">⎋</span>
              في Safari ثم «إضافة إلى الشاشة الرئيسية»، وافتح التطبيق من الأيقونة واضغط «تفعيل».
            </p>
          ) : support === "denied" ? (
            <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">
              الإشعارات محظورة لهذا الموقع. افتح إعدادات المتصفح ← إعدادات الموقع ← الإشعارات، واسمح بها ثم أعد فتح الصفحة.
            </p>
          ) : (
            <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">
              حتى تصلك رسائل {who} بصوت حتى لو كان التطبيق مغلقاً.
            </p>
          )}
          <div className="mt-3 flex items-center gap-2">
            {support === "prompt" && (
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  const ok = await enablePushNotifications(true);
                  setBusy(false);
                  setSubscribed(ok);
                  setSupport(getPushSupport());
                }}
                className="rounded-xl bg-[var(--primary)] px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
              >
                {busy ? "جاري التفعيل..." : "تفعيل الإشعارات"}
              </button>
            )}
            <button type="button" onClick={dismiss} className="px-2 py-2 text-xs text-[var(--text-muted)]">
              لاحقاً
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
