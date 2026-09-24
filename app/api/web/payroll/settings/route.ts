import { NextRequest, NextResponse } from "next/server";
import { resolveSchoolScopedActorContext } from "@/lib/managed-users-server";
import { createServiceSupabaseClient } from "@/lib/supabase-server";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: { message } }, { status });
}

const ADMIN_ROLES = ["admin", "super_admin"] as const;

const DEFAULT_WORKING_DAYS = 22;
const MAX_WORKING_DAYS = 31;

/**
 * GET /api/web/payroll/settings?schoolId= — payroll settings for one school.
 *
 * A school that has never saved settings has no row, which is not an error:
 * return the defaults so the form renders instead of showing a failure.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;

  const context = await resolveSchoolScopedActorContext(
    searchParams.get("schoolId"),
    {
      allowedRoles: [...ADMIN_ROLES],
      roleDeniedMessage: "ليس لديك صلاحية عرض إعدادات الرواتب.",
    },
    request.headers.get("authorization"),
  );

  if (!context.ok) return jsonError(context.message, context.status);

  const { targetSchoolId } = context.value;
  const serviceClient = createServiceSupabaseClient();

  const { data, error } = await (serviceClient as any)
    .from("payroll_settings")
    .select("school_id, working_days_per_month, default_lecture_price, updated_at")
    .eq("school_id", targetSchoolId)
    .maybeSingle();

  // 42P01 = relation does not exist. The table ships in a migration that may
  // not be applied yet; fall back to defaults so the settings form still
  // renders instead of failing the whole page.
  if (error && error.code !== "42P01") {
    return jsonError(error.message, 500);
  }

  return NextResponse.json({
    ok: true,
    settings: {
      school_id: targetSchoolId,
      working_days_per_month: data?.working_days_per_month ?? DEFAULT_WORKING_DAYS,
      default_lecture_price: Number(data?.default_lecture_price ?? 0),
      updated_at: data?.updated_at ?? null,
    },
  });
}

/**
 * PUT /api/web/payroll/settings
 * Body: { school_id, working_days_per_month, default_lecture_price }
 */
export async function PUT(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;

  const requestedSchoolId = typeof body?.school_id === "string" ? body.school_id : null;

  const context = await resolveSchoolScopedActorContext(
    requestedSchoolId,
    {
      allowedRoles: [...ADMIN_ROLES],
      roleDeniedMessage: "ليس لديك صلاحية تعديل إعدادات الرواتب.",
    },
    request.headers.get("authorization"),
  );

  if (!context.ok) return jsonError(context.message, context.status);

  const { targetSchoolId, actorUserId } = context.value;

  const workingDays = Number(body?.working_days_per_month);
  const lecturePrice = Number(body?.default_lecture_price);

  // Mirror the table's CHECK constraints so a bad value comes back as an
  // Arabic message instead of a raw Postgres error.
  if (!Number.isInteger(workingDays) || workingDays < 1 || workingDays > MAX_WORKING_DAYS) {
    return jsonError(`عدد أيام الدوام يجب أن يكون بين 1 و ${MAX_WORKING_DAYS}.`, 400);
  }

  if (!Number.isFinite(lecturePrice) || lecturePrice < 0) {
    return jsonError("سعر المحاضرة يجب أن يكون رقماً غير سالب.", 400);
  }

  const serviceClient = createServiceSupabaseClient();

  const { data, error } = await (serviceClient as any)
    .from("payroll_settings")
    .upsert(
      {
        school_id: targetSchoolId,
        working_days_per_month: workingDays,
        default_lecture_price: lecturePrice,
        updated_by: actorUserId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "school_id" },
    )
    .select("school_id, working_days_per_month, default_lecture_price, updated_at")
    .single();

  if (error) return jsonError(error.message, 500);

  return NextResponse.json({
    ok: true,
    settings: {
      school_id: data.school_id,
      working_days_per_month: data.working_days_per_month,
      default_lecture_price: Number(data.default_lecture_price),
      updated_at: data.updated_at,
    },
  });
}
