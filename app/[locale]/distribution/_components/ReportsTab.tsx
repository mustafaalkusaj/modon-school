"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import type {
  DistributionItem,
  DistributionRecord,
  DistributionSettings,
  StudentBasic,
} from "../_types";
import { STATUS_LABELS } from "../_types";
import { GRADES, GRADE_MAP } from "../_constants";

// ── Types ────────────────────────────────────────────────────────────────────

type ReportType = "delivery" | "gaps" | "purchase";

interface ReportsTabProps {
  students: StudentBasic[];
  items: DistributionItem[];
  records: Record<string, Record<string, DistributionRecord>>;
  settings: DistributionSettings | null;
  schoolName: string;
}

// ── Report type metadata ────────────────────────────────────────────────────

const REPORT_META: Record<ReportType, { label: string; icon: string; desc: string }> = {
  delivery: { label: "كشف التسليم", icon: "☑", desc: "كشف تفصيلي بتسليم المستلزمات لكل طالب" },
  gaps:     { label: "تقرير النواقص", icon: "⚠", desc: "قائمة الطلاب الذين لم يستلموا بعد" },
  purchase: { label: "طلب شراء", icon: "\u{1F4E6}", desc: "ملخص الكميات المطلوبة للشراء" },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(): string {
  return new Intl.DateTimeFormat("ar-IQ", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date());
}

function getStudentsByClass(
  students: StudentBasic[],
  className: string
): StudentBasic[] {
  return students.filter((s) => s.class_name === className);
}

function getUniqueClasses(students: StudentBasic[]): string[] {
  const classes = new Set(students.map((s) => s.class_name));
  return Array.from(classes).sort();
}

// ── Component ────────────────────────────────────────────────────────────────

export default function ReportsTab({
  students,
  items,
  records,
  settings,
  schoolName,
}: ReportsTabProps) {
  const [reportType, setReportType] = React.useState<ReportType | null>(null);
  const [selectedClass, setSelectedClass] = React.useState<string>("");
  const [showReport, setShowReport] = React.useState(false);
  const reportRef = React.useRef<HTMLDivElement>(null);

  const classes = React.useMemo(() => getUniqueClasses(students), [students]);

  const activeItems = React.useMemo(
    () => items.filter((i) => i.is_active),
    [items]
  );

  const filteredStudents = React.useMemo(() => {
    if (!selectedClass) return students;
    return getStudentsByClass(students, selectedClass);
  }, [students, selectedClass]);

  const handleGenerate = React.useCallback(() => {
    if (!reportType) return;
    setShowReport(true);
  }, [reportType]);

  const handlePrint = React.useCallback(() => {
    window.print();
  }, []);

  const handleCopy = React.useCallback(async () => {
    if (!reportRef.current) return;
    const text = reportRef.current.innerText;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement("textarea");
      area.value = text;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      document.body.removeChild(area);
    }
  }, []);

  const academicYear = settings?.academic_year ?? "—";

  // ── Delivery Report Data ────────────────────────────────────────────────

  const deliveryReportRows = React.useMemo(() => {
    if (reportType !== "delivery") return [];
    return filteredStudents.map((student) => {
      const studentRecords = records[student.id] ?? {};
      const itemStatuses = activeItems.map((item) => {
        const rec = studentRecords[item.id];
        return {
          itemId: item.id,
          itemName: item.name,
          delivered: rec?.status === 1,
          status: rec?.status ?? 0,
        };
      });
      return { student, itemStatuses };
    });
  }, [reportType, filteredStudents, records, activeItems]);

  // ── Gaps Report Data ────────────────────────────────────────────────────

  const gapsReportRows = React.useMemo(() => {
    if (reportType !== "gaps") return [];
    const rows: {
      student: StudentBasic;
      pendingItems: { name: string; status: number }[];
    }[] = [];

    for (const student of filteredStudents) {
      const studentRecords = records[student.id] ?? {};
      const pending = activeItems
        .filter((item) => {
          const rec = studentRecords[item.id];
          return !rec || rec.status === 0 || rec.status === 2;
        })
        .map((item) => ({
          name: item.name,
          status: studentRecords[item.id]?.status ?? 0,
        }));

      if (pending.length > 0) {
        rows.push({ student, pendingItems: pending });
      }
    }
    return rows;
  }, [reportType, filteredStudents, records, activeItems]);

  // ── Purchase Order Data ─────────────────────────────────────────────────

  const purchaseOrderRows = React.useMemo(() => {
    if (reportType !== "purchase") return [];
    const needs: Record<string, { name: string; size: string; count: number }> =
      {};

    for (const student of filteredStudents) {
      const studentRecords = records[student.id] ?? {};
      for (const item of activeItems) {
        const rec = studentRecords[item.id];
        if (!rec || rec.status === 0 || rec.status === 2) {
          const size = rec?.size ?? "—";
          const key = `${item.id}::${size}`;
          if (!needs[key]) {
            needs[key] = { name: item.name, size, count: 0 };
          }
          needs[key].count++;
        }
      }
    }

    return Object.values(needs).sort((a, b) => a.name.localeCompare(b.name));
  }, [reportType, filteredStudents, records, activeItems]);

  // ── Shared table styles ────────────────────────────────────────────────

  const thStyle: React.CSSProperties = { padding: "10px 12px", fontWeight: 600, fontSize: "0.8rem", letterSpacing: "0.02em", color: "#fff", borderBottom: "none", whiteSpace: "nowrap" };
  const thGradient: React.CSSProperties = { background: "linear-gradient(135deg, var(--primary), color-mix(in oklch, var(--primary) 70%, #000 30%))" };
  const cellBase: React.CSSProperties = { padding: "10px 12px", borderBottom: "1px solid var(--border)" };
  const cellIdx: React.CSSProperties = { ...cellBase, color: "var(--text-tertiary)", fontSize: "0.8rem" };
  const cellName: React.CSSProperties = { ...cellBase, fontWeight: 600, color: "var(--text-primary)" };
  const cellSub: React.CSSProperties = { ...cellBase, color: "var(--text-secondary)", fontSize: "0.8rem" };
  const rowBg = (i: number): React.CSSProperties => ({ backgroundColor: i % 2 === 0 ? "transparent" : "color-mix(in oklch, var(--surface-soft) 50%, transparent 50%)" });

  return (
    <div className="space-y-6">
      {/* ── Report Type Selection ──────────────────────────────────── */}
      <div className="grid gap-3 print:hidden" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
        {(Object.keys(REPORT_META) as ReportType[]).map((type) => {
          const meta = REPORT_META[type];
          const isActive = reportType === type;
          return (
            <button
              key={type}
              onClick={() => { setReportType(type); setShowReport(false); }}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "6px",
                padding: "20px 16px 16px",
                borderRadius: "14px",
                cursor: "pointer",
                border: isActive
                  ? "2px solid var(--primary)"
                  : "1.5px solid var(--border)",
                background: isActive
                  ? "linear-gradient(135deg, color-mix(in oklch, var(--primary) 8%, var(--card-bg) 92%), var(--card-bg))"
                  : "var(--card-bg)",
                boxShadow: isActive
                  ? "0 0 0 3px color-mix(in oklch, var(--primary) 15%, transparent 85%), 0 4px 12px rgba(0,0,0,0.06)"
                  : "0 1px 4px rgba(0,0,0,0.04)",
                transition: "all 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
                textAlign: "center",
              }}
            >
              <span style={{ fontSize: "1.6rem", lineHeight: 1, width: "44px", height: "44px", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "12px", background: isActive ? "linear-gradient(135deg, var(--primary), color-mix(in oklch, var(--primary) 80%, #000 20%))" : "var(--surface-soft)", color: isActive ? "#fff" : "var(--text-secondary)", transition: "all 0.25s cubic-bezier(0.16, 1, 0.3, 1)" }}>
                {meta.icon}
              </span>
              <span style={{ fontWeight: 700, fontSize: "0.95rem", color: isActive ? "var(--primary)" : "var(--text-primary)", transition: "color 0.2s" }}>
                {meta.label}
              </span>
              <span style={{ fontSize: "0.75rem", color: "var(--text-tertiary)", lineHeight: 1.4, maxWidth: "180px" }}>
                {meta.desc}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── Filters ────────────────────────────────────────────────── */}
      {reportType && (
        <Card>
          <CardContent className="p-5">
            <div className="flex flex-wrap items-end gap-4">
              <div className="flex-1 min-w-[200px]">
                <label
                  className="block text-xs font-semibold mb-2 tracking-wide"
                  style={{ color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.06em" }}
                >
                  الصف الدراسي
                </label>
                <Select
                  value={selectedClass}
                  onChange={(e) => {
                    setSelectedClass(e.target.value);
                    setShowReport(false);
                  }}
                >
                  <option value="">جميع الصفوف</option>
                  {classes.map((cls) => (
                    <option key={cls} value={cls}>
                      {GRADE_MAP[cls] ?? cls}
                    </option>
                  ))}
                </Select>
              </div>
              <Button
                onClick={handleGenerate}
                style={{
                  background: "linear-gradient(135deg, var(--primary), color-mix(in oklch, var(--primary) 75%, #000 25%))",
                  color: "#fff",
                  fontWeight: 600,
                  padding: "8px 28px",
                  borderRadius: "10px",
                  border: "none",
                  transition: "opacity 0.2s, transform 0.2s",
                }}
              >
                توليد التقرير
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Generated Report ───────────────────────────────────────── */}
      {showReport && reportType && (
        <>
          {/* Action Buttons */}
          <div className="flex gap-2 print:hidden">
            {([{ fn: handlePrint, icon: "⎙", text: "طباعة" }, { fn: handleCopy, icon: "📋", text: "نسخ" }] as const).map((btn) => (
              <button
                key={btn.text}
                onClick={btn.fn}
                style={{ display: "inline-flex", alignItems: "center", gap: "6px", padding: "8px 20px", borderRadius: "999px", border: "1.5px solid var(--border)", background: "var(--card-bg)", color: "var(--text-primary)", fontWeight: 600, fontSize: "0.85rem", cursor: "pointer", transition: "all 0.2s" }}
              >
                <span style={{ fontSize: "1.1rem" }}>{btn.icon}</span>
                {btn.text}
              </button>
            ))}
          </div>

          {/* Report Content */}
          <div
            ref={reportRef}
            className="report-printable"
            style={{
              backgroundColor: "var(--card-bg)",
              border: "2px solid var(--border)",
              borderRadius: "16px",
              padding: "32px",
              boxShadow: "0 2px 16px rgba(0,0,0,0.04)",
              position: "relative",
              overflow: "hidden",
            }}
          >
            {/* Decorative top accent */}
            <div
              className="print:hidden"
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                height: "4px",
                background: "linear-gradient(90deg, var(--primary), color-mix(in oklch, var(--primary) 50%, #06b6d4 50%), var(--primary))",
                borderRadius: "16px 16px 0 0",
              }}
            />

            {/* Report Header */}
            <div className="text-center mb-8 pb-6" style={{ borderBottom: "2px solid var(--border)" }}>
              {/* Logo placeholder */}
              <div
                style={{
                  width: "56px",
                  height: "56px",
                  margin: "0 auto 12px",
                  borderRadius: "14px",
                  background: "linear-gradient(135deg, var(--primary), color-mix(in oklch, var(--primary) 70%, #000 30%))",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#fff",
                  fontSize: "1.5rem",
                  fontWeight: 800,
                }}
              >
                {"🏫"}
              </div>
              <h2
                className="text-xl font-bold mb-1"
                style={{ color: "var(--text-primary)", letterSpacing: "0.01em" }}
              >
                {schoolName}
              </h2>
              <p className="text-sm mb-0.5" style={{ color: "var(--text-secondary)" }}>
                العام الدراسي: {academicYear}
              </p>
              <p className="text-sm mb-3" style={{ color: "var(--text-secondary)" }}>
                التاريخ: {formatDate()}
              </p>
              <h3
                style={{
                  fontSize: "1.15rem",
                  fontWeight: 700,
                  color: "var(--primary)",
                  position: "relative",
                  display: "inline-block",
                  paddingBottom: "8px",
                }}
              >
                {reportType === "delivery" && "كشف تسليم المستلزمات المدرسية"}
                {reportType === "gaps" && "تقرير النواقص"}
                {reportType === "purchase" && "طلب شراء المستلزمات"}
                <span
                  style={{
                    position: "absolute",
                    bottom: 0,
                    left: "50%",
                    transform: "translateX(-50%)",
                    width: "60px",
                    height: "3px",
                    borderRadius: "2px",
                    background: "linear-gradient(90deg, transparent, var(--primary), transparent)",
                  }}
                />
              </h3>
              {selectedClass && (
                <p className="text-sm mt-2" style={{ color: "var(--text-secondary)" }}>
                  الصف: {GRADE_MAP[selectedClass] ?? selectedClass}
                </p>
              )}
            </div>

            {/* ── Delivery Checklist ─────────────────────────────────── */}
            {reportType === "delivery" && (
              <div className="overflow-x-auto" style={{ borderRadius: "12px", border: "1px solid var(--border)" }}>
                <table className="w-full text-sm" style={{ borderCollapse: "separate", borderSpacing: 0 }}>
                  <thead>
                    <tr style={thGradient}>
                      <th className="text-start" style={{ ...thStyle, borderRadius: "0 12px 0 0" }}>#</th>
                      <th className="text-start" style={thStyle}>اسم الطالب</th>
                      <th className="text-start" style={thStyle}>الصف</th>
                      {activeItems.map((item, i) => (
                        <th
                          key={item.id}
                          className="text-center"
                          style={{
                            ...thStyle,
                            ...(i === activeItems.length - 1 ? { borderRadius: "12px 0 0 0" } : {}),
                          }}
                        >
                          {item.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {deliveryReportRows.map(({ student, itemStatuses }, index) => (
                      <tr key={student.id} style={rowBg(index)}>
                        <td style={cellIdx}>{index + 1}</td>
                        <td style={cellName}>{student.full_name}</td>
                        <td style={cellSub}>{GRADE_MAP[student.class_name] ?? student.class_name}</td>
                        {itemStatuses.map((is) => (
                          <td key={is.itemId} className="text-center" style={cellBase}>
                            {is.delivered ? (
                              <span
                                aria-label="تم التسليم"
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  width: "24px",
                                  height: "24px",
                                  borderRadius: "50%",
                                  backgroundColor: "color-mix(in oklch, var(--success) 15%, transparent 85%)",
                                  color: "var(--success)",
                                  fontSize: "0.85rem",
                                  fontWeight: 700,
                                }}
                              >
                                &#10003;
                              </span>
                            ) : (
                              <span
                                aria-label="لم يسلم"
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  width: "24px",
                                  height: "24px",
                                  borderRadius: "50%",
                                  backgroundColor: "color-mix(in oklch, var(--text-tertiary) 8%, transparent 92%)",
                                  color: "var(--text-tertiary)",
                                  fontSize: "0.75rem",
                                }}
                              >
                                &mdash;
                              </span>
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {deliveryReportRows.length === 0 && (
                  <div className="text-center py-12" style={{ color: "var(--text-tertiary)" }}>
                    <div style={{ fontSize: "2.5rem", marginBottom: "8px", opacity: 0.4 }}>{"📋"}</div>
                    <p className="text-sm">لا توجد بيانات للعرض</p>
                  </div>
                )}
              </div>
            )}

            {/* ── Gaps Report ───────────────────────────────────────── */}
            {reportType === "gaps" && (
              <div className="space-y-3">
                {gapsReportRows.length === 0 ? (
                  <div className="text-center py-12" style={{ color: "var(--text-tertiary)" }}>
                    <div style={{ fontSize: "2.5rem", marginBottom: "8px", opacity: 0.4 }}>{"✅"}</div>
                    <p className="text-sm font-medium" style={{ color: "var(--success)" }}>
                      جميع الطلاب استلموا كافة المستلزمات
                    </p>
                  </div>
                ) : (
                  <div className="overflow-x-auto" style={{ borderRadius: "12px", border: "1px solid var(--border)" }}>
                    <table className="w-full text-sm" style={{ borderCollapse: "separate", borderSpacing: 0 }}>
                      <thead>
                        <tr style={thGradient}>
                          <th className="text-start" style={{ ...thStyle, borderRadius: "0 12px 0 0" }}>#</th>
                          <th className="text-start" style={thStyle}>اسم الطالب</th>
                          <th className="text-start" style={thStyle}>الصف</th>
                          <th className="text-start" style={{ ...thStyle, borderRadius: "12px 0 0 0" }}>المستلزمات الناقصة</th>
                        </tr>
                      </thead>
                      <tbody>
                        {gapsReportRows.map(({ student, pendingItems }, index) => (
                          <tr key={student.id} style={rowBg(index)}>
                            <td style={cellIdx}>{index + 1}</td>
                            <td style={cellName}>{student.full_name}</td>
                            <td style={cellSub}>{GRADE_MAP[student.class_name] ?? student.class_name}</td>
                            <td style={cellBase}>
                              <div className="flex flex-wrap gap-1.5">
                                {pendingItems.map((pi) => (
                                  <Badge key={pi.name} variant={pi.status === 2 ? "warning" : "danger"} size="sm">
                                    {pi.name}
                                    {pi.status === 2 && " (غير متوفر)"}
                                  </Badge>
                                ))}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    marginTop: "16px",
                    padding: "10px 16px",
                    borderRadius: "10px",
                    backgroundColor: "var(--surface-soft)",
                    fontSize: "0.85rem",
                    color: "var(--text-secondary)",
                  }}
                >
                  <span style={{ fontSize: "1rem" }}>{"📊"}</span>
                  اجمالي الطلاب الذين لديهم نواقص:{" "}
                  <strong style={{ color: "var(--text-primary)" }}>{gapsReportRows.length}</strong>
                  {" "}من أصل{" "}
                  <strong style={{ color: "var(--text-primary)" }}>{filteredStudents.length}</strong>
                </div>
              </div>
            )}

            {/* ── Purchase Order ────────────────────────────────────── */}
            {reportType === "purchase" && (
              <div className="overflow-x-auto" style={{ borderRadius: "12px", border: "1px solid var(--border)" }}>
                <table className="w-full text-sm" style={{ borderCollapse: "separate", borderSpacing: 0 }}>
                  <thead>
                    <tr style={thGradient}>
                      <th className="text-start" style={{ ...thStyle, borderRadius: "0 12px 0 0" }}>#</th>
                      <th className="text-start" style={thStyle}>الصنف</th>
                      <th className="text-center" style={thStyle}>المقاس</th>
                      <th className="text-center" style={{ ...thStyle, borderRadius: "12px 0 0 0" }}>الكمية المطلوبة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {purchaseOrderRows.map((row, index) => (
                      <tr key={`${row.name}-${row.size}`} style={rowBg(index)}>
                        <td style={cellIdx}>{index + 1}</td>
                        <td style={cellName}>{row.name}</td>
                        <td className="text-center" style={cellSub}>{row.size}</td>
                        <td className="text-center" style={cellBase}>
                          <Badge variant="primary" size="sm">{row.count}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {purchaseOrderRows.length === 0 && (
                  <div className="text-center py-12" style={{ color: "var(--text-tertiary)" }}>
                    <div style={{ fontSize: "2.5rem", marginBottom: "8px", opacity: 0.4 }}>{"✅"}</div>
                    <p className="text-sm">لا توجد نواقص تستلزم شراء</p>
                  </div>
                )}
              </div>
            )}

            {/* ── Signature Lines ───────────────────────────────────── */}
            <div
              className="mt-12 pt-8 flex justify-between"
              style={{ borderTop: "2px dashed color-mix(in oklch, var(--border) 70%, transparent 30%)" }}
            >
              <div className="text-center">
                <div
                  style={{
                    width: "160px",
                    height: "48px",
                    marginBottom: "8px",
                    borderBottom: "2px dotted var(--text-tertiary)",
                  }}
                />
                <p
                  className="text-xs font-semibold tracking-wide"
                  style={{ color: "var(--text-secondary)", letterSpacing: "0.04em" }}
                >
                  توقيع المسؤول
                </p>
              </div>
              <div className="text-center">
                <div
                  style={{
                    width: "160px",
                    height: "48px",
                    marginBottom: "8px",
                    borderBottom: "2px dotted var(--text-tertiary)",
                  }}
                />
                <p
                  className="text-xs font-semibold tracking-wide"
                  style={{ color: "var(--text-secondary)", letterSpacing: "0.04em" }}
                >
                  توقيع المدير
                </p>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── Print Styles ───────────────────────────────────────────── */}
      <style jsx global>{`
        @media print {
          body > *:not(.report-printable) {
            display: none !important;
          }
          .report-printable {
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            border: none !important;
            box-shadow: none !important;
            border-radius: 0 !important;
            background: #fff !important;
            color: #000 !important;
            padding: 20px !important;
          }
          .report-printable * {
            color: #000 !important;
            background: transparent !important;
          }
          .report-printable thead tr {
            background: #e5e7eb !important;
          }
          .report-printable thead th {
            color: #000 !important;
            background: #e5e7eb !important;
          }
          .report-printable table {
            border: 1px solid #ccc;
          }
          .report-printable th,
          .report-printable td {
            border: 1px solid #ccc !important;
          }
          .print\\:hidden {
            display: none !important;
          }
        }
      `}</style>
    </div>
  );
}