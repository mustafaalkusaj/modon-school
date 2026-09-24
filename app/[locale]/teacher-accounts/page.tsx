"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { useRole } from "@/hooks/useRole";
import { useSchoolScope } from "@/hooks/useSchoolScope";
import { fetchWithAuthorizedSession } from "@/lib/authorized-api";
import { Download, Printer, Search, Loader2, UserPlus, QrCode, CreditCard, KeyRound, Copy, Check, GraduationCap, Filter } from "@/lib/icons";
import QRCode from "qrcode";
import { escapeHtml } from "@/lib/export";
import { AppSidebar } from "@/components/AppSidebar";
import { AppShellTopbar } from "@/components/AppShellTopbar";

// Account names come from user-editable records and are written into a
// same-origin window with document.write, so every value must be escaped.
const h = (value: unknown) => escapeHtml(String(value ?? ""));

const SITE_URL = "https://modon-school.com";
const SCHOOL_NAME = "مدارس مدن الأهلية";
const SCHOOL_LOGO = "/logo-modon.jpg";

interface TeacherAccount {
  authUserId: string;
  fullName: string;
  subject: string;
  jobTitle: string;
  username: string;
  password: string;
  appStatus: string;
}

function TeacherAccountsContent() {
  const { profile } = useRole();
  const schoolScope = useSchoolScope(profile);
  const schoolId = schoolScope.selectedSchoolId;

  const [teachers, setTeachers] = useState<TeacherAccount[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [ensuring, setEnsuring] = useState(false);
  const [ensureResult, setEnsureResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [qrLoading, setQrLoading] = useState<Record<string, boolean>>({});
  const [qrUrls, setQrUrls] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const [subjectFilter, setSubjectFilter] = useState<string>("");
  const [printingCards, setPrintingCards] = useState(false);

  const fetchTeachers = useCallback(async () => {
    if (!schoolId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithAuthorizedSession(
        `/api/web/teacher-accounts?schoolId=${schoolId}`,
      );
      const data = await res.json();
      if (!data.ok) {
        const msg = typeof data.error === "string" ? data.error : data.error?.message;
        throw new Error(msg ?? "فشل في تحميل البيانات");
      }
      setTeachers(data.teachers ?? []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "خطأ غير متوقع");
    } finally {
      setLoading(false);
    }
  }, [schoolId]);

  useEffect(() => {
    fetchTeachers();
  }, [fetchTeachers]);

  const handleEnsureAll = useCallback(async () => {
    if (!schoolId || ensuring) return;
    setEnsuring(true);
    setEnsureResult(null);
    try {
      const res = await fetchWithAuthorizedSession(
        `/api/web/teacher-accounts/ensure-all?schoolId=${schoolId}`,
        { method: "POST" },
      );
      const data = await res.json();
      if (!res.ok && !data.ok) {
        const msg = typeof data.error === "string" ? data.error : data.error?.message;
        throw new Error(msg ?? "فشل في إنشاء الحسابات");
      }
      setEnsureResult({ ok: true, message: data.message });
      fetchTeachers();
    } catch (err: unknown) {
      setEnsureResult({
        ok: false,
        message: err instanceof Error ? err.message : "خطأ غير متوقع",
      });
    } finally {
      setEnsuring(false);
    }
  }, [schoolId, ensuring, fetchTeachers]);

  const openQrWindow = useCallback((teacher: TeacherAccount, dataUrl: string) => {
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(`<!DOCTYPE html><html dir="rtl"><head><meta charset="utf-8"/><title>QR - ${h(teacher.fullName)}</title><style>body{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;font-family:sans-serif;}</style></head><body><h2>${h(teacher.fullName)}</h2><img src="${h(dataUrl)}" width="250" height="250"/><p style="color:#666">${h(teacher.username)}</p></body></html>`);
    w.document.close();
  }, []);

  const handleShowQr = useCallback(
    async (teacher: TeacherAccount) => {
      if (!schoolId || !teacher.authUserId || qrLoading[teacher.username]) return;
      if (qrUrls[teacher.username]) {
        openQrWindow(teacher, qrUrls[teacher.username]);
        return;
      }
      setQrLoading((p) => ({ ...p, [teacher.username]: true }));
      try {
        let qrPayload: string;
        const res = await fetchWithAuthorizedSession("/api/admin/qr-tokens", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "generate_qr",
            auth_user_id: teacher.authUserId,
            account_type: "teacher",
            school_id: schoolId,
          }),
        });
        const data = await res.json();
        if (data?.ok && data.token?.token) {
          qrPayload = `${SITE_URL}/ar/qr-login?t=${encodeURIComponent(data.token.token)}`;
        } else {
          qrPayload = `${SITE_URL}/ar/teacher-login`;
        }
        const dataUrl = await QRCode.toDataURL(qrPayload, {
          width: 250,
          margin: 1,
          color: { dark: "#1e1b4b", light: "#ffffff" },
        });
        setQrUrls((p) => ({ ...p, [teacher.username]: dataUrl }));
        openQrWindow(teacher, dataUrl);
      } catch {
        /* skip */
      } finally {
        setQrLoading((p) => ({ ...p, [teacher.username]: false }));
      }
    },
    [schoolId, qrLoading, qrUrls, openQrWindow],
  );

  const handleCopy = useCallback((text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  }, []);

  const filtered = useMemo(() => {
    let list = teachers;
    if (subjectFilter) {
      list = list.filter((t) => t.subject === subjectFilter);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (t) =>
          t.fullName.toLowerCase().includes(q) ||
          t.subject?.toLowerCase().includes(q) ||
          t.username.toLowerCase().includes(q),
      );
    }
    return list;
  }, [teachers, search, subjectFilter]);

  const subjects = useMemo(() => {
    const set = new Set(teachers.map((t) => t.subject).filter(Boolean));
    return Array.from(set).sort();
  }, [teachers]);

  const handleExcelDownload = useCallback(() => {
    const header = "الاسم الكامل\tالمادة\tاسم المستخدم\tكلمة المرور";
    const rows = filtered.map(
      (t) => `${t.fullName}\t${t.subject ?? ""}\t${t.username}\t${t.password}`,
    );
    const content = "﻿" + [header, ...rows].join("\n");
    const blob = new Blob([content], { type: "application/vnd.ms-excel;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `teacher-accounts-${new Date().toISOString().slice(0, 10)}.xls`;
    a.click();
    URL.revokeObjectURL(url);
  }, [filtered]);

  const handlePrint = useCallback(() => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    const rows = filtered
      .map(
        (t, i) =>
          `<tr>
            <td style="padding:8px;border:1px solid #ddd;text-align:center">${i + 1}</td>
            <td style="padding:8px;border:1px solid #ddd">${h(t.fullName)}</td>
            <td style="padding:8px;border:1px solid #ddd;text-align:center">${h(t.subject ?? "")}</td>
            <td style="padding:8px;border:1px solid #ddd;text-align:center;direction:ltr">${h(t.username)}</td>
            <td style="padding:8px;border:1px solid #ddd;text-align:center;direction:ltr">${h(t.password || "—")}</td>
          </tr>`,
      )
      .join("");

    printWindow.document.write(`<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="utf-8"/>
  <title>حسابات الأساتذة</title>
  <style>
    body { font-family: 'Segoe UI', Tahoma, sans-serif; padding: 20px; direction: rtl; }
    h1 { text-align: center; margin-bottom: 20px; font-size: 22px; }
    table { width: 100%; border-collapse: collapse; }
    th { padding: 10px; border: 1px solid #333; background: #f0f0f0; font-weight: bold; }
    td { font-size: 14px; }
    @media print { body { padding: 0; } }
  </style>
</head>
<body>
  <h1>حسابات الأساتذة</h1>
  <p style="text-align:center;color:#666">عدد الأساتذة: ${filtered.length} | تاريخ الطباعة: ${new Date().toLocaleDateString("ar-IQ")}</p>
  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>الاسم الكامل</th>
        <th>المادة</th>
        <th>اسم المستخدم</th>
        <th>كلمة المرور</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`);
    printWindow.document.close();
    printWindow.onload = () => {
      printWindow.print();
    };
  }, [filtered]);

  const buildCardHtml = useCallback(
    (teacher: TeacherAccount, siteQr: string, teacherQr: string) => `
    <div class="card">
      <div class="card-header">
        <img src="${SCHOOL_LOGO}" class="logo" alt="logo"/>
        <div class="school-name">${SCHOOL_NAME}</div>
      </div>
      <div class="card-title">بطاقة دخول الموقع الإلكتروني</div>
      <div class="info-section">
        <div class="info-row">
          <span class="info-label">الاسم الكامل</span>
          <span class="info-value">${h(teacher.fullName)}</span>
        </div>
        <div class="info-row">
          <span class="info-label">المادة</span>
          <span class="info-value">${h(teacher.subject || "—")}</span>
        </div>
      </div>
      <div class="credentials">
        <div class="cred-row">
          <span class="cred-label">اسم المستخدم</span>
          <span class="cred-value" dir="ltr">${h(teacher.username)}</span>
        </div>
        <div class="cred-row">
          <span class="cred-label">كلمة المرور</span>
          <span class="cred-value" dir="ltr">${h(teacher.password || "—")}</span>
        </div>
      </div>
      <div class="qr-row">
        <div class="qr-block">
          <img src="${h(siteQr)}" class="qr-img" alt="QR الموقع"/>
          <div class="qr-label">رابط الموقع</div>
        </div>
        <div class="qr-block">
          <img src="${h(teacherQr)}" class="qr-img" alt="QR الأستاذ"/>
          <div class="qr-label">تسجيل دخول الأستاذ</div>
        </div>
      </div>
      <div class="steps-section">
        <div class="steps-title">طريقة الدخول</div>
        <div class="step"><span class="step-num">١</span> افتح كاميرا الهاتف</div>
        <div class="step"><span class="step-num">٢</span> وجّه الكاميرا نحو رمز QR</div>
        <div class="step"><span class="step-num">٣</span> اضغط على الرابط الذي يظهر</div>
        <div class="step"><span class="step-num">٤</span> أدخل اسم المستخدم وكلمة المرور</div>
        <div class="step"><span class="step-num">٥</span> اضغط "تسجيل الدخول"</div>
      </div>
      <div class="card-footer">modon-school.com</div>
    </div>`,
    [],
  );

  const cardStyles = `
    @page { size: A4; margin: 0; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; direction: rtl; background: #fff; }
    .card {
      width: 210mm; min-height: 297mm; padding: 12mm 18mm;
      display: flex; flex-direction: column; align-items: center;
      page-break-after: always; position: relative; overflow: hidden;
    }
    .card::before {
      content: ''; position: absolute; top: 0; right: 0; left: 0; height: 5px;
      background: linear-gradient(90deg, #4f46e5, #7c3aed, #4f46e5);
    }
    .card-header { display: flex; flex-direction: column; align-items: center; margin-top: 8mm; }
    .logo { width: 22mm; height: auto; }
    .school-name { font-size: 18pt; font-weight: 800; color: #1a1a1a; margin-top: 3mm; }
    .card-title {
      font-size: 13pt; color: #fff; background: #4f46e5; padding: 6px 30px;
      border-radius: 12px; margin-top: 5mm; font-weight: 700; letter-spacing: 0.5px;
    }
    .info-section { width: 100%; margin-top: 8mm; max-width: 160mm; }
    .info-row {
      display: flex; justify-content: space-between; padding: 6px 0;
      border-bottom: 1px dashed #e5e7eb; font-size: 13pt;
    }
    .info-label { color: #6b7280; font-weight: 500; }
    .info-value { color: #111827; font-weight: 700; }
    .credentials {
      width: 100%; max-width: 160mm;
      background: #eef2ff; border: 1.5px solid #c7d2fe; border-radius: 8px;
      padding: 4mm 6mm; margin-top: 5mm;
    }
    .cred-row {
      display: flex; justify-content: space-between; align-items: center;
      padding: 4px 0; font-size: 13pt;
    }
    .cred-label { color: #3730a3; font-weight: 700; }
    .cred-value {
      font-family: 'Courier New', monospace; font-size: 14pt; font-weight: 800;
      color: #1e1b4b; letter-spacing: 1px;
    }
    .qr-row {
      display: flex; justify-content: center; gap: 16mm;
      margin-top: 8mm; width: 100%;
    }
    .qr-block { display: flex; flex-direction: column; align-items: center; }
    .qr-img { width: 40mm; height: 40mm; }
    .qr-label { font-size: 9pt; color: #6b7280; margin-top: 2mm; font-weight: 600; }
    .steps-section {
      width: 100%; max-width: 160mm; background: #fafafa; border: 1px solid #e5e7eb;
      border-radius: 8px; padding: 5mm 6mm; margin-top: 8mm;
    }
    .steps-title { font-size: 11pt; font-weight: 800; color: #4f46e5; margin-bottom: 4px; text-align: center; }
    .step { font-size: 10pt; color: #374151; padding: 3px 0; display: flex; align-items: center; gap: 6px; }
    .step-num {
      display: inline-flex; align-items: center; justify-content: center;
      width: 18px; height: 18px; border-radius: 50%; background: #4f46e5;
      color: #fff; font-size: 9pt; font-weight: 700; flex-shrink: 0;
    }
    .card-footer {
      margin-top: auto; padding-bottom: 6mm;
      font-size: 11pt; color: #9ca3af; font-weight: 600; letter-spacing: 1.5px; direction: ltr;
    }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  `;

  const openPrintCards = useCallback(
    async (teachersList: TeacherAccount[]) => {
      if (teachersList.length === 0 || !schoolId) return;
      setPrintingCards(true);
      try {
        let siteQr: string;
        try {
          siteQr = await QRCode.toDataURL(SITE_URL, {
            width: 300, margin: 1, color: { dark: "#000000", light: "#ffffff" },
          });
        } catch {
          siteQr = "";
        }

        const authUserIds = teachersList
          .map((t) => t.authUserId)
          .filter((id): id is string => !!id);

        let tokenMap: Record<string, string> = {};
        if (authUserIds.length > 0) {
          try {
            const res = await fetchWithAuthorizedSession("/api/admin/qr-tokens", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "bulk_generate",
                auth_user_ids: authUserIds,
                account_type: "teacher",
                school_id: schoolId,
              }),
            });
            const data = await res.json();
            if (data?.ok && data.tokens) {
              tokenMap = data.tokens;
            }
          } catch { /* continue without tokens */ }
        }

        // QR generation is CPU-bound, so batch it: a whole-school print would
        // otherwise lock the tab for the entire run.
        const QR_BATCH = 50;
        const results: { teacher: TeacherAccount; qr: string }[] = [];
        for (let i = 0; i < teachersList.length; i += QR_BATCH) {
          const batch = teachersList.slice(i, i + QR_BATCH);
          const settled = await Promise.allSettled(
            batch.map(async (t) => {
              let qrPayload = `${SITE_URL}/ar/teacher-login`;
              if (t.authUserId && tokenMap[t.authUserId]) {
                qrPayload = `${SITE_URL}/ar/qr-login?t=${encodeURIComponent(tokenMap[t.authUserId])}`;
              }
              const qr = await QRCode.toDataURL(qrPayload, {
                width: 300, margin: 1, color: { dark: "#000000", light: "#ffffff" },
              });
              return { teacher: t, qr };
            }),
          );
          for (const r of settled) {
            if (r.status === "fulfilled") results.push(r.value);
          }
        }

        const cardsHtml = results.map((r) => buildCardHtml(r.teacher, siteQr, r.qr));
        const pw = window.open("", "_blank");
        if (!pw) return;
        pw.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8"/><title>بطاقات دخول الأساتذة</title><style>${cardStyles}</style></head><body>${cardsHtml.join("\n")}</body></html>`);
        pw.document.close();
        pw.onload = () => pw.print();
      } finally {
        setPrintingCards(false);
      }
    },
    [buildCardHtml, cardStyles, schoolId],
  );

  const handlePrintCard = useCallback(
    (teacher: TeacherAccount) => openPrintCards([teacher]),
    [openPrintCards],
  );

  const handlePrintCards = useCallback(
    () => openPrintCards(filtered),
    [openPrintCards, filtered],
  );

  const withPassword = useMemo(() => teachers.filter((t) => t.password).length, [teachers]);
  const withoutPassword = teachers.length - withPassword;

  const shellContent = loading ? (
    <div className="flex flex-col items-center justify-center min-h-[400px] gap-3">
      <Loader2 className="h-10 w-10 animate-spin text-[var(--primary)]" />
      <span className="text-sm text-[var(--text-secondary)]">جاري تحميل حسابات الأساتذة...</span>
    </div>
  ) : error ? (
    <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
      <div className="w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
        <KeyRound className="h-8 w-8 text-red-500" />
      </div>
      <p className="text-red-600 dark:text-red-400 text-lg font-medium">{error}</p>
      <button
        onClick={fetchTeachers}
        className="px-5 py-2.5 bg-[var(--primary)] text-white rounded-xl hover:opacity-90 transition-opacity font-medium text-sm"
      >
        إعادة المحاولة
      </button>
    </div>
  ) : (
    <div className="p-3 sm:p-4 md:p-6 max-w-7xl mx-auto space-y-4 sm:space-y-5">

      {/* Hero Banner */}
      <div
        className="relative rounded-xl sm:rounded-2xl overflow-hidden p-4 sm:p-6 md:p-8"
        style={{
          background: "linear-gradient(135deg, var(--primary) 0%, color-mix(in srgb, var(--primary) 60%, #6366f1) 100%)",
        }}
      >
        <div className="absolute top-0 end-0 w-48 sm:w-72 h-48 sm:h-72 rounded-full opacity-[0.08] pointer-events-none" style={{ background: "white", transform: "translate(35%, -40%)" }} />
        <div className="absolute bottom-0 start-12 w-32 sm:w-48 h-32 sm:h-48 rounded-full opacity-[0.06] pointer-events-none" style={{ background: "white", transform: "translateY(60%)" }} />
        <div className="relative flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-white/60 text-[10px] sm:text-xs font-medium mb-1 sm:mb-2 tracking-widest uppercase">
              لوحة الإدارة · حسابات الأساتذة
            </p>
            <h1 className="text-xl sm:text-2xl md:text-3xl font-black text-white mb-1 sm:mb-1.5 leading-tight">
              حسابات الأساتذة
            </h1>
            <p className="text-white/70 text-xs sm:text-sm hidden sm:block">
              إدارة بيانات الدخول وطباعة بطاقات تسجيل الدخول للأساتذة
            </p>
            <div className="flex flex-wrap gap-1.5 sm:gap-2 mt-2 sm:mt-3">
              <span className="inline-flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-0.5 sm:py-1 rounded-full text-[10px] sm:text-xs font-semibold" style={{ background: "rgba(255,255,255,0.18)", color: "white" }}>
                <GraduationCap size={10} className="sm:w-3 sm:h-3" />
                {teachers.length} أستاذ
              </span>
              <span className="inline-flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-0.5 sm:py-1 rounded-full text-[10px] sm:text-xs font-semibold" style={{ background: "rgba(255,255,255,0.18)", color: "white" }}>
                <KeyRound size={10} className="sm:w-3 sm:h-3" />
                {withPassword} فعّال
              </span>
              {withoutPassword > 0 && (
                <span className="inline-flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-0.5 sm:py-1 rounded-full text-[10px] sm:text-xs font-semibold" style={{ background: "rgba(255,200,50,0.25)", color: "#fef08a" }}>
                  {withoutPassword} بدون مرور
                </span>
              )}
            </div>
          </div>
          <div className="hidden md:flex items-center justify-center w-20 h-20 rounded-2xl flex-shrink-0" style={{ background: "rgba(255,255,255,0.15)", backdropFilter: "blur(8px)" }}>
            <GraduationCap size={38} className="text-white" />
          </div>
        </div>
      </div>

      {/* Ensure-all warning */}
      {withoutPassword > 0 && (
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3 sm:p-4 rounded-xl sm:rounded-2xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-800/40 flex items-center justify-center flex-shrink-0">
              <UserPlus className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">{withoutPassword} أستاذ بدون كلمة مرور</p>
              <p className="text-xs text-amber-700 dark:text-amber-300">يمكنك إنشاء حسابات لجميع الأساتذة دفعة واحدة</p>
            </div>
          </div>
          <button
            onClick={handleEnsureAll}
            disabled={ensuring}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-amber-600 text-white rounded-xl hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-semibold whitespace-nowrap transition-colors"
          >
            {ensuring ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
            {ensuring ? "جاري الإنشاء..." : "إنشاء الحسابات"}
          </button>
        </div>
      )}

      {ensureResult && (
        <div className={`p-4 rounded-2xl text-sm border flex items-center gap-3 ${
          ensureResult.ok
            ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-800 dark:text-green-200"
            : "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-800 dark:text-red-200"
        }`}>
          <Check className="h-5 w-5 flex-shrink-0" />
          {ensureResult.message}
        </div>
      )}

      {/* Main Content Card */}
      <div className="bg-[var(--surface)] rounded-xl sm:rounded-2xl border border-[var(--border)] p-3 sm:p-5 space-y-3 sm:space-y-4">

        {/* Toolbar */}
        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row gap-2 sm:gap-2">
            <div className="relative flex-1">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-tertiary)]" />
              <input
                type="text"
                placeholder="بحث بالاسم أو المادة أو اسم المستخدم..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pr-10 pl-4 py-2 sm:py-2 border border-[var(--border)] rounded-xl bg-[var(--surface)] text-[var(--text-primary)] text-sm focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent transition-shadow"
              />
            </div>
            <div className="relative w-full sm:w-auto">
              <Filter className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--text-tertiary)] pointer-events-none" />
              <select
                value={subjectFilter}
                onChange={(e) => setSubjectFilter(e.target.value)}
                className="w-full sm:w-auto appearance-none pr-9 pl-6 py-2 border border-[var(--border)] rounded-xl bg-[var(--surface)] text-[var(--text-primary)] text-sm focus:ring-2 focus:ring-[var(--primary)] cursor-pointer"
              >
                <option value="">كل المواد</option>
                {subjects.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handleExcelDownload}
              disabled={filtered.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] disabled:opacity-40 disabled:cursor-not-allowed text-xs font-medium transition-colors"
            >
              <Download className="h-3.5 w-3.5" />
              <span className="hidden xs:inline">Excel</span>
            </button>
            <button
              onClick={handlePrint}
              disabled={filtered.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] disabled:opacity-40 disabled:cursor-not-allowed text-xs font-medium transition-colors"
            >
              <Printer className="h-3.5 w-3.5" />
              طباعة
            </button>
            <button
              onClick={handlePrintCards}
              disabled={filtered.length === 0 || printingCards}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[var(--primary)] text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-semibold transition-opacity"
            >
              {printingCards ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <CreditCard className="h-3.5 w-3.5" />
              )}
              {printingCards ? "جاري التحضير..." : "طباعة بطاقات"}
            </button>
          </div>
        </div>

        {/* Results count */}
        {(search || subjectFilter) && (
          <p className="text-xs text-[var(--text-tertiary)]">
            عرض {filtered.length} من {teachers.length} أستاذ
            {subjectFilter && <> · المادة: <strong>{subjectFilter}</strong></>}
          </p>
        )}

        {/* Table */}
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <div className="w-14 h-14 rounded-2xl bg-[var(--surface-hover)] flex items-center justify-center">
              <Search className="h-6 w-6 text-[var(--text-tertiary)]" />
            </div>
            <p className="text-sm text-[var(--text-secondary)] font-medium">
              {teachers.length === 0 ? "لا توجد حسابات أساتذة" : "لا توجد نتائج تطابق البحث"}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-[var(--border)] -mx-3 sm:mx-0">
            <table className="w-full text-sm min-w-[600px]">
              <thead>
                <tr className="bg-[var(--surface-soft)]">
                  <th className="px-2 sm:px-4 py-2.5 sm:py-3 text-right text-[10px] sm:text-xs font-semibold text-[var(--text-tertiary)] uppercase tracking-wider w-10 sm:w-12">#</th>
                  <th className="px-2 sm:px-4 py-2.5 sm:py-3 text-right text-[10px] sm:text-xs font-semibold text-[var(--text-tertiary)] uppercase tracking-wider">الاسم</th>
                  <th className="px-2 sm:px-4 py-2.5 sm:py-3 text-right text-[10px] sm:text-xs font-semibold text-[var(--text-tertiary)] uppercase tracking-wider">المادة</th>
                  <th className="px-2 sm:px-4 py-2.5 sm:py-3 text-right text-[10px] sm:text-xs font-semibold text-[var(--text-tertiary)] uppercase tracking-wider">اسم المستخدم</th>
                  <th className="px-2 sm:px-4 py-2.5 sm:py-3 text-right text-[10px] sm:text-xs font-semibold text-[var(--text-tertiary)] uppercase tracking-wider">كلمة المرور</th>
                  <th className="px-2 sm:px-4 py-2.5 sm:py-3 text-center text-[10px] sm:text-xs font-semibold text-[var(--text-tertiary)] uppercase tracking-wider w-20 sm:w-28">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {filtered.map((t, i) => (
                  <tr key={`${t.username}-${i}`} className="hover:bg-[var(--surface-hover)] transition-colors">
                    <td className="px-2 sm:px-4 py-2.5 sm:py-3 text-[var(--text-tertiary)] text-center text-xs">{i + 1}</td>
                    <td className="px-2 sm:px-4 py-2.5 sm:py-3">
                      <span className="font-medium text-[var(--text-primary)]">{t.fullName}</span>
                    </td>
                    <td className="px-2 sm:px-4 py-2.5 sm:py-3">
                      <span className="inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium bg-[var(--surface-soft)] text-[var(--text-secondary)] border border-[var(--border)]">
                        {t.subject || "—"}
                      </span>
                    </td>
                    <td className="px-2 sm:px-4 py-2.5 sm:py-3" dir="ltr">
                      <button
                        onClick={() => handleCopy(t.username, `u-${t.username}`)}
                        className="group inline-flex items-center gap-1.5 font-mono text-xs text-[var(--text-secondary)] hover:text-[var(--primary)] transition-colors"
                        title="نسخ اسم المستخدم"
                      >
                        {t.username}
                        {copied === `u-${t.username}` ? (
                          <Check className="h-3 w-3 text-green-500" />
                        ) : (
                          <Copy className="h-3 w-3 opacity-0 group-hover:opacity-60 transition-opacity" />
                        )}
                      </button>
                    </td>
                    <td className="px-2 sm:px-4 py-2.5 sm:py-3" dir="ltr">
                      {t.password ? (
                        <button
                          onClick={() => handleCopy(t.password, `p-${t.username}`)}
                          className="group inline-flex items-center gap-1.5 font-mono text-xs transition-colors"
                          title="نسخ كلمة المرور"
                        >
                          <span className="px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 font-semibold border border-emerald-200 dark:border-emerald-800">
                            {t.password}
                          </span>
                          {copied === `p-${t.username}` ? (
                            <Check className="h-3 w-3 text-green-500" />
                          ) : (
                            <Copy className="h-3 w-3 text-[var(--text-tertiary)] opacity-0 group-hover:opacity-60 transition-opacity" />
                          )}
                        </button>
                      ) : (
                        <span className="text-xs text-[var(--text-tertiary)] italic">غير متوفرة</span>
                      )}
                    </td>
                    <td className="px-2 sm:px-4 py-2.5 sm:py-3">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => handlePrintCard(t)}
                          className="inline-flex items-center justify-center w-8 h-8 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 transition-colors"
                          title="طباعة بطاقة"
                        >
                          <CreditCard className="h-4 w-4" />
                        </button>
                        {t.authUserId && (
                          <button
                            onClick={() => handleShowQr(t)}
                            disabled={qrLoading[t.username]}
                            className="inline-flex items-center justify-center w-8 h-8 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 disabled:opacity-50 transition-colors"
                            title="عرض رمز QR"
                          >
                            {qrLoading[t.username] ? <Loader2 className="h-4 w-4 animate-spin" /> : <QrCode className="h-4 w-4" />}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-[var(--surface-soft)]">
      <AppSidebar currentPath="/teacher-accounts" />
      <div className="flex-1 flex flex-col min-w-0">
        <AppShellTopbar title="حسابات الأساتذة" />
        <main className="app-shell-frame--with-fixed-topbar flex-1 overflow-y-auto">
          {shellContent}
        </main>
      </div>
    </div>
  );
}

export default function TeacherAccountsPage() {
  return (
    <ProtectedRoute roles={["admin", "super_admin"]}>
      <TeacherAccountsContent />
    </ProtectedRoute>
  );
}
