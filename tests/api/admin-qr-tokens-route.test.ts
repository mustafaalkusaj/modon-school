import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mockState = vi.hoisted(() => ({
  actorProfile: null as null | { role: string; is_active: boolean; school_id: string | null },
  targetProfiles: [] as Array<{ id: string; role: string; school_id: string }>,
  getOrCreateQrToken: vi.fn(),
  getQrTokenById: vi.fn(),
  listQrTokensBySchool: vi.fn(),
  regenerateQrToken: vi.fn(),
  deactivateQrTokenById: vi.fn(),
  bulkGetOrCreateTokens: vi.fn(),
}));

vi.mock("@/lib/supabase-server", () => ({
  createRouteSupabaseClient: async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: mockState.actorProfile, error: null }),
        }),
      }),
    }),
  }),
  getRouteAuthenticatedUser: async () => ({
    data: { user: mockState.actorProfile ? { id: "actor-1" } : null },
    error: null,
  }),
  createServiceSupabaseClient: () => ({
    from: () => ({
      select: () => ({
        in: async (_column: string, ids: string[]) => ({
          data: mockState.targetProfiles.filter((p) => ids.includes(p.id)),
          error: null,
        }),
      }),
    }),
  }),
}));

vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/qr-tokens", () => ({
  generateQrLoginDataUrl: vi.fn().mockResolvedValue("data:image/png;base64,x"),
  getOrCreateQrToken: mockState.getOrCreateQrToken,
  getQrTokenById: mockState.getQrTokenById,
  listQrTokensBySchool: mockState.listQrTokensBySchool,
  regenerateQrToken: mockState.regenerateQrToken,
  deactivateQrTokenById: mockState.deactivateQrTokenById,
  bulkGetOrCreateTokens: mockState.bulkGetOrCreateTokens,
}));

function post(body: unknown) {
  return new NextRequest("http://localhost/api/admin/qr-tokens", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function loadRoute() {
  return import("@/app/api/admin/qr-tokens/route");
}

describe("/api/admin/qr-tokens authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.actorProfile = { role: "admin", is_active: true, school_id: "school-a" };
    mockState.targetProfiles = [
      { id: "student-a", role: "student", school_id: "school-a" },
      { id: "student-b", role: "student", school_id: "school-b" },
      { id: "admin-a", role: "admin", school_id: "school-a" },
      { id: "root", role: "super_admin", school_id: "school-a" },
    ];
    mockState.getOrCreateQrToken.mockResolvedValue({ id: "t1", token: "tok" });
    mockState.listQrTokensBySchool.mockResolvedValue([]);
    mockState.bulkGetOrCreateTokens.mockResolvedValue(new Map());
  });

  it("issues a token for a student in the admin's own school", async () => {
    const { POST } = await loadRoute();
    const res = await POST(post({ action: "generate_qr", auth_user_id: "student-a" }));
    expect(res.status).toBe(200);
    expect(mockState.getOrCreateQrToken).toHaveBeenCalledWith({
      authUserId: "student-a",
      schoolId: "school-a",
    });
  });

  it("rejects a school_id that is not the admin's school", async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      post({ action: "generate_qr", auth_user_id: "student-b", school_id: "school-b" }),
    );
    expect(res.status).toBe(403);
    expect(mockState.getOrCreateQrToken).not.toHaveBeenCalled();
  });

  it("rejects a target user from another school", async () => {
    const { POST } = await loadRoute();
    const res = await POST(post({ action: "generate_qr", auth_user_id: "student-b" }));
    expect(res.status).toBe(403);
  });

  it("never issues a token for a super_admin", async () => {
    const { POST } = await loadRoute();
    const res = await POST(post({ action: "generate_qr", auth_user_id: "root" }));
    expect(res.status).toBe(403);

    mockState.actorProfile = { role: "super_admin", is_active: true, school_id: null };
    const res2 = await POST(
      post({ action: "generate_qr", auth_user_id: "root", school_id: "school-a" }),
    );
    expect(res2.status).toBe(403);
    expect(mockState.getOrCreateQrToken).not.toHaveBeenCalled();
  });

  it("only lets a super_admin issue tokens for school admins", async () => {
    const { POST } = await loadRoute();
    const res = await POST(post({ action: "generate_qr", auth_user_id: "admin-a" }));
    expect(res.status).toBe(403);

    mockState.actorProfile = { role: "super_admin", is_active: true, school_id: null };
    const res2 = await POST(
      post({ action: "generate_qr", auth_user_id: "admin-a", school_id: "school-a" }),
    );
    expect(res2.status).toBe(200);
  });

  it("rejects an unknown target user", async () => {
    const { POST } = await loadRoute();
    const res = await POST(post({ action: "generate_qr", auth_user_id: "ghost" }));
    expect(res.status).toBe(403);
  });

  it("rejects regenerate/deactivate on another school's token", async () => {
    mockState.getQrTokenById.mockResolvedValue({
      id: "t-b",
      token: "x",
      user_id: "student-b",
      school_id: "school-b",
    });
    const { POST } = await loadRoute();
    expect((await POST(post({ action: "regenerate", token_id: "t-b" }))).status).toBe(403);
    expect((await POST(post({ action: "deactivate", token_id: "t-b" }))).status).toBe(403);
    expect(mockState.regenerateQrToken).not.toHaveBeenCalled();
    expect(mockState.deactivateQrTokenById).not.toHaveBeenCalled();
  });

  it("rejects a bulk request containing any ineligible user", async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      post({ action: "bulk_generate", auth_user_ids: ["student-a", "student-b"] }),
    );
    expect(res.status).toBe(403);
    expect(mockState.bulkGetOrCreateTokens).not.toHaveBeenCalled();
  });

  it("does not list another school's tokens", async () => {
    const { GET } = await loadRoute();
    const res = await GET(
      new NextRequest("http://localhost/api/admin/qr-tokens?school_id=school-b"),
    );
    expect(res.status).toBe(403);
    expect(mockState.listQrTokensBySchool).not.toHaveBeenCalled();
  });
});
