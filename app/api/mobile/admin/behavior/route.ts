import { NextRequest, NextResponse } from "next/server";

import {
  parseMobileListParams,
  queryMobileBehaviorLogs,
  type MobileRouteContext,
} from "@/lib/mobile-api-server";
import { resolveAdminMobileRouteContext } from "@/lib/mobile-admin-server";
import { isValidUUID } from "@/lib/route-utils";
import { excludeDeletedStudents } from "@/lib/students/soft-delete";

export async function GET(req: NextRequest) {
  try {
    const context = await resolveAdminMobileRouteContext(req);
    if (context.ok === false) {
      return context.response;
    }

    const params = parseMobileListParams(req, { limit: 20, maxLimit: 100 });
    const url = new URL(req.url);

    // queryMobileBehaviorLogs only reads serviceSupabase + schoolId, both present
    // on the admin context. Cast to the shared shape to reuse the query.
    const result = await queryMobileBehaviorLogs(
      context.value as unknown as MobileRouteContext,
      params,
      { studentId: url.searchParams.get("student_id")?.trim() || undefined },
    );

    return NextResponse.json({
      ok: true,
      gate: result.gate,
      items: result.items,
      page: params.page,
      limit: params.limit,
    });
  } catch (error) {
    // A bare `catch {}` here hid a TypeError: the response said "internal_error"
    // with no way to tell a schema fault from a null deref.
    console.error("[mobile/admin/behavior] GET failed", error);
    return NextResponse.json(
      { ok: false, error: "internal_error" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const context = await resolveAdminMobileRouteContext(req);
    if (context.ok === false) return context.response;

    const { schoolId, serviceSupabase } = context.value;
    const body = ((await req.json().catch(() => null)) ?? {}) as {
      student_id?: string;
      student_name?: string;
      behavior_type?: string;
      points?: number;
      note?: string;
    };

    const { student_id, student_name, behavior_type, points, note } = body;

    if (
      !student_name ||
      typeof student_name !== "string" ||
      !student_name.trim()
    ) {
      return NextResponse.json(
        { ok: false, error: "missing_required_field", field: "student_name" },
        { status: 400 },
      );
    }

    // `behavior_type` is NOT NULL — passing null turned a bad request into a 500.
    if (
      !behavior_type ||
      typeof behavior_type !== "string" ||
      !behavior_type.trim()
    ) {
      return NextResponse.json(
        { ok: false, error: "نوع السلوك مطلوب.", field: "behavior_type" },
        { status: 400 },
      );
    }

    if (
      student_id !== undefined &&
      student_id !== null &&
      (typeof student_id !== "string" || !isValidUUID(student_id))
    ) {
      return NextResponse.json(
        { ok: false, error: "معرّف الطالب غير صالح.", field: "student_id" },
        { status: 400 },
      );
    }

    if (
      typeof points !== "number" ||
      !Number.isInteger(points) ||
      points === 0 ||
      points < -50 ||
      points > 50
    ) {
      return NextResponse.json(
        { ok: false, error: "invalid_points", field: "points" },
        { status: 400 },
      );
    }

    // The service client bypasses RLS, so school ownership of a body-supplied
    // student id is enforced here.
    if (student_id) {
      const { data: student, error: studentError } =
        await excludeDeletedStudents(
          serviceSupabase.from("students").select("id"),
        )
          .eq("id", student_id)
          .eq("school_id", schoolId)
          .maybeSingle();

      if (studentError) {
        return NextResponse.json(
          { ok: false, error: "تعذر التحقق من الطالب." },
          { status: 500 },
        );
      }
      if (!student) {
        return NextResponse.json(
          {
            ok: false,
            error: "الطالب غير موجود في مدرستك.",
            field: "student_id",
          },
          { status: 403 },
        );
      }
    }

    const { data, error } = await serviceSupabase
      .from("behavior_logs")
      .insert({
        school_id: schoolId,
        student_id: student_id ?? null,
        student_name: student_name.trim(),
        behavior_type: behavior_type.trim(),
        points,
        note: note ?? null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)
      .select(
        "id, student_id, student_name, behavior_type, points, note, created_at",
      )
      .single();

    if (error) throw error;

    return NextResponse.json({ ok: true, item: data });
  } catch {
    return NextResponse.json(
      { ok: false, error: "internal_error" },
      { status: 500 },
    );
  }
}
