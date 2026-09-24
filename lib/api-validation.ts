import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { z, type ZodSchema } from "zod";

// ─── Common reusable schemas ──────────────────────────────────
export const schemas = {
  uuid: z.string().uuid(),
  email: z.string().email().max(320),
  password: z.string().min(6).max(256),
  name: z.string().trim().min(1).max(255),
  phone: z.string().trim().min(7).max(20).optional(),
  school_id: z.string().uuid(),
  branch_id: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  identifier: z.string().trim().min(1).max(320),
  text: z.string().trim().min(1).max(5000),
  shortText: z.string().trim().min(1).max(500),
  amount: z.coerce.number().min(0),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  boolean: z.coerce.boolean(),
};

// ─── Validate request body ────────────────────────────────────
export async function validateBody<T extends ZodSchema>(
  req: NextRequest,
  schema: T,
): Promise<
  | { success: true; data: z.infer<T> }
  | { success: false; response: NextResponse }
> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return {
      success: false,
      response: NextResponse.json(
        { ok: false, error: "invalid_json", message: "Request body is not valid JSON" },
        { status: 400 },
      ),
    };
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    const fieldErrors = result.error.issues.map((i) => ({
      field: i.path.join("."),
      message: i.message,
    }));
    return {
      success: false,
      response: NextResponse.json(
        { ok: false, error: "validation_error", fields: fieldErrors },
        { status: 400 },
      ),
    };
  }

  return { success: true, data: result.data };
}

// ─── Validate query params ────────────────────────────────────
export function validateParams<T extends ZodSchema>(
  req: NextRequest,
  schema: T,
): 
  | { success: true; data: z.infer<T> }
  | { success: false; response: NextResponse }
{
  const params = Object.fromEntries(req.nextUrl.searchParams.entries());
  const result = schema.safeParse(params);
  if (!result.success) {
    return {
      success: false,
      response: NextResponse.json(
        { ok: false, error: "invalid_params" },
        { status: 400 },
      ),
    };
  }
  return { success: true, data: result.data };
}

// ─── Quick error response helper ──────────────────────────────
export function apiError(error: string, status: number = 400) {
  return NextResponse.json(
    { ok: false, error },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export function apiSuccess<T>(data: T, status: number = 200) {
  return NextResponse.json(
    { ok: true, ...data },
    { status },
  );
}
