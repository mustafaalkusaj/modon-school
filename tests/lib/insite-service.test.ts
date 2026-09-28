import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ createServiceSupabaseClient: vi.fn() }));

import { listNotifications } from "@/lib/notifications/insite-service";

type Result = { data: unknown; error: unknown };

function makeClient(tables: Record<string, Result>) {
  return {
    from: (table: string) => {
      const result = tables[table] ?? { data: [], error: null };
      const query: Record<string, unknown> = {};
      for (const method of ["select", "eq", "or", "order", "range", "limit"]) {
        query[method] = () => query;
      }
      query.then = (onF: (v: Result) => unknown, onR?: (e: unknown) => unknown) =>
        Promise.resolve(result).then(onF, onR);
      return query;
    },
  } as unknown as SupabaseClient;
}

describe("listNotifications", () => {
  it("reads the parent school_notifications row whether it is embedded as an object or an array", async () => {
    const parent = { title: "اجتماع", body: "غداً", category: "general", priority: "normal" };
    const client = makeClient({
      notification_recipients: {
        data: [
          { id: "r1", notification_id: "n1", is_read: false, read_at: null, created_at: "2026-09-01T10:00:00Z", school_notifications: parent },
          { id: "r2", notification_id: "n2", is_read: true, read_at: null, created_at: "2026-09-01T09:00:00Z", school_notifications: [parent] },
        ],
        error: null,
      },
    });

    const items = await listNotifications(client, "user-1", "school-1");

    expect(items.map((i) => i.title)).toEqual(["اجتماع", "اجتماع"]);
    expect(items[0].body).toBe("غداً");
  });

  it("merges direct notifications (teacher broadcasts, homework…) into the first page, newest first", async () => {
    const client = makeClient({
      notification_recipients: { data: [], error: null },
      notifications: {
        data: [
          { id: "d1", type: "teacher_broadcast", title: "من الأستاذ", message: "نص", is_read: false, created_at: "2026-09-02T08:00:00Z" },
        ],
        error: null,
      },
    });

    const items = await listNotifications(client, "user-1", "school-1");

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: "d1", notificationId: "d1", title: "من الأستاذ", body: "نص", isRead: false });
  });
});
