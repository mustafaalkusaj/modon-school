"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useParams, useRouter } from "next/navigation";
import {
  ClipboardList,
  Clock,
  AlertCircle,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import { StudentShell } from "@/components/StudentShell";
import { getLocaleFromPath } from "@/lib/locale-routing";
import { fetchJsonWithAuthorizedSession } from "@/lib/authorized-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Radio } from "@/components/ui/radio";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/ui/empty-state";

const AUTOSAVE_INTERVAL_MS = 25_000;

interface ExamDetail {
  id: string;
  title: string;
  subject: string | null;
  type: string | null;
  total_marks: number | null;
  starts_at: string | null;
  ends_at: string | null;
  active_attempt_id: string | null;
  attempts_count: number;
  settings: {
    duration_minutes: number | null;
    instructions: string | null;
    allow_review: boolean;
  } | null;
  attempts: Array<{
    id: string;
    score: number | null;
    total: number | null;
    status: string | null;
    submitted_at: string | null;
    can_see_details: boolean;
  }>;
}

interface ExamQuestion {
  id: string;
  prompt: string;
  type: string | null;
  options: string[] | null;
  marks: number | null;
  sort_order: number | null;
}

interface AttemptState {
  attemptId: string;
  questions: ExamQuestion[];
  remainingSeconds: number;
}

type AnswerMap = Record<string, unknown>;

export default function StudentExamTakingPage() {
  const pathname = usePathname();
  const routeParams = useParams<{ examId: string }>();
  const router = useRouter();
  const locale = getLocaleFromPath(pathname);
  const isAr = locale === "ar";
  const t = (ar: string, en: string) => (isAr ? ar : en);
  const examId = routeParams.examId;

  const [exam, setExam] = useState<ExamDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState<AttemptState | null>(null);
  const [answers, setAnswers] = useState<AnswerMap>({});

  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitResult, setSubmitResult] = useState<{
    status: string;
    score: number | null;
    resultsPending: boolean;
  } | null>(null);

  const answersRef = useRef<AnswerMap>({});
  answersRef.current = answers;

  const loadDetail = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    fetchJsonWithAuthorizedSession(`/api/student/exams/${examId}`)
      .then((res) => {
        if (!res.response.ok) {
          setLoadError(
            (res.payload as { error?: string } | null)?.error ??
              "load_failed",
          );
          return;
        }
        const data = (res.payload as { data?: { exam: ExamDetail } } | null)
          ?.data;
        setExam(data?.exam ?? null);
      })
      .catch(() => setLoadError("network_error"))
      .finally(() => setLoading(false));
  }, [examId]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  const latestAttemptSummary = exam?.attempts?.[exam.attempts.length - 1] ?? null;
  const alreadyTerminal =
    !exam?.active_attempt_id &&
    latestAttemptSummary != null &&
    latestAttemptSummary.status !== "in_progress";

  const handleStart = useCallback(async () => {
    setStarting(true);
    setStartError(null);
    try {
      const res = await fetchJsonWithAuthorizedSession(
        `/api/student/exams/${examId}/start`,
        { method: "POST" },
      );
      if (!res.response.ok) {
        setStartError(
          (res.payload as { error?: string } | null)?.error ?? "start_failed",
        );
        return;
      }
      const data = (
        res.payload as {
          data?: {
            attempt_id: string;
            questions: ExamQuestion[];
            remaining_seconds: number;
          };
        } | null
      )?.data;
      if (!data) {
        setStartError("start_failed");
        return;
      }
      setAttempt({
        attemptId: data.attempt_id,
        questions: data.questions ?? [],
        remainingSeconds: data.remaining_seconds ?? 0,
      });
      setAnswers({});
    } catch {
      setStartError("network_error");
    } finally {
      setStarting(false);
    }
  }, [examId]);

  const persistAnswers = useCallback(
    async (currentAnswers: AnswerMap, attemptId: string) => {
      setSaving(true);
      try {
        const payload = Object.entries(currentAnswers).map(
          ([question_id, answer]) => ({ question_id, answer }),
        );
        const res = await fetchJsonWithAuthorizedSession(
          `/api/student/exams/${examId}/autosave`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              attempt_id: attemptId,
              answers: payload,
            }),
          },
        );
        if (res.response.ok) {
          setSavedAt(new Date().toISOString());
        }
      } catch {
        // Autosave failures are silent — the next interval/change retries.
      } finally {
        setSaving(false);
      }
    },
    [examId],
  );

  // Periodic autosave while an attempt is active.
  useEffect(() => {
    if (!attempt) return;
    const interval = window.setInterval(() => {
      if (Object.keys(answersRef.current).length > 0) {
        persistAnswers(answersRef.current, attempt.attemptId);
      }
    }, AUTOSAVE_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [attempt, persistAnswers]);

  // Debounced autosave on answer change.
  const debounceRef = useRef<number | null>(null);
  const handleAnswerChange = useCallback(
    (questionId: string, value: unknown) => {
      setAnswers((prev) => ({ ...prev, [questionId]: value }));
      if (!attempt) return;
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
      debounceRef.current = window.setTimeout(() => {
        persistAnswers({ ...answersRef.current, [questionId]: value }, attempt.attemptId);
      }, 1500);
    },
    [attempt, persistAnswers],
  );

  const handleSubmit = useCallback(async () => {
    if (!attempt) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const payload = Object.entries(answersRef.current)
        .filter(([, value]) => value !== null && value !== undefined && value !== "")
        .map(([question_id, answer]) => ({ question_id, answer }));

      const res = await fetchJsonWithAuthorizedSession(
        `/api/student/exams/${examId}/submit`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            attempt_id: attempt.attemptId,
            answers: payload,
          }),
        },
      );
      if (!res.response.ok) {
        setSubmitError(
          (res.payload as { error?: string } | null)?.error ?? "submit_failed",
        );
        return;
      }
      const data = (
        res.payload as {
          data?: {
            status: string;
            score: number | null;
            results_pending_release: boolean;
          };
        } | null
      )?.data;
      setSubmitResult({
        status: data?.status ?? "submitted",
        score: data?.score ?? null,
        resultsPending: Boolean(data?.results_pending_release),
      });
      setAttempt(null);
      loadDetail();
    } catch {
      setSubmitError("network_error");
    } finally {
      setSubmitting(false);
    }
  }, [attempt, examId, loadDetail]);

  const answeredCount = useMemo(
    () =>
      Object.values(answers).filter(
        (v) => v !== null && v !== undefined && v !== "",
      ).length,
    [answers],
  );

  if (loading) {
    return (
      <StudentShell currentPath="/student/exams" titleAr="الامتحان" titleEn="Exam">
        <div className="h-[300px] rounded-[var(--card-radius)] bg-[var(--card-bg)] border border-[var(--card-border)] animate-pulse" />
      </StudentShell>
    );
  }

  if (loadError || !exam) {
    return (
      <StudentShell currentPath="/student/exams" titleAr="الامتحان" titleEn="Exam">
        <EmptyState
          icon={<AlertCircle className="h-12 w-12 text-[var(--danger)]" />}
          title={t("تعذر تحميل الامتحان", "Could not load exam")}
        />
      </StudentShell>
    );
  }

  return (
    <StudentShell
      currentPath="/student/exams"
      titleAr={exam.title}
      titleEn={exam.title}
    >
      <div className="space-y-6 max-w-3xl">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-4">
              <CardTitle>{exam.title}</CardTitle>
              {exam.total_marks != null && (
                <Badge variant="info">
                  {t("الدرجة الكلية", "Total")}: {exam.total_marks}
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {exam.subject && (
              <p className="text-sm text-[var(--text-muted)]">
                {t("المادة", "Subject")}: {exam.subject}
              </p>
            )}
            {exam.settings?.duration_minutes != null && (
              <div className="flex items-center gap-1 text-sm text-[var(--text-muted)]">
                <Clock className="h-4 w-4" />
                {exam.settings.duration_minutes} {t("دقيقة", "minutes")}
              </div>
            )}
            {exam.settings?.instructions && (
              <p className="text-sm text-[var(--text-secondary)] whitespace-pre-wrap">
                {exam.settings.instructions}
              </p>
            )}
          </CardContent>
        </Card>

        {submitResult ? (
          <Card>
            <CardContent className="p-6 text-center space-y-3">
              <CheckCircle2 className="h-10 w-10 text-[var(--success)] mx-auto" />
              <p className="font-semibold text-[var(--text-primary)]">
                {t("تم تسليم الامتحان بنجاح", "Exam submitted successfully")}
              </p>
              {submitResult.resultsPending ? (
                <p className="text-sm text-[var(--text-muted)]">
                  {t(
                    "ستظهر النتيجة بعد التصحيح.",
                    "Your result will appear after grading.",
                  )}
                </p>
              ) : (
                <p className="text-sm text-[var(--text-muted)]">
                  {t("درجتك", "Your score")}: {submitResult.score ?? "—"}
                </p>
              )}
              <Button
                variant="outline"
                onClick={() => router.push(`/${locale}/student/exams`)}
              >
                {t("العودة إلى الامتحانات", "Back to exams")}
              </Button>
            </CardContent>
          </Card>
        ) : attempt ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between text-sm text-[var(--text-muted)]">
              <span>
                {t("تمت الإجابة", "Answered")}: {answeredCount}/
                {attempt.questions.length}
              </span>
              <span className="flex items-center gap-1">
                {saving && <Loader2 className="h-3 w-3 animate-spin" />}
                {savedAt
                  ? t("تم الحفظ", "Saved")
                  : t("لم يتم الحفظ بعد", "Not saved yet")}
              </span>
            </div>

            {attempt.questions.map((q, idx) => (
              <QuestionCard
                key={q.id}
                index={idx}
                question={q}
                value={answers[q.id]}
                onChange={(value) => handleAnswerChange(q.id, value)}
                t={t}
              />
            ))}

            {submitError && (
              <p className="text-sm text-[var(--danger)]">{submitError}</p>
            )}

            <Button
              variant="primary"
              size="lg"
              loading={submitting}
              onClick={handleSubmit}
              className="w-full"
            >
              {t("تسليم الامتحان", "Submit exam")}
            </Button>
          </div>
        ) : alreadyTerminal ? (
          <Card>
            <CardContent className="p-6 text-center space-y-3">
              <ClipboardList className="h-10 w-10 text-[var(--text-tertiary)] mx-auto" />
              <p className="font-semibold text-[var(--text-primary)]">
                {t("تم تسليم هذا الامتحان مسبقاً", "This exam was already submitted")}
              </p>
              {latestAttemptSummary?.can_see_details ? (
                <p className="text-sm text-[var(--text-muted)]">
                  {t("درجتك", "Your score")}: {latestAttemptSummary.score ?? "—"} /{" "}
                  {latestAttemptSummary.total ?? exam.total_marks ?? "—"}
                </p>
              ) : (
                <p className="text-sm text-[var(--text-muted)]">
                  {t(
                    "بانتظار التصحيح.",
                    "Awaiting grading.",
                  )}
                </p>
              )}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-6 text-center space-y-3">
              {startError && (
                <p className="text-sm text-[var(--danger)]">{startError}</p>
              )}
              <Button
                variant="primary"
                size="lg"
                loading={starting}
                onClick={handleStart}
              >
                {exam.active_attempt_id
                  ? t("متابعة الامتحان", "Continue exam")
                  : t("بدء الامتحان", "Start exam")}
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </StudentShell>
  );
}

function QuestionCard({
  index,
  question,
  value,
  onChange,
  t,
}: {
  index: number;
  question: ExamQuestion;
  value: unknown;
  onChange: (value: unknown) => void;
  t: (ar: string, en: string) => string;
}) {
  const isChoice =
    question.type === "multiple_choice" || question.type === "true_false";
  const options =
    question.options ??
    (question.type === "true_false" ? ["true", "false"] : null);

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm font-medium text-[var(--text-primary)]">
            {index + 1}. {question.prompt}
          </p>
          {question.marks != null && (
            <Badge variant="neutral" size="sm">
              {question.marks} {t("درجة", "pts")}
            </Badge>
          )}
        </div>

        {isChoice && options ? (
          <div className="space-y-2">
            {options.map((opt) => (
              <Radio
                key={opt}
                name={`q-${question.id}`}
                label={opt}
                checked={value === opt}
                onChange={() => onChange(opt)}
              />
            ))}
          </div>
        ) : (
          <Textarea
            value={typeof value === "string" ? value : ""}
            onChange={(e) => onChange(e.target.value)}
            placeholder={t("اكتب إجابتك هنا...", "Write your answer here...")}
          />
        )}
      </CardContent>
    </Card>
  );
}
