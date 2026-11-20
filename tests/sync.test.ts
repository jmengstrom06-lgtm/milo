import { describe, it, expect, vi, beforeEach } from "vitest";

// A tiny fake of the Supabase table, speaking the same requests sync.ts sends.
type Row = { user_id: string; kind: string; item_id: string; updated: number; deleted: boolean; data: unknown };
let db: Row[] = [];
let requests = 0;
vi.mock("electron", () => ({ ipcMain: { handle: () => {} }, app: { getPath: () => "/tmp" } }));
vi.mock("../src/main/blackbox", () => ({ log: () => {} }));
vi.mock("../src/main/library", () => ({ applyLibraryRows: () => 0, librarySyncRows: () => [], onLibraryChange: () => {} }));
vi.mock("../src/main/classes", () => ({ loadClasses: () => ({ classes: [], active: null }), onClassesChange: () => {}, saveClasses: () => {} }));
vi.mock("../src/main/account", () => ({
  account: () => ({ signedIn: true, email: "" }),
  onAccountChange: () => {},
  userId: () => "u1",
  rest: async (path: string, init: { method?: string; body?: Row[] } = {}) => {
    requests++;
    const u = new URL("http://x/" + path);
    const kind = (u.searchParams.get("kind") ?? "").replace("eq.", "");
    if (init.method === "POST") {
      for (const r of init.body ?? []) {
        const i = db.findIndex((x) => x.user_id === r.user_id && x.kind === r.kind && x.item_id === r.item_id);
        if (i >= 0) db[i] = r;
        else db.push(r);
      }
      return true;
    }
    let rows = db.filter((r) => r.kind === kind);
    const inq = u.searchParams.get("item_id");
    if (inq) {
      const ids = JSON.parse("[" + inq.replace(/^in\.\(|\)$/g, "") + "]");
      rows = rows.filter((r) => ids.includes(r.item_id));
    }
    return rows.map((r) => ({ item_id: r.item_id, updated: String(r.updated), deleted: r.deleted, data: r.data }));
  },
}));

import { exchange } from "../src/main/sync";

describe("sync", () => {
  beforeEach(() => {
    db = [];
    requests = 0;
  });

  it("first Mac uploads, second Mac downloads", async () => {
    expect(await exchange("gameplan", [{ id: "stat|hw 7: tests, part 2", updated: 100, data: { step: 1 } }])).toEqual([]);
    expect(db.length).toBe(1);
    const down = await exchange("gameplan", []);
    expect(down).toEqual([{ id: "stat|hw 7: tests, part 2", updated: 100, deleted: false, data: { step: 1 } }]);
  });

  it("newest edit wins, both directions", async () => {
    await exchange("gameplan", [{ id: "a", updated: 100, data: "old" }]);
    // Mac B edited it later: B's version goes up
    expect(await exchange("gameplan", [{ id: "a", updated: 200, data: "B" }])).toEqual([]);
    expect(db[0].data).toBe("B");
    // Mac A still has the old one: it comes down, A's old copy does NOT go up
    const down = await exchange("gameplan", [{ id: "a", updated: 100, data: "old" }]);
    expect(down?.[0].data).toBe("B");
    expect(db[0].data).toBe("B");
  });

  it("a delete reaches the other Mac", async () => {
    await exchange("library", [{ id: "s1", updated: 100, data: { title: "Cell" } }]);
    await exchange("library", [{ id: "s1", updated: 300, deleted: true }]);
    const down = await exchange("library", [{ id: "s1", updated: 100, data: { title: "Cell" } }]);
    expect(down).toEqual([{ id: "s1", updated: 300, deleted: true, data: null }]);
  });

  it("nothing to do = no uploads", async () => {
    await exchange("gameplan", [{ id: "a", updated: 1, data: 1 }]);
    requests = 0;
    await exchange("gameplan", [{ id: "a", updated: 1, data: 1 }]);
    expect(requests).toBe(1); // just the quick "what's there" check
  });
});
