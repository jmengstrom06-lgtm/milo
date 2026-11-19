// The class library: everything Milo makes (drawings, sheets, study sets, plans) is filed under the class
// you were working on, so "the cell diagram from bio last week" is one tap away. Stored on this Mac.

import { app, ipcMain } from "electron";
import fs from "node:fs";
import path from "node:path";
import { log as bb } from "./blackbox";

export type LibApp = "sketch" | "sheet" | "study" | "planner";
export type LibItem = {
  id: string;
  classId: string | null; // null = not filed under a class
  app: LibApp;
  title: string;
  created: number;
  updated: number;
  data: unknown; // the sketch / table / study set / plan itself
};

const APPS: LibApp[] = ["sketch", "sheet", "study", "planner"];
const MAX_ITEMS = 600;
const MAX_BYTES = 400_000; // per item (big SVG drawings fit; runaway data doesn't)

const file = () => path.join(app.getPath("userData"), "library.json");
let cache: LibItem[] | null = null;

function all(): LibItem[] {
  if (cache) return cache;
  try {
    const raw = JSON.parse(fs.readFileSync(file(), "utf8"));
    cache = Array.isArray(raw) ? (raw as LibItem[]) : [];
  } catch {
    cache = [];
  }
  return cache;
}
function persist() {
  try {
    fs.mkdirSync(app.getPath("userData"), { recursive: true });
    const tmp = file() + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(cache ?? []));
    fs.renameSync(tmp, file()); // never leave a half-written library
  } catch (e) {
    bb("library", "save_failed", { error: (e as Error).message });
  }
}

/** Add a new item, or update it if `id` is given and exists. */
export function saveItem(input: Partial<LibItem> & { app: LibApp; data: unknown }): LibItem | null {
  if (!APPS.includes(input.app)) return null;
  const size = JSON.stringify(input.data ?? null).length;
  if (size > MAX_BYTES) {
    bb("library", "too_big", { app: input.app, size });
    return null;
  }
  const items = all();
  const now = Date.now();
  const i = input.id ? items.findIndex((x) => x.id === input.id) : -1;
  if (i >= 0) {
    const cur = items[i];
    items[i] = {
      ...cur,
      title: String(input.title ?? cur.title).slice(0, 160),
      classId: input.classId === undefined ? cur.classId : input.classId,
      data: input.data,
      updated: now,
    };
    persist();
    return items[i];
  }
  const item: LibItem = {
    id: `${input.app[0]}${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    classId: input.classId ?? null,
    app: input.app,
    title: String(input.title || "Untitled").slice(0, 160),
    created: now,
    updated: now,
    data: input.data,
  };
  items.unshift(item);
  if (items.length > MAX_ITEMS) items.length = MAX_ITEMS; // oldest fall off
  persist();
  bb("library", "saved", { app: item.app, filed: !!item.classId });
  return item;
}

export function listItems(f: { classId?: string | null | "all"; app?: LibApp | "all" } = {}): LibItem[] {
  return all()
    .filter((x) => f.classId === undefined || f.classId === "all" || x.classId === f.classId)
    .filter((x) => !f.app || f.app === "all" || x.app === f.app)
    .sort((a, b) => b.updated - a.updated);
}

export function moveItem(id: string, classId: string | null): LibItem | null {
  const it = all().find((x) => x.id === id);
  if (!it) return null;
  it.classId = classId;
  it.updated = Date.now();
  persist();
  return it;
}

export function deleteItem(id: string): boolean {
  const items = all();
  const i = items.findIndex((x) => x.id === id);
  if (i < 0) return false;
  items.splice(i, 1);
  persist();
  return true;
}

/** How many things each class has, per app ("null" = not filed). */
export function counts(): Record<string, Record<LibApp, number>> {
  const out: Record<string, Record<LibApp, number>> = {};
  for (const it of all()) {
    const k = it.classId ?? "null";
    out[k] ??= { sketch: 0, sheet: 0, study: 0, planner: 0 };
    out[k][it.app]++;
  }
  return out;
}

/** A class was deleted: its things become unfiled instead of disappearing. */
export function unfileMissing(classIds: string[]) {
  const keep = new Set(classIds);
  let changed = false;
  for (const it of all()) {
    if (it.classId && !keep.has(it.classId)) {
      it.classId = null;
      changed = true;
    }
  }
  if (changed) persist();
}

export function registerLibrary() {
  ipcMain.handle("lib:save", (_e, item) => saveItem(item));
  ipcMain.handle("lib:list", (_e, f) => listItems(f ?? {}));
  ipcMain.handle("lib:move", (_e, id: string, classId: string | null) => moveItem(String(id), classId ? String(classId) : null));
  ipcMain.handle("lib:delete", (_e, id: string) => deleteItem(String(id)));
  ipcMain.handle("lib:counts", () => counts());
}
