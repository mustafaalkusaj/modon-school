"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { useRole } from "@/hooks/useRole";
import { useSchoolScope } from "@/hooks/useSchoolScope";
import { fetchWithAuthorizedSession } from "@/lib/authorized-api";
import { Download, Printer, Search, Loader2, UserPlus, QrCode, CreditCard, KeyRound, Users, Copy, Check, Filter } from "lucide-react";
import QRCode from "qrcode";
import { escapeHtml } from "@/lib/export";
import { AppSidebar } from "@/components/AppSidebar";
import { AppShellTopbar } from "@/components/AppShellTopbar";
import { SchoolScopeEmptyState } from "@/components/SchoolScopeBanner";

// Account names come from user-editable records and are written into a
// same-origin window with document.write, so every value must be escaped.
const h = (value: unknown) => escapeHtml(String(value ?? ""));

interface StudentAccount {
  studentId: string;
  authUserId: string | null;
  fullName: string;
  className: string;
  username: string;
  password: string;
  hasAccount: boolean;
}

function StudentAccountsContent() {
  const { profile } = useRole();
  const schoolScope = useSchoolScope(profile);
  const schoolId = schoolScope.selectedSchoolId;

  const [students, setStudents] = useState<StudentAccount[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [classFilter, setClassFilter] = useState<string>("");
  const [withoutAccount, setWithoutAccount] = useState(0);
  const [provisioning, setProvisioning] = useState(false);
  const [provisionResult, setProvisionResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const [qrLoading, setQrLoading] = useState<Record<string, boolean>>({});
  const [qrUrls, setQrUrls] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState<string | null>(null);

  const fetchStudents = useCallback(async () => {
    if (!schoolId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithAuthorizedSession(
        `/api/web/student-accounts?schoolId=${schoolId}`,
      );
      const data = await res.json();
      if (!data.ok) {
        const msg = typeof data.error === "string" ? data.error : data.error?.message;
        throw new Error(msg ?? "فشل في تحميل البيانات");
      }
      setStudents(data.students ?? []);
      setWithoutAccount(typeof data.without_account === "number" ? data.without_account : 0);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "خطأ غير متوقع");
    } finally {
      setLoading(false);
    }
  }, [schoolId]);

  useEffect(() => {
    if (schoolScope.scopeLoading || schoolScope.shouldBlockContent) return;
    fetchStudents();
  }, [fetchStudents, schoolScope.scopeLoading, schoolScope.shouldBlockContent]);

  const handleProvisionAll = useCallback(async () => {
    if (!schoolId || provisioning) return;
    setProvisioning(true);
    setProvisionResult(null);
    try {
      const res = await fetchWithAuthorizedSession(
        "/api/web/student-accounts/ensure-all",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ schoolId }),
        },
      );
      const data = await res.json();
      if (!data.ok) {
        const msg = typeof data.error === "string" ? data.error : data.error?.message;
        throw new Error(msg ?? "فشل في إنشاء الحسابات");
      }
      const parts: string[] = [];
      if (data.created > 0) parts.push(`تم إنشاء ${data.created} حساب`);
      if (data.ensured > 0) parts.push(`تم تأكيد ${data.ensured} حساب`);
      if (data.failed > 0) parts.push(`فشل ${data.failed} حساب`);
      setProvisionResult({
        ok: true,
        message: parts.length > 0 ? parts.join(" · ") : (data.message ?? "جميع الطلبة لديهم حسابات بالفعل."),
      });
      fetchStudents();
    } catch (err: unknown) {
      setProvisionResult({
        ok: false,
        message: err instanceof Error ? err.message : "خطأ غير متوقع",
      });
    } finally {
      setProvisioning(false);
    }
  }, [schoolId, provisioning, fetchStudents]);

  const handleShowQr = useCallback(
    async (student: StudentAccount) => {
      if (!schoolId || !student.authUserId || qrLoading[student.username]) return;
      if (qrUrls[student.username]) {
        const w = window.open("", "_blank");
        if (!w) return;
        w.document.write(`<!DOCTYPE html><html dir="rtl"><head><meta charset="utf-8"/><title>QR - ${h(student.fullName)}</title><style>body{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;font-family:sans-serif;}</style></head><body><h2>${h(student.fullName)}</h2><img src="${h(qrUrls[student.username])}" width="250" height="250"/><p style="color:#666">${h(student.username)}</p></body></html>`);
        w.document.close();
        return;
      }
      setQrLoading((p) => ({ ...p, [student.username]: true }));
      try {
        let qrPayload: string;
        const res = await fetchWithAuthorizedSession("/api/admin/qr-tokens", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "generate_qr", auth_user_id: student.authUserId, school_id: schoolId }),
        });
        const data = await res.json();
        if (data?.ok && data.token?.token) {
          qrPayload = `https://modon-school.com/ar/qr-login?t=${encodeURIComponent(data.token.token)}`;
        } else {
          qrPayload = student.password
            ? `https://modon-school.com/ar/qr-login?u=${encodeURIComponent(student.username)}&p=${encodeURIComponent(student.password)}`
            : `https://modon-school.com/ar/student-login`;
        }
        const dataUrl = await QRCode.toDataURL(qrPayload, {
          width: 250,
          margin: 1,
          color: { dark: "#000000", light: "#ffffff" },
        });
        setQrUrls((p) => ({ ...p, [student.username]: dataUrl }));
        const w = window.open("", "_blank");
        if (!w) return;
        w.document.write(`<!DOCTYPE html><html dir="rtl"><head><meta charset="utf-8"/><title>QR - ${h(student.fullName)}</title><style>body{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;font-family:sans-serif;}</style></head><body><h2>${h(student.fullName)}</h2><img src="${h(dataUrl)}" width="250" height="250"/><p style="color:#666">${h(student.username)}</p></body></html>`);
        w.document.close();
      } catch {
        /* skip */
      } finally {
        setQrLoading((p) => ({ ...p, [student.username]: false }));
      }
    },
    [schoolId, qrLoading, qrUrls],
  );

  const handleCopy = useCallback((text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  }, []);

  const filtered = useMemo(() => {
    let list = students;
    if (classFilter) {
      list = list.filter((s) => s.className === classFilter);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (s) =>
          s.fullName.toLowerCase().includes(q) ||
          s.className?.toLowerCase().includes(q) ||
          s.username.toLowerCase().includes(q),
      );
    }
    return list;
  }, [students, search, classFilter]);

  const classes = useMemo(() => {
    const set = new Set(students.map((s) => s.className).filter(Boolean));
    return Array.from(set).sort();
  }, [students]);

  const handleExcelDownload = useCallback(() => {
    const header = "الاسم الكامل\tالصف\tاسم المستخدم\tكلمة المرور";
    const rows = filtered.map(
      (s) => `${s.fullName}\t${s.className ?? ""}\t${s.username}\t${s.password}`,
    );
    const content = "﻿" + [header, ...rows].join("\n");
    const blob = new Blob([content], {
      type: "application/vnd.ms-excel;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `student-accounts-${new Date().toISOString().slice(0, 10)}.xls`;
    a.click();
    URL.revokeObjectURL(url);
  }, [filtered]);

  const handlePrint = useCallback(() => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    const rows = filtered
      .map(
        (s, i) =>
          `<tr>
            <td style="padding:8px;border:1px solid #ddd;text-align:center">${i + 1}</td>
            <td style="padding:8px;border:1px solid #ddd">${h(s.fullName)}</td>
            <td style="padding:8px;border:1px solid #ddd;text-align:center">${h(s.className ?? "")}</td>
            <td style="padding:8px;border:1px solid #ddd;text-align:center;direction:ltr">${h(s.username)}</td>
            <td style="padding:8px;border:1px solid #ddd;text-align:center;direction:ltr">${h(s.password || "—")}</td>
          </tr>`,
      )
      .join("");

    printWindow.document.write(`<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="utf-8"/>
  <title>حسابات الطلبة</title>
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
  <h1>حسابات الطلبة</h1>
  <p style="text-align:center;color:#666">عدد الطلبة: ${filtered.length} | تاريخ الطباعة: ${new Date().toLocaleDateString("ar-IQ")}</p>
  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>الاسم الكامل</th>
        <th>الصف</th>
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
    (student: StudentAccount, siteQr: string, studentQr: string) => `
    <div class="card">
      <div class="card-header">
        <img src="/logo-modon.jpg" class="logo" alt="logo"/>
        <div class="school-name">مدارس مدن الأهلية</div>
      </div>
      <div class="card-title">بطاقة دخول الموقع الإلكتروني</div>
      <div class="info-section">
        <div class="info-row">
          <span class="info-label">الاسم الكامل</span>
          <span class="info-value">${h(student.fullName)}</span>
        </div>
        <div class="info-row">
          <span class="info-label">الصف</span>
          <span class="info-value">${h(student.className || "—")}</span>
        </div>
      </div>
      <div class="credentials">
        <div class="cred-row">
          <span class="cred-label">اسم المستخدم</span>
          <span class="cred-value" dir="ltr">${h(student.username)}</span>
        </div>
        <div class="cred-row">
          <span class="cred-label">كلمة المرور</span>
          <span class="cred-value" dir="ltr">${h(student.password || "—")}</span>
        </div>
      </div>
      <div class="qr-row">
        <div class="qr-block">
          <img src="${h(siteQr)}" class="qr-img" alt="QR"/>
          <div class="qr-label">رابط الموقع</div>
        </div>
        <div class="qr-block">
          <img src="${h(studentQr)}" class="qr-img" alt="QR"/>
          <div class="qr-label">تسجيل دخول الطالب</div>
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
    async (studentsList: StudentAccount[]) => {
      if (studentsList.length === 0 || !schoolId) return;
      const siteUrl = "https://modon-school.com";
      let siteQr: string;
      try {
        siteQr = await QRCode.toDataURL(siteUrl, {
          width: 300, margin: 1, color: { dark: "#000000", light: "#ffffff" },
        });
      } catch {
        siteQr = "";
      }
      const BATCH_SIZE = 10;
      const generateStudentQr = async (s: StudentAccount): Promise<{ student: StudentAccount; qr: string }> => {
        try {
          let qrPayload = s.password
            ? `${siteUrl}/ar/qr-login?u=${encodeURIComponent(s.username)}&p=${encodeURIComponent(s.password)}`
            : `${siteUrl}/ar/student-login`;
          if (s.authUserId) {
            const res = await fetchWithAuthorizedSession("/api/admin/qr-tokens", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "generate_qr", auth_user_id: s.authUserId, school_id: schoolId }),
            });
            const data = await res.json();
            if (data?.ok && data.token?.token) {
              qrPayload = `${siteUrl}/ar/qr-login?t=${encodeURIComponent(data.token.token)}`;
            }
          }
          const qr = await QRCode.toDataURL(qrPayload, {
            width: 300, margin: 1, color: { dark: "#000000", light: "#ffffff" },
          });
          return { student: s, qr };
        } catch {
          return { student: s, qr: "" };
        }
      };

      const results: { student: StudentAccount; qr: string }[] = [];
      for (let i = 0; i < studentsList.length; i += BATCH_SIZE) {
        const batch = studentsList.slice(i, i + BATCH_SIZE);
        const batchResults = await Promise.all(batch.map(generateStudentQr));
        results.push(...batchResults);
      }

      const cardsHtml = results.map((r) => buildCardHtml(r.student, siteQr, r.qr));
      const pw = window.open("", "_blank");
      if (!pw) return;
      pw.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8"/><title>بطاقات دخول الطلبة</title><style>${cardStyles}</style></head><body>${cardsHtml.join("\n")}</body></html>`);
      pw.document.close();
      pw.onload = () => pw.print();
    },
    [buildCardHtml, cardStyles, schoolId],
  );

  const handlePrintCard = useCallback(
    (student: StudentAccount) => openPrintCards([student]),
    [openPrintCards],
  );

  const handlePrintCards = useCallback(
    () => openPrintCards(filtered),
    [openPrintCards, filtered],
  );

  const withPassword = useMemo(() => students.filter((s) => s.password).length, [students]);
  const withoutPassword = students.length - withPassword;

  const shellContent = loading ? (
    <div className="flex flex-col items-center justify-center min-h-[400px] gap-3">
      <Loader2 className="h-10 w-10 animate-spin text-[var(--primary)]" />
      <span className="text-sm text-[var(--text-secondary)]">جاري تحميل حسابات الطلبة...</span>
    </div>
  ) : error ? (
    <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
      <div className="w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
        <KeyRound className="h-8 w-8 text-red-500" />
      </div>
      <p className="text-red-600 dark:text-red-400 text-lg font-medium">{error}</p>
      <button
        onClick={fetchStudents}
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
          background: "linear-gradient(135deg, var(--primary) 0%, color-mix(in srgb, var(--primary) 60%, var(--success)) 100%)",
        }}
      >
        <div className="absolute top-0 end-0 w-48 sm:w-72 h-48 sm:h-72 rounded-full opacity-[0.08] pointer-events-none" style={{ background: "white", transform: "translate(35%, -40%)" }} />
        <div className="absolute bottom-0 start-12 w-32 sm:w-48 h-32 sm:h-48 rounded-full opacity-[0.06] pointer-events-none" style={{ background: "white", transform: "translateY(60%)" }} />
        <div className="relative flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-white/60 text-[10px] sm:text-xs font-medium mb-1 sm:mb-2 tracking-widest uppercase">
              لوحة الإدارة · حسابات الطلبة
            </p>
            <h1 className="text-xl sm:text-2xl md:text-3xl font-black text-white mb-1 sm:mb-1.5 leading-tight">
              حسابات الطلبة
            </h1>
            <p className="text-white/70 text-xs sm:text-sm hidden sm:block">
              إدارة بيانات الدخول وطباعة بطاقات تسجيل الدخول
            </p>
            <div className="flex flex-wrap gap-1.5 sm:gap-2 mt-2 sm:mt-3">
              <span className="inline-flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-0.5 sm:py-1 rounded-full text-[10px] sm:text-xs font-semibold" style={{ background: "rgba(255,255,255,0.18)", color: "white" }}>
                <Users size={10} className="sm:w-3 sm:h-3" />
                {students.length} طالب
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
            <KeyRound size={38} className="text-white" />
          </div>
        </div>
      </div>

      {schoolScope.shouldBlockContent ? (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--card-bg)] p-8 shadow-[var(--card-shadow)]">
          <SchoolScopeEmptyState scope={schoolScope} title="حسابات الطلبة" description="اختر مدرسة لعرض حسابات الطلبة" />
        </div>
      ) : (<>

      {/* Provision warning */}
      {(withoutAccount > 0 || withoutPassword > 0) && (
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3 sm:p-4 rounded-xl sm:rounded-2xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-800/40 flex items-center justify-center flex-shrink-0">
              <UserPlus className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">
                {withoutAccount > 0
                  ? `${withoutAccount} طالب بدون حساب`
                  : `${withoutPassword} طالب بدون كلمة مرور`}
              </p>
              <p className="text-xs text-amber-700 dark:text-amber-300">يمكنك إنشاء حسابات لجميع الطلبة دفعة واحدة</p>
            </div>
          </div>
          <button
            onClick={handleProvisionAll}
            disabled={provisioning}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-amber-600 text-white rounded-xl hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-semibold whitespace-nowrap transition-colors"
          >
            {provisioning ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
            {provisioning ? "جاري الإنشاء..." : `إنشاء الحسابات${withoutAccount > 0 ? ` (${withoutAccount})` : ""}`}
          </button>
        </div>
      )}

      {provisionResult && (
        <div className={`p-4 rounded-2xl text-sm border flex items-center gap-3 ${
          provisionResult.ok
            ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-800 dark:text-green-200"
            : "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-800 dark:text-red-200"
        }`}>
          <Check className="h-5 w-5 flex-shrink-0" />
          {provisionResult.message}
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
                placeholder="بحث بالاسم أو اسم المستخدم..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pr-10 pl-4 py-2 sm:py-2 border border-[var(--border)] rounded-xl bg-[var(--surface)] text-[var(--text-primary)] text-sm focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent transition-shadow"
              />
            </div>
            <div className="relative w-full sm:w-auto">
              <Filter className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--text-tertiary)] pointer-events-none" />
              <select
                value={classFilter}
                onChange={(e) => setClassFilter(e.target.value)}
                className="w-full sm:w-auto appearance-none pr-9 pl-6 py-2 border border-[var(--border)] rounded-xl bg-[var(--surface)] text-[var(--text-primary)] text-sm focus:ring-2 focus:ring-[var(--primary)] cursor-pointer"
              >
                <option value="">كل الصفوف</option>
                {classes.map((c) => (
                  <option key={c} value={c}>{c}</option>
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
              disabled={filtered.length === 0}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[var(--primary)] text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-semibold transition-opacity"
            >
              <CreditCard className="h-3.5 w-3.5" />
              طباعة بطاقات
            </button>
          </div>
        </div>

        {/* Results count */}
        {(search || classFilter) && (
          <p className="text-xs text-[var(--text-tertiary)]">
            عرض {filtered.length} من {students.length} طالب
            {classFilter && <> · الصف: <strong>{classFilter}</strong></>}
          </p>
        )}

        {/* Table */}
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <div className="w-14 h-14 rounded-2xl bg-[var(--surface-hover)] flex items-center justify-center">
              <Search className="h-6 w-6 text-[var(--text-tertiary)]" />
            </div>
            <p className="text-sm text-[var(--text-secondary)] font-medium">
              {students.length === 0 ? "لا يوجد طلاب في المدرسة" : "لا توجد نتائج تطابق البحث"}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-[var(--border)] -mx-3 sm:mx-0">
            <table className="w-full text-sm min-w-[600px]">
              <thead>
                <tr className="bg-[var(--surface-soft)]">
                  <th className="px-2 sm:px-4 py-2.5 sm:py-3 text-right text-[10px] sm:text-xs font-semibold text-[var(--text-tertiary)] uppercase tracking-wider w-10 sm:w-12">#</th>
                  <th className="px-2 sm:px-4 py-2.5 sm:py-3 text-right text-[10px] sm:text-xs font-semibold text-[var(--text-tertiary)] uppercase tracking-wider">الاسم</th>
                  <th className="px-2 sm:px-4 py-2.5 sm:py-3 text-right text-[10px] sm:text-xs font-semibold text-[var(--text-tertiary)] uppercase tracking-wider">الصف</th>
                  <th className="px-2 sm:px-4 py-2.5 sm:py-3 text-right text-[10px] sm:text-xs font-semibold text-[var(--text-tertiary)] uppercase tracking-wider">اسم المستخدم</th>
                  <th className="px-2 sm:px-4 py-2.5 sm:py-3 text-right text-[10px] sm:text-xs font-semibold text-[var(--text-tertiary)] uppercase tracking-wider">كلمة المرور</th>
                  <th className="px-2 sm:px-4 py-2.5 sm:py-3 text-center text-[10px] sm:text-xs font-semibold text-[var(--text-tertiary)] uppercase tracking-wider w-20 sm:w-28">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {filtered.map((s, i) => (
                  <tr key={`${s.username}-${i}`} className="hover:bg-[var(--surface-hover)] transition-colors">
                    <td className="px-2 sm:px-4 py-2.5 sm:py-3 text-[var(--text-tertiary)] text-center text-xs">{i + 1}</td>
                    <td className="px-2 sm:px-4 py-2.5 sm:py-3">
                      <span className="font-medium text-[var(--text-primary)]">{s.fullName}</span>
                    </td>
                    <td className="px-2 sm:px-4 py-2.5 sm:py-3">
                      <span className="inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium bg-[var(--surface-soft)] text-[var(--text-secondary)] border border-[var(--border)]">
                        {s.className ?? "—"}
                      </span>
                    </td>
                    <td className="px-2 sm:px-4 py-2.5 sm:py-3" dir="ltr">
                      {s.hasAccount ? (
                        <button
                          onClick={() => handleCopy(s.username, `u-${s.username}`)}
                          className="group inline-flex items-center gap-1.5 font-mono text-xs text-[var(--text-secondary)] hover:text-[var(--primary)] transition-colors"
                          title="نسخ اسم المستخدم"
                        >
                          {s.username}
                          {copied === `u-${s.username}` ? (
                            <Check className="h-3 w-3 text-green-500" />
                          ) : (
                            <Copy className="h-3 w-3 opacity-0 group-hover:opacity-60 transition-opacity" />
                          )}
                        </button>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800">بدون حساب</span>
                      )}
                    </td>
                    <td className="px-2 sm:px-4 py-2.5 sm:py-3" dir="ltr">
                      {s.hasAccount && s.password ? (
                        <button
                          onClick={() => handleCopy(s.password, `p-${s.username}`)}
                          className="group inline-flex items-center gap-1.5 font-mono text-xs transition-colors"
                          title="نسخ كلمة المرور"
                        >
                          <span className="px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 font-semibold border border-emerald-200 dark:border-emerald-800">
                            {s.password}
                          </span>
                          {copied === `p-${s.username}` ? (
                            <Check className="h-3 w-3 text-green-500" />
                          ) : (
                            <Copy className="h-3 w-3 text-[var(--text-tertiary)] opacity-0 group-hover:opacity-60 transition-opacity" />
                          )}
                        </button>
                      ) : s.hasAccount ? (
                        <span className="text-xs text-[var(--text-tertiary)] italic">غير متوفرة</span>
                      ) : (
                        <span className="text-xs text-[var(--text-tertiary)]">—</span>
                      )}
                    </td>
                    <td className="px-2 sm:px-4 py-2.5 sm:py-3">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => handlePrintCard(s)}
                          className="inline-flex items-center justify-center w-8 h-8 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 transition-colors"
                          title="طباعة بطاقة"
                        >
                          <CreditCard className="h-4 w-4" />
                        </button>
                        {s.authUserId && (
                          <button
                            onClick={() => handleShowQr(s)}
                            disabled={qrLoading[s.username]}
                            className="inline-flex items-center justify-center w-8 h-8 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 disabled:opacity-50 transition-colors"
                            title="عرض رمز QR"
                          >
                            {qrLoading[s.username] ? <Loader2 className="h-4 w-4 animate-spin" /> : <QrCode className="h-4 w-4" />}
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
      </>)}
    </div>
  );

  return (
    <div className="flex min-h-screen bg-[var(--surface-soft)]">
      <AppSidebar currentPath="/student-accounts" />
      <div className="flex-1 flex flex-col min-w-0">
        <AppShellTopbar title="حسابات الطلبة" />
        <main className="app-shell-frame--with-fixed-topbar flex-1 overflow-y-auto">
          {shellContent}
        </main>
      </div>
    </div>
  );
}

export default function StudentAccountsPage() {
  return (
    <ProtectedRoute roles={["admin", "super_admin"]}>
      <StudentAccountsContent />
    </ProtectedRoute>
  );
}
