import { beforeEach, describe, expect, it, vi } from "vitest";

const sendNotification = vi.fn();
const updateIn = vi.fn(async () => ({ error: null }));

vi.mock("web-push", () => ({
  default: { setVapidDetails: vi.fn(), sendNotification },
}));

const subs = Array.from({ length: 45 }, (_, i) => ({
  id: `sub-${i}`,
  subscription_json: {
    type: "web",
    endpoint: `https://push.example/${i}`,
    keys: { p256dh: "p", auth: "a" },
  },
}));

vi.mock("@/lib/supabase-server", () => ({
  createServiceSupabaseClient: () => ({
    from: () => {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.in = () => chain;
      chain.eq = (col: string) =>
        col === "is_active" ? Promise.resolve({ data: subs, error: null }) : chain;
      chain.update = () => ({ in: updateIn });
      return chain;
    },
  }),
}));

describe("sendWebPushToUsers", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "pub");
    vi.stubEnv("VAPID_PRIVATE_KEY", "priv");
    sendNotification.mockReset();
    updateIn.mockClear();
  });

  it("sends to every device with a timeout and deactivates gone subscriptions", async () => {
    sendNotification.mockImplementation(async (sub: { endpoint: string }) => {
      if (sub.endpoint.endsWith("/7")) throw Object.assign(new Error("gone"), { statusCode: 410 });
      return {};
    });
    const { sendWebPushToUsers } = await import("@/lib/web-push");
    const result = await sendWebPushToUsers(["u1"], "school-1", { title: "t", body: "b" });

    expect(sendNotification).toHaveBeenCalledTimes(45);
    expect(sendNotification.mock.calls[0][2]).toMatchObject({ timeout: 10_000, TTL: 86_400 });
    expect(result).toMatchObject({ sent: 44, deactivated: 1, failed: 0 });
    expect(updateIn).toHaveBeenCalledWith("id", ["sub-7"]);
  });
});
