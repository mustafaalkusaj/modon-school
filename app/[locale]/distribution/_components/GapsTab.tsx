"use client";

import React, { useState, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import {
  DistributionItem,
  DistributionRecord,
  StudentBasic,
  DeliveryStatus,
} from "../_types";
import { GRADE_MAP, GRADES } from "../_constants";

// ── Props & Helpers ──────────────────────────────────────────────────────────

interface GapsTabProps {
  students: StudentBasic[];
  items: DistributionItem[];
  records: Record<string, Record<string, DistributionRecord>>;
}

function getItemsForStudent(
  student: StudentBasic,
  allItems: DistributionItem[]
): DistributionItem[] {
  return allItems.filter(
    (item) =>
      (item.category === "uniform" && item.grade === null) ||
      (item.category === "book" && item.grade === student.class_name)
  );
}

type ViewMode = "by-item" | "by-student";

// ── KPI Card ─────────────────────────────────────────────────────────────────

const KPI_ICONS = { delivered: "✔", pending: "⧖", unavailable: "✖", completion: "★" };

function KpiCard({ label, value, color, suffix, icon }: {
  label: string; value: number | string; color: string; suffix?: string; icon?: string;
}) {
  return (
    <Card
      style={{ overflow: "hidden", transition: "transform 0.2s, box-shadow 0.2s", cursor: "default", borderBottom: `3px solid ${color}` }}
      onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = `0 6px 20px color-mix(in srgb, ${color} 18%, transparent)`; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "none"; }}
    >
      <CardContent style={{
        padding: 20, display: "flex", flexDirection: "column", gap: 6, position: "relative", overflow: "hidden",
        background: `linear-gradient(135deg, color-mix(in srgb, ${color} 6%, transparent) 0%, transparent 100%)`,
      }}>
        {icon && (
          <span style={{ position: "absolute", top: 10, insetInlineEnd: 14, fontSize: "1.6rem", opacity: 0.12, lineHeight: 1, pointerEvents: "none", userSelect: "none" }}>
            {icon}
          </span>
        )}
        <span style={{ fontSize: "0.76rem", color: "var(--text-secondary)", fontWeight: 500, letterSpacing: "0.02em" }}>
          {label}
        </span>
        <span style={{ fontSize: "1.85rem", fontWeight: 900, color, fontVariantNumeric: "tabular-nums", lineHeight: 1.1 }}>
          {value}
          {suffix && <span style={{ fontSize: "0.9rem", fontWeight: 600, marginInlineStart: 2 }}>{suffix}</span>}
        </span>
      </CardContent>
    </Card>
  );
}

// ── Aggregation types ────────────────────────────────────────────────────────

interface ItemAgg { item: DistributionItem; delivered: number; pending: number; unavailable: number; total: number; percent: number; }
interface StudentAgg { student: StudentBasic; delivered: number; total: number; percent: number; }

// ── Main Component ───────────────────────────────────────────────────────────

export default function GapsTab({ students, items, records }: GapsTabProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("by-item");
  const [classFilter, setClassFilter] = useState("");

  const kpis = useMemo(() => {
    let delivered = 0, pending = 0, unavailable = 0, totalRelevant = 0;
    for (const student of students) {
      const sItems = getItemsForStudent(student, items);
      const sRecords = records[student.id];
      for (const item of sItems) {
        const status: DeliveryStatus = (sRecords?.[item.id]?.status ?? 0) as DeliveryStatus;
        if (status === 3) continue;
        totalRelevant++;
        if (status === 1) delivered++;
        else if (status === 2) unavailable++;
        else pending++;
      }
    }
    const completionPercent = totalRelevant === 0 ? 0 : Math.round((delivered / totalRelevant) * 100);
    return { delivered, pending, unavailable, completionPercent };
  }, [students, items, records]);

  const itemAggs = useMemo((): ItemAgg[] => {
    const map = new Map<string, ItemAgg>();
    for (const item of items) {
      if (!item.is_active) continue;
      map.set(item.id, { item, delivered: 0, pending: 0, unavailable: 0, total: 0, percent: 0 });
    }
    for (const student of students) {
      const sItems = getItemsForStudent(student, items);
      const sRecords = records[student.id];
      for (const item of sItems) {
        const agg = map.get(item.id);
        if (!agg) continue;
        const status: DeliveryStatus = (sRecords?.[item.id]?.status ?? 0) as DeliveryStatus;
        if (status === 3) continue;
        agg.total++;
        if (status === 1) agg.delivered++;
        else if (status === 2) agg.unavailable++;
        else agg.pending++;
      }
    }
    const result = Array.from(map.values()).filter((a) => a.total > 0);
    for (const a of result) a.percent = Math.round((a.delivered / a.total) * 100);
    return result.sort((a, b) => a.percent - b.percent);
  }, [students, items, records]);

  const studentAggs = useMemo((): StudentAgg[] => {
    let pool = students;
    if (classFilter) pool = pool.filter((s) => s.class_name === classFilter);
    return pool
      .map((student) => {
        const sItems = getItemsForStudent(student, items);
        const sRecords = records[student.id];
        let delivered = 0, total = 0;
        for (const item of sItems) {
          const status: DeliveryStatus = (sRecords?.[item.id]?.status ?? 0) as DeliveryStatus;
          if (status === 3) continue;
          total++;
          if (status === 1) delivered++;
        }
        return { student, delivered, total, percent: total === 0 ? 0 : Math.round((delivered / total) * 100) };
      })
      .sort((a, b) => a.percent - b.percent);
  }, [students, items, records, classFilter]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      {/* KPI Row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 14 }}>
        <KpiCard label="مُستلم" value={kpis.delivered} color="var(--success, #22c55e)" icon={KPI_ICONS.delivered} />
        <KpiCard label="قيد الانتظار" value={kpis.pending} color="var(--warning, #eab308)" icon={KPI_ICONS.pending} />
        <KpiCard label="غير متوفر" value={kpis.unavailable} color="var(--danger, #ef4444)" icon={KPI_ICONS.unavailable} />
        <KpiCard label="نسبة الإنجاز" value={kpis.completionPercent} suffix="%" color="var(--primary)" icon={KPI_ICONS.completion} />
      </div>

      {/* View Toggle */}
      <div style={{ display: "flex", justifyContent: "center" }}>
        <div style={{ display: "flex", background: "var(--surface-soft, #f1f5f9)", borderRadius: 999, padding: 3, gap: 2 }}>
          {([["by-item", "حسب الصنف"], ["by-student", "حسب الطالب"]] as const).map(([key, label]) => (
            <button
              key={key} type="button" onClick={() => setViewMode(key)}
              style={{
                padding: "7px 24px", fontSize: "0.82rem", fontWeight: viewMode === key ? 700 : 500,
                border: "none", borderRadius: 999, whiteSpace: "nowrap", cursor: "pointer",
                background: viewMode === key ? "var(--primary)" : "transparent",
                color: viewMode === key ? "#fff" : "var(--text-secondary)",
                transition: "all 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      {viewMode === "by-item" ? (
        <ItemTable rows={itemAggs} />
      ) : (
        <>
          <div style={{ maxWidth: 260 }}>
            <Select value={classFilter} onChange={(e) => setClassFilter(e.target.value)}>
              <option value="">كل الصفوف</option>
              {GRADES.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </Select>
          </div>
          <StudentTable rows={studentAggs} />
        </>
      )}
    </div>
  );
}

// ── Shared Table Styles ─────────────────────────────────────────────────────

const wrap: React.CSSProperties = {
  overflowX: "auto", borderRadius: 12,
  border: "1px solid var(--border, #e2e8f0)",
  boxShadow: "0 1px 4px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.02)",
};
const tbl: React.CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" };
const th: React.CSSProperties = {
  padding: "12px 14px", textAlign: "start", fontWeight: 600, fontSize: "0.76rem", letterSpacing: "0.01em",
  color: "var(--text-secondary)", whiteSpace: "nowrap", borderBottom: "2px solid var(--border)",
  background: "linear-gradient(180deg, color-mix(in srgb, var(--primary) 5%, var(--surface-soft, #f8fafc)) 0%, var(--surface-soft, #f8fafc) 100%)",
};
const td: React.CSSProperties = {
  padding: "11px 14px", color: "var(--text-primary)", transition: "background 0.15s",
  borderBottom: "1px solid color-mix(in srgb, var(--border) 60%, transparent)",
};

function rowHover(el: HTMLTableRowElement, bg: string) { el.style.background = bg; }
function stripeBg(idx: number, tint = "var(--primary)") {
  return idx % 2 === 1 ? `color-mix(in srgb, ${tint} 2%, transparent)` : "transparent";
}

// ── Percentage Bar ───────────────────────────────────────────────────────────

function PercentBar({ value }: { value: number }) {
  const c = value >= 80 ? "var(--success, #22c55e)" : value >= 40 ? "var(--warning, #eab308)" : "var(--danger, #ef4444)";
  const end = value >= 80 ? "#16a34a" : value >= 40 ? "#ca8a04" : "#dc2626";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 110 }}>
      <div style={{ flex: 1, height: 8, borderRadius: 999, overflow: "hidden", background: "color-mix(in srgb, var(--border) 40%, transparent)", boxShadow: "inset 0 1px 2px rgba(0,0,0,0.06)" }}>
        <div style={{ height: "100%", width: `${value}%`, borderRadius: 999, background: `linear-gradient(90deg, ${c}, ${end})`, transition: "width 0.5s cubic-bezier(0.4, 0, 0.2, 1)" }} />
      </div>
      <span style={{ fontSize: "0.75rem", fontWeight: 700, color: c, fontVariantNumeric: "tabular-nums", minWidth: 38, textAlign: "end" }}>
        {value}%
      </span>
    </div>
  );
}

// ── Item Table ───────────────────────────────────────────────────────────────

function ItemTable({ rows }: { rows: ItemAgg[] }) {
  if (rows.length === 0) {
    return <p style={{ textAlign: "center", color: "var(--text-secondary)", padding: 40, fontSize: "0.88rem" }}>لا توجد بيانات</p>;
  }
  return (
    <div style={wrap}>
      <table style={tbl}>
        <thead>
          <tr>
            <th style={th}>الصنف</th>
            <th style={th}>النوع</th>
            <th style={{ ...th, textAlign: "center" }}>مُستلم</th>
            <th style={{ ...th, textAlign: "center" }}>معلّق</th>
            <th style={{ ...th, textAlign: "center" }}>غير متوفر</th>
            <th style={{ ...th, minWidth: 150 }}>النسبة</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => {
            const bg = stripeBg(idx);
            return (
              <tr key={row.item.id} style={{ background: bg, transition: "background 0.15s" }}
                onMouseEnter={(e) => rowHover(e.currentTarget, "color-mix(in srgb, var(--primary) 6%, transparent)")}
                onMouseLeave={(e) => rowHover(e.currentTarget, bg)}
              >
                <td style={{ ...td, fontWeight: 600 }}>{row.item.name}</td>
                <td style={td}>
                  <span style={{
                    display: "inline-block", padding: "3px 10px", borderRadius: 999, fontSize: "0.72rem", fontWeight: 600,
                    background: row.item.category === "uniform"
                      ? "color-mix(in srgb, var(--info, #3b82f6) 12%, transparent)"
                      : "color-mix(in srgb, var(--warning, #eab308) 12%, transparent)",
                    color: row.item.category === "uniform" ? "var(--info, #3b82f6)" : "var(--warning, #eab308)",
                  }}>
                    {row.item.category === "uniform" ? "زي" : "كتاب"}
                  </span>
                </td>
                <td style={{ ...td, textAlign: "center", color: "var(--success, #22c55e)", fontWeight: 700 }}>{row.delivered}</td>
                <td style={{ ...td, textAlign: "center", color: "var(--warning, #eab308)", fontWeight: 700 }}>{row.pending}</td>
                <td style={{ ...td, textAlign: "center", color: "var(--danger, #ef4444)", fontWeight: 700 }}>{row.unavailable}</td>
                <td style={td}><PercentBar value={row.percent} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Student Table ────────────────────────────────────────────────────────────

function StudentTable({ rows }: { rows: StudentAgg[] }) {
  if (rows.length === 0) {
    return <p style={{ textAlign: "center", color: "var(--text-secondary)", padding: 40, fontSize: "0.88rem" }}>لا توجد بيانات</p>;
  }
  return (
    <div style={wrap}>
      <table style={tbl}>
        <thead>
          <tr>
            <th style={th}>الطالب</th>
            <th style={th}>الصف</th>
            <th style={th}>الشعبة</th>
            <th style={{ ...th, textAlign: "center" }}>مُستلم</th>
            <th style={{ ...th, textAlign: "center" }}>المجموع</th>
            <th style={{ ...th, minWidth: 150 }}>النسبة</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => {
            const tint = row.percent >= 80 ? "var(--success, #22c55e)" : row.percent >= 40 ? "var(--warning, #eab308)" : "var(--danger, #ef4444)";
            const bg = idx % 2 === 1 ? `color-mix(in srgb, ${tint} 4%, transparent)` : "transparent";
            const hBg = `color-mix(in srgb, ${tint} 10%, transparent)`;
            return (
              <tr key={row.student.id}
                style={{ background: bg, borderInlineStart: `3px solid ${tint}`, transition: "background 0.15s" }}
                onMouseEnter={(e) => rowHover(e.currentTarget, hBg)}
                onMouseLeave={(e) => rowHover(e.currentTarget, bg)}
              >
                <td style={{ ...td, fontWeight: 600 }}>{row.student.full_name}</td>
                <td style={td}>{GRADE_MAP[row.student.class_name] ?? row.student.class_name}</td>
                <td style={td}>{row.student.section ?? "—"}</td>
                <td style={{ ...td, textAlign: "center", fontWeight: 700 }}>{row.delivered}</td>
                <td style={{ ...td, textAlign: "center", fontWeight: 700 }}>{row.total}</td>
                <td style={td}><PercentBar value={row.percent} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}