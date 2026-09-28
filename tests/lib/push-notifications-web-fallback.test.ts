import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const sendWebPushToUsers = vi.fn(async () => ({ sent: 1, failed: 0, deactivated: 0, errors: [] }));
vi.mock("@/lib/web-push", () => ({ sendWebPushToUsers }));

// Minimal chainable client: every query resolves to { data: [], error: null }
// except inserts, which echo one row. No Expo tokens exist.
function makeClient() {
  const query: Record<string, unknown> = {};
  const chain = () => query;
  for (const m of ["select", "in", "eq", "contains", "update", "insert"]) query[m] = chain;
  query.then = (onF: (v: unknown) => unknown) => Promise.resolve({ data: [{ id: "n1" }], error: null }).then(onF);
  return { from: () => query };
}
vi.mock("@/lib/supabase-server", () => ({ createServiceSupabaseClient: () => makeClient() }));

const { sendPushNotification } = await import("@/lib/push-notifications");

describe("sendPushNotification", () => {
  it("still sends Web Push when no Expo tokens are registered", async () => {
    const result = await sendPushNotification(makeClient() as never, {
      schoolId: "school-1",
      userIds: ["user-1"],
      title: "تذكير",
      message: "نص",
      link: "/ar/student/notifications",
    });
    expect(sendWebPushToUsers).toHaveBeenCalledWith(["user-1"], "school-1", {
      title: "تذكير",
      body: "نص",
      category: "general",
      url: "/ar/student/notifications",
    });
    expect(result.sent).toBe(1);
  });
});
