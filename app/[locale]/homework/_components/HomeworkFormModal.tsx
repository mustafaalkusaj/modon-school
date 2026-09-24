"use client";

import { useEffect, useState } from "react";
import { Upload } from "lucide-react";

import { Modal, ModalHeader, ModalBody, ModalFooter } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { fetchJsonWithAuthorizedSession } from "@/lib/authorized-api";
import type { HomeworkRow } from "../page";

export interface HomeworkFormValues {
  title: string;
  description: string | null;
  subject: string;
  class_name: string;
  section: string | null;
  due_at: string | null;
  max_grade: number;
  allow_late: boolean;
  status: "active" | "draft" | "archived";
  attachment?: {
    bucket: string;
    path: string;
    file_name: string;
    mime_type: string | null;
    size_bytes: number;
  } | null;
}

interface HomeworkFormModalProps {
  open: boolean;
  onClose: () => void;
  onSave: (values: HomeworkFormValues) => void;
  saving: boolean;
  error: string | null;
  initial: HomeworkRow | null;
}

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export function HomeworkFormModal({
  open,
  onClose,
  onSave,
  saving,
  error,
  initial,
}: HomeworkFormModalProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [subject, setSubject] = useState("");
  const [className, setClassName] = useState("");
  const [section, setSection] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [maxGrade, setMaxGrade] = useState(100);
  const [allowLate, setAllowLate] = useState(false);
  const [status, setStatus] = useState<"active" | "draft" | "archived">("active");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle(initial?.title ?? "");
    setDescription("");
    setSubject(initial?.subject ?? "");
    setClassName(initial?.class_name ?? "");
    setSection(initial?.section ?? "");
    setDueAt(initial?.due_at ? initial.due_at.slice(0, 10) : "");
    setMaxGrade(initial?.max_grade ?? 100);
    setAllowLate(initial?.allow_late ?? false);
    setStatus((initial?.status as "active" | "draft" | "archived") ?? "active");
    setFile(null);
    setUploadError(null);
  }, [open, initial]);

  async function handleSubmit() {
    if (!title.trim() || !subject.trim() || !className.trim()) return;

    let attachment: HomeworkFormValues["attachment"] = null;

    if (file) {
      if (file.size > MAX_UPLOAD_BYTES) {
        setUploadError("حجم الملف يتجاوز 10 م.ب.");
        return;
      }
      setUploading(true);
      setUploadError(null);
      try {
        const urlRes = await fetchJsonWithAuthorizedSession(
          "/api/teacher/homework/upload-url",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              file_name: file.name,
              mime_type: file.type,
              size_bytes: file.size,
            }),
          },
        );
        if (!urlRes.response.ok) throw new Error("upload_url_failed");
        const { data } = urlRes.payload as {
          data: { bucket: string; path: string; signed_url: string; file_name: string };
        };
        const putRes = await fetch(data.signed_url, {
          method: "PUT",
          headers: { "Content-Type": file.type || "application/octet-stream" },
          body: file,
        });
        if (!putRes.ok) throw new Error("upload_failed");
        attachment = {
          bucket: data.bucket,
          path: data.path,
          file_name: data.file_name,
          mime_type: file.type,
          size_bytes: file.size,
        };
      } catch {
        setUploadError("تعذر رفع الملف. حاول مجدداً.");
        setUploading(false);
        return;
      } finally {
        setUploading(false);
      }
    }

    onSave({
      title: title.trim(),
      description: description.trim() || null,
      subject: subject.trim(),
      class_name: className.trim(),
      section: section.trim() || null,
      due_at: dueAt || null,
      max_grade: maxGrade,
      allow_late: allowLate,
      status,
      attachment,
    });
  }

  return (
    <Modal open={open} onClose={onClose} size="md">
      <ModalHeader
        title={initial ? "تعديل الواجب" : "واجب جديد"}
        description="الواجب يظهر فقط للصف/المادة المسندة إليك."
        onClose={onClose}
      />
      <ModalBody className="space-y-4">
        <div>
          <label className="text-xs font-medium text-[var(--text-secondary)] mb-1.5 block">
            العنوان
          </label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={240} />
        </div>

        <div>
          <label className="text-xs font-medium text-[var(--text-secondary)] mb-1.5 block">
            الوصف
          </label>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-[var(--text-secondary)] mb-1.5 block">
              المادة
            </label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
          <div>
            <label className="text-xs font-medium text-[var(--text-secondary)] mb-1.5 block">
              الصف
            </label>
            <Input value={className} onChange={(e) => setClassName(e.target.value)} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-[var(--text-secondary)] mb-1.5 block">
              الشعبة (اختياري)
            </label>
            <Input value={section} onChange={(e) => setSection(e.target.value)} />
          </div>
          <div>
            <label className="text-xs font-medium text-[var(--text-secondary)] mb-1.5 block">
              موعد التسليم
            </label>
            <Input type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-[var(--text-secondary)] mb-1.5 block">
              الدرجة القصوى
            </label>
            <Input
              type="number"
              min={1}
              value={maxGrade}
              onChange={(e) => setMaxGrade(Number(e.target.value) || 100)}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-[var(--text-secondary)] mb-1.5 block">
              الحالة
            </label>
            <Select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
              <option value="active">نشط</option>
              <option value="draft">مسودة</option>
              <option value="archived">مؤرشف</option>
            </Select>
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
          <input
            type="checkbox"
            checked={allowLate}
            onChange={(e) => setAllowLate(e.target.checked)}
            className="rounded border-[var(--card-border)]"
          />
          السماح بالتسليم المتأخر
        </label>

        <div>
          <label className="inline-flex items-center gap-2 rounded-xl border border-dashed border-[var(--card-border)] px-4 py-2.5 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-soft)] transition-colors cursor-pointer">
            <Upload className="h-3.5 w-3.5" />
            {file ? file.name : "إرفاق ملف مرجعي (اختياري، حتى 10 م.ب)"}
            <input
              type="file"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              accept="image/jpeg,image/png,image/webp,application/pdf,.doc,.docx"
            />
          </label>
        </div>

        {(error || uploadError) && (
          <p className="text-xs text-[var(--danger)]">{uploadError ?? error}</p>
        )}
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>
          إلغاء
        </Button>
        <Button
          variant="primary"
          onClick={handleSubmit}
          loading={saving || uploading}
          disabled={!title.trim() || !subject.trim() || !className.trim()}
        >
          {initial ? "حفظ التعديل" : "نشر الواجب"}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
