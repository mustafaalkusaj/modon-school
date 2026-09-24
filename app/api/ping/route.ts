/**
 * Lightweight public liveness endpoint.
 * Use /api/health for authenticated dependency probes.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  return new Response(
    JSON.stringify({
      ok: true,
      pong: Date.now(),
      timestamp: new Date().toISOString(),
      build_tag: "2026-09-16T-fix-students-v2",
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        "Pragma": "no-cache",
        "Expires": "0",
      },
    }
  );
}
