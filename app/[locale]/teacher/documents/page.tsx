"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { FileText, Download, Calendar, AlertTriangle } from "lucide-react";
import { TeacherShell } from "@/components/TeacherShell";
import { getLocaleFromPath } from "@/lib/locale-routing";
import { fetchJsonWithAuthorizedSession } from "@/lib/authorized-api";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";

interface DocumentRecord {
  id: string;
  title: string;
  document_type: string;
  file_path: string | null;
  image_url: string | null;
  expiry_date: string | null;
  notes: string | null;
  created_at: string;
}

function getExpiryStatus(
  expiryDate: string | null,
): "expired" | "expiring_soon" | "valid" | "none" {
  if (!expiryDate) return "none";
  const now = new Date();
  const expiry = new Date(expiryDate);
  if (expiry < now) return "expired";
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;
  if (expiry.getTime() - now.getTime() < thirtyDays) return "expiring_soon";
  return "valid";
}

export default function TeacherDocumentsPage() {
  const pathname = usePathname();
  const locale = getLocaleFromPath(pathname);
  const isAr = locale === "ar";
  const t = (ar: string, en: string) => (isAr ? ar : en);

  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchJsonWithAuthorizedSession("/api/teacher/documents")
      .then((res) => {
        if (res.response.ok) {
          setDocuments((res.payload as any)?.data?.documents ?? []);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <TeacherShell
      currentPath="/teacher/documents"
      titleAr="الوثائق"
      titleEn="Documents"
    >
      <div className="space-y-4 max-w-3xl mx-auto">
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-[100px] rounded-[var(--card-radius)] bg-[var(--card-bg)] border border-[var(--card-border)] animate-pulse"
              />
            ))}
          </div>
        ) : documents.length === 0 ? (
          <EmptyState
            icon={
              <FileText className="h-12 w-12 text-[var(--text-tertiary)]" />
            }
            title={t("لا توجد وثائق", "No documents")}
          />
        ) : (
          <div className="space-y-3">
            {documents.map((doc) => {
              const expiryStatus = getExpiryStatus(doc.expiry_date);
              const fileUrl = doc.file_path || doc.image_url;

              return (
                <Card key={doc.id}>
                  <CardContent className="pt-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 min-w-0 flex-1">
                        <FileText className="h-5 w-5 mt-0.5 shrink-0 text-[var(--primary)]" />
                        <div className="min-w-0 flex-1 space-y-1.5">
                          <p className="text-sm sm:text-base font-semibold text-[var(--text-primary)] truncate">
                            {doc.title}
                          </p>
                          <Badge variant="info" size="sm">
                            {doc.document_type}
                          </Badge>
                          {doc.expiry_date && (
                            <div className="flex items-center gap-1.5 text-xs">
                              {expiryStatus === "expired" ? (
                                <AlertTriangle className="h-3.5 w-3.5 text-[var(--danger)]" />
                              ) : expiryStatus === "expiring_soon" ? (
                                <AlertTriangle className="h-3.5 w-3.5 text-[var(--warning)]" />
                              ) : (
                                <Calendar className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                              )}
                              <span
                                className={
                                  expiryStatus === "expired"
                                    ? "text-[var(--danger)] font-medium"
                                    : expiryStatus === "expiring_soon"
                                      ? "text-[var(--warning)] font-medium"
                                      : "text-[var(--text-muted)]"
                                }
                              >
                                {expiryStatus === "expired"
                                  ? t("منتهي الصلاحية", "Expired")
                                  : expiryStatus === "expiring_soon"
                                    ? t("ينتهي قريباً", "Expiring soon")
                                    : t("ينتهي", "Expires")}{" "}
                                {new Date(doc.expiry_date).toLocaleDateString(
                                  isAr ? "ar-IQ" : "en-US",
                                )}
                              </span>
                            </div>
                          )}
                          {doc.notes && (
                            <p className="text-xs text-[var(--text-muted)] line-clamp-2">
                              {doc.notes}
                            </p>
                          )}
                        </div>
                      </div>
                      {fileUrl && (
                        <a
                          href={fileUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="shrink-0 flex items-center gap-1 text-xs font-medium text-[var(--primary)] hover:underline"
                        >
                          <Download className="h-4 w-4" />
                          <span className="hidden sm:inline">
                            {t("عرض", "View")}
                          </span>
                        </a>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </TeacherShell>
  );
}
