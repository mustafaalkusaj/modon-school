"use client";

import * as React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type {
  DistributionItem, DistributionRecord, DistributionStock,
  DistributionSettings, StudentBasic,
} from "../_types";
import { GRADES } from "../_constants";

// ── Types ────────────────────────────────────────────────────────────────────
type CategoryFilter = "uniform" | "book";
interface StockTabProps {
  items: DistributionItem[];
  stock: DistributionStock[];
  records: Record<string, Record<string, DistributionRecord>>;
  students: StudentBasic[];
  settings: DistributionSettings | null;
  onUpdateStock: (
    itemId: string, size: string, variant: string, quantity: number
  ) => Promise<void>;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function getDeliveredCount(
  records: Record<string, Record<string, DistributionRecord>>,
  itemId: string, size?: string, variant?: string
): number {
  let count = 0;
  for (const studentRecords of Object.values(records)) {
    const rec = studentRecords[itemId];
    if (!rec || rec.status !== 1) continue;
    if (size && rec.size !== size) continue;
    if (variant && rec.variant !== variant) continue;
    count++;
  }
  return count;
}

function getStockQuantity(
  stock: DistributionStock[], itemId: string, size: string, variant: string
): number {
  const entry = stock.find(
    (s) => s.item_id === itemId && s.size === size && s.variant === variant
  );
  return entry?.quantity ?? 0;
}

const GRADE_ACCENTS = [
  "#6366f1","#8b5cf6","#a855f7","#d946ef","#ec4899","#f43f5e",
  "#f97316","#eab308","#22c55e","#14b8a6","#06b6d4","#3b82f6",
];
const pillGrad = "linear-gradient(135deg, var(--primary), color-mix(in oklch, var(--primary) 80%, #000))";
const stripGrad = "linear-gradient(90deg, var(--primary), color-mix(in oklch, var(--primary) 50%, transparent))";
const headGrad = "linear-gradient(180deg, var(--surface-soft), color-mix(in oklch, var(--surface-soft) 60%, transparent))";
const thStyle: React.CSSProperties = {
  color: "var(--text-tertiary)", borderBottom: "1px solid var(--border)", letterSpacing: "0.03em",
};
const inputExtra: React.CSSProperties = {
  direction: "ltr", borderRadius: 8, transition: "border-color 0.2s ease, box-shadow 0.2s ease",
};
const cardBase: React.CSSProperties = {
  borderRadius: 14, overflow: "hidden", border: "1px solid var(--border)",
  transition: "box-shadow 0.2s ease", boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
};

function RemainingPill({ hasStock, remaining }: { hasStock: boolean; remaining: number }) {
  const bg = !hasStock ? "var(--surface-soft)"
    : remaining > 0 ? "color-mix(in oklch, var(--success) 12%, transparent)"
    : "color-mix(in oklch, var(--danger) 12%, transparent)";
  const fg = !hasStock ? "var(--text-tertiary)" : remaining > 0 ? "var(--success)" : "var(--danger)";
  return (
    <span className="inline-flex items-center justify-center text-xs font-bold"
      style={{ minWidth: 32, padding: "3px 10px", borderRadius: 999, background: bg, color: fg, transition: "all 0.2s ease" }}>
      {hasStock ? remaining : "—"}
    </span>
  );
}

function EmptyState({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center"
      style={{ borderRadius: 16, border: "2px dashed var(--border)", background: "var(--surface-soft)" }}>
      <div style={{
        width: 56, height: 56, borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center",
        background: "linear-gradient(135deg, var(--primary), color-mix(in oklch, var(--primary) 60%, transparent))",
        marginBottom: 12, opacity: 0.15,
      }}>
        <span style={{ fontSize: 28 }}>{icon}</span>
      </div>
      <p className="text-sm" style={{ color: "var(--text-tertiary)" }}>{text}</p>
    </div>
  );
}

const TH_LABELS_UNIFORM = ["المقاس", "المخزون", "المسلّم", "المتبقي"];
const TH_LABELS_BOOK = ["الكتاب", "المخزون", "المسلّم", "المتبقي"];

function TableHead({ labels }: { labels: string[] }) {
  return (
    <thead>
      <tr style={{ background: headGrad }}>
        {labels.map((h, i) => (
          <th key={h} className={`${i === 0 ? "text-start" : "text-center"} px-3 py-2.5 font-semibold text-xs`} style={thStyle}>{h}</th>
        ))}
      </tr>
    </thead>
  );
}

// ── Component ────────────────────────────────────────────────────────────────
export default function StockTab({
  items, stock, records, settings, onUpdateStock,
}: StockTabProps) {
  const [category, setCategory] = React.useState<CategoryFilter>("uniform");
  const [pendingUpdates, setPendingUpdates] = React.useState<Record<string, boolean>>({});

  const uniformItems = React.useMemo(() => items.filter((i) => i.category === "uniform" && i.is_active), [items]);
  const bookItems = React.useMemo(() => items.filter((i) => i.category === "book" && i.is_active), [items]);

  const getSizes = React.useCallback((item: DistributionItem): string[] => {
    if (!item.size_scale || !settings) return ["--"];
    const scale = settings.size_scales[item.size_scale];
    return scale?.values ?? [];
  }, [settings]);

  const handleQuantityChange = React.useCallback(
    async (itemId: string, size: string, variant: string, value: string) => {
      const qty = parseInt(value, 10);
      if (isNaN(qty) || qty < 0) return;
      const key = `${itemId}-${size}-${variant}`;
      setPendingUpdates((prev) => ({ ...prev, [key]: true }));
      try { await onUpdateStock(itemId, size, variant, qty); }
      finally { setPendingUpdates((prev) => ({ ...prev, [key]: false })); }
    }, [onUpdateStock]
  );

  const booksByGrade = React.useMemo(() => {
    const map: Record<string, DistributionItem[]> = {};
    for (const item of bookItems) {
      const grade = item.grade ?? "other";
      if (!map[grade]) map[grade] = [];
      map[grade].push(item);
    }
    return map;
  }, [bookItems]);

  return (
    <div className="space-y-6">
      {/* ── Segmented Toggle ── */}
      <div className="inline-flex items-center p-1 gap-1"
        style={{ borderRadius: 999, border: "1.5px solid var(--border)", background: "var(--surface-soft)" }}>
        {(["uniform", "book"] as const).map((cat) => (
          <button key={cat} type="button" onClick={() => setCategory(cat)}
            className="px-5 py-2 text-sm font-semibold"
            style={{
              borderRadius: 999, border: "none", cursor: "pointer", letterSpacing: "0.02em",
              background: category === cat ? pillGrad : "transparent",
              color: category === cat ? "#fff" : "var(--text-tertiary)",
              transition: "all 0.2s ease",
            }}>
            {cat === "uniform" ? "الزي" : "الكتب"}
          </button>
        ))}
      </div>

      {/* ── Uniform Inventory ── */}
      {category === "uniform" && (
        <div className="space-y-5">
          {uniformItems.length === 0 && <EmptyState icon="👔" text="لا توجد أصناف زي مدرسي. أضف الأصناف من الإعدادات." />}
          {uniformItems.map((item) => {
            const sizes = getSizes(item);
            const variants = item.variants.length > 0 ? item.variants : ["--"];
            return (
              <Card key={item.id} style={cardBase}>
                <div style={{ height: 4, background: stripGrad }} />
                <CardContent className="p-5">
                  <h3 className="text-base font-bold mb-4"
                    style={{ color: "var(--text-primary)", paddingInlineStart: 10, borderInlineStart: "3px solid var(--primary)" }}>
                    {item.name}
                  </h3>
                  {variants.map((variant) => (
                    <div key={variant} className="mb-5 last:mb-0">
                      {variants.length > 1 && (
                        <p className="text-xs font-semibold mb-2 px-2 py-1 inline-block"
                          style={{ color: "var(--primary)", background: "color-mix(in oklch, var(--primary) 8%, transparent)", borderRadius: 6 }}>
                          {variant}
                        </p>
                      )}
                      <div className="overflow-x-auto" style={{ borderRadius: 10, border: "1px solid var(--border)" }}>
                        <table className="w-full text-sm" style={{ borderCollapse: "separate", borderSpacing: 0 }}>
                          <TableHead labels={TH_LABELS_UNIFORM} />
                          <tbody>
                            {sizes.map((size, idx) => {
                              const variantKey = variant === "--" ? "" : variant;
                              const stockQty = getStockQuantity(stock, item.id, size, variantKey);
                              const delivered = getDeliveredCount(records, item.id, size, variantKey || undefined);
                              const remaining = stockQty - delivered;
                              const hasStock = stockQty > 0;
                              const updateKey = `${item.id}-${size}-${variantKey}`;
                              return (
                                <tr key={size} className="hover:bg-[var(--surface-soft)]"
                                  style={{ borderBottom: idx < sizes.length - 1 ? "1px solid var(--border)" : "none", transition: "background 0.15s ease" }}>
                                  <td className="px-3 py-2.5 font-semibold text-sm" style={{ color: "var(--text-primary)" }}>{size}</td>
                                  <td className="px-3 py-2 text-center">
                                    <Input type="number" min={0} value={stockQty}
                                      onChange={(e) => handleQuantityChange(item.id, size, variantKey, e.target.value)}
                                      disabled={pendingUpdates[updateKey] ?? false}
                                      className="w-20 text-center mx-auto" style={inputExtra} />
                                  </td>
                                  <td className="px-3 py-2.5 text-center text-sm" style={{ color: "var(--text-tertiary)" }}>{delivered}</td>
                                  <td className="px-3 py-2.5 text-center"><RemainingPill hasStock={hasStock} remaining={remaining} /></td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* ── Books Inventory ── */}
      {category === "book" && (
        <div className="space-y-5">
          {Object.keys(booksByGrade).length === 0 && <EmptyState icon="📚" text="لا توجد كتب مسجلة. أضف الكتب من الإعدادات." />}
          {GRADES.map((grade, gradeIdx) => {
            const gradeBooks = booksByGrade[grade.id];
            if (!gradeBooks || gradeBooks.length === 0) return null;
            const accent = GRADE_ACCENTS[gradeIdx % GRADE_ACCENTS.length];
            return (
              <Card key={grade.id} style={cardBase}>
                <div style={{ height: 4, background: `linear-gradient(90deg, ${accent}, ${accent}44)` }} />
                <CardContent className="p-5">
                  <h3 className="text-base font-bold mb-4"
                    style={{ color: "var(--text-primary)", paddingInlineStart: 10, borderInlineStart: `3px solid ${accent}` }}>
                    {grade.name}
                  </h3>
                  <div className="overflow-x-auto" style={{ borderRadius: 10, border: "1px solid var(--border)" }}>
                    <table className="w-full text-sm" style={{ borderCollapse: "separate", borderSpacing: 0 }}>
                      <TableHead labels={TH_LABELS_BOOK} />
                      <tbody>
                        {gradeBooks.map((book, idx) => {
                          const stockQty = getStockQuantity(stock, book.id, "--", "");
                          const delivered = getDeliveredCount(records, book.id);
                          const remaining = stockQty - delivered;
                          const hasStock = stockQty > 0;
                          const updateKey = `${book.id}-----`;
                          return (
                            <tr key={book.id} className="hover:bg-[var(--surface-soft)]"
                              style={{ borderBottom: idx < gradeBooks.length - 1 ? "1px solid var(--border)" : "none", transition: "background 0.15s ease" }}>
                              <td className="px-3 py-2.5 text-sm" style={{ color: "var(--text-primary)" }}>{book.name}</td>
                              <td className="px-3 py-2 text-center">
                                <Input type="number" min={0} value={stockQty}
                                  onChange={(e) => handleQuantityChange(book.id, "--", "", e.target.value)}
                                  disabled={pendingUpdates[updateKey] ?? false}
                                  className="w-20 text-center mx-auto" style={inputExtra} />
                              </td>
                              <td className="px-3 py-2.5 text-center text-sm" style={{ color: "var(--text-tertiary)" }}>{delivered}</td>
                              <td className="px-3 py-2.5 text-center"><RemainingPill hasStock={hasStock} remaining={remaining} /></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}