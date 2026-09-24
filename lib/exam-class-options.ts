import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Canonical list of class names an exam may target inside one school.
 *
 * `exams.class_name` is free text, and the student eligibility check in
 * `/api/mobile/student/exams/[examId]/start` compares it verbatim against
 * `students.class_name`. Any value that does not exist on a student row makes
 * the exam unstartable for everyone, so both the creation UIs and the creation
 * routes resolve their options from here.
 *
 * The list is the union of:
 *  - `students.class_name` — the values eligibility is actually decided on;
 *  - `classes.name` — so a newly created class with no enrolled students yet is
 *    still selectable.
 */

type QueryClient = Pick<SupabaseClient, "from">;

function normalizeClassName(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

/** Comparison key: normalized whitespace, case-insensitive. */
export function classNameKey(value: unknown): string {
  return normalizeClassName(value).toLocaleLowerCase("ar-IQ");
}

export interface SchoolClassOptions {
  /** Display values, sorted, de-duplicated by `classNameKey`. */
  names: string[];
  /** `classNameKey(name)` -> stored display value. */
  byKey: Map<string, string>;
}

export async function loadSchoolClassOptions(
  client: QueryClient,
  schoolId: string,
): Promise<SchoolClassOptions> {
  const [studentRows, classRows] = await Promise.all([
    client.from("students").select("class_name").eq("school_id", schoolId),
    client.from("classes").select("name").eq("school_id", schoolId),
  ]);

  // A failure on either source is not fatal on its own — the other still gives
  // a usable list — but both failing means we have no list at all and callers
  // must not silently treat that as "no valid classes".
  if (studentRows.error && classRows.error) {
    throw new Error("تعذر تحميل قائمة الصفوف.");
  }

  const byKey = new Map<string, string>();
  const collect = (value: unknown) => {
    const name = normalizeClassName(value);
    if (!name) return;
    const key = classNameKey(name);
    if (!byKey.has(key)) byKey.set(key, name);
  };

  for (const row of studentRows.data ?? []) {
    collect((row as { class_name?: unknown }).class_name);
  }
  for (const row of classRows.data ?? []) {
    collect((row as { name?: unknown }).name);
  }

  return {
    names: Array.from(byKey.values()).sort((a, b) => a.localeCompare(b, "ar")),
    byKey,
  };
}

export type ExamClassResolution =
  | { ok: true; value: string | null }
  | { ok: false; message: string };

/**
 * Validate a submitted `class_name` against the school's real classes.
 *
 * An empty value is allowed and stored as `null` — the start route treats a
 * null exam class as "not restricted to a class", which is a deliberate choice
 * and not the bug being fixed here.
 */
export async function resolveExamClassName(
  client: QueryClient,
  schoolId: string,
  rawClassName: unknown,
): Promise<ExamClassResolution> {
  const submitted = normalizeClassName(rawClassName);
  if (!submitted) {
    return { ok: true, value: null };
  }

  let options: SchoolClassOptions;
  try {
    options = await loadSchoolClassOptions(client, schoolId);
  } catch {
    return { ok: false, message: "تعذر التحقق من الصف. حاول مرة أخرى." };
  }

  const match = options.byKey.get(classNameKey(submitted));
  if (!match) {
    const sample = options.names.slice(0, 8).join("، ");
    return {
      ok: false,
      message: options.names.length
        ? `الصف «${submitted}» غير موجود في هذه المدرسة. اختر صفاً من الصفوف المسجّلة: ${sample}${options.names.length > 8 ? "…" : ""}`
        : `الصف «${submitted}» غير موجود في هذه المدرسة، ولا توجد صفوف مسجّلة بعد. أضف الصفوف أو الطلاب أولاً.`,
    };
  }

  // Store the canonical stored spelling so it matches `students.class_name`
  // character-for-character.
  return { ok: true, value: match };
}
