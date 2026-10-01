"use client";
import { useEffect, useState } from "react";
import { fetchJsonWithAuthorizedSession } from "@/lib/authorized-api";
import { useSchoolScope } from "@/hooks/useSchoolScope";
import { useRole } from "@/hooks/useRole";
import type { TeacherRecord } from "../../../_types";

interface AssignmentRow {
  classes: { id: string; name: string; grade?: string; section?: string } | null;
  sections: { id: string; name: string } | null;
  subjects: { id: string; name: string } | null;
}

interface Props {
  teacher: TeacherRecord;
  canManage: boolean;
  locale: "ar" | "en";
}

function Field({ label, value }: { label: string; value: string | number | null | undefined }) {
  const display = value != null && value !== "" ? String(value) : "—";
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-[var(--text-muted)]">{label}</span>
      <span className="text-sm text-[var(--text-primary)] font-medium">{display}</span>
    </div>
  );
}

function InfoCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
      {children}
    </div>
  );
}

const CONTRACT_TYPE_AR: Record<string, string> = {
  full_time: "دوام كامل",
  part_time: "دوام جزئي",
  substitute: "بديل",
  volunteer: "متطوع",
};

const CONTRACT_TYPE_EN: Record<string, string> = {
  full_time: "Full Time",
  part_time: "Part Time",
  substitute: "Substitute",
  volunteer: "Volunteer",
};

const QUALIFICATION_AR: Record<string, string> = {
  diploma: "دبلوم",
  bachelor: "بكالوريوس",
  master: "ماجستير",
  phd: "دكتوراه",
  other: "أخرى",
};

const QUALIFICATION_EN: Record<string, string> = {
  diploma: "Diploma",
  bachelor: "Bachelor",
  master: "Master",
  phd: "PhD",
  other: "Other",
};

export function SubjectsTab({ teacher, locale }: Props) {
  const isEn = locale === "en";
  const { profile } = useRole();
  const schoolScope = useSchoolScope(profile);
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [assignmentsLoading, setAssignmentsLoading] = useState(true);

  useEffect(() => {
    const schoolId = schoolScope.selectedSchoolId ?? profile?.school_id;
    if (!schoolId || !teacher.id) return;
    setAssignmentsLoading(true);
    const params = new URLSearchParams({ schoolId });
    fetchJsonWithAuthorizedSession<{ ok: boolean; assignments: AssignmentRow[] }>(
      `/api/web/teachers/${teacher.id}/subjects?${params.toString()}`
    )
      .then(({ response, payload }) => {
        if (response.ok && payload?.assignments) {
          setAssignments(payload.assignments);
        }
      })
      .catch(() => {})
      .finally(() => setAssignmentsLoading(false));
  }, [teacher.id, schoolScope.selectedSchoolId, profile?.school_id]);

  const contractLabel = teacher.contract_type
    ? (isEn ? CONTRACT_TYPE_EN[teacher.contract_type] : CONTRACT_TYPE_AR[teacher.contract_type]) ?? teacher.contract_type
    : null;

  const qualificationLabel = teacher.qualification
    ? (isEn ? QUALIFICATION_EN[teacher.qualification] : QUALIFICATION_AR[teacher.qualification]) ?? teacher.qualification
    : null;

  return (
    <div className="flex flex-col gap-5">
      {/* Main subject & specialization */}
      <div>
        <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">
          {isEn ? "Teaching Subject" : "المادة الدراسية"}
        </h3>
        <InfoCard>
          <Field
            label={isEn ? "Main Subject" : "المادة الرئيسية"}
            value={teacher.subject}
          />
          <Field
            label={isEn ? "Specialization" : "التخصص"}
            value={teacher.specialization}
          />
          <Field
            label={isEn ? "Qualification" : "المؤهل العلمي"}
            value={qualificationLabel}
          />
          <Field
            label={isEn ? "University" : "الجامعة"}
            value={teacher.university}
          />
          <Field
            label={isEn ? "Graduation Year" : "سنة التخرج"}
            value={teacher.graduation_year}
          />
          <Field
            label={isEn ? "Years of Experience" : "سنوات الخبرة"}
            value={teacher.years_experience != null ? (isEn ? `${teacher.years_experience} yrs` : `${teacher.years_experience} سنوات`) : null}
          />
        </InfoCard>
      </div>

      {/* Teaching load */}
      <div>
        <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">
          {isEn ? "Teaching Load" : "العبء التدريسي"}
        </h3>
        <InfoCard>
          <Field
            label={isEn ? "Max Periods / Day" : "أقصى حصص يوميًا"}
            value={teacher.max_periods_daily}
          />
          <Field
            label={isEn ? "Max Periods / Week" : "أقصى حصص أسبوعيًا"}
            value={teacher.max_periods_weekly}
          />
          <Field
            label={isEn ? "Job Title" : "المسمى الوظيفي"}
            value={teacher.job_title}
          />
          <Field
            label={isEn ? "Contract Type" : "نوع العقد"}
            value={contractLabel}
          />
        </InfoCard>
      </div>

      {/* Assigned classes */}
      <div>
        <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">
          {isEn ? "Assigned Classes" : "الصفوف المخصصة"}
        </h3>
        {assignmentsLoading ? (
          <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-8 flex items-center justify-center text-[var(--text-muted)] text-sm">
            {isEn ? "Loading..." : "جاري التحميل..."}
          </div>
        ) : assignments.length === 0 ? (
          <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-8 flex flex-col items-center gap-2 text-[var(--text-muted)]">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
            </svg>
            <p className="text-sm text-center">
              {isEn ? "No class assignments yet." : "لا توجد صفوف مخصصة بعد."}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {assignments.map((a, i) => (
              <div
                key={i}
                className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-4 flex flex-col gap-1.5"
              >
                <span className="text-sm font-semibold text-[var(--text-primary)]">
                  {a.classes?.name ?? "—"}
                </span>
                {a.sections && (
                  <span className="text-xs text-[var(--text-muted)]">
                    {isEn ? "Section" : "الشعبة"}: {a.sections.name}
                  </span>
                )}
                {a.subjects && (
                  <span className="text-xs text-[var(--text-muted)]">
                    {isEn ? "Subject" : "المادة"}: {a.subjects.name}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
