"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { fetchJsonWithAuthorizedSession } from "@/lib/authorized-api";
import {
  X,
  AlertTriangle,
  Users,
  Loader2,
  Copy,
  Trash2,
  Merge,
  Check,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

type PaymentReceipt = {
  amount: number | null;
  receipt_number: string | null;
  manual_receipt_number: string | null;
};

type DuplicateStudent = {
  id: string;
  full_name: string;
  class_name: string | null;
  section: string | null;
  phone: string | null;
  status: string | null;
  created_at: string | null;
  paid_fee: number | null;
  total_fee: number | null;
  discount_value: number | null;
  receipts: PaymentReceipt[];
};

type DuplicateGroup = {
  name: string;
  count: number;
  students: DuplicateStudent[];
};

type DuplicatesResponse = {
  ok?: boolean;
  totalDuplicateGroups: number;
  totalDuplicateStudents: number;
  duplicates: DuplicateGroup[];
  error?: { message?: string };
};

interface DuplicateStudentsModalProps {
  show: boolean;
  onClose: () => void;
  schoolId: string | null;
  branchId: string | null;
}

export function DuplicateStudentsModal({
  show,
  onClose,
  schoolId,
  branchId,
}: DuplicateStudentsModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState<DuplicatesResponse | null>(null);
  const [copied, setCopied] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [merging, setMerging] = useState<string | null>(null);
  const [mergeSelection, setMergeSelection] = useState<Record<string, string>>(
    {},
  );
  const [actionMsg, setActionMsg] = useState("");

  const fetchDuplicates = useCallback(async () => {
    if (!schoolId) return;
    setLoading(true);
    setError("");
    setData(null);
    setActionMsg("");
    try {
      const params = new URLSearchParams({ schoolId });
      if (branchId) params.set("branchId", branchId);

      const { response, payload } =
        await fetchJsonWithAuthorizedSession<DuplicatesResponse>(
          `/api/dashboard/students/duplicates?${params.toString()}`,
        );

      if (!response.ok || !payload?.ok) {
        setError(payload?.error?.message ?? "حدث خطأ أثناء جلب البيانات");
        return;
      }
      setData(payload);
    } catch {
      setError("خطأ بالشبكة");
    } finally {
      setLoading(false);
    }
  }, [schoolId, branchId]);

  const handleOpen = useCallback(() => {
    if (!data && !loading) {
      void fetchDuplicates();
    }
  }, [data, loading, fetchDuplicates]);

  if (show && !data && !loading && !error) {
    handleOpen();
  }

  const handleDelete = useCallback(
    async (studentId: string) => {
      if (!schoolId) return;
      setDeletingId(studentId);
      setActionMsg("");
      try {
        const { response, payload } = await fetchJsonWithAuthorizedSession<{
          ok?: boolean;
          error?: { message?: string };
        }>(`/api/web/students/${studentId}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            school_id: schoolId,
            branch_id: branchId,
          }),
        });

        if (!response.ok || !payload?.ok) {
          setActionMsg(payload?.error?.message ?? "تعذر حذف الطالب");
          return;
        }

        setActionMsg("تم حذف الطالب بنجاح");
        void fetchDuplicates();
      } catch {
        setActionMsg("خطأ بالشبكة أثناء الحذف");
      } finally {
        setDeletingId(null);
      }
    },
    [schoolId, branchId, fetchDuplicates],
  );

  const handleMerge = useCallback(
    async (groupName: string, students: DuplicateStudent[]) => {
      if (!schoolId) return;
      const keepId = mergeSelection[groupName] ?? students[0].id;
      const mergeIds = students
        .filter((s) => s.id !== keepId)
        .map((s) => s.id);
      if (mergeIds.length === 0) return;

      setMerging(groupName);
      setActionMsg("");
      try {
        const { response, payload } = await fetchJsonWithAuthorizedSession<{
          ok?: boolean;
          mergedCount?: number;
          error?: { message?: string };
        }>("/api/dashboard/students/duplicates/merge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            schoolId,
            branchId,
            keepId,
            mergeIds,
          }),
        });

        if (!response.ok || !payload?.ok) {
          setActionMsg(payload?.error?.message ?? "تعذر دمج الطلاب");
          return;
        }

        setActionMsg(`تم دمج ${payload.mergedCount} طالب بنجاح`);
        void fetchDuplicates();
      } catch {
        setActionMsg("خطأ بالشبكة أثناء الدمج");
      } finally {
        setMerging(null);
      }
    },
    [schoolId, branchId, mergeSelection, fetchDuplicates],
  );

  const copyAll = useCallback(() => {
    if (!data) return;
    const lines = data.duplicates.flatMap((g) =>
      g.students.map(
        (s) =>
          `${s.full_name}\t${s.class_name ?? ""}\t${s.section ?? ""}\t${s.phone ?? ""}\t${s.status ?? ""}`,
      ),
    );
    const header = "الاسم\tالصف\tالشعبة\tالهاتف\tالحالة";
    navigator.clipboard.writeText([header, ...lines].join("\n")).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [data]);

  const formatDate = (iso: string | null) => {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleDateString("ar-IQ", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch {
      return "—";
    }
  };

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] w-full max-w-3xl max-h-[85vh] flex flex-col shadow-2xl"
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between p-5 border-b border-[var(--border)]">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5 text-amber-600" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-[var(--text)]">
                    الطلاب المتكررين والمتشابهين
                  </h2>
                  {data && (
                    <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                      {data.totalDuplicateGroups} مجموعة ·{" "}
                      {data.totalDuplicateStudents} طالب
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {data && data.duplicates.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={copyAll}
                    className="text-xs"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    {copied ? "تم النسخ" : "نسخ الكل"}
                  </Button>
                )}
                <button
                  type="button"
                  onClick={onClose}
                  className="p-2 rounded-lg hover:bg-[var(--surface-soft)] transition-colors"
                >
                  <X className="w-5 h-5 text-[var(--text-secondary)]" />
                </button>
              </div>
            </div>

            {/* Action message */}
            {actionMsg && (
              <div className="mx-5 mt-3 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700">
                {actionMsg}
              </div>
            )}

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-5 custom-scrollbar">
              {loading && (
                <div className="flex flex-col items-center justify-center py-16 gap-3">
                  <Loader2 className="w-8 h-8 text-[var(--primary)] animate-spin" />
                  <p className="text-sm text-[var(--text-secondary)]">
                    جاري البحث عن الطلاب المتكررين والمتشابهين...
                  </p>
                </div>
              )}

              {error && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                  {error}
                </div>
              )}

              {data && data.duplicates.length === 0 && (
                <div className="flex flex-col items-center justify-center py-16 gap-3">
                  <div className="w-14 h-14 rounded-2xl bg-green-100 flex items-center justify-center">
                    <Users className="w-7 h-7 text-green-600" />
                  </div>
                  <p className="text-base font-semibold text-[var(--text)]">
                    لا يوجد طلاب متكررين
                  </p>
                  <p className="text-sm text-[var(--text-secondary)]">
                    جميع أسماء الطلاب فريدة
                  </p>
                </div>
              )}

              {data && data.duplicates.length > 0 && (
                <div className="space-y-4">
                  {data.duplicates.map((group) => {
                    const selectedKeep =
                      mergeSelection[group.name] ?? group.students[0].id;
                    return (
                      <div
                        key={group.name}
                        className="rounded-xl border border-amber-200 bg-amber-50/50 overflow-hidden"
                      >
                        <div className="px-4 py-3 bg-amber-100/60 flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <AlertTriangle className="w-4 h-4 text-amber-600" />
                            <span className="font-bold text-sm text-amber-900">
                              {group.name}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-amber-700 bg-amber-200 px-2 py-0.5 rounded-full">
                              {group.count} مكرر
                            </span>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                handleMerge(group.name, group.students)
                              }
                              disabled={
                                merging === group.name || group.count < 2
                              }
                              className="text-xs border-blue-300 text-blue-700 hover:bg-blue-50"
                            >
                              {merging === group.name ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Merge className="w-3.5 h-3.5" />
                              )}
                              دمج
                            </Button>
                          </div>
                        </div>
                        <div className="divide-y divide-amber-100">
                          {group.students.map((student, idx) => (
                            <div
                              key={student.id}
                              className={`px-4 py-3 flex items-center justify-between gap-3 text-sm ${
                                selectedKeep === student.id
                                  ? "bg-green-50/60"
                                  : ""
                              }`}
                            >
                              <div className="flex items-center gap-3 min-w-0 flex-1">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setMergeSelection((prev) => ({
                                      ...prev,
                                      [group.name]: student.id,
                                    }))
                                  }
                                  className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 transition-colors ${
                                    selectedKeep === student.id
                                      ? "bg-green-500 text-white"
                                      : "bg-amber-200 text-amber-800 hover:bg-green-200"
                                  }`}
                                  title={
                                    selectedKeep === student.id
                                      ? "سيتم الاحتفاظ بهذا الطالب"
                                      : "اختر للاحتفاظ"
                                  }
                                >
                                  {selectedKeep === student.id ? (
                                    <Check className="w-3.5 h-3.5" />
                                  ) : (
                                    idx + 1
                                  )}
                                </button>
                                <div className="min-w-0 flex-1">
                                  <p className="font-medium text-[var(--text)] truncate">
                                    {student.full_name}
                                    {selectedKeep === student.id && (
                                      <span className="text-xs text-green-600 mr-2">
                                        (يُحتفظ به)
                                      </span>
                                    )}
                                  </p>
                                  <p className="text-xs text-[var(--text-tertiary)]">
                                    {student.class_name ?? "—"}{" "}
                                    {student.section
                                      ? `/ ${student.section}`
                                      : ""}{" "}
                                    · {student.phone ?? "بدون هاتف"} ·{" "}
                                    {formatDate(student.created_at)}
                                  </p>
                                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-xs text-[var(--text-secondary)]">
                                    {student.total_fee != null && (
                                      <span>الأجور: <b>{student.total_fee.toLocaleString("ar-IQ")}</b></span>
                                    )}
                                    {student.paid_fee != null && (
                                      <span>المدفوع: <b className="text-green-700">{student.paid_fee.toLocaleString("ar-IQ")}</b></span>
                                    )}
                                    {student.total_fee != null && student.paid_fee != null && (
                                      <span>المتبقي: <b className="text-red-600">{(student.total_fee - student.paid_fee).toLocaleString("ar-IQ")}</b></span>
                                    )}
                                    {student.discount_value != null && student.discount_value > 0 && (
                                      <span>خصم: {student.discount_value.toLocaleString("ar-IQ")}</span>
                                    )}
                                  </div>
                                  {student.receipts.length > 0 && (
                                    <div className="flex flex-wrap gap-1 mt-1">
                                      {student.receipts.map((r, ri) => (
                                        <span
                                          key={ri}
                                          className="inline-flex items-center gap-1 text-[10px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded"
                                        >
                                          وصل {r.manual_receipt_number ?? r.receipt_number ?? "—"}
                                          {r.amount != null && ` · ${r.amount.toLocaleString("ar-IQ")}`}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-2 flex-shrink-0">
                                <span
                                  className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                                    student.status === "active"
                                      ? "bg-green-100 text-green-700"
                                      : student.status === "suspended"
                                        ? "bg-red-100 text-red-700"
                                        : student.status === "transferred"
                                          ? "bg-blue-100 text-blue-700"
                                          : "bg-gray-100 text-gray-600"
                                  }`}
                                >
                                  {student.status === "active"
                                    ? "نشط"
                                    : student.status === "suspended"
                                      ? "موقوف"
                                      : student.status === "transferred"
                                        ? "منقول"
                                        : student.status === "deleted"
                                          ? "محذوف"
                                          : student.status ?? "—"}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => handleDelete(student.id)}
                                  disabled={deletingId === student.id}
                                  className="p-1.5 rounded-lg text-red-400 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
                                  title="حذف هذا الطالب"
                                >
                                  {deletingId === student.id ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                  ) : (
                                    <Trash2 className="w-4 h-4" />
                                  )}
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
