import { NextRequest, NextResponse } from "next/server";
import { resolveSchoolScopedActorContext } from "@/lib/managed-users-server";
import { enforceRateLimit } from "@/lib/rate-limit";
import { jsonError, jsonServerError } from "@/lib/route-utils";
import { routeUserHasPermission } from "@/lib/route-permissions";
import { resolveBranchScope } from "@/lib/branch-scope";
import { getCacheHeaders, CACHE_STRATEGIES } from "@/lib/cache-strategies";

// `class_schedules.day_of_week` is a smallint (sunday = 0) but the grid speaks
// day names. Keep the mapping in one place so reads and writes agree.
const DAY_NUMBER: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};
const DAY_NAME: Record<number, string> = Object.fromEntries(
  Object.entries(DAY_NUMBER).map(([name, n]) => [n, name]),
);
const VALID_DAYS = new Set([
  "saturday",
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
]);
const MAX_PERIODS = 10;

// The table stores subject_name/teacher_id; the grid reads subject/teacher_name.
const SCHEDULE_SELECT =
  "id, day_of_week, period_number, time_slot_id, is_locked, subject_name, teacher_id, class_name, section, teachers(full_name)";

type ScheduleRow = {
  id: string;
  day_of_week: number | null;
  period_number: number | null;
  time_slot_id: string | null;
  is_locked: boolean | null;
  subject_name: string | null;
  teacher_id: string | null;
  class_name: string | null;
  section: string | null;
  teachers?: { full_name: string | null } | null;
};

/** Reshape a stored row into the flat shape the schedule grid renders. */
function toGridCell(row: ScheduleRow) {
  return {
    id: row.id,
    day_of_week:
      row.day_of_week === null ? null : (DAY_NAME[row.day_of_week] ?? null),
    period_number: row.period_number,
    time_slot_id: row.time_slot_id,
    is_locked: row.is_locked ?? false,
    subject: row.subject_name,
    teacher_name: row.teachers?.full_name ?? null,
    teacher_id: row.teacher_id,
    class_name: row.class_name,
    section: row.section,
  };
}

export async function GET(req: NextRequest) {
  const schoolId = req.nextUrl.searchParams.get("schoolId");
  const className = req.nextUrl.searchParams.get("className")?.trim() || "";
  const section = req.nextUrl.searchParams.get("section")?.trim() || "";
  const teacherName = req.nextUrl.searchParams.get("teacherName")?.trim() || "";
  const mode = req.nextUrl.searchParams.get("mode")?.trim() || "";
  const day = req.nextUrl.searchParams.get("day")?.trim() || "";

  // Only require className when NOT in teacher or overview mode
  if (!teacherName && mode !== "overview" && !className)
    return jsonError("الصف مطلوب.", 400);

  const context = await resolveSchoolScopedActorContext(
    schoolId,
    {
      allowedRoles: ["super_admin", "admin", "employee"],
      roleDeniedMessage: "غير مصرح.",
    },
    req.headers.get("authorization"),
  );
  if (!context.ok) {
    return jsonError(
      "message" in context ? context.message : "تعذر التحقق.",
      "status" in context ? context.status : 500,
    );
  }

  const { actorSupabase, actorUserId, targetSchoolId } = context.value;

  // Validate branch scope — reject requests from actors trying to access branches they don't belong to.
  // class_schedules has no branch_id column so we cannot filter rows by branch, but we still enforce
  // that branch-scoped actors can only request their own branch.
  const requestedBranchId =
    req.nextUrl.searchParams.get("branchId") ??
    req.nextUrl.searchParams.get("branch_id");
  const branchScope = resolveBranchScope(context.value, requestedBranchId);
  if (!branchScope.ok) {
    return jsonError(branchScope.message, branchScope.status);
  }

  const rateLimited = await enforceRateLimit(req, {
    namespace: "schedule-read",
    windowMs: 60_000,
    maxHits: 120,
    identifier: actorUserId,
  });
  if (rateLimited) return rateLimited;

  const canView = await routeUserHasPermission(
    actorSupabase,
    actorUserId,
    "view_students",
  );
  if (!canView) return jsonError("ليس لديك صلاحية.", 403);

  // Teacher mode: return all entries for this teacher across all classes
  if (teacherName) {
    // Escape SQL LIKE wildcards in user input so the ilike acts as a literal
    // substring match rather than a pattern. An unescaped % or _ would let a
    // caller enumerate all teachers or perform broader queries.
    const safeTeacherName = `%${teacherName.replace(/[%_\\]/g, "\\$&")}%`;
    // Schedules reference teachers by id, so resolve the name to ids first.
    const { data: matchedTeachers, error: teacherError } = await actorSupabase
      .from("teachers")
      .select("id")
      .eq("school_id", targetSchoolId)
      .ilike("full_name", safeTeacherName);
    if (teacherError)
      return jsonServerError(
        "web-schedule",
        teacherError,
        "تعذر إكمال العملية. حاول مرة أخرى لاحقاً.",
        500,
      );

    const teacherIds = (matchedTeachers ?? []).map((t) => t.id);
    if (teacherIds.length === 0) {
      return NextResponse.json(
        { ok: true, schedule: [], mode: "teacher" },
        { headers: getCacheHeaders(CACHE_STRATEGIES.SCHEDULE_LIST) },
      );
    }

    const { data, error } = await actorSupabase
      .from("class_schedules")
      .select(SCHEDULE_SELECT)
      .eq("school_id", targetSchoolId)
      .in("teacher_id", teacherIds);
    if (error)
      return jsonServerError(
        "web-schedule",
        error,
        "تعذر إكمال العملية. حاول مرة أخرى لاحقاً.",
        500,
      );
    return NextResponse.json(
      {
        ok: true,
        schedule: ((data ?? []) as unknown as ScheduleRow[]).map(toGridCell),
        mode: "teacher",
      },
      { headers: getCacheHeaders(CACHE_STRATEGIES.SCHEDULE_LIST) },
    );
  }

  // Overview mode: return all entries for a given day across all classes
  if (mode === "overview" && day) {
    const dayNumber = DAY_NUMBER[day.toLowerCase()];
    if (dayNumber === undefined) return jsonError("يوم غير صالح.", 400);

    const { data, error } = await actorSupabase
      .from("class_schedules")
      .select(SCHEDULE_SELECT)
      .eq("school_id", targetSchoolId)
      .eq("day_of_week", dayNumber);
    if (error)
      return jsonServerError(
        "web-schedule",
        error,
        "تعذر إكمال العملية. حاول مرة أخرى لاحقاً.",
        500,
      );
    return NextResponse.json(
      {
        ok: true,
        schedule: ((data ?? []) as unknown as ScheduleRow[]).map(toGridCell),
        mode: "overview",
      },
      { headers: getCacheHeaders(CACHE_STRATEGIES.SCHEDULE_LIST) },
    );
  }

  // Class mode: return entries for a specific class/section
  let query = actorSupabase
    .from("class_schedules")
    .select(SCHEDULE_SELECT)
    .eq("school_id", targetSchoolId)
    .eq("class_name", className);

  if (section) query = query.eq("section", section);

  const { data, error } = await query;
  if (error)
    return jsonServerError("web-schedule", error, "تعذر تحميل الجدول.", 500);

  return NextResponse.json(
    {
      ok: true,
      schedule: ((data ?? []) as unknown as ScheduleRow[]).map(toGridCell),
    },
    { headers: getCacheHeaders(CACHE_STRATEGIES.SCHEDULE_LIST) },
  );
}

export async function PUT(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  const schoolId =
    typeof body?.school_id === "string" ? body.school_id.trim() : "";
  const className =
    typeof body?.class_name === "string" ? body.class_name.trim() : "";
  const section = typeof body?.section === "string" ? body.section.trim() : "";
  const entries = Array.isArray(body?.entries) ? body.entries : [];

  if (!schoolId || !className) return jsonError("المدرسة والصف مطلوبان.", 400);

  const context = await resolveSchoolScopedActorContext(
    schoolId,
    {
      allowedRoles: ["super_admin", "admin", "employee"],
      roleDeniedMessage: "غير مصرح.",
    },
    req.headers.get("authorization"),
  );
  if (!context.ok) {
    return jsonError(
      "message" in context ? context.message : "تعذر التحقق.",
      "status" in context ? context.status : 500,
    );
  }

  const { actorSupabase, actorUserId, targetSchoolId } = context.value;

  const rateLimited = await enforceRateLimit(req, {
    namespace: "schedule-write",
    windowMs: 60_000,
    maxHits: 30,
    identifier: actorUserId,
  });
  if (rateLimited) return rateLimited;

  const canManage = await routeUserHasPermission(
    actorSupabase,
    actorUserId,
    "manage_schedule",
  );
  if (!canManage) return jsonError("ليس لديك صلاحية تعديل الجدول.", 403);

  const intents = (entries as unknown[])
    .filter(
      (e): e is Record<string, unknown> => e !== null && typeof e === "object",
    )
    .filter((e) => {
      const day = typeof e.day_of_week === "string" ? e.day_of_week : "";
      const period = Number(e.period_number);
      const subject = typeof e.subject === "string" ? e.subject.trim() : "";
      return (
        VALID_DAYS.has(day) &&
        period >= 1 &&
        period <= MAX_PERIODS &&
        subject.length > 0
      );
    })
    .map((e) => ({
      day: e.day_of_week as string,
      period: Number(e.period_number),
      timeSlotId:
        typeof e.time_slot_id === "string" && e.time_slot_id.length > 0
          ? e.time_slot_id
          : null,
      subject: (e.subject as string).trim(),
      teacherName:
        typeof e.teacher_name === "string"
          ? e.teacher_name.trim() || null
          : null,
      isLocked: typeof e.is_locked === "boolean" ? e.is_locked : false,
    }));

  // `class_schedules` requires start_time/end_time, which the grid never sends;
  // they come from the school's configured time slots, matched by explicit id
  // or by the slot ordinal the cell sits on.
  const { data: slotRows, error: slotError } = await actorSupabase
    .from("schedule_time_slots")
    .select("id, slot_order, start_time, end_time")
    .eq("school_id", targetSchoolId);
  if (slotError)
    return jsonServerError(
      "web-schedule",
      slotError,
      "تعذر إكمال العملية. حاول مرة أخرى لاحقاً.",
      500,
    );

  const slotById = new Map<string, (typeof slotRows)[number]>();
  const slotByOrder = new Map<number, (typeof slotRows)[number]>();
  for (const slot of slotRows ?? []) {
    slotById.set(slot.id, slot);
    if (slot.slot_order !== null) slotByOrder.set(slot.slot_order, slot);
  }

  // Teachers are stored by id; the grid edits them by name.
  const teacherNames = Array.from(
    new Set(
      intents
        .map((i) => i.teacherName)
        .filter((name): name is string => Boolean(name)),
    ),
  );
  const teacherIdByName = new Map<string, string>();
  if (teacherNames.length) {
    const { data: teacherRows, error: teacherLookupError } = await actorSupabase
      .from("teachers")
      .select("id, full_name")
      .eq("school_id", targetSchoolId)
      .in("full_name", teacherNames);
    if (teacherLookupError)
      return jsonServerError(
        "web-schedule",
        teacherLookupError,
        "تعذر إكمال العملية. حاول مرة أخرى لاحقاً.",
        500,
      );
    for (const t of teacherRows ?? []) {
      if (t.full_name) teacherIdByName.set(t.full_name, t.id);
    }
  }

  const unresolved: string[] = [];
  const sanitized = intents.flatMap((intent) => {
    const slot = intent.timeSlotId
      ? slotById.get(intent.timeSlotId)
      : slotByOrder.get(intent.period);
    if (!slot) {
      unresolved.push(`${intent.day} / الحصة ${intent.period}`);
      return [];
    }
    return [
      {
        school_id: targetSchoolId,
        class_name: className,
        section: section || null,
        day_of_week: DAY_NUMBER[intent.day],
        period_number: intent.period,
        time_slot_id: slot.id,
        start_time: slot.start_time,
        end_time: slot.end_time,
        subject_name: intent.subject,
        teacher_id: intent.teacherName
          ? (teacherIdByName.get(intent.teacherName) ?? null)
          : null,
        is_locked: intent.isLocked,
      },
    ];
  });

  // Writing a partial schedule would silently drop the operator's cells, so
  // stop and name the slots that need configuring instead.
  if (unresolved.length) {
    return jsonError(
      `لا توجد فترة زمنية معرّفة لهذه الحصص: ${unresolved.join("، ")}. عرّف الفترات الزمنية أولاً.`,
      400,
    );
  }

  // C9: Check for teacher double-booking before making any changes.
  // Collect unique teacher+day+time_slot combinations from the incoming entries.
  const teacherSlots = sanitized.filter((e) => e.teacher_id && e.time_slot_id);
  if (teacherSlots.length > 0) {
    // Build an OR filter: each combination is (teacher_id=X AND day_of_week=Y AND time_slot_id=Z).
    // We check for existing rows in OTHER classes/sections so we don't flag the class being replaced.
    //
    // Both ids come from the database (a teachers lookup and the school's time
    // slots), never straight from the request body, so no caller-controlled text
    // reaches the filter string.
    const orParts = teacherSlots
      .map(
        (e) =>
          `and(teacher_id.eq.${e.teacher_id},day_of_week.eq.${e.day_of_week},time_slot_id.eq.${e.time_slot_id})`,
      )
      .join(",");

    const conflictQuery = actorSupabase
      .from("class_schedules")
      .select(
        "id, teacher_id, day_of_week, time_slot_id, class_name, section, teachers(full_name)",
      )
      .eq("school_id", targetSchoolId)
      .or(orParts)
      // Exclude the current class/section being replaced (its rows will be deleted).
      .neq("class_name", className);

    // If section is set, also exclude the exact same section within the same class (already excluded by class_name neq).
    // If no section, exclude all rows for this class (already done above).
    const { data: conflicts, error: conflictError } = await conflictQuery;
    if (conflictError)
      return jsonServerError(
        "web-schedule",
        conflictError,
        "تعذر التحقق من تعارض المعلمين.",
        500,
      );

    if (conflicts && conflicts.length > 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "تعارض في جدول المعلم: المعلم مجدول في نفس الوقت لصف آخر.",
          conflicts,
        },
        { status: 409 },
      );
    }
  }

  // C8: Atomic-safe replace — snapshot existing IDs, insert new rows, then delete
  // only the snapshotted IDs. If insert fails we return early and the old schedule
  // is untouched. If delete fails after a successful insert we have duplicates but
  // no data loss; the caller can retry.
  let existingIdQuery = actorSupabase
    .from("class_schedules")
    .select("id")
    .eq("school_id", targetSchoolId)
    .eq("class_name", className);
  if (section) existingIdQuery = existingIdQuery.eq("section", section);

  const { data: existingRows, error: snapshotError } = await existingIdQuery;
  if (snapshotError)
    return jsonServerError(
      "web-schedule",
      snapshotError,
      "تعذر قراءة الجدول الحالي.",
      500,
    );

  const existingIds = (existingRows ?? []).map((r: { id: string }) => r.id);

  // H16: If no entries provided, do nothing — avoid wiping the whole section schedule.
  if (sanitized.length === 0) {
    return NextResponse.json({ ok: true, count: 0 });
  }

  const { error: insertError } = await actorSupabase
    .from("class_schedules")
    .insert(sanitized as never);
  if (insertError)
    return jsonServerError(
      "web-schedule",
      insertError,
      "تعذر حفظ الجدول.",
      500,
    );

  // Delete only the rows that existed before our insert.
  if (existingIds.length > 0) {
    const { error: deleteError } = await actorSupabase
      .from("class_schedules")
      .delete()
      .in("id", existingIds);
    if (deleteError) {
      // Insert already committed — surface the error so the caller knows duplicates exist.
      return jsonServerError(
        "web-schedule",
        deleteError,
        "تعذر حذف الجدول القديم بعد الحفظ.",
        500,
      );
    }
  }

  return NextResponse.json({ ok: true, count: sanitized.length });
}
