"use client";

import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  DistributionItem, DistributionRecord, StudentBasic,
  DeliveryStatus, STATUS_LABELS, ItemWithRecord,
} from "../_types";
import { GRADE_MAP, GRADES } from "../_constants";

// ── Props ────────────────────────────────────────────────────────────────────
interface DeliveryTabProps {
  students: StudentBasic[];
  items: DistributionItem[];
  records: Record<string, Record<string, DistributionRecord>>;
  settings: {
    size_scales: { age: { values: string[] }; letter: { values: string[] } };
  } | null;
  onToggleDelivery: (studentId: string, item: DistributionItem, currentStatus: DeliveryStatus) => Promise<void>;
  onBulkDeliver: (studentId: string, category: "uniform" | "book", status: 0 | 1) => Promise<void>;
  onUpdateRecord: (studentId: string, itemId: string, updates: Partial<DistributionRecord>) => Promise<void>;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function getItemsForStudent(student: StudentBasic, allItems: DistributionItem[]): DistributionItem[] {
  return allItems.filter(
    (item) =>
      (item.category === "uniform" && item.grade === null) ||
      (item.category === "book" && item.grade === student.class_name)
  );
}

function computeProgress(
  studentItems: DistributionItem[],
  studentRecords: Record<string, DistributionRecord> | undefined
): { delivered: number; total: number; percent: number } {
  const relevant = studentItems.filter((item) => studentRecords?.[item.id]?.status !== 3);
  const delivered = relevant.filter((item) => studentRecords?.[item.id]?.status === 1).length;
  const total = relevant.length;
  return { delivered, total, percent: total === 0 ? 0 : Math.round((delivered / total) * 100) };
}

type ProgressTier = "complete" | "partial" | "none";
function getProgressTier(percent: number): ProgressTier {
  if (percent >= 100) return "complete";
  return percent > 0 ? "partial" : "none";
}

const RING_COLORS: Record<ProgressTier, string> = {
  complete: "var(--success, #22c55e)", partial: "var(--warning, #eab308)", none: "var(--text-muted, #9ca3af)",
};
const STATUS_STRIP: Record<DeliveryStatus, string> = {
  0: "var(--border)", 1: "var(--success, #22c55e)", 2: "var(--danger, #ef4444)", 3: "var(--text-muted, #9ca3af)",
};
const STATUS_BG: Record<DeliveryStatus, string> = {
  0: "var(--surface-soft)",
  1: "color-mix(in srgb, var(--success, #22c55e) 8%, transparent)",
  2: "color-mix(in srgb, var(--danger, #ef4444) 8%, transparent)",
  3: "color-mix(in srgb, var(--text-muted, #9ca3af) 6%, transparent)",
};

// ── Progress Ring (CSS conic-gradient) ──────────────────────────────────────
function ProgressRing({ percent, tier }: { percent: number; tier: ProgressTier }) {
  const color = RING_COLORS[tier];
  const bg = "color-mix(in srgb, var(--text-muted, #9ca3af) 18%, transparent)";
  return (
    <span style={{
      display: "inline-block", width: 22, height: 22, borderRadius: "50%",
      background: `conic-gradient(${color} ${percent * 3.6}deg, ${bg} 0deg)`,
      flexShrink: 0, position: "relative",
    }}>
      <span style={{ position: "absolute", inset: 4, borderRadius: "50%", background: "var(--card-bg, #fff)" }} />
    </span>
  );
}

// ── Size Popover ─────────────────────────────────────────────────────────────
function SizeSelector({ values, currentSize, onSelect }: {
  values: string[]; currentSize: string | null; onSelect: (size: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <button type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        style={{
          fontSize: "0.7rem", padding: "2px 10px", borderRadius: 8,
          border: `1px solid var(--border)`,
          background: currentSize ? "color-mix(in srgb, var(--primary) 10%, transparent)" : "var(--surface-soft)",
          color: "var(--text-secondary)", cursor: "pointer", whiteSpace: "nowrap", transition: "all 0.2s ease",
        }}
      >
        {currentSize ? `المقاس: ${currentSize}` : "اختر المقاس"}
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "100%", right: 0, zIndex: 50, marginTop: 4,
          background: "var(--card-bg, #fff)", border: `1px solid var(--border)`, borderRadius: 10,
          boxShadow: "0 8px 32px rgba(0,0,0,0.12)", backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)", padding: 8, display: "flex", flexWrap: "wrap", gap: 5, minWidth: 150,
        }}>
          {values.map((v) => (
            <button key={v} type="button"
              onClick={(e) => { e.stopPropagation(); onSelect(v); setOpen(false); }}
              style={{
                fontSize: "0.75rem", padding: "5px 12px", borderRadius: 8,
                border: currentSize === v ? `2px solid var(--primary)` : `1px solid var(--border)`,
                background: currentSize === v ? "color-mix(in srgb, var(--primary) 15%, transparent)" : "var(--surface-soft)",
                color: "var(--text-primary)", cursor: "pointer",
                fontWeight: currentSize === v ? 600 : 400, transition: "all 0.15s ease",
              }}
            >{v}</button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Item Tile ────────────────────────────────────────────────────────────────
function ItemTile({ item, record, sizeValues, onToggle, onSizeChange }: {
  item: DistributionItem; record: DistributionRecord | null;
  sizeValues: string[] | null; onToggle: () => void; onSizeChange: (size: string) => void;
}) {
  const status: DeliveryStatus = record?.status ?? 0;
  const isClickable = status === 0 || status === 1;
  const isDimmed = status === 3;

  return (
    <div role="button" tabIndex={isClickable ? 0 : -1}
      onClick={isClickable ? onToggle : undefined}
      onKeyDown={isClickable ? (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); }
      } : undefined}
      style={{
        background: STATUS_BG[status], borderRadius: 12, padding: "0 14px 12px",
        cursor: isClickable ? "pointer" : "default", opacity: isDimmed ? 0.45 : 1,
        transition: "all 0.2s ease, box-shadow 0.2s ease",
        display: "flex", flexDirection: "column", gap: 6, minHeight: 76,
        position: "relative", overflow: "hidden",
        border: "1px solid color-mix(in srgb, var(--border) 60%, transparent)",
        boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
      }}
      className="hover:shadow-md"
    >
      {/* Status strip on top */}
      <div style={{
        height: 3, marginInline: -14, marginBottom: 4,
        background: STATUS_STRIP[status], borderRadius: "0 0 2px 2px",
      }} />
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--text-primary)", lineHeight: 1.4 }}>
          {item.name}
        </span>
        <span style={{
          fontSize: "0.65rem", fontWeight: 600, padding: "2px 8px", borderRadius: 6,
          whiteSpace: "nowrap", letterSpacing: "0.01em",
          background: status === 1 ? "color-mix(in srgb, var(--success, #22c55e) 18%, transparent)"
            : status === 2 ? "color-mix(in srgb, var(--danger, #ef4444) 18%, transparent)" : "transparent",
          color: status === 1 ? "var(--success, #22c55e)"
            : status === 2 ? "var(--danger, #ef4444)" : "var(--text-secondary)",
        }}>
          {STATUS_LABELS[status]}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        {record?.variant && <Badge variant="neutral" size="sm">{record.variant}</Badge>}
        {item.category === "uniform" && sizeValues && (
          <SizeSelector values={sizeValues} currentSize={record?.size ?? null} onSelect={onSizeChange} />
        )}
      </div>
      {record?.note && (
        <p style={{ fontSize: "0.7rem", color: "var(--text-secondary)", margin: 0, lineHeight: 1.4 }}>
          {record.note}
        </p>
      )}
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────
export default function DeliveryTab({
  students, items, records, settings, onToggleDelivery, onBulkDeliver, onUpdateRecord,
}: DeliveryTabProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [gradeFilter, setGradeFilter] = useState("");
  const [sectionFilter, setSectionFilter] = useState("");
  const [search, setSearch] = useState("");

  const filteredStudents = useMemo(() => {
    let result = students;
    if (gradeFilter) result = result.filter((s) => s.class_name === gradeFilter);
    if (sectionFilter) result = result.filter((s) => s.section === sectionFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter((s) => s.full_name.toLowerCase().includes(q));
    }
    return result;
  }, [students, gradeFilter, sectionFilter, search]);

  const sections = useMemo(() => {
    const pool = gradeFilter ? students.filter((s) => s.class_name === gradeFilter) : students;
    const set = new Set(pool.map((s) => s.section).filter(Boolean) as string[]);
    return Array.from(set).sort();
  }, [students, gradeFilter]);

  const selectedStudent = useMemo(
    () => filteredStudents.find((s) => s.id === selectedId) ?? null,
    [filteredStudents, selectedId]
  );
  const selectedIndex = useMemo(
    () => selectedStudent ? filteredStudents.findIndex((s) => s.id === selectedStudent.id) : -1,
    [filteredStudents, selectedStudent]
  );

  const goToPrev = useCallback(() => {
    if (selectedIndex > 0) setSelectedId(filteredStudents[selectedIndex - 1].id);
  }, [filteredStudents, selectedIndex]);
  const goToNext = useCallback(() => {
    if (selectedIndex < filteredStudents.length - 1) setSelectedId(filteredStudents[selectedIndex + 1].id);
  }, [filteredStudents, selectedIndex]);

  const studentItems = useMemo(
    () => (selectedStudent ? getItemsForStudent(selectedStudent, items) : []),
    [selectedStudent, items]
  );
  const studentRecords = selectedStudent ? records[selectedStudent.id] : undefined;
  const progress = useMemo(() => computeProgress(studentItems, studentRecords), [studentItems, studentRecords]);
  const uniformItems = useMemo(() => studentItems.filter((i) => i.category === "uniform"), [studentItems]);
  const bookItems = useMemo(() => studentItems.filter((i) => i.category === "book"), [studentItems]);

  const getSizeValues = useCallback(
    (item: DistributionItem): string[] | null => {
      if (item.category !== "uniform" || !item.size_scale || !settings) return null;
      return settings.size_scales[item.size_scale]?.values ?? null;
    }, [settings]
  );

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 20 }} className="lg:!grid-cols-[340px_1fr]">
      {/* ── LEFT: Student List ───────────────────────────────────────────── */}
      <div style={{
        display: "flex", flexDirection: "column", gap: 0, minHeight: 0,
        borderRadius: 14, border: "1px solid var(--border)", background: "var(--card-bg)", overflow: "hidden",
      }}>
        {/* Gradient header bar */}
        <div style={{
          padding: "14px 16px 12px",
          background: "linear-gradient(135deg, color-mix(in srgb, var(--primary) 12%, transparent), color-mix(in srgb, var(--primary) 4%, transparent))",
          borderBottom: "1px solid var(--border)",
        }}>
          <h3 style={{ margin: "0 0 10px", fontSize: "0.85rem", fontWeight: 700, color: "var(--text-primary)", letterSpacing: "0.01em" }}>
            قائمة الطلاب
            <span style={{ fontSize: "0.75rem", fontWeight: 400, color: "var(--text-secondary)", marginInlineStart: 6 }}>
              ({filteredStudents.length})
            </span>
          </h3>
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <Select value={gradeFilter} onChange={(e) => { setGradeFilter(e.target.value); setSectionFilter(""); }} style={{ flex: 1 }}>
              <option value="">كل الصفوف</option>
              {GRADES.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </Select>
            <Select value={sectionFilter} onChange={(e) => setSectionFilter(e.target.value)} style={{ flex: 1 }} disabled={sections.length === 0}>
              <option value="">كل الشعب</option>
              {sections.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          </div>
          <Input placeholder="بحث بالاسم..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>

        {/* Student list */}
        <div style={{ flex: 1, overflowY: "auto", maxHeight: "calc(100vh - 380px)", display: "flex", flexDirection: "column" }}>
          {filteredStudents.length === 0 && (
            <div style={{ padding: "40px 24px", textAlign: "center", color: "var(--text-secondary)" }}>
              <div style={{
                width: 48, height: 48, margin: "0 auto 12px", borderRadius: "50%",
                background: "color-mix(in srgb, var(--text-muted) 10%, transparent)",
                display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.3rem", opacity: 0.6,
              }}>؟</div>
              <p style={{ margin: 0, fontSize: "0.85rem" }}>لا يوجد طلاب</p>
            </div>
          )}
          {filteredStudents.map((student) => {
            const sItems = getItemsForStudent(student, items);
            const prog = computeProgress(sItems, records[student.id]);
            const tier = getProgressTier(prog.percent);
            const isSelected = student.id === selectedId;
            return (
              <button key={student.id} type="button" onClick={() => setSelectedId(student.id)}
                style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "11px 14px",
                  border: "none",
                  borderBottom: "1px solid color-mix(in srgb, var(--border) 50%, transparent)",
                  borderInlineStart: isSelected ? "3px solid var(--primary)" : "3px solid transparent",
                  background: isSelected ? "color-mix(in srgb, var(--primary) 6%, transparent)" : "transparent",
                  cursor: "pointer", textAlign: "start", width: "100%", transition: "all 0.2s ease",
                }}
              >
                <ProgressRing percent={prog.percent} tier={tier} />
                <span style={{
                  flex: 1, fontSize: "0.84rem", fontWeight: isSelected ? 600 : 400,
                  color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis",
                  whiteSpace: "nowrap", lineHeight: 1.4,
                }}>{student.full_name}</span>
                <span style={{
                  fontSize: "0.72rem", fontVariantNumeric: "tabular-nums", direction: "ltr",
                  color: isSelected ? "var(--primary)" : "var(--text-secondary)",
                  fontWeight: isSelected ? 600 : 400,
                  background: isSelected ? "color-mix(in srgb, var(--primary) 10%, transparent)" : "transparent",
                  padding: "2px 6px", borderRadius: 6, transition: "all 0.2s ease",
                }}>{prog.delivered}/{prog.total}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── RIGHT: Item Grid ─────────────────────────────────────────────── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {!selectedStudent ? (
          <div style={{
            display: "flex", flexDirection: "column", alignItems: "center",
            justifyContent: "center", minHeight: 340, color: "var(--text-secondary)", gap: 12,
          }}>
            <div style={{
              width: 64, height: 64, borderRadius: 16,
              background: "color-mix(in srgb, var(--primary) 8%, transparent)",
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.6rem", opacity: 0.7,
            }}>←</div>
            <p style={{ margin: 0, fontSize: "0.9rem" }}>اختر طالباً من القائمة</p>
          </div>
        ) : (
          <>
            {/* Hero card */}
            <Card style={{
              background: "linear-gradient(135deg, var(--primary), color-mix(in srgb, var(--primary) 80%, #000))",
              color: "#fff", border: "none", borderRadius: 16, overflow: "hidden", position: "relative",
            }}>
              {/* Subtle dot pattern overlay */}
              <div style={{
                position: "absolute", inset: 0, opacity: 0.07, pointerEvents: "none",
                backgroundImage: "radial-gradient(circle, #fff 1px, transparent 1px)", backgroundSize: "18px 18px",
              }} />
              <CardContent style={{ padding: "22px 24px", position: "relative" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
                  <div>
                    <h2 style={{ fontSize: "1.2rem", fontWeight: 700, margin: 0, letterSpacing: "0.01em" }}>
                      {selectedStudent.full_name}
                    </h2>
                    <p style={{ fontSize: "0.82rem", margin: "5px 0 0", opacity: 0.85 }}>
                      {GRADE_MAP[selectedStudent.class_name] ?? selectedStudent.class_name}
                      {selectedStudent.section && ` — شعبة ${selectedStudent.section}`}
                    </p>
                  </div>
                  <span style={{
                    fontSize: "2rem", fontWeight: 800, fontVariantNumeric: "tabular-nums",
                    letterSpacing: "0.04em", lineHeight: 1, textShadow: "0 2px 8px rgba(0,0,0,0.15)",
                  }}>{progress.percent}%</span>
                </div>
                <div style={{
                  background: "rgba(255,255,255,0.18)", borderRadius: 999, height: 10,
                  overflow: "hidden", boxShadow: "inset 0 1px 2px rgba(0,0,0,0.1)",
                }}>
                  <div style={{
                    height: "100%", width: `${progress.percent}%`,
                    background: "linear-gradient(90deg, rgba(255,255,255,0.95), rgba(255,255,255,0.75))",
                    borderRadius: 999, transition: "width 0.4s cubic-bezier(0.16, 1, 0.3, 1)",
                    boxShadow: "0 0 12px rgba(255,255,255,0.3)",
                  }} />
                </div>
                <p style={{ fontSize: "0.78rem", marginTop: 8, opacity: 0.8, textAlign: "center", letterSpacing: "0.01em" }}>
                  {progress.delivered} من {progress.total} صنف
                </p>
              </CardContent>
            </Card>

            {/* Prev / Next */}
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <Button variant="secondary" size="sm" onClick={goToPrev} disabled={selectedIndex <= 0}>السابق</Button>
              <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)", alignSelf: "center", fontVariantNumeric: "tabular-nums" }}>
                {selectedIndex + 1} / {filteredStudents.length}
              </span>
              <Button variant="secondary" size="sm" onClick={goToNext} disabled={selectedIndex >= filteredStudents.length - 1}>التالي</Button>
            </div>

            <ItemSection title="الزي المدرسي" sectionItems={uniformItems} studentRecords={studentRecords}
              studentId={selectedStudent.id} category="uniform" getSizeValues={getSizeValues}
              onToggleDelivery={onToggleDelivery} onBulkDeliver={onBulkDeliver} onUpdateRecord={onUpdateRecord}
              accentColor="var(--primary)" />
            <ItemSection title="الكتب المنهجية" sectionItems={bookItems} studentRecords={studentRecords}
              studentId={selectedStudent.id} category="book" getSizeValues={getSizeValues}
              onToggleDelivery={onToggleDelivery} onBulkDeliver={onBulkDeliver} onUpdateRecord={onUpdateRecord}
              accentColor="var(--success, #22c55e)" />
          </>
        )}
      </div>
    </div>
  );
}

// ── Item Section Sub-component ───────────────────────────────────────────────
function ItemSection({ title, sectionItems, studentRecords, studentId, category, getSizeValues,
  onToggleDelivery, onBulkDeliver, onUpdateRecord, accentColor,
}: {
  title: string; sectionItems: DistributionItem[];
  studentRecords: Record<string, DistributionRecord> | undefined;
  studentId: string; category: "uniform" | "book";
  getSizeValues: (item: DistributionItem) => string[] | null;
  onToggleDelivery: DeliveryTabProps["onToggleDelivery"];
  onBulkDeliver: DeliveryTabProps["onBulkDeliver"];
  onUpdateRecord: DeliveryTabProps["onUpdateRecord"];
  accentColor: string;
}) {
  if (sectionItems.length === 0) return null;
  return (
    <section>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <h3 style={{
          fontSize: "0.95rem", fontWeight: 700, color: "var(--text-primary)", margin: 0,
          display: "flex", alignItems: "center", gap: 10,
        }}>
          <span style={{ width: 4, height: 22, borderRadius: 2, background: accentColor, flexShrink: 0 }} />
          {title}
          <span style={{ fontSize: "0.75rem", fontWeight: 400, color: "var(--text-secondary)" }}>
            ({sectionItems.length})
          </span>
        </h3>
        <div style={{ display: "flex", gap: 6 }}>
          <Button variant="secondary" size="sm" onClick={() => onBulkDeliver(studentId, category, 1)}
            style={{ borderRadius: 8, fontWeight: 600 }}>تسليم الكل</Button>
          <Button variant="ghost" size="sm" onClick={() => onBulkDeliver(studentId, category, 0)}
            style={{ borderRadius: 8 }}>تفريغ</Button>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(185px, 1fr))", gap: 12 }}>
        {sectionItems.map((item) => {
          const rec = studentRecords?.[item.id] ?? null;
          return (
            <ItemTile key={item.id} item={item} record={rec} sizeValues={getSizeValues(item)}
              onToggle={() => onToggleDelivery(studentId, item, (rec?.status ?? 0) as DeliveryStatus)}
              onSizeChange={(size) => onUpdateRecord(studentId, item.id, { size })} />
          );
        })}
      </div>
    </section>
  );
}