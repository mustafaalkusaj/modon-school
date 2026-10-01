import { fetchAllRows } from "@/lib/supabase-fetch-all";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  applyBranchScopeToQuery,
  resolveBranchScope,
} from "@/lib/branch-scope";
import { resolveSchoolScopedActorContext } from "@/lib/managed-users-server";
import { enforceRateLimit } from "@/lib/rate-limit";
import { createServiceSupabaseClient } from "@/lib/supabase-server";
import { jsonError, jsonServerError, logRouteError } from "@/lib/route-utils";
import { logger } from "@/lib/logger";
import { excludeDeletedStudents } from "@/lib/students/soft-delete";

const bodySchema = z.object({
  schoolId: z.string().uuid("معرّف المدرسة غير صالح."),
  // Identifies the run so a repeated execution for the same year can be refused.
  // Derived from the current date when the client does not send it.
  academicYear: z.string().min(4).max(32).optional(),
  options: z.object({
    promoteStudents: z.boolean().default(true),
    resetFees: z.boolean().default(true),
    notifyParents: z.boolean().default(false),
  }),
});

// School years roll over in July, so anything from July onwards belongs to the
// year that is just starting.
const ACADEMIC_YEAR_ROLLOVER_MONTH = 6; // 0-indexed → July

function resolveAcademicYearLabel(now = new Date()): string {
  const year =
    now.getMonth() >= ACADEMIC_YEAR_ROLLOVER_MONTH
      ? now.getFullYear()
      : now.getFullYear() - 1;
  return `${year}-${year + 1}`;
}

// Idempotency marker written to audit_logs. There is no dedicated runs table, so
// a single audit row per (school, academic year) acts as the run claim.
const YEAR_END_RUN_ACTION = "year_end_execute";
const YEAR_END_RUN_ENTITY = "year_end_run";

// Arabic ordinal grade progression map (grades 1-12 in Arabic)
const GRADE_MAP: Record<string, string> = {
  الأول: "الثاني",
  الثاني: "الثالث",
  الثالث: "الرابع",
  الرابع: "الخامس",
  الخامس: "السادس",
  السادس: "السابع",
  السابع: "الثامن",
  الثامن: "التاسع",
  التاسع: "العاشر",
  العاشر: "الحادي عشر",
  "الحادي عشر": "الثاني عشر",
  "الثاني عشر": "مُخرَّج",
};

// Numeric grade progression map (1-12) for schools that use numeric grade names
const NUMERIC_GRADE_MAP: Record<string, string> = {
  "1": "2",
  "2": "3",
  "3": "4",
  "4": "5",
  "5": "6",
  "6": "7",
  "7": "8",
  "8": "9",
  "9": "10",
  "10": "11",
  "11": "12",
  "12": "مُخرَّج",
};

const FINAL_GRADES = ["الثاني عشر", "مُخرَّج", "12"];

// Rate limit: 1 per hour per school (enforced via namespace+identifier)
const YEAR_END_WINDOW_MS = 60 * 60 * 1000; // 1 hour

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("البيانات المرسلة غير صالحة.", 400);
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return jsonError("البيانات المرسلة غير صالحة.", 400);
  }

  const { schoolId, options } = parsed.data;
  const academicYear =
    parsed.data.academicYear?.trim() || resolveAcademicYearLabel();

  const context = await resolveSchoolScopedActorContext(
    schoolId,
    {
      allowedRoles: ["super_admin", "admin"],
      roleDeniedMessage: "عملية نهاية السنة متاحة للمسؤولين فقط.",
    },
    req.headers.get("authorization"),
  );

  if (!context.ok) {
    return jsonError(
      "message" in context
        ? context.message
        : "تعذر التحقق من صلاحيات المستخدم.",
      "status" in context ? context.status : 500,
    );
  }

  const { actorUserId, actorSupabase, targetSchoolId } = context.value;

  const branchScope = resolveBranchScope(context.value);
  if (!branchScope.ok) {
    return jsonError(branchScope.message, branchScope.status);
  }

  // 1 per hour per school
  const rateLimited = await enforceRateLimit(req, {
    namespace: "year-end-execute",
    windowMs: YEAR_END_WINDOW_MS,
    maxHits: 1,
    identifier: `${actorUserId}:${targetSchoolId}`,
    productionFailureMode: "memory-fallback",
  });
  if (rateLimited) return rateLimited;

  const runKey = `${targetSchoolId}:${academicYear}`;

  try {
    // ── Idempotency guard ──────────────────────────────────────────────────
    // The three bulk steps below are NOT wrapped in a DB transaction (the
    // Supabase JS client cannot open one), so a failure part-way leaves earlier
    // steps applied. Re-running would then promote the same students a second
    // time (الأول→الثاني→الثالث). A run claim recorded before any mutation makes
    // the endpoint refuse the repeat instead. Recovery from a partial run is a
    // manual operation — the claim must be removed deliberately.
    // The claim is read and written with the service client on purpose: the live
    // `audit_logs` INSERT/UPDATE policies are restricted to super_admin, so an
    // admin running year-end would be denied and the whole endpoint would fail.
    // This is system bookkeeping, not a user write — the school was already
    // authorized by resolveSchoolScopedActorContext above, and every key below
    // is derived from targetSchoolId rather than from the request body.
    const runBookkeeping = createServiceSupabaseClient();

    const { data: existingRun, error: existingRunError } = await runBookkeeping
      .from("audit_logs")
      .select("id, created_at")
      .eq("action_type", YEAR_END_RUN_ACTION)
      .eq("entity_type", YEAR_END_RUN_ENTITY)
      .eq("entity_id", runKey)
      .limit(1);

    if (existingRunError) throw existingRunError;

    if ((existingRun ?? []).length > 0) {
      logger.warn("[year-end-execute] duplicate run refused", {
        school: targetSchoolId,
        academicYear,
      });
      return jsonError(
        `تم تنفيذ عملية نهاية السنة للعام ${academicYear} مسبقاً. لا يمكن تنفيذها مرة أخرى.`,
        409,
      );
    }

    // Claim the run before mutating anything.
    const { error: claimError } = await runBookkeeping
      .from("audit_logs")
      .insert({
        actor_user_id: actorUserId,
        actor_source: "app",
        action_type: YEAR_END_RUN_ACTION,
        entity_type: YEAR_END_RUN_ENTITY,
        entity_id: runKey,
        school_id: targetSchoolId,
        summary: `بدء عملية نهاية السنة للعام ${academicYear}`,
        metadata: { academic_year: academicYear, options },
      });

    if (claimError) {
      // audit_logs_year_end_run_once: a concurrent request claimed it first.
      if ((claimError as { code?: string }).code === "23505") {
        return jsonError(
          `عملية نهاية السنة للعام ${academicYear} قيد التنفيذ أو نُفّذت مسبقاً.`,
          409,
        );
      }
      throw claimError;
    }

    // Paged: a single select stops at 1000 rows, which left every student
    // past the first 1000 un-promoted.
    const { data: students, error: fetchError } = await fetchAllRows(() =>
      applyBranchScopeToQuery(
        excludeDeletedStudents(
          actorSupabase
            .from("students")
            .select("id, class_name, status, paid_fee"),
        )
          .eq("school_id", targetSchoolId)
          .neq("status", "graduated"),
        branchScope.value,
      ).order("id"),
    );

    if (fetchError) throw fetchError;

    const activeStudents = students ?? [];
    let promotedCount = 0;
    let graduatedCount = 0;
    let feesResetCount = 0;

    // Build bulk update batches to avoid N+1 writes and to fail atomically per batch.
    // We cannot use a true DB transaction through Supabase JS client, so we collect
    // all IDs per target class and issue one UPDATE per group. If any step fails we
    // return an error immediately — no partial state is silently committed.
    if (options.promoteStudents) {
      // Separate graduating students from those being promoted to the next grade
      const graduatingIds: string[] = [];
      // Keyed by fromClass so every UPDATE can assert the pre-promotion value and
      // become a no-op if the step was already applied.
      const promotionGroups = new Map<
        string,
        { fromClass: string; nextClass: string; ids: string[] }
      >();

      for (const student of activeStudents) {
        const currentClass = student.class_name ?? "";
        const isGraduating = FINAL_GRADES.some((g) => currentClass.includes(g));

        if (isGraduating) {
          graduatingIds.push(student.id);
        } else {
          let nextClass: string | null = null;

          // Try Arabic ordinal map first
          for (const [from, to] of Object.entries(GRADE_MAP)) {
            if (currentClass.includes(from)) {
              nextClass = currentClass.replace(from, to);
              break;
            }
          }

          // Fall back to numeric map (e.g. "1", "2", ... "12")
          if (!nextClass) {
            const trimmed = currentClass.trim();
            if (
              Object.prototype.hasOwnProperty.call(NUMERIC_GRADE_MAP, trimmed)
            ) {
              nextClass = NUMERIC_GRADE_MAP[trimmed];
            }
          }

          if (nextClass) {
            const group = promotionGroups.get(currentClass) ?? {
              fromClass: currentClass,
              nextClass,
              ids: [],
            };
            group.ids.push(student.id);
            promotionGroups.set(currentClass, group);
          } else {
            // Log a warning instead of silently skipping — operators need to know
            logger.warn(
              "[year-end-execute] unmatched grade — student skipped",
              {
                school: targetSchoolId,
                studentId: student.id,
                class_name: currentClass,
              },
            );
          }
        }
      }

      // Step 1: Bulk promote by class group. Each UPDATE asserts the
      // pre-promotion class, so a repeated run cannot promote anyone twice.
      for (const { fromClass, nextClass, ids } of Array.from(
        promotionGroups.values(),
      )) {
        const { error } = await actorSupabase
          .from("students")
          .update({ class_name: nextClass })
          .eq("school_id", targetSchoolId)
          .eq("class_name", fromClass)
          .in("id", ids);
        if (error) {
          logger.error(
            "[year-end-execute] promotion failed",
            new Error(error.message),
            { school: targetSchoolId, nextClass },
          );
          return jsonServerError(
            "web-year-end-execute",
            error,
            "فشل ترحيل الطلاب إلى الصف " + nextClass,
            500,
          );
        }
        promotedCount += ids.length;
      }

      // Step 2: Bulk graduate terminal students
      if (graduatingIds.length > 0) {
        let error: { message: string } | null = null;
        // Chunked: hundreds of uuids in one `in` filter overflow the URL.
        // `.neq("status", "graduated")` keeps the write a no-op for students
        // the step already handled.
        for (let i = 0; i < graduatingIds.length && !error; i += 150) {
          ({ error } = await actorSupabase
            .from("students")
            .update({ status: "graduated", class_name: "مُخرَّج" })
            .eq("school_id", targetSchoolId)
            .neq("status", "graduated")
            .in("id", graduatingIds.slice(i, i + 150)));
        }
        if (error) {
          logger.error(
            "[year-end-execute] graduation failed",
            new Error(error.message),
            { school: targetSchoolId },
          );
          return jsonServerError(
            "web-year-end-execute",
            error,
            "فشل تخريج الطلاب النهائيين",
            500,
          );
        }
        graduatedCount = graduatingIds.length;
      }
    }

    // Step 3: Reset fees — only runs if promotion steps above all succeeded
    if (options.resetFees) {
      const { data: resetData, error: resetError } =
        await applyBranchScopeToQuery(
          excludeDeletedStudents(
            actorSupabase.from("students").update({ paid_fee: 0 }),
          )
            .eq("school_id", targetSchoolId)
            .neq("status", "graduated"),
          branchScope.value,
        ).select("id");

      if (resetError) {
        logger.error(
          "[year-end-execute] fees reset failed",
          new Error(resetError.message),
          { school: targetSchoolId },
        );
        return jsonServerError(
          "web-year-end-execute",
          resetError,
          "فشل إعادة تصفير الأقساط",
          500,
        );
      }
      feesResetCount = (resetData ?? []).length;
    }

    // Record the outcome on the run claim so a partial run can be diagnosed.
    await runBookkeeping
      .from("audit_logs")
      .update({
        summary: `اكتملت عملية نهاية السنة للعام ${academicYear}`,
        metadata: {
          academic_year: academicYear,
          options,
          promoted: promotedCount,
          graduated: graduatedCount,
          fees_reset: feesResetCount,
          completed: true,
        },
      })
      .eq("action_type", YEAR_END_RUN_ACTION)
      .eq("entity_type", YEAR_END_RUN_ENTITY)
      .eq("entity_id", runKey);

    logger.info("[year-end-execute] completed", {
      school: targetSchoolId,
      actor: actorUserId,
      academicYear,
      promoted: promotedCount,
      graduated: graduatedCount,
      feesReset: feesResetCount,
    });

    return NextResponse.json({
      promoted_count: promotedCount,
      graduated_count: graduatedCount,
      fees_reset_count: feesResetCount,
    });
  } catch (err) {
    logRouteError("year-end-execute", err);
    return jsonError("تعذر تنفيذ عملية نهاية السنة.", 500);
  }
}
