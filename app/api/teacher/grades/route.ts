import { NextRequest, NextResponse } from "next/server";
import {
  createTeacherGradeRecord,
  updateTeacherGradeRecord,
} from "@/lib/academic-records-server";
import {
  filterTeacherStudents,
  resolveTeacherAppContext,
  resolveTeacherContext,
  summarizeTeacherClasses,
  unauthorized,
} from "@/lib/teacher-api";

/**
 * Without `class_name`: the teacher's classes + subjects (for the filters).
 * With `class_name` (+ optional `section`, `subject`, `exam_type`): the class
 * roster merged with the marks this teacher already entered for that
 * subject/exam type, so re-saving edits instead of duplicating.
 */
export async function GET(req: NextRequest) {
  const ctx = await resolveTeacherContext(req);
  if (!ctx) return unauthorized();
  const app = await resolveTeacherAppContext(ctx);
  if (!app) return unauthorized();

  const url = new URL(req.url);
  const className = url.searchParams.get("class_name");
  const section = url.searchParams.get("section");
  const subject = url.searchParams.get("subject");
  const examType = url.searchParams.get("exam_type");

  const classes = summarizeTeacherClasses(app);
  const base = {
    classes,
    class_names: Array.from(new Set(classes.map((c) => c.class_name))),
    subjects: Array.from(new Set(classes.flatMap((c) => c.subjects))),
  };

  if (!className) {
    return NextResponse.json({ ok: true, data: { ...base, students: [] } });
  }

  const roster = filterTeacherStudents(app, className, section);
  const existing = new Map<
    string,
    { id: string; score: number | null; max_score: number | null }
  >();

  if (roster.length > 0 && subject) {
    let query = ctx.supabase
      .from("grades")
      .select("id, student_id, score, max_score, created_at")
      .eq("school_id", ctx.schoolId)
      .eq("teacher_id", ctx.teacherId)
      .eq("subject", subject)
      .in(
        "student_id",
        roster.map((s) => s.student_id),
      )
      .order("created_at", { ascending: false });
    if (examType) query = query.eq("exam_type", examType);

    const { data, error } = await query;
    if (error) {
      return NextResponse.json(
        { ok: false, error: "fetch_failed" },
        { status: 500 },
      );
    }
    for (const row of data ?? []) {
      if (row.student_id && !existing.has(row.student_id)) {
        existing.set(row.student_id, {
          id: row.id,
          score: row.score === null ? null : Number(row.score),
          max_score: row.max_score === null ? null : Number(row.max_score),
        });
      }
    }
  }

  return NextResponse.json(
    {
      ok: true,
      data: {
        ...base,
        students: roster.map((s) => {
          const g = existing.get(s.student_id);
          return {
            student_id: s.student_id,
            full_name: s.full_name,
            section: s.section,
            grade_id: g?.id ?? null,
            score: g?.score ?? null,
            max_score: g?.max_score ?? 100,
          };
        }),
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(req: NextRequest) {
  const ctx = await resolveTeacherContext(req);
  if (!ctx) return unauthorized();
  const app = await resolveTeacherAppContext(ctx);
  if (!app) return unauthorized();

  const body = (await req.json().catch(() => null)) as {
    subject?: unknown;
    exam_type?: unknown;
    grades?: Array<Record<string, unknown>>;
  } | null;

  const grades = Array.isArray(body?.grades) ? body.grades : [];
  if (grades.length === 0 || grades.length > 300) {
    return NextResponse.json(
      { ok: false, error: "لا توجد درجات للحفظ." },
      { status: 400 },
    );
  }

  let saved = 0;
  const errors: string[] = [];
  for (const g of grades) {
    const input = {
      student_id: g.student_id,
      subject: body?.subject,
      exam_type: body?.exam_type,
      score: g.score,
      max_score: g.max_score,
    };
    const result =
      typeof g.grade_id === "string" && g.grade_id
        ? await updateTeacherGradeRecord(app, { ...input, id: g.grade_id })
        : await createTeacherGradeRecord(app, input);
    if (result.ok) saved += 1;
    else {
      const msg = result.message ?? "تعذر حفظ بعض الدرجات.";
      if (!errors.includes(msg)) errors.push(msg);
    }
  }

  const ok = errors.length === 0;
  return NextResponse.json(
    {
      ok,
      error: ok ? undefined : errors.join(" "),
      data: { saved, failed: grades.length - saved },
    },
    { status: ok ? 200 : saved > 0 ? 207 : 400 },
  );
}
