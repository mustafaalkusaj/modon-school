"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Modal, ModalHeader, ModalBody, ModalFooter } from "@/components/ui/modal";
import type { DistributionItem, DistributionSettings } from "../_types";
import { GRADES, DEFAULT_SIZE_SCALES, ACADEMIC_YEAR } from "../_constants";

// ── Types ────────────────────────────────────────────────────────────────────
interface SettingsTabProps {
  items: DistributionItem[];
  settings: DistributionSettings | null;
  schoolId: string;
  onSaveItem: (item: Partial<DistributionItem> & { school_id: string }) => Promise<void>;
  onDeleteItem: (itemId: string) => Promise<void>;
  onSaveSettings: (settings: Partial<DistributionSettings>) => Promise<void>;
  onSeedDefaults: (schoolId: string) => Promise<void>;
}

type ItemFormData = {
  name: string; size_scale: "age" | "letter" | ""; variants: string; grade: string; category: "uniform" | "book";
};

const EMPTY_FORM: ItemFormData = { name: "", size_scale: "", variants: "", grade: "", category: "uniform" };

// ── Shared Styles ────────────────────────────────────────────────────────────
const card = (c: string): React.CSSProperties => ({
  borderRadius: 16, border: "1px solid var(--border)", borderTop: `4px solid ${c}`, overflow: "hidden",
});
const hdr: React.CSSProperties = { display: "flex", alignItems: "center", gap: 10, marginBottom: 16 };
const icon = (bg: string): React.CSSProperties => ({
  width: 32, height: 32, borderRadius: 8, display: "flex", alignItems: "center",
  justifyContent: "center", fontSize: 15, background: bg, color: "#fff", flexShrink: 0,
});
const row: React.CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
  padding: "12px 14px", borderRadius: 12, backgroundColor: "var(--surface-soft)",
  border: "1px solid var(--border)", transition: "box-shadow 0.2s ease, border-color 0.2s ease",
};
const saveGrad: React.CSSProperties = {
  background: "linear-gradient(135deg,#10b981,#059669)", color: "#fff", border: "none", fontWeight: 600, borderRadius: 10,
};
const addBtn = (c: string): React.CSSProperties => ({
  borderRadius: 10, borderStyle: "dashed", borderColor: c, color: c, fontWeight: 600, transition: "all 0.2s ease",
});
const hoverIn = (accent: string) => (e: React.MouseEvent<HTMLDivElement>) => {
  e.currentTarget.style.boxShadow = "0 2px 12px rgba(0,0,0,0.08)";
  e.currentTarget.style.borderColor = accent;
};
const hoverOut = (e: React.MouseEvent<HTMLDivElement>) => {
  e.currentTarget.style.boxShadow = "none";
  e.currentTarget.style.borderColor = "var(--border)";
};
const actionBtn: React.CSSProperties = { borderRadius: 8, fontSize: 13 };
const fieldLabel: React.CSSProperties = { color: "var(--text-primary)", marginBottom: 8 };
const inputR: React.CSSProperties = { borderRadius: 10 };
const gridBtn: React.CSSProperties = { borderRadius: 12, padding: "12px 16px", justifyContent: "center", transition: "all 0.2s ease" };

// ── Component ────────────────────────────────────────────────────────────────
export default function SettingsTab({
  items, settings, schoolId, onSaveItem, onDeleteItem, onSaveSettings, onSeedDefaults,
}: SettingsTabProps) {
  const [academicYear, setAcademicYear] = React.useState(settings?.academic_year ?? ACADEMIC_YEAR);
  const [savingYear, setSavingYear] = React.useState(false);
  const [showItemModal, setShowItemModal] = React.useState(false);
  const [editingItem, setEditingItem] = React.useState<DistributionItem | null>(null);
  const [itemForm, setItemForm] = React.useState<ItemFormData>(EMPTY_FORM);
  const [savingItem, setSavingItem] = React.useState(false);
  const [bookGradeTab, setBookGradeTab] = React.useState<string>(GRADES[0].id);
  const [showResetConfirm, setShowResetConfirm] = React.useState(false);
  const [seeding, setSeeding] = React.useState(false);
  const [importing, setImporting] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // ── Derived Data ──────────────────────────────────────────────────────────
  const uniformItems = React.useMemo(
    () => items.filter((i) => i.category === "uniform").sort((a, b) => a.sort_order - b.sort_order),
    [items]
  );
  const booksByGrade = React.useMemo(() => {
    const map: Record<string, DistributionItem[]> = {};
    for (const item of items.filter((i) => i.category === "book")) {
      const grade = item.grade ?? "other";
      if (!map[grade]) map[grade] = [];
      map[grade].push(item);
    }
    return map;
  }, [items]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleSaveYear = React.useCallback(async () => {
    if (!academicYear.trim()) return;
    setSavingYear(true);
    try { await onSaveSettings({ academic_year: academicYear.trim() }); } finally { setSavingYear(false); }
  }, [academicYear, onSaveSettings]);

  const openAddUniform = React.useCallback(() => {
    setEditingItem(null); setItemForm({ ...EMPTY_FORM, category: "uniform" }); setShowItemModal(true);
  }, []);

  const openAddBook = React.useCallback((grade: string) => {
    setEditingItem(null); setItemForm({ ...EMPTY_FORM, category: "book", grade }); setShowItemModal(true);
  }, []);

  const openEditItem = React.useCallback((item: DistributionItem) => {
    setEditingItem(item);
    setItemForm({ name: item.name, size_scale: item.size_scale ?? "", variants: item.variants.join("، "), grade: item.grade ?? "", category: item.category });
    setShowItemModal(true);
  }, []);

  const handleSaveItem = React.useCallback(async () => {
    if (!itemForm.name.trim()) return;
    setSavingItem(true);
    try {
      const payload: Partial<DistributionItem> & { school_id: string } = {
        school_id: schoolId, name: itemForm.name.trim(), category: itemForm.category,
        size_scale: itemForm.category === "uniform" && itemForm.size_scale ? (itemForm.size_scale as "age" | "letter") : null,
        variants: itemForm.category === "uniform" && itemForm.variants.trim()
          ? itemForm.variants.split(/[,،]/).map((v) => v.trim()).filter(Boolean) : [],
        grade: itemForm.category === "book" ? itemForm.grade || null : null,
      };
      if (editingItem) payload.id = editingItem.id;
      await onSaveItem(payload);
      setShowItemModal(false);
    } finally { setSavingItem(false); }
  }, [itemForm, editingItem, schoolId, onSaveItem]);

  const handleDeleteItem = React.useCallback(async (itemId: string) => { await onDeleteItem(itemId); }, [onDeleteItem]);

  const handleSeedDefaults = React.useCallback(async () => {
    setSeeding(true);
    try { await onSeedDefaults(schoolId); } finally { setSeeding(false); }
  }, [schoolId, onSeedDefaults]);

  const handleExport = React.useCallback(() => {
    const data = { exportedAt: new Date().toISOString(), schoolId, settings, items };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `distribution-export-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  }, [schoolId, settings, items]);

  const handleImport = React.useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (data.settings) await onSaveSettings(data.settings);
      if (Array.isArray(data.items)) { for (const item of data.items) await onSaveItem({ ...item, school_id: schoolId }); }
    } catch (err) { console.error("Import failed:", err); }
    finally { setImporting(false); if (fileInputRef.current) fileInputRef.current.value = ""; }
  }, [onSaveSettings, onSaveItem, schoolId]);

  const handleResetRecords = React.useCallback(() => { setShowResetConfirm(true); }, []);

  // ── Render helpers ────────────────────────────────────────────────────────
  const renderItemRow = (item: DistributionItem, accent: string, isBook = false) => (
    <div key={item.id} style={row} onMouseEnter={hoverIn(accent)} onMouseLeave={hoverOut}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p className="text-sm font-medium truncate" style={{ color: "var(--text-primary)", marginBottom: isBook ? 0 : 6 }}>
          {item.name}
        </p>
        {!isBook && (
          <div className="flex flex-wrap gap-1.5">
            {item.size_scale && (
              <Badge variant="info" size="sm" style={{ borderRadius: 20, padding: "2px 10px" }}>
                {DEFAULT_SIZE_SCALES[item.size_scale]?.name ?? item.size_scale}
              </Badge>
            )}
            {item.variants.map((v) => (
              <Badge key={v} variant="neutral" size="sm" style={{ borderRadius: 20, padding: "2px 10px" }}>{v}</Badge>
            ))}
          </div>
        )}
      </div>
      <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
        <Button variant="ghost" size="sm" onClick={() => openEditItem(item)} style={actionBtn}>تعديل</Button>
        <Button variant="ghost" size="sm" onClick={() => handleDeleteItem(item.id)} className="hover:!text-[var(--danger)]" style={actionBtn}>حذف</Button>
      </div>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* ── Academic Year ──────────────────────────────────────────────── */}
      <Card style={card("#6366f1")}>
        <CardContent className="p-5">
          <div style={hdr}>
            <span style={icon("linear-gradient(135deg,#6366f1,#818cf8)")}>{"\u{1F4C5}"}</span>
            <h3 className="text-base font-semibold" style={{ margin: 0, color: "var(--text-primary)" }}>العام الدراسي</h3>
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 12 }}>
            <div style={{ flex: 1, maxWidth: 260 }}>
              <Input value={academicYear} onChange={(e) => setAcademicYear(e.target.value)}
                placeholder="مثال: 2026-2027" style={{ direction: "ltr", textAlign: "start", borderRadius: 10 }} />
            </div>
            <Button onClick={handleSaveYear} disabled={savingYear} style={savingYear ? undefined : saveGrad}>
              {savingYear ? "جارٍ الحفظ..." : "حفظ"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── Uniform Items ─────────────────────────────────────────────── */}
      <Card style={card("#f59e0b")}>
        <CardContent className="p-5">
          <div style={{ ...hdr, justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={icon("linear-gradient(135deg,#f59e0b,#fbbf24)")}>{"\u{1F455}"}</span>
              <h3 className="text-base font-semibold" style={{ margin: 0, color: "var(--text-primary)" }}>أصناف الزي المدرسي</h3>
            </div>
            <Button variant="outline" size="sm" onClick={openAddUniform} style={addBtn("#f59e0b")}>+ إضافة صنف</Button>
          </div>
          {uniformItems.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--text-secondary)", padding: "8px 0" }}>
              لا توجد أصناف. استخدم &quot;تحميل الافتراضيات&quot; أو أضف يدوياً.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {uniformItems.map((item) => renderItemRow(item, "#f59e0b40"))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Books ─────────────────────────────────────────────────────── */}
      <Card style={card("#0ea5e9")}>
        <CardContent className="p-5">
          <div style={hdr}>
            <span style={icon("linear-gradient(135deg,#0ea5e9,#38bdf8)")}>{"\u{1F4DA}"}</span>
            <h3 className="text-base font-semibold" style={{ margin: 0, color: "var(--text-primary)" }}>الكتب المنهجية</h3>
          </div>
          {/* Grade pill tabs */}
          <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 12, marginBottom: 16 }}>
            {GRADES.map((g) => {
              const active = bookGradeTab === g.id;
              return (
                <button key={g.id} type="button" onClick={() => setBookGradeTab(g.id)} style={{
                  padding: "6px 16px", borderRadius: 20, fontSize: 13, fontWeight: 600, whiteSpace: "nowrap",
                  border: active ? "none" : "1px solid var(--border)", cursor: "pointer", transition: "all 0.2s ease",
                  background: active ? "linear-gradient(135deg,#0ea5e9,#38bdf8)" : "transparent",
                  color: active ? "#fff" : "var(--text-secondary)",
                }}>{g.name}</button>
              );
            })}
          </div>
          <div>
            {(booksByGrade[bookGradeTab] ?? []).length === 0 ? (
              <p className="text-sm" style={{ color: "var(--text-secondary)", padding: "16px 0" }}>لا توجد كتب لهذا الصف.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {(booksByGrade[bookGradeTab] ?? []).map((book) => renderItemRow(book, "#0ea5e940", true))}
              </div>
            )}
            <Button variant="outline" size="sm" onClick={() => openAddBook(bookGradeTab)}
              style={{ marginTop: 12, ...addBtn("#0ea5e9") }}>+ إضافة كتاب</Button>
          </div>
        </CardContent>
      </Card>

      {/* ── Data Management ───────────────────────────────────────────── */}
      <Card style={card("#8b5cf6")}>
        <CardContent className="p-5">
          <div style={hdr}>
            <span style={icon("linear-gradient(135deg,#8b5cf6,#a78bfa)")}>{"\u{1F5C4}"}</span>
            <h3 className="text-base font-semibold" style={{ margin: 0, color: "var(--text-primary)" }}>بيانات</h3>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 10 }}>
            <Button variant="outline" onClick={handleSeedDefaults} disabled={seeding} style={gridBtn}>
              {seeding ? "جارٍ التحميل..." : "تحميل الافتراضيات"}
            </Button>
            <Button variant="outline" onClick={handleExport} style={gridBtn}>تصدير البيانات</Button>
            <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={importing} style={gridBtn}>
              {importing ? "جارٍ الاستيراد..." : "استيراد البيانات"}
            </Button>
            <input ref={fileInputRef} type="file" accept=".json" onChange={handleImport} className="hidden" aria-label="استيراد ملف بيانات" />
            <Button variant="outline" onClick={handleResetRecords}
              style={{ ...gridBtn, borderColor: "var(--danger)", color: "var(--danger)" }}>مسح السجلات</Button>
          </div>
        </CardContent>
      </Card>

      {/* ── Add/Edit Item Modal ───────────────────────────────────────── */}
      <Modal open={showItemModal} onClose={() => setShowItemModal(false)} size="md">
        <ModalHeader
          title={editingItem ? `تعديل: ${editingItem.name}` : itemForm.category === "uniform" ? "إضافة صنف زي" : "إضافة كتاب"}
          onClose={() => setShowItemModal(false)} />
        <ModalBody>
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div>
              <label className="block text-sm font-semibold" style={fieldLabel}>الاسم</label>
              <Input value={itemForm.name} onChange={(e) => setItemForm((p) => ({ ...p, name: e.target.value }))}
                placeholder={itemForm.category === "uniform" ? "مثال: تيشيرت صيفي" : "مثال: كتاب الرياضيات"} style={inputR} />
            </div>
            {itemForm.category === "uniform" && (
              <>
                <div>
                  <label className="block text-sm font-semibold" style={fieldLabel}>نظام المقاسات</label>
                  <Select value={itemForm.size_scale}
                    onChange={(e) => setItemForm((p) => ({ ...p, size_scale: e.target.value as "age" | "letter" | "" }))} style={inputR}>
                    <option value="">بدون مقاسات</option>
                    <option value="age">{DEFAULT_SIZE_SCALES.age.name}</option>
                    <option value="letter">{DEFAULT_SIZE_SCALES.letter.name}</option>
                  </Select>
                </div>
                <div>
                  <label className="block text-sm font-semibold" style={fieldLabel}>المتغيرات (مفصولة بفاصلة)</label>
                  <Input value={itemForm.variants} onChange={(e) => setItemForm((p) => ({ ...p, variants: e.target.value }))}
                    placeholder="مثال: بنطرون، تنورة" style={inputR} />
                  <p className="text-xs" style={{ color: "var(--text-tertiary)", marginTop: 6 }}>اتركه فارغاً إذا لا توجد متغيرات</p>
                </div>
              </>
            )}
            {itemForm.category === "book" && (
              <div>
                <label className="block text-sm font-semibold" style={fieldLabel}>الصف</label>
                <Select value={itemForm.grade} onChange={(e) => setItemForm((p) => ({ ...p, grade: e.target.value }))} style={inputR}>
                  <option value="">اختر الصف</option>
                  {GRADES.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </Select>
              </div>
            )}
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="outline" onClick={() => setShowItemModal(false)} style={inputR}>إلغاء</Button>
          <Button onClick={handleSaveItem} disabled={savingItem} style={savingItem ? inputR : saveGrad}>
            {savingItem ? "جارٍ الحفظ..." : editingItem ? "تحديث" : "إضافة"}
          </Button>
        </ModalFooter>
      </Modal>

      {/* ── Reset Confirmation Modal ──────────────────────────────────── */}
      <Modal open={showResetConfirm} onClose={() => setShowResetConfirm(false)} size="sm">
        <ModalHeader title="تأكيد مسح السجلات" onClose={() => setShowResetConfirm(false)} />
        <ModalBody>
          <div style={{
            padding: 16, borderRadius: 12,
            backgroundColor: "color-mix(in srgb, var(--danger) 8%, transparent)",
            border: "1px solid color-mix(in srgb, var(--danger) 20%, transparent)", marginBottom: 8,
          }}>
            <p className="text-sm" style={{ color: "var(--text-primary)", marginBottom: 8 }}>
              هل أنت متأكد من مسح جميع سجلات التوزيع لهذه المدرسة؟ هذا الإجراء لا يمكن التراجع عنه.
            </p>
            <p className="text-sm font-medium" style={{ color: "var(--danger)", margin: 0 }}>
              سيتم حذف جميع بيانات التسليم نهائياً.
            </p>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="outline" onClick={() => setShowResetConfirm(false)} style={inputR}>إلغاء</Button>
          <Button onClick={() => { setShowResetConfirm(false); }}
            style={{ background: "linear-gradient(135deg,#ef4444,#dc2626)", color: "#fff", border: "none", borderRadius: 10, fontWeight: 600 }}>
            مسح نهائي
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}