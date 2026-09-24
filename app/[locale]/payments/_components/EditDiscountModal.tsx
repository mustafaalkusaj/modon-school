"use client";

import React from "react";
import {
  Modal,
  ModalHeader,
  ModalBody,
  ModalFooter,
} from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import type { Student } from "../_types";

interface EditDiscountModalProps {
  show: boolean;
  student: Student | null;
  saving: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (studentId: string, discountValue: number) => void;
}

export function EditDiscountModal({
  show,
  student,
  saving,
  error,
  onClose,
  onSubmit,
}: EditDiscountModalProps) {
  const [value, setValue] = React.useState("");

  React.useEffect(() => {
    if (show && student) {
      setValue(String(student.discount_value ?? 0));
    }
  }, [show, student]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!student) return;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) return;
    onSubmit(student.id, parsed);
  };

  if (!student) return null;

  return (
    <Modal open={show} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <ModalHeader
          title={`تعديل التخفيض — ${student.full_name}`}
          onClose={onClose}
        />
        <ModalBody>
          <div className="space-y-4">
            <div>
              <label
                htmlFor="discount-value"
                className="block text-sm font-medium text-[var(--text-secondary)] mb-1"
              >
                قيمة التخفيض
              </label>
              <input
                id="discount-value"
                type="number"
                min="0"
                step="any"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--card-bg)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                autoFocus
                dir="ltr"
              />
            </div>

            <div className="text-xs text-[var(--text-muted)] space-y-1">
              <p>إجمالي الرسوم: {student.total_fee?.toLocaleString()}</p>
              <p>المدفوع: {student.paid_fee?.toLocaleString()}</p>
            </div>

            {error && (
              <p className="text-sm text-[var(--danger)]">{error}</p>
            )}
          </div>
        </ModalBody>
        <ModalFooter>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            disabled={saving}
          >
            إلغاء
          </Button>
          <Button type="submit" variant="primary" size="sm" disabled={saving}>
            {saving ? "جاري الحفظ..." : "حفظ"}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
