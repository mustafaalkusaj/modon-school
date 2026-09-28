"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Users, Search, Send } from "lucide-react";
import { TeacherShell } from "@/components/TeacherShell";
import { getLocaleFromPath } from "@/lib/locale-routing";
import { fetchJsonWithAuthorizedSession } from "@/lib/authorized-api";
import { EmptyState } from "@/components/ui/empty-state";
import { sectionMatches } from "@/lib/section-scope";

interface Student {
  id: string;
  full_name: string;
  class_name: string | null;
  section: string | null;
  has_account: boolean;
}

interface TeacherClass {
  id: string;
  class_name: string;
  section: string | null;
  student_count: number;
}

const ALL = "__all__";

function classKey(className: string, section: string | null) {
  return `${className}::${section ?? ""}`;
}

export default function TeacherStudentsPage() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const locale = getLocaleFromPath(pathname);
  const isAr = locale === "ar";
  const t = (ar: string, en: string) => (isAr ? ar : en);

  const [students, setStudents] = useState<Student[]>([]);
  const [classes, setClasses] = useState<TeacherClass[]>([]);
  const [selected, setSelected] = useState(() => {
    const cn = searchParams.get("class_name");
    return cn ? classKey(cn, searchParams.get("section")) : ALL;
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);

  // Load the whole roster once; filtering by class happens client-side.
  useEffect(() => {
    fetchJsonWithAuthorizedSession("/api/teacher/students")
      .then((res) => {
        const d = (res.payload as { data?: { students?: Student[]; classes?: TeacherClass[] } } | null)?.data;
        if (res.response.ok && d) {
          setStudents(d.students ?? []);
          setClasses(d.classes ?? []);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const selectedClass = classes.find((c) => classKey(c.class_name, c.section) === selected) ?? null;

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return students.filter((s) => {
      if (selectedClass) {
        if ((s.class_name ?? "").toLowerCase() !== selectedClass.class_name.toLowerCase()) return false;
        if (!sectionMatches(s.section, selectedClass.section)) return false;
      }
      return !q || s.full_name.toLowerCase().includes(q);
    });
  }, [students, selectedClass, searchQuery]);

  const sendHref = (() => {
    const params = new URLSearchParams();
    if (selectedClass) {
      params.set("class_name", selectedClass.class_name);
      if (selectedClass.section) params.set("section", selectedClass.section);
    }
    const qs = params.toString();
    return `/${locale}/teacher/notifications/send${qs ? `?${qs}` : ""}`;
  })();

  return (
    <TeacherShell
      currentPath="/teacher/students"
      titleAr="طلابي"
      titleEn="My Students"
      subtitleAr={loading ? undefined : `${filtered.length} طالب`}
      subtitleEn={loading ? undefined : `${filtered.length} students`}
    >
      <div className="space-y-4 max-w-4xl mx-auto">
        {/* Class chips */}
        {classes.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
            {[{ key: ALL, label: t("كل صفوفي", "All my classes") }, ...classes.map((c) => ({
              key: classKey(c.class_name, c.section),
              label: `${c.class_name}${c.section ? ` / ${c.section}` : ""}`,
            }))].map((chip) => (
              <button
                key={chip.key}
                onClick={() => setSelected(chip.key)}
                className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition ${
                  selected === chip.key
                    ? "bg-[var(--primary)] text-white"
                    : "border border-[var(--card-border)] bg-[var(--card-bg)] text-[var(--text-secondary)]"
                }`}
              >
                {chip.label}
              </button>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-muted)]" />
            <input
              type="text"
              placeholder={t("ابحث باسم الطالب...", "Search by name...")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] ps-9 pe-3 py-2.5 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--primary)]"
            />
          </div>
          <Link
            href={sendHref}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--primary)] px-3 py-2.5 text-sm font-semibold text-white"
          >
            <Send className="h-4 w-4" />
            <span className="hidden sm:inline">{t("إشعار", "Notify")}</span>
          </Link>
        </div>

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-14 rounded-2xl bg-[var(--card-bg)] border border-[var(--card-border)] animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Users className="h-12 w-12 text-[var(--text-tertiary)]" />}
            title={classes.length === 0 ? t("لم تُسند إليك صفوف بعد", "No classes assigned yet") : t("لا يوجد طلاب", "No students found")}
            description={classes.length === 0 ? t("تواصل مع إدارة المدرسة لإسناد الصفوف والمواد لك.", "Ask the school administration to assign your classes.") : undefined}
          />
        ) : (
          <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] divide-y divide-[var(--card-border)]">
            {filtered.map((student, idx) => (
              <div key={student.id} className="flex items-center gap-3 p-3">
                <span className="w-6 text-center text-xs text-[var(--text-muted)] tabular-nums">{idx + 1}</span>
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--primary)_12%,transparent)] text-xs font-bold text-[var(--primary)]">
                  {student.full_name.split(" ").slice(0, 2).map((w) => w[0]).join("")}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[var(--text-primary)] truncate">{student.full_name}</p>
                  <p className="text-xs text-[var(--text-muted)]">
                    {student.class_name}
                    {student.section ? ` / ${student.section}` : ""}
                  </p>
                </div>
                {!student.has_account && (
                  <span className="shrink-0 rounded-full bg-[var(--surface-soft,var(--background))] px-2 py-0.5 text-[10px] text-[var(--text-muted)]">
                    {t("بدون حساب", "No app account")}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </TeacherShell>
  );
}
