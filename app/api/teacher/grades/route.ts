import { NextRequest, NextResponse } from "next/server";
import { createTeacherGradeRecord } from "@/lib/academic-records-server";
import {
  filterTeacherStudents,
  resolveTeacherContext,
  summarizeTeacherClasses,
  unauthorized,
} from "@/lib/teacher-api";

export async function GET(req: NextRequest) {
  const ctx = await resolveTeacherContext(req);
  if (!ctx) return unauthorized();

  const url = new URL(req.url);
  const classes = summarizeTeacherClasses(ctx);
  const className = url.searchParams.get("class_name") || classes[0]?.class_name || "";
  const subject = url.searchParams.get("subject") || "";

  const roster = className ? filterTeacherStudents(ctx, className) : [];
  const studentIds = roster.map((s) => s.student_id);

  let grades: Array<Record<string, unknown>> = [];
  if (studentIds.length > 0) {
    let query = ctx.supabase
      .from("grades")
      .select("id, student_id, subject, score, max_score, exam_type, created_at")
      .eq("school_id", ctx.schoolId)
      .eq("teacher_id", ctx.teacherId)
      .in("student_id", studentIds)
      .order("created_at", { ascending: false })
      .limit(200);
    if (subject) query = query.eq("subject", subject);
    const { data } = await query;
    grades = (data ?? []) as Array<Record<string, unknown>>;
  }

  const nameById = new Map(roster.map((s) => [s.student_id, s.full_name]));

  return NextResponse.json({
    ok: true,
    data: {
      classes,
      class_name: className,
      students: roster.map((s) => ({
        student_id: s.student_id,
        full_name: s.full_name,
        section: s.section,
      })),
      recent_grades: grades.map((g) => {
        const score = Number(g.score) || 0;
        const maxScore = Number(g.max_score) || 0;
        return {
          id: g.id as string,
          student_id: g.student_id as string,
          student_name: nameById.get(g.student_id as string) ?? "",
          subject: (g.subject as string) ?? "",
          exam_type: (g.exam_type as string) ?? null,
          score,
          max_score: maxScore,
          percentage: maxScore > 0 ? Math.round((score / maxScore) * 100) : null,
          date: (g.created_at as string) ?? null,
        };
      }),
    },
  });
}

export async function POST(req: NextRequest) {
  const ctx = await resolveTeacherContext(req);
  if (!ctx) return unauthorized();

  const body = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const gradesInput = Array.isArray(body.grades)
    ? (body.grades as Array<Record<string, unknown>>)
    : [];

  if (gradesInput.length === 0) {
    return NextResponse.json(
      { ok: false, error: "أدخل درجة طالب واحد على الأقل." },
      { status: 400 },
    );
  }
  if (gradesInput.length > 200) {
    return NextResponse.json(
      { ok: false, error: "عدد الدرجات أكبر من الحد المسموح (200)." },
      { status: 400 },
    );
  }

  const academicCtx = {
    schoolId: ctx.schoolId,
    account: { teacher: { id: ctx.teacherId, assignments: ctx.assignments } },
    serviceSupabase: ctx.supabase,
  };

  const results = await Promise.all(
    gradesInput.map((g) =>
      createTeacherGradeRecord(academicCtx, {
        student_id: g.student_id,
        subject: body.subject,
        exam_type: body.exam_type,
        score: g.score,
        max_score: body.max_score ?? g.max_score,
        note: g.note,
      }),
    ),
  );

  const failed = results.filter((r) => !r.ok);
  const inserted = results.length - failed.length;

  if (inserted === 0) {
    return NextResponse.json(
      { ok: false, error: failed[0]?.message ?? "تعذر حفظ الدرجات." },
      { status: 400 },
    );
  }

  return NextResponse.json({
    ok: true,
    data: { inserted, failed: failed.length },
    message: failed.length
      ? `تم حفظ ${inserted} درجة، وتعذر حفظ ${failed.length}: ${failed[0].message}`
      : `تم حفظ ${inserted} درجة.`,
  });
}
