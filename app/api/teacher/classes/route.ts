import { NextRequest, NextResponse } from "next/server";
import {
  resolveTeacherAppContext,
  resolveTeacherContext,
  summarizeTeacherClasses,
  unauthorized,
} from "@/lib/teacher-api";

export async function GET(req: NextRequest) {
  const ctx = await resolveTeacherContext(req);
  if (!ctx) return unauthorized();
  const app = await resolveTeacherAppContext(ctx);
  if (!app) return unauthorized();

  return NextResponse.json(
    { ok: true, data: { classes: summarizeTeacherClasses(app) } },
    { headers: { "Cache-Control": "no-store" } },
  );
}
