// ============================================================
// Event-driven Notifications (Phase 3)
// ------------------------------------------------------------
// Builds the proper Arabic title/message for each domain event
// and dispatches via the reusable push helper.
//
// Every function is defensive: it resolves the recipient's
// auth_user_id, builds the message, and calls sendPushNotification
// (which itself never throws). Callers should still wrap invocations
// in try/catch so a notification failure can never break the main write.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { sendPushNotification, type PushNotificationResult } from "@/lib/push-notifications";

interface BaseEventCtx {
  supabase: SupabaseClient;
  schoolId: string;
  branchId?: string | null;
}

const EMPTY_RESULT: PushNotificationResult = {
  targeted: 0,
  inAppSaved: 0,
  sent: 0,
  failed: 0,
  deactivatedTokens: 0,
  errors: [],
};

/**
 * Resolve the auth_user_id for a student record id (so notifications
 * land on the account the student actually logs in with).
 */
async function resolveStudentAuthUserId(
  supabase: SupabaseClient,
  schoolId: string,
  studentId: string,
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from("students")
      .select("auth_user_id")
      .eq("id", studentId)
      .eq("school_id", schoolId)
      .maybeSingle();
    if (error || !data) return null;
    const authUserId = (data as { auth_user_id: string | null }).auth_user_id;
    return authUserId && authUserId.trim() ? authUserId : null;
  } catch {
    return null;
  }
}

/**
 * Resolve the auth_user_id for a teacher record id.
 */
async function resolveTeacherAuthUserId(
  supabase: SupabaseClient,
  schoolId: string,
  teacherId: string,
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from("teachers")
      .select("auth_user_id")
      .eq("id", teacherId)
      .eq("school_id", schoolId)
      .maybeSingle();
    if (error || !data) return null;
    const authUserId = (data as { auth_user_id: string | null }).auth_user_id;
    return authUserId && authUserId.trim() ? authUserId : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------
// Homework submission received (student → teacher)
// ------------------------------------------------------------
export async function notifySubmissionReceived(
  ctx: BaseEventCtx & {
    teacherId: string;
    studentName?: string | null;
    title: string;
  },
): Promise<PushNotificationResult> {
  const userId = await resolveTeacherAuthUserId(ctx.supabase, ctx.schoolId, ctx.teacherId);
  if (!userId) return EMPTY_RESULT;

  const namePart = ctx.studentName ? ` من الطالب ${ctx.studentName}` : "";

  return sendPushNotification(ctx.supabase, {
    schoolId: ctx.schoolId,
    branchId: ctx.branchId ?? null,
    userIds: [userId],
    type: "assignment",
    title: "تسليم واجب جديد",
    message: `تم استلام تسليم جديد${namePart} لواجب "${ctx.title}".`,
    link: "/homework",
    recipientRole: "teacher",
    metadata: { teacher_id: ctx.teacherId, title: ctx.title },
  });
}

// ------------------------------------------------------------
// New grade
// ------------------------------------------------------------
export async function notifyNewGrade(
  ctx: BaseEventCtx & {
    studentId: string;
    subject?: string | null;
    score?: number | null;
    maxScore?: number | null;
  },
): Promise<PushNotificationResult> {
  const allIds = await resolveStudentAndParents(ctx.supabase, ctx.schoolId, ctx.studentId);
  if (allIds.length === 0) return EMPTY_RESULT;

  const subjectPart = ctx.subject ? ` في مادة ${ctx.subject}` : "";
  // Store policy (Apple 4.5.4): the visible notification text must not carry
  // the actual score — it can appear on a locked screen. Details stay in-app.
  return sendPushNotification(ctx.supabase, {
    schoolId: ctx.schoolId,
    branchId: ctx.branchId ?? null,
    userIds: allIds,
    type: "grade",
    title: "درجة جديدة",
    message: `تم رصد درجة جديدة${subjectPart}. اطّلع على التفاصيل داخل التطبيق.`,
    link: "/grades",
    recipientRole: "student",
    metadata: { student_id: ctx.studentId, subject: ctx.subject ?? null },
  });
}

// ------------------------------------------------------------
// New assignment
// ------------------------------------------------------------
export async function notifyNewAssignment(
  ctx: BaseEventCtx & {
    /** Direct student record ids (when targeting a single student). */
    studentIds?: string[];
    /** Class/section scope to resolve recipients. */
    className?: string | null;
    section?: string | null;
    title: string;
    subject?: string | null;
    dueAt?: string | null;
  },
): Promise<PushNotificationResult> {
  const userIds = await resolveRecipientsByScope(ctx.supabase, ctx.schoolId, {
    studentIds: ctx.studentIds,
    className: ctx.className,
    section: ctx.section,
  });
  if (userIds.length === 0) return EMPTY_RESULT;

  const subjectPart = ctx.subject ? ` (${ctx.subject})` : "";

  return sendPushNotification(ctx.supabase, {
    schoolId: ctx.schoolId,
    branchId: ctx.branchId ?? null,
    userIds,
    type: "assignment",
    title: "واجب جديد",
    message: `تمت إضافة واجب جديد: ${ctx.title}${subjectPart}.`,
    link: "/assignments",
    recipientRole: "student",
    metadata: { subject: ctx.subject ?? null, due_at: ctx.dueAt ?? null },
  });
}

// ------------------------------------------------------------
// Homework graded
// ------------------------------------------------------------
export async function notifyAssignmentGraded(
  ctx: BaseEventCtx & {
    studentId: string;
    subject?: string | null;
    grade?: number | null;
    maxGrade?: number | null;
  },
): Promise<PushNotificationResult> {
  const allIds = await resolveStudentAndParents(ctx.supabase, ctx.schoolId, ctx.studentId);
  if (allIds.length === 0) return EMPTY_RESULT;

  const subjectPart = ctx.subject ? ` في مادة ${ctx.subject}` : "";
  // Store policy (Apple 4.5.4): no grade in the visible push text.
  return sendPushNotification(ctx.supabase, {
    schoolId: ctx.schoolId,
    branchId: ctx.branchId ?? null,
    userIds: allIds,
    type: "assignment",
    title: "تم تقييم الواجب",
    message: `تم تقييم واجبك${subjectPart}. اطّلع على الدرجة داخل التطبيق.`,
    link: "/assignments",
    recipientRole: "student",
    metadata: {
      student_id: ctx.studentId,
      subject: ctx.subject ?? null,
      grade: ctx.grade ?? null,
      max_grade: ctx.maxGrade ?? null,
    },
  });
}

// ------------------------------------------------------------
// Homework deadline reminder (cron, one day before due_at)
// ------------------------------------------------------------
export async function notifyDeadlineReminder(
  ctx: BaseEventCtx & {
    studentIds: string[];
    title: string;
    subject?: string | null;
    dueAt?: string | null;
  },
): Promise<PushNotificationResult> {
  if (ctx.studentIds.length === 0) return EMPTY_RESULT;

  const userIds = await resolveRecipientsByScope(ctx.supabase, ctx.schoolId, {
    studentIds: ctx.studentIds,
  });
  if (userIds.length === 0) return EMPTY_RESULT;

  const subjectPart = ctx.subject ? ` (${ctx.subject})` : "";

  return sendPushNotification(ctx.supabase, {
    schoolId: ctx.schoolId,
    branchId: ctx.branchId ?? null,
    userIds,
    type: "assignment",
    title: "تذكير بموعد تسليم واجب",
    message: `موعد تسليم واجب "${ctx.title}"${subjectPart} غدًا. لا تنسَ التسليم.`,
    link: "/assignments",
    recipientRole: "student",
    metadata: { subject: ctx.subject ?? null, due_at: ctx.dueAt ?? null },
  });
}

// ------------------------------------------------------------
// Absence
// ------------------------------------------------------------
export async function notifyAbsence(
  ctx: BaseEventCtx & {
    studentId: string;
    attendanceDate?: string | null;
    status?: string | null;
  },
): Promise<PushNotificationResult> {
  const allIds = await resolveStudentAndParents(ctx.supabase, ctx.schoolId, ctx.studentId);
  if (allIds.length === 0) return EMPTY_RESULT;

  const datePart = ctx.attendanceDate ? ` بتاريخ ${ctx.attendanceDate}` : "";
  const isLate = ctx.status === "late";

  return sendPushNotification(ctx.supabase, {
    schoolId: ctx.schoolId,
    branchId: ctx.branchId ?? null,
    userIds: allIds,
    type: "attendance",
    title: isLate ? "تأخر عن الحضور" : "غياب",
    message: isLate
      ? `تم تسجيل تأخر عن الدوام${datePart}.`
      : `تم تسجيل غياب${datePart}.`,
    link: "/attendance",
    recipientRole: "student",
    metadata: { student_id: ctx.studentId, status: ctx.status ?? "absent" },
  });
}

// ------------------------------------------------------------
// Behavior
// ------------------------------------------------------------
export async function notifyNewBehavior(
  ctx: BaseEventCtx & {
    studentId: string;
    behaviorType?: string | null;
    points?: number | null;
    note?: string | null;
  },
): Promise<PushNotificationResult> {
  const allIds = await resolveStudentAndParents(ctx.supabase, ctx.schoolId, ctx.studentId);
  if (allIds.length === 0) return EMPTY_RESULT;

  // Apple 4.5.4: keep behavior type and points out of the visible push text;
  // they stay in metadata for the in-app screen.
  return sendPushNotification(ctx.supabase, {
    schoolId: ctx.schoolId,
    branchId: ctx.branchId ?? null,
    userIds: allIds,
    type: "behavior",
    title: "ملاحظة سلوكية",
    message: "تم تسجيل ملاحظة سلوكية جديدة. اطّلع على التفاصيل داخل التطبيق.",
    link: "/behavior",
    recipientRole: "student",
    metadata: { student_id: ctx.studentId, behavior_type: ctx.behaviorType ?? null, points: ctx.points ?? null },
  });
}

// ------------------------------------------------------------
// Payment
// ------------------------------------------------------------
export async function notifyPayment(
  ctx: BaseEventCtx & {
    studentId: string;
    amount?: number | null;
    receiptNumber?: string | null;
  },
): Promise<PushNotificationResult> {
  const allIds = await resolveStudentAndParents(ctx.supabase, ctx.schoolId, ctx.studentId);
  if (allIds.length === 0) return EMPTY_RESULT;

  // Apple 4.5.4: keep the paid amount out of the visible push text; it stays
  // in metadata for the in-app screen.
  return sendPushNotification(ctx.supabase, {
    schoolId: ctx.schoolId,
    branchId: ctx.branchId ?? null,
    userIds: allIds,
    type: "payment",
    title: "دفعة مالية",
    message: "تم تسجيل دفعة مالية جديدة. اطّلع على التفاصيل داخل التطبيق.",
    link: "/payments",
    recipientRole: "student",
    metadata: {
      student_id: ctx.studentId,
      amount: ctx.amount ?? null,
      receipt_number: ctx.receiptNumber ?? null,
    },
  });
}

// ------------------------------------------------------------
// Exam scheduled
// ------------------------------------------------------------
export async function notifyExamScheduled(
  ctx: BaseEventCtx & {
    className?: string | null;
    examTitle: string;
    subject?: string | null;
    startsAt?: string | null;
  },
): Promise<PushNotificationResult> {
  const userIds = await resolveRecipientsByScope(ctx.supabase, ctx.schoolId, {
    className: ctx.className,
  });
  if (userIds.length === 0) return EMPTY_RESULT;

  const subjectPart = ctx.subject ? ` (${ctx.subject})` : "";
  const datePart = ctx.startsAt ? ` بتاريخ ${ctx.startsAt.slice(0, 10)}` : "";

  return sendPushNotification(ctx.supabase, {
    schoolId: ctx.schoolId,
    branchId: ctx.branchId ?? null,
    userIds,
    type: "exam",
    title: "امتحان جديد",
    message: `تم جدولة امتحان: ${ctx.examTitle}${subjectPart}${datePart}.`,
    link: "/exams",
    recipientRole: "student",
    metadata: {
      exam_title: ctx.examTitle,
      subject: ctx.subject ?? null,
      starts_at: ctx.startsAt ?? null,
    },
  });
}

// ------------------------------------------------------------
// Exam graded (manual grading completed by teacher)
// ------------------------------------------------------------
export async function notifyExamGraded(
  ctx: BaseEventCtx & {
    studentId: string;
    examTitle: string;
    score?: number | null;
    totalMarks?: number | null;
  },
): Promise<PushNotificationResult> {
  const allIds = await resolveStudentAndParents(ctx.supabase, ctx.schoolId, ctx.studentId);
  if (allIds.length === 0) return EMPTY_RESULT;

  // Store policy (Apple 4.5.4): no scores in the visible notification text.
  return sendPushNotification(ctx.supabase, {
    schoolId: ctx.schoolId,
    branchId: ctx.branchId ?? null,
    userIds: allIds,
    type: "exam",
    title: "نتيجة الامتحان",
    message: `تم تصحيح امتحان ${ctx.examTitle}. اطّلع على النتيجة داخل التطبيق.`,
    link: "/exams",
    recipientRole: "student",
    metadata: {
      student_id: ctx.studentId,
      exam_title: ctx.examTitle,
      score: ctx.score ?? null,
    },
  });
}

// ------------------------------------------------------------
// Exam result (auto-graded on submission)
// ------------------------------------------------------------
export async function notifyExamResult(
  ctx: BaseEventCtx & {
    studentId: string;
    examTitle: string;
    score?: number | null;
  },
): Promise<PushNotificationResult> {
  const allIds = await resolveStudentAndParents(ctx.supabase, ctx.schoolId, ctx.studentId);
  if (allIds.length === 0) return EMPTY_RESULT;

  // Store policy (Apple 4.5.4): no scores in the visible notification text.
  return sendPushNotification(ctx.supabase, {
    schoolId: ctx.schoolId,
    branchId: ctx.branchId ?? null,
    userIds: allIds,
    type: "exam",
    title: "تم تسليم الامتحان",
    message: "تم تسليم إجاباتك بنجاح.",
    link: "/exams",
    recipientRole: "student",
    metadata: { student_id: ctx.studentId, exam_title: ctx.examTitle, score: ctx.score ?? null },
  });
}

// ------------------------------------------------------------
// Installment / fee reminder
// ------------------------------------------------------------
export async function notifyInstallmentDue(
  ctx: BaseEventCtx & {
    studentIds: string[];
  },
): Promise<PushNotificationResult> {
  if (ctx.studentIds.length === 0) return EMPTY_RESULT;

  const userIds = await resolveRecipientsByScope(ctx.supabase, ctx.schoolId, {
    studentIds: ctx.studentIds,
  });
  if (userIds.length === 0) return EMPTY_RESULT;

  return sendPushNotification(ctx.supabase, {
    schoolId: ctx.schoolId,
    branchId: ctx.branchId ?? null,
    userIds,
    type: "payment",
    title: "تذكير بالأقساط",
    message: "لديك رصيد مالي مستحق. يرجى مراجعة قسم المدفوعات داخل التطبيق.",
    link: "/payments",
    recipientRole: "student",
    metadata: {},
  });
}

// ------------------------------------------------------------
// Shared: resolve linked parent auth_user_ids for given student records
// ------------------------------------------------------------
async function resolveParentUserIds(
  supabase: SupabaseClient,
  schoolId: string,
  studentRecordIds: string[],
): Promise<string[]> {
  if (studentRecordIds.length === 0) return [];
  try {
    const { data, error } = await supabase
      .from("parent_student_links")
      .select("parent_user_id")
      .eq("school_id", schoolId)
      .in("student_id", studentRecordIds);
    if (error || !data) return [];
    return Array.from(
      new Set(
        (data as Array<{ parent_user_id: string }>)
          .map((row) => row.parent_user_id)
          .filter((id): id is string => Boolean(id && id.trim())),
      ),
    );
  } catch {
    return [];
  }
}

// ------------------------------------------------------------
// Shared: resolve student + parent auth_user_ids for a single student
// ------------------------------------------------------------
async function resolveStudentAndParents(
  supabase: SupabaseClient,
  schoolId: string,
  studentId: string,
): Promise<string[]> {
  const [userId, parentIds] = await Promise.all([
    resolveStudentAuthUserId(supabase, schoolId, studentId),
    resolveParentUserIds(supabase, schoolId, [studentId]),
  ]);
  return [...(userId ? [userId] : []), ...parentIds];
}

// ------------------------------------------------------------
// Shared: resolve student auth_user_ids by direct ids OR class/section
// ------------------------------------------------------------
async function resolveRecipientsByScope(
  supabase: SupabaseClient,
  schoolId: string,
  scope: { studentIds?: string[]; className?: string | null; section?: string | null },
): Promise<string[]> {
  try {
    let query = supabase
      .from("students")
      .select("id, auth_user_id")
      .eq("school_id", schoolId);

    if (scope.studentIds && scope.studentIds.length > 0) {
      query = query.in("id", scope.studentIds);
    } else {
      if (scope.className) query = query.eq("class_name", scope.className);
      if (scope.section) query = query.eq("section", scope.section);
    }

    const { data, error } = await query;
    if (error || !data) return [];

    const rows = data as Array<{ id: string; auth_user_id: string | null }>;
    const studentAuthIds = rows
      .map((row) => row.auth_user_id)
      .filter((id): id is string => Boolean(id && id.trim()));

    const studentRecordIds = rows.map((row) => row.id);
    const parentIds = await resolveParentUserIds(supabase, schoolId, studentRecordIds);

    return Array.from(new Set([...studentAuthIds, ...parentIds]));
  } catch {
    return [];
  }
}
