import { NextRequest, NextResponse } from "next/server";
import { resolveSchoolScopedActorContext } from "@/lib/managed-users-server";
import { loadSchoolClassOptions } from "@/lib/exam-class-options";

export const dynamic = "force-dynamic";

const ALLOWED_ROLES = ["admin", "super_admin", "employee"] as const;

/**
 * Class names an exam may target in this school. The exam creation form uses
 * this to offer a selection instead of free text, so the stored `class_name`
 * always matches a real `students.class_name`.
 */
export async function GET(request: NextRequest) {
  const schoolIdParam = request.nextUrl.searchParams.get("schoolId");
  const context = await resolveSchoolScopedActorContext(
    schoolIdParam,
    {
      allowedRoles: [...ALLOWED_ROLES],
      roleDeniedMessage: "ليس لديك صلاحية الوصول إلى الامتحانات.",
    },
    request.headers.get("authorization"),
  );
  if (!context.ok) {
    return NextResponse.json(
      { ok: false, error: context.message },
      { status: context.status },
    );
  }

  const { actorSupabase, targetSchoolId } = context.value;
  try {
    const options = await loadSchoolClassOptions(actorSupabase, targetSchoolId);
    return NextResponse.json({ ok: true, items: options.names });
  } catch {
    return NextResponse.json(
      { ok: false, error: "تعذر تحميل قائمة الصفوف." },
      { status: 500 },
    );
  }
}
