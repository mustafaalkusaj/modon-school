import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const resolveSchoolScopedActorContext = vi.fn();
vi.mock("@/lib/managed-users-server", () => ({ resolveSchoolScopedActorContext }));

const verifyRBACSession = vi.fn();
vi.mock("@/lib/rbac-session", () => ({ RBAC_COOKIE_NAME: "school_rbac", verifyRBACSession }));

let managedRow: { is_active: boolean } | null = { is_active: true };
vi.mock("@/lib/supabase-server", () => ({
  createServiceSupabaseClient: () => {
    const q: Record<string, unknown> = {};
    q.select = () => q;
    q.eq = () => q;
    q.maybeSingle = async () => ({ data: managedRow, error: null });
    return { from: () => q };
  },
}));

const { resolveNotificationActor } = await import("@/lib/notification-actor");

function req() {
  return {
    headers: new Headers(),
    cookies: { get: () => ({ value: "signed-cookie" }) },
  } as never;
}

describe("resolveNotificationActor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    managedRow = { is_active: true };
  });

  it("uses the Supabase session when present", async () => {
    resolveSchoolScopedActorContext.mockResolvedValue({
      ok: true,
      value: { actorUserId: "u1", targetSchoolId: "s1", actorRole: "student", actorSupabase: {} },
    });
    const r = await resolveNotificationActor(req(), ["student"]);
    expect(r).toMatchObject({ ok: true, value: { userId: "u1", schoolId: "s1" } });
    expect(verifyRBACSession).not.toHaveBeenCalled();
  });

  it("falls back to the signed RBAC cookie for QR-login accounts", async () => {
    resolveSchoolScopedActorContext.mockResolvedValue({ ok: false, status: 401, message: "x" });
    verifyRBACSession.mockResolvedValue({ userId: "qr-student", schoolId: "s1", role: "student", userActive: true });
    const r = await resolveNotificationActor(req(), ["student", "teacher"]);
    expect(r).toMatchObject({ ok: true, value: { userId: "qr-student", schoolId: "s1", role: "student" } });
  });

  it("rejects a cookie role that is not allowed", async () => {
    resolveSchoolScopedActorContext.mockResolvedValue({ ok: false, status: 401, message: "x" });
    verifyRBACSession.mockResolvedValue({ userId: "u", schoolId: "s1", role: "student", userActive: true });
    const r = await resolveNotificationActor(req(), ["admin"]);
    expect(r).toMatchObject({ ok: false, status: 403 });
  });

  it("rejects a deactivated managed account", async () => {
    resolveSchoolScopedActorContext.mockResolvedValue({ ok: false, status: 401, message: "x" });
    verifyRBACSession.mockResolvedValue({ userId: "u", schoolId: "s1", role: "student", userActive: true });
    managedRow = { is_active: false };
    const r = await resolveNotificationActor(req(), ["student"]);
    expect(r).toMatchObject({ ok: false, status: 401 });
  });

  it("does not fall back on a 403 from the Supabase path", async () => {
    resolveSchoolScopedActorContext.mockResolvedValue({ ok: false, status: 403, message: "denied" });
    const r = await resolveNotificationActor(req(), ["student"]);
    expect(r).toMatchObject({ ok: false, status: 403 });
    expect(verifyRBACSession).not.toHaveBeenCalled();
  });
});
