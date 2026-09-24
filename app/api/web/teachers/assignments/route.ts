import { NextRequest, NextResponse } from "next/server";
import { resolveSchoolScopedActorContext } from "@/lib/managed-users-server";
import { jsonError, logRouteError } from "@/lib/route-utils";

export async function GET(req: NextRequest) {
  const schoolId = req.nextUrl.searchParams.get("schoolId");

  const context = await resolveSchoolScopedActorContext(
    schoolId,
    {
      allowedRoles: ["super_admin", "admin", "employee"],
      roleDeniedMessage: "عرض تعيينات الأساتذة متاح ضمن نطاق المدرسة فقط.",
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

  const { actorSupabase, targetSchoolId } = context.value;

  try {
    const { data, error } = await actorSupabase
      .from("teacher_assignments")
      .select("teacher_id, class_id, section_id, classes(id, name), sections(id, name), subjects(id, name)")
      .eq("school_id", targetSchoolId)
      .eq("is_active", true);

    if (error) {
      logRouteError("teachers-assignments-bulk", error, { schoolId: targetSchoolId });
      return jsonError("تعذر تحميل تعيينات الأساتذة.", 500);
    }

    const rows = (data ?? []) as Array<Record<string, unknown>>;

    const byTeacher: Record<string, Array<{ class_name: string; section: string | null; subject: string | null }>> = {};

    for (const row of rows) {
      const tid = row.teacher_id as string;
      const cls = row.classes as Record<string, unknown> | null;
      const sec = row.sections as Record<string, unknown> | null;
      const subj = row.subjects as Record<string, unknown> | null;

      if (!cls) continue;

      if (!byTeacher[tid]) byTeacher[tid] = [];

      const className = (cls.name as string) ?? "";
      const sectionName = sec ? (sec.name as string) : null;
      const subjectName = subj ? (subj.name as string) : null;

      const key = `${className}::${sectionName ?? ""}::${subjectName ?? ""}`;
      const exists = byTeacher[tid].some(
        (a) => `${a.class_name}::${a.section ?? ""}::${a.subject ?? ""}` === key,
      );
      if (!exists) {
        byTeacher[tid].push({ class_name: className, section: sectionName, subject: subjectName });
      }
    }

    return NextResponse.json({ ok: true, data: byTeacher });
  } catch (error) {
    logRouteError("teachers-assignments-bulk", error, { schoolId: targetSchoolId });
    return jsonError("تعذر تحميل تعيينات الأساتذة.", 500);
  }
}
