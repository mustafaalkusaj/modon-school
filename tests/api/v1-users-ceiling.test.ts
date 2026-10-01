import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const {
  resolveSchoolScopedActorContextMock,
  createServiceSupabaseClientMock,
  loadDeepPermissionsForUserMock,
  effectivePermissionKeysMock,
} = vi.hoisted(() => ({
  resolveSchoolScopedActorContextMock: vi.fn(),
  createServiceSupabaseClientMock: vi.fn(),
  loadDeepPermissionsForUserMock: vi.fn(),
  effectivePermissionKeysMock: vi.fn(),
}));

vi.mock("@/lib/managed-users-server", () => ({
  resolveSchoolScopedActorContext: resolveSchoolScopedActorContextMock,
}));
vi.mock("@/lib/supabase-server", () => ({
  createServiceSupabaseClient: createServiceSupabaseClientMock,
}));
vi.mock("@/lib/authorization/deep-permissions", () => ({
  loadDeepPermissionsForUser: loadDeepPermissionsForUserMock,
}));
vi.mock("@/lib/authorization/permission-ceiling", () => ({
  effectivePermissionKeys: effectivePermissionKeysMock,
}));

import { POST } from "@/app/api/v1/users/route";

const SCHOOL_ID = "11111111-1111-4111-8111-111111111111";
const ROLE_ID = "22222222-2222-4222-8222-222222222222";
const AUTH_USER_ID = "33333333-3333-4333-8333-333333333333";
const ACTOR_ID = "44444444-4444-4444-8444-444444444444";

function makeService(roleKeys: string[], createUser = vi.fn()) {
  createUser.mockResolvedValue({ data: { user: { id: AUTH_USER_ID } }, error: null });
  return {
    createUser,
    client: {
      auth: { admin: { createUser, deleteUser: vi.fn(async () => ({ error: null })) } },
      from(table: string) {
        const api: Record<string, unknown> = {
          select: () => api,
          eq: () =>
            table === "role_perm_assignments"
              ? Promise.resolve({
                  data: roleKeys.map((key) => ({ perm_definitions: { key } })),
                  error: null,
                })
              : api,
          maybeSingle: async () => ({
            data: table === "school_roles" ? { id: ROLE_ID } : null,
            error: null,
          }),
          single: async () => ({ data: { id: AUTH_USER_ID, school_id: SCHOOL_ID }, error: null }),
          insert: () => ({
            select: () => ({
              single: async () => ({ data: { id: AUTH_USER_ID, school_id: SCHOOL_ID }, error: null }),
            }),
            then: (onF: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(onF),
          }),
        };
        return api;
      },
    },
  };
}

function request() {
  return new Request("http://localhost/api/v1/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      full_name: "Test Employee",
      email: "employee@example.invalid",
      password: "placeholder-pw",
      school_role_id: ROLE_ID,
    }),
  }) as never;
}

function actor(actorRole: string) {
  resolveSchoolScopedActorContextMock.mockResolvedValue({
    ok: true,
    value: { targetSchoolId: SCHOOL_ID, actorBranchId: null, actorUserId: ACTOR_ID, actorRole },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  loadDeepPermissionsForUserMock.mockResolvedValue({ permMap: {}, sidebar: [] });
});

describe("POST /api/v1/users privilege ceiling", () => {
  it("refuses a role holding a permission the acting admin does not have", async () => {
    actor("admin");
    effectivePermissionKeysMock.mockReturnValue(new Set(["students.view"]));
    const service = makeService(["students.view", "payments.delete"]);
    createServiceSupabaseClientMock.mockReturnValue(service.client);

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(service.createUser).not.toHaveBeenCalled();
    expect(loadDeepPermissionsForUserMock).toHaveBeenCalledWith(
      service.client,
      ACTOR_ID,
      SCHOOL_ID,
    );
  });

  it("allows a role whose permissions are a subset of the acting admin's", async () => {
    actor("admin");
    effectivePermissionKeysMock.mockReturnValue(new Set(["students.view", "payments.delete"]));
    const service = makeService(["students.view"]);
    createServiceSupabaseClientMock.mockReturnValue(service.client);

    const response = await POST(request());

    expect(response.status).toBe(201);
    expect(service.createUser).toHaveBeenCalledTimes(1);
  });

  it("does not apply the ceiling to a super admin", async () => {
    actor("super_admin");
    const service = makeService(["anything.at.all"]);
    createServiceSupabaseClientMock.mockReturnValue(service.client);

    const response = await POST(request());

    expect(response.status).toBe(201);
    expect(loadDeepPermissionsForUserMock).not.toHaveBeenCalled();
  });
});
