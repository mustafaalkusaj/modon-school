import type { TeacherRecord } from "../_types";

/**
 * Inline trigger every printable document embeds. The document prints itself
 * on `load`, which is the only reliable moment: attaching a `load` listener to
 * the opened window from here races the blob loading and silently loses the
 * print on a fast load. Keep exactly one trigger per document — two of them
 * open two print dialogs.
 */
export const AUTO_PRINT_SCRIPT =
  `<script>window.addEventListener("load",()=>{window.print();})</script>`;

/**
 * Opens an HTML document in a new tab and releases the blob URL afterwards.
 * The document is expected to embed AUTO_PRINT_SCRIPT itself.
 */
export function openPrintWindow(html: string) {
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank");
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

function fmtDate(val: string | null | undefined, isEn: boolean): string {
  if (!val) return "—";
  try {
    return new Date(val).toLocaleDateString(
      isEn ? "en-GB" : "ar-IQ-u-nu-latn",
      { year: "numeric", month: "long", day: "numeric" },
    );
  } catch {
    return val;
  }
}

const LABELS = {
  gender: {
    ar: { male: "ذكر", female: "أنثى" } as Record<string, string>,
    en: { male: "Male", female: "Female" } as Record<string, string>,
  },
  contract: {
    ar: { full_time: "دوام كامل", part_time: "دوام جزئي", substitute: "بديل", volunteer: "متطوع" } as Record<string, string>,
    en: { full_time: "Full Time", part_time: "Part Time", substitute: "Substitute", volunteer: "Volunteer" } as Record<string, string>,
  },
  marital: {
    ar: { single: "أعزب", married: "متزوج", divorced: "مطلق", widowed: "أرمل" } as Record<string, string>,
    en: {} as Record<string, string>,
  },
  status: {
    ar: { active: "فعّال", on_leave: "إجازة", suspended: "موقوف", resigned: "مستقيل", terminated: "منتهي" } as Record<string, string>,
    en: {} as Record<string, string>,
  },
} as const;

function labelFor(
  category: "gender" | "contract" | "marital" | "status",
  value: string | null,
  isEn: boolean,
): string {
  if (!value) return "—";
  const map = LABELS[category][isEn ? "en" : "ar"];
  return map[value] ?? (isEn ? value.replace("_", " ") : value);
}

export function printTeacherCard(
  teacher: TeacherRecord,
  locale: "ar" | "en",
) {
  const isEn = locale === "en";
  const initials = getInitials(teacher.full_name);

  openPrintWindow(`<!DOCTYPE html><html dir="${isEn ? "ltr" : "rtl"}"><head><meta charset="utf-8"><title>${teacher.full_name}</title><style>body{margin:0;padding:20px;font-family:system-ui,sans-serif;background:#f8fafc}.card{width:148mm;min-height:105mm;background:#fff;border:1.5px solid #e2e8f0;border-radius:12px;padding:14px 16px;box-sizing:border-box;display:flex;flex-direction:column;gap:10px}.header{display:flex;align-items:center;gap:8px;border-bottom:1px solid #f1f5f9;padding-bottom:8px}.logo{width:32px;height:32px;border-radius:6px;background:linear-gradient(135deg,#667eea,#764ba2);display:flex;align-items:center;justify-content:center;color:#fff;font-size:14px;font-weight:900}.school-name{font-size:13px;font-weight:700;color:#334155}.badge{margin-inline-start:auto;font-size:9px;font-weight:600;color:#94a3b8;border:1px solid #e2e8f0;border-radius:4px;padding:2px 6px}.body{display:flex;gap:12px;align-items:flex-start;flex:1}.avatar{width:52px;height:52px;border-radius:10px;background:linear-gradient(135deg,#667eea,#764ba2);display:flex;align-items:center;justify-content:center;color:#fff;font-size:18px;font-weight:900;border:2px solid #e2e8f0;flex-shrink:0}.info{flex:1}.name{font-size:15px;font-weight:900;color:#0f172a;margin-bottom:4px}.emp-id{display:inline-block;font-size:10px;font-weight:700;color:#6366f1;background:#ede9fe;border-radius:4px;padding:2px 7px;margin-bottom:4px}.meta{font-size:11px;color:#64748b;font-weight:600;margin-bottom:2px}.meta span{color:#334155}.creds{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:8px 12px;display:grid;grid-template-columns:1fr 1fr;gap:6px}.cred-label{font-size:9px;font-weight:700;color:#94a3b8;margin-bottom:2px}.cred-value{font-size:12px;font-weight:700;color:#0f172a;direction:ltr;text-align:start}@media print{body{padding:0}}</style></head><body><div class="card"><div class="header"><div class="logo">م</div><div class="school-name">${isEn ? "School" : "المدرسة"}</div><div class="badge">${isEn ? "Teacher Card" : "بطاقة أستاذ"}</div></div><div class="body"><div class="avatar">${initials}</div><div class="info"><div class="name">${teacher.full_name}</div>${teacher.employee_id ? `<div class="emp-id">${teacher.employee_id}</div>` : ""}${teacher.subject ? `<div class="meta">${isEn ? "Subject" : "المادة"}: <span>${teacher.subject}</span></div>` : ""}${teacher.job_title ? `<div class="meta">${isEn ? "Title" : "المسمى"}: <span>${teacher.job_title}</span></div>` : ""}</div></div>${teacher.app_username ? `<div class="creds"><div><div class="cred-label">${isEn ? "USERNAME" : "اسم المستخدم"}</div><div class="cred-value">${teacher.app_username}</div></div></div>` : ""}</div>${AUTO_PRINT_SCRIPT}</body></html>`);
}

export function printTeacherInfo(
  teacher: TeacherRecord,
  locale: "ar" | "en",
) {
  const isEn = locale === "en";
  const initials = getInitials(teacher.full_name);
  const fmt = (v: string | null | undefined) => v || "—";

  const field = (lbl: string, val: string, dir?: string) =>
    `<div class="field"><span class="label">${lbl}</span><span class="value"${dir ? ` dir="${dir}"` : ""}>${val}</span></div>`;

  const section = (title: string, fields: string) =>
    `<div class="section"><div class="section-title">${title}</div><div class="grid2">${fields}</div></div>`;

  const personalFields = [
    field(isEn ? "Phone" : "الهاتف", fmt(teacher.phone), "ltr"),
    field(isEn ? "Email" : "البريد الإلكتروني", fmt(teacher.email), "ltr"),
    field(isEn ? "Gender" : "الجنس", labelFor("gender", teacher.gender, isEn)),
    field(isEn ? "Date of Birth" : "تاريخ الميلاد", fmtDate(teacher.date_of_birth, isEn)),
    field(isEn ? "Nationality" : "الجنسية", fmt(teacher.nationality)),
    field(isEn ? "Marital Status" : "الحالة الاجتماعية", labelFor("marital", teacher.marital_status, isEn)),
  ].join("");

  const workFields = [
    field(isEn ? "Contract Type" : "نوع العقد", labelFor("contract", teacher.contract_type, isEn)),
    field(isEn ? "Hire Date" : "تاريخ التعيين", fmtDate(teacher.hire_date, isEn)),
    field(isEn ? "Years of Experience" : "سنوات الخبرة", teacher.years_experience != null ? (isEn ? `${teacher.years_experience} years` : `${teacher.years_experience} سنة`) : "—"),
    field(isEn ? "Subject" : "المادة", fmt(teacher.subject)),
    field(isEn ? "Specialization" : "التخصص", fmt(teacher.specialization)),
    field(isEn ? "Job Title" : "المسمى الوظيفي", fmt(teacher.job_title)),
  ].join("");

  const qualFields = [
    field(isEn ? "Degree" : "الشهادة", fmt(teacher.qualification)),
    field(isEn ? "University" : "الجامعة", fmt(teacher.university)),
    field(isEn ? "Graduation Year" : "سنة التخرج", String(teacher.graduation_year ?? "—")),
  ].join("");

  const emergencySection =
    teacher.emergency_contact_name || teacher.emergency_contact_phone
      ? section(isEn ? "Emergency Contact" : "جهة الطوارئ", [
          field(isEn ? "Name" : "الاسم", fmt(teacher.emergency_contact_name)),
          field(isEn ? "Phone" : "الهاتف", fmt(teacher.emergency_contact_phone), "ltr"),
          field(isEn ? "Relation" : "الصلة", fmt(teacher.emergency_contact_relation)),
        ].join(""))
      : "";

  openPrintWindow(`<!DOCTYPE html>
<html dir="${isEn ? "ltr" : "rtl"}" lang="${isEn ? "en" : "ar"}">
<head>
<meta charset="utf-8">
<title>${teacher.full_name}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:${isEn ? "system-ui,sans-serif" : "'Noto Sans Arabic',system-ui,sans-serif"};background:#f1f5f9;color:#1e293b;direction:${isEn ? "ltr" : "rtl"};padding:24px}
  .page{max-width:720px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)}
  .hero{background:linear-gradient(135deg,#4f46e5 0%,#7c3aed 60%,#9333ea 100%);padding:24px 28px 40px;display:flex;align-items:center;gap:16px}
  .avatar{width:64px;height:64px;border-radius:50%;background:rgba(255,255,255,0.2);border:3px solid rgba(255,255,255,0.5);display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:900;color:#fff;flex-shrink:0;overflow:hidden}
  .avatar img{width:100%;height:100%;object-fit:cover}
  .hero-info{flex:1}
  .hero-name{font-size:20px;font-weight:900;color:#fff;margin-bottom:4px}
  .hero-meta{font-size:12px;color:rgba(255,255,255,0.75);display:flex;flex-wrap:wrap;gap:8px 16px}
  .hero-badge{display:inline-block;background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.3);border-radius:20px;padding:2px 10px;font-size:11px;font-weight:700;color:#fff}
  .body{padding:24px 28px;margin-top:-20px;position:relative}
  .section{background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px 20px;margin-bottom:16px}
  .section-title{font-size:11px;font-weight:800;color:#6366f1;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px;display:flex;align-items:center;gap:6px}
  .section-title::after{content:'';flex:1;height:1px;background:#e0e7ff}
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px 20px}
  .field{display:flex;flex-direction:column;gap:2px}
  .label{font-size:9px;font-weight:800;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px}
  .value{font-size:12px;font-weight:600;color:#334155}
  @media print{body{background:#fff;padding:0}.page{box-shadow:none;border-radius:0}}
</style>
</head>
<body>
<div class="page">
  <div class="hero">
    <div class="avatar">${teacher.photo ? `<img src="${teacher.photo}" alt="">` : initials}</div>
    <div class="hero-info">
      <div class="hero-name">${teacher.full_name}</div>
      <div class="hero-meta">
        ${teacher.employee_id ? `<span class="hero-badge"># ${teacher.employee_id}</span>` : ""}
        ${teacher.subject ? `<span>${isEn ? "Subject" : "المادة"}: ${teacher.subject}</span>` : ""}
        ${teacher.job_title ? `<span>${isEn ? "Title" : "المسمى"}: ${teacher.job_title}</span>` : ""}
      </div>
    </div>
  </div>
  <div class="body">
    ${section(isEn ? "Personal Information" : "المعلومات الشخصية", personalFields)}
    ${section(isEn ? "Work Information" : "معلومات الوظيفة", workFields)}
    ${section(isEn ? "Qualification" : "المؤهل العلمي", qualFields)}
    ${emergencySection}
  </div>
</div>
${AUTO_PRINT_SCRIPT}
</body>
</html>`);
}

export function getStatusLabel(status: string, isEn: boolean): string {
  return labelFor("status", status, isEn);
}

export function getContractLabel(contract: string | null, isEn: boolean): string {
  return labelFor("contract", contract, isEn);
}

export function getGenderLabel(gender: string | null, isEn: boolean): string {
  return labelFor("gender", gender, isEn);
}
