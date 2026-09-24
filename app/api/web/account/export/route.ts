/**
 * GDPR Art. 15 — subject access request.
 *
 * Returns the authenticated caller's OWN data as JSON. There is no target
 * parameter: the subject is taken from the session, so the endpoint cannot be
 * pointed at another user. Works for both web sessions and mobile app accounts
 * because it resolves the caller through the mobile route context, which is
 * the common denominator for every managed account in the system.
 */
import { NextRequest, NextResponse } from "next/server";

import { buildSubjectDataExport } from "@/lib/account-deletion/export";
import { resolveMobileRouteContext } from "@/lib/mobile-api-server";
import { enforceRateLimit } from "@/lib/rate-limit";
import { jsonServerError } from "@/lib/route-utils";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const context = await resolveMobileRouteContext(req);
  if (context.ok === false) return context.response;

  const { authUserId, schoolId, account, serviceSupabase } = context.value;

  const limited = await enforceRateLimit(req, {
    namespace: "account-data-export",
    windowMs: 60 * 60_000,
    maxHits: 5,
    identifier: authUserId,
  });
  if (limited) return limited;

  try {
    const linkedId = account.linkage.linked_record_id ?? null;
    const role = account.identity.role ?? null;

    const payload = await buildSubjectDataExport(
      {
        authUserId,
        schoolId,
        role,
        studentId: role === "student" ? linkedId : null,
        teacherId: role === "teacher" ? linkedId : null,
      },
      serviceSupabase,
    );

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="my-data-${authUserId}.json"`,
      },
    });
  } catch (error) {
    return jsonServerError(
      "web/account/export",
      error,
      "تعذر تجهيز نسخة بياناتك. حاول لاحقاً.",
    );
  }
}
