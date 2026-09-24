"use client";

import { useEffect, useState, useCallback } from "react";
import { usePathname, useParams } from "next/navigation";
import {
  FileText,
  CalendarDays,
  BookOpen,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  Send,
  Pencil,
  Paperclip,
  Award,
  Upload,
  X,
  AlertCircle,
} from "lucide-react";
import { StudentShell } from "@/components/StudentShell";
import { getLocaleFromPath } from "@/lib/locale-routing";
import { fetchJsonWithAuthorizedSession } from "@/lib/authorized-api";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface AssignmentAttachment {
  bucket: string;
  path: string;
  file_name: string;
  mime_type: string | null;
}

interface AssignmentDetail {
  id: string;
  title: string;
  subject: string | null;
  due_at: string | null;
  content_kind: string;
  description: string | null;
  created_at: string | null;
  max_grade: number;
  allow_late: boolean;
  status: string;
  attachment: AssignmentAttachment | null;
}

interface SubmissionDetail {
  id: string;
  notes: string | null;
  file_url: string | null;
  file_name: string | null;
  submitted_at: string | null;
  grade: number | null;
  feedback: string | null;
  graded_at: string | null;
  is_late: boolean;
  status: "submitted" | "graded" | "returned";
}

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export default function AssignmentDetailPage() {
  const pathname = usePathname();
  const { id } = useParams<{ id: string }>();
  const locale = getLocaleFromPath(pathname);
  const isAr = locale === "ar";
  const t = (ar: string, en: string) => (isAr ? ar : en);
  const BackArrow = isAr ? ArrowLeft : ArrowRight;

  const [assignment, setAssignment] = useState<AssignmentDetail | null>(null);
  const [submission, setSubmission] = useState<SubmissionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [notes, setNotes] = useState("");
  const [editing, setEditing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [downloadingAttachment, setDownloadingAttachment] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetchJsonWithAuthorizedSession(
        `/api/student/assignments/${id}`,
      );
      if (res.response.ok) {
        const payload = res.payload as {
          data: {
            assignment: AssignmentDetail;
            submission: SubmissionDetail | null;
          };
        };
        setAssignment(payload.data.assignment);
        setSubmission(payload.data.submission);
        if (payload.data.submission?.notes) {
          setNotes(payload.data.submission.notes);
        }
      }
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function uploadSelectedFile() {
    if (!selectedFile) return null;

    const urlRes = await fetchJsonWithAuthorizedSession(
      "/api/student/assignments/upload-url",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assignment_id: id,
          file_name: selectedFile.name,
          mime_type: selectedFile.type,
          size_bytes: selectedFile.size,
        }),
      },
    );

    if (!urlRes.response.ok) {
      throw new Error("upload_url_failed");
    }

    const { data } = urlRes.payload as {
      data: { bucket: string; path: string; signed_url: string; file_name: string };
    };

    const putRes = await fetch(data.signed_url, {
      method: "PUT",
      headers: { "Content-Type": selectedFile.type || "application/octet-stream" },
      body: selectedFile,
    });

    if (!putRes.ok) {
      throw new Error("upload_failed");
    }

    return {
      file_url: data.path,
      file_name: data.file_name,
      file_mime_type: selectedFile.type,
    };
  }

  async function handleSubmit() {
    if (!notes.trim() && !selectedFile && !submission?.file_url) return;
    setSubmitting(true);
    setError(null);
    setSuccess(false);

    try {
      let fileFields: {
        file_url?: string;
        file_name?: string;
        file_mime_type?: string;
      } = {};

      if (selectedFile) {
        if (selectedFile.size > MAX_UPLOAD_BYTES) {
          setError("file_too_large");
          setSubmitting(false);
          return;
        }
        const uploaded = await uploadSelectedFile();
        if (uploaded) fileFields = uploaded;
      }

      const res = await fetchJsonWithAuthorizedSession(
        `/api/student/assignments/${id}/submit`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ notes: notes.trim(), ...fileFields }),
        },
      );

      if (res.response.ok) {
        setSuccess(true);
        setEditing(false);
        setSelectedFile(null);
        await fetchData();
      } else {
        const p = res.payload as { error?: string };
        setError(p.error ?? "submit_failed");
      }
    } catch {
      setError("network_error");
    } finally {
      setSubmitting(false);
    }
  }

  async function openAttachment(bucket: string, path: string, fileName: string) {
    setDownloadingAttachment(true);
    try {
      const res = await fetchJsonWithAuthorizedSession(
        "/api/student/assignments/download-url",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bucket, path, file_name: fileName }),
        },
      );
      if (res.response.ok) {
        const { data } = res.payload as { data: { signed_url: string } };
        window.open(data.signed_url, "_blank", "noopener,noreferrer");
      }
    } catch {
      setError("network_error");
    } finally {
      setDownloadingAttachment(false);
    }
  }

  const isPast =
    assignment?.due_at ? new Date(assignment.due_at) < new Date() : false;
  const showForm = !submission || editing;

  return (
    <StudentShell
      currentPath="/student/assignments"
      titleAr="تسليم الواجب"
      titleEn="Submit Assignment"
    >
      <div className="max-w-3xl mx-auto space-y-5">
        {/* back link */}
        <a
          href={`/${locale}/student/assignments`}
          className="inline-flex items-center gap-1.5 text-sm text-[var(--primary)] hover:underline"
        >
          <BackArrow className="h-4 w-4" />
          {t("العودة للواجبات", "Back to assignments")}
        </a>

        {loading ? (
          <div className="space-y-4">
            <div className="h-40 rounded-2xl bg-[var(--card-bg)] border border-[var(--card-border)] animate-pulse" />
            <div className="h-52 rounded-2xl bg-[var(--card-bg)] border border-[var(--card-border)] animate-pulse" />
          </div>
        ) : loadError ? (
          <div className="flex items-center justify-center min-h-[60vh]">
            <Card className="max-w-md w-full">
              <CardContent className="pt-6 text-center">
                <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2">{t("حدث خطأ", "Something went wrong")}</h3>
                <p className="text-muted-foreground mb-4">{t("تعذر تحميل البيانات. حاول مرة أخرى.", "Failed to load data. Please try again.")}</p>
                <button onClick={() => window.location.reload()} className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:opacity-90">{t("إعادة المحاولة", "Retry")}</button>
              </CardContent>
            </Card>
          </div>
        ) : !assignment ? (
          <Card className="rounded-2xl">
            <CardContent className="p-8 text-center">
              <FileText className="h-12 w-12 text-[var(--text-muted)] mx-auto mb-3" />
              <p className="text-sm text-[var(--text-muted)]">
                {t("الواجب غير موجود", "Assignment not found")}
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* ── Assignment info ── */}
            <Card className="rounded-2xl">
              <CardContent className="p-5 sm:p-6 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <h2 className="text-base sm:text-lg font-bold text-[var(--text-primary)]">
                      {assignment.title}
                    </h2>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2">
                      {assignment.subject && (
                        <div className="flex items-center gap-1">
                          <BookOpen className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                          <span className="text-xs text-[var(--text-muted)]">
                            {assignment.subject}
                          </span>
                        </div>
                      )}
                      {assignment.due_at && (
                        <div className="flex items-center gap-1">
                          <CalendarDays className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                          <span className="text-xs text-[var(--text-muted)]">
                            {t("التسليم:", "Due:")}{" "}
                            {assignment.due_at.slice(0, 10)}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                  <Badge
                    variant={isPast ? "danger" : "success"}
                    size="sm"
                  >
                    {isPast
                      ? t("انتهى الموعد", "Past due")
                      : t("مفتوح", "Open")}
                  </Badge>
                </div>

                {assignment.description && (
                  <div className="rounded-xl bg-[var(--surface-soft)] p-4">
                    <p className="text-sm text-[var(--text-secondary)] whitespace-pre-wrap leading-relaxed">
                      {assignment.description}
                    </p>
                  </div>
                )}

                {assignment.attachment && (
                  <button
                    onClick={() =>
                      openAttachment(
                        assignment.attachment!.bucket,
                        assignment.attachment!.path,
                        assignment.attachment!.file_name,
                      )
                    }
                    disabled={downloadingAttachment}
                    className="inline-flex items-center gap-2 rounded-xl border border-[var(--card-border)] px-4 py-2 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-soft)] transition-colors disabled:opacity-50"
                  >
                    <Paperclip className="h-3.5 w-3.5" />
                    {assignment.attachment.file_name}
                  </button>
                )}

                <p className="text-xs text-[var(--text-muted)]">
                  {t("الدرجة القصوى:", "Max grade:")} {assignment.max_grade}
                  {assignment.allow_late
                    ? ` · ${t("يُسمح بالتأخير", "Late submissions allowed")}`
                    : ""}
                </p>
              </CardContent>
            </Card>

            {/* ── Grade & feedback ── */}
            {submission?.status === "graded" && submission.grade !== null && (
              <Card className="rounded-2xl border-[var(--primary)]/30">
                <CardContent className="p-5 sm:p-6 space-y-3">
                  <div className="flex items-center gap-2">
                    <Award className="h-5 w-5 text-[var(--primary)]" />
                    <span className="text-sm font-semibold text-[var(--text-primary)]">
                      {t("النتيجة:", "Grade:")} {submission.grade}/
                      {assignment.max_grade}
                    </span>
                  </div>
                  {submission.feedback && (
                    <div className="rounded-xl bg-[var(--surface-soft)] p-4">
                      <p className="text-sm text-[var(--text-secondary)] whitespace-pre-wrap">
                        {submission.feedback}
                      </p>
                    </div>
                  )}
                  {submission.graded_at && (
                    <p className="text-xs text-[var(--text-muted)]">
                      {t("تاريخ التصحيح:", "Graded at:")}{" "}
                      {new Date(submission.graded_at).toLocaleString(
                        isAr ? "ar" : "en",
                      )}
                    </p>
                  )}
                </CardContent>
              </Card>
            )}

            {/* ── Existing submission ── */}
            {submission && !editing && (
              <Card className="rounded-2xl border-[var(--success)]/30">
                <CardContent className="p-5 sm:p-6 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-5 w-5 text-[var(--success)]" />
                      <span className="text-sm font-semibold text-[var(--success)]">
                        {t("تم التسليم", "Submitted")}
                      </span>
                      {submission.is_late && (
                        <Badge variant="warning" size="sm">
                          {t("متأخر", "Late")}
                        </Badge>
                      )}
                    </div>
                    {submission.status !== "graded" && (
                      <button
                        onClick={() => setEditing(true)}
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--primary)] hover:underline"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        {t("تعديل", "Edit")}
                      </button>
                    )}
                  </div>

                  {submission.notes && (
                    <div className="rounded-xl bg-[var(--surface-soft)] p-4">
                      <p className="text-sm text-[var(--text-secondary)] whitespace-pre-wrap">
                        {submission.notes}
                      </p>
                    </div>
                  )}

                  {submission.file_url && (
                    <button
                      onClick={() =>
                        openAttachment(
                          "school-media",
                          submission.file_url!,
                          submission.file_name ?? "attachment",
                        )
                      }
                      disabled={downloadingAttachment}
                      className="inline-flex items-center gap-2 rounded-xl border border-[var(--card-border)] px-4 py-2 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-soft)] transition-colors disabled:opacity-50"
                    >
                      <Paperclip className="h-3.5 w-3.5" />
                      {submission.file_name ?? t("الملف المرفوع", "Uploaded file")}
                    </button>
                  )}

                  {submission.submitted_at && (
                    <p className="text-xs text-[var(--text-muted)]">
                      {t("تاريخ التسليم:", "Submitted at:")}{" "}
                      {new Date(submission.submitted_at).toLocaleString(
                        isAr ? "ar" : "en",
                      )}
                    </p>
                  )}
                </CardContent>
              </Card>
            )}

            {/* ── Submit / Edit form ── */}
            {showForm && (
              <Card className="rounded-2xl">
                <CardContent className="p-5 sm:p-6 space-y-4">
                  <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                    {submission
                      ? t("تعديل الإجابة", "Edit submission")
                      : t("تسليم الواجب", "Submit assignment")}
                  </h3>

                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder={t(
                      "اكتب إجابتك أو ملاحظاتك هنا...",
                      "Write your answer or notes here...",
                    )}
                    rows={6}
                    className="w-full rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/40 resize-y"
                    dir={isAr ? "rtl" : "ltr"}
                  />

                  <div className="flex items-center gap-3">
                    <label className="inline-flex items-center gap-2 rounded-xl border border-dashed border-[var(--card-border)] px-4 py-2.5 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-soft)] transition-colors cursor-pointer">
                      <Upload className="h-3.5 w-3.5" />
                      {selectedFile
                        ? selectedFile.name
                        : t("إرفاق ملف (اختياري، حتى 10 م.ب)", "Attach a file (optional, up to 10MB)")}
                      <input
                        type="file"
                        className="hidden"
                        onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
                        accept="image/jpeg,image/png,image/webp,application/pdf,.doc,.docx"
                      />
                    </label>
                    {selectedFile && (
                      <button
                        onClick={() => setSelectedFile(null)}
                        className="text-[var(--text-muted)] hover:text-[var(--danger)]"
                        aria-label={t("إزالة الملف", "Remove file")}
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>

                  {isPast && !assignment.allow_late && (
                    <p className="text-xs text-[var(--danger)]">
                      {t(
                        "انتهى موعد التسليم ولا يُسمح بالتسليم المتأخر لهذا الواجب.",
                        "The deadline has passed and late submissions are not allowed for this assignment.",
                      )}
                    </p>
                  )}

                  {error && (
                    <p className="text-xs text-[var(--danger)]">
                      {error === "notes_required"
                        ? t("يرجى كتابة إجابة أو إرفاق ملف", "Please write an answer or attach a file")
                        : error === "file_too_large"
                          ? t("حجم الملف يتجاوز 10 م.ب", "File exceeds 10MB")
                          : error === "deadline_passed"
                            ? t("انتهى موعد التسليم", "The deadline has passed")
                            : t("حدث خطأ، حاول مجدداً", "An error occurred, try again")}
                    </p>
                  )}

                  {success && (
                    <p className="text-xs text-[var(--success)]">
                      {t("تم التسليم بنجاح!", "Submitted successfully!")}
                    </p>
                  )}

                  <div className="flex items-center gap-3">
                    <button
                      onClick={handleSubmit}
                      disabled={
                        submitting ||
                        (!notes.trim() && !selectedFile && !submission?.file_url) ||
                        (isPast && !assignment.allow_late)
                      }
                      className="inline-flex items-center gap-2 rounded-xl bg-[var(--primary)] px-5 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                    >
                      <Send className="h-4 w-4" />
                      {submitting
                        ? t("جارٍ الإرسال...", "Submitting...")
                        : submission
                          ? t("حفظ التعديل", "Save changes")
                          : t("إرسال", "Submit")}
                    </button>

                    {editing && (
                      <button
                        onClick={() => {
                          setEditing(false);
                          setNotes(submission?.notes ?? "");
                        }}
                        className="text-sm text-[var(--text-muted)] hover:underline"
                      >
                        {t("إلغاء", "Cancel")}
                      </button>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </StudentShell>
  );
}
