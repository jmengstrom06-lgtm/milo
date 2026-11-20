// Sync: a student's class folders, class list and game plans follow them to any Mac they sign in on.
// One row per item in Supabase (sync_items, each student sees only their own). Newest edit wins.
// Runs after sign-in, at startup, a few seconds after any change, and every 5 minutes.

import { ipcMain, type BrowserWindow } from "electron";
import { log as bb } from "./blackbox";
import { account, onAccountChange, rest, userId } from "./account";
import { applyLibraryRows, librarySyncRows, onLibraryChange, type SyncRow } from "./library";
import { loadClasses, onClassesChange, saveClasses } from "./classes";

type Kind = "library" | "classes" | "gameplan";
type Remote = { item_id: string; updated: number | string; deleted: boolean; data?: unknown };

const q = (id: string) => `"${id.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/** Push what's newer here, pull what's newer there. Returns what came down (or null if offline / signed out). */
export async function exchange(kind: Kind, local: SyncRow[]): Promise<SyncRow[] | null> {
  const uid = userId();
  if (!uid) return null;
  const remote = (await rest(`sync_items?select=item_id,updated,deleted&kind=eq.${kind}&limit=5000`)) as Remote[] | null;
  if (!Array.isArray(remote)) return null;
  const there = new Map(remote.map((r) => [r.item_id, Number(r.updated)]));
  const here = new Map(local.map((l) => [l.id, l.updated]));

  // up: anything new or edited here
  const up = local.filter((l) => !there.has(l.id) || l.updated > (there.get(l.id) ?? 0));
  let batch: unknown[] = [];
  let bytes = 0;
  const flush = async () => {
    if (!batch.length) return true;
    const ok = await rest("sync_items?on_conflict=user_id,kind,item_id", { method: "POST", body: batch, prefer: "resolution=merge-duplicates,return=minimal" });
    batch = [];
    bytes = 0;
    return ok !== null;
  };
  for (const l of up) {
    const row = { user_id: uid, kind, item_id: l.id, updated: l.updated, deleted: !!l.deleted, data: l.deleted ? null : (l.data ?? null) };
    const size = JSON.stringify(row).length;
    if (bytes + size > 1_500_000 || batch.length >= 40) if (!(await flush())) return null;
    batch.push(row);
    bytes += size;
  }
  if (!(await flush())) return null;

  // down: anything new or edited on another Mac
  const down = remote.filter((r) => !here.has(r.item_id) || Number(r.updated) > (here.get(r.item_id) ?? 0)).map((r) => r.item_id);
  const got: SyncRow[] = [];
  for (let i = 0; i < down.length; i += 30) {
    const ids = down.slice(i, i + 30).map(q).join(",");
    const rows = (await rest(`sync_items?select=item_id,updated,deleted,data&kind=eq.${kind}&item_id=in.(${encodeURIComponent(ids)})`)) as Remote[] | null;
    if (!Array.isArray(rows)) return null;
    for (const r of rows) got.push({ id: r.item_id, updated: Number(r.updated), deleted: r.deleted, data: r.data });
  }
  if (up.length || got.length) bb("sync", "exchanged", { kind, up: up.length, down: got.length });
  return got;
}

let win: BrowserWindow | null = null;
let running = false;
let again = false;

/** Library + classes here in the main process; game plans live in the window, so it's told to sync its own. */
export async function syncNow(reason: string) {
  if (!account().signedIn) return;
  if (running) {
    again = true;
    return;
  }
  running = true;
  try {
    const changed: Kind[] = [];
    const lib = await exchange("library", librarySyncRows());
    if (lib && applyLibraryRows(lib)) changed.push("library");

    const c = loadClasses();
    // classes set up before sync existed have no edit time: count them as very old, so a newer list elsewhere wins
    const stamp = c.updated || (c.classes.length ? 1 : 0);
    const cls = await exchange("classes", stamp ? [{ id: "all", updated: stamp, data: { classes: c.classes } }] : []);
    const newer = cls?.find((r) => r.id === "all" && !r.deleted);
    if (newer && Array.isArray((newer.data as { classes?: unknown })?.classes)) {
      saveClasses({ classes: (newer.data as { classes: never[] }).classes, active: c.active }, newer.updated);
      changed.push("classes");
    }
    if (lib === null) bb("sync", "offline", { reason });
    win?.webContents.send("milo:sync-now", changed); // the window syncs its game plans, and refreshes what changed
  } catch (e) {
    bb("sync", "error", { reason, error: (e as Error).message });
  } finally {
    running = false;
    if (again) {
      again = false;
      setTimeout(() => void syncNow("queued"), 1500);
    }
  }
}

export function startSync(w: BrowserWindow) {
  win = w;
  let debounce: ReturnType<typeof setTimeout> | null = null;
  const soon = (reason: string) => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => void syncNow(reason), 4000);
  };
  onLibraryChange(() => soon("library_change"));
  onClassesChange(() => soon("classes_change"));
  onAccountChange(() => account().signedIn && void syncNow("signed_in"));
  setTimeout(() => void syncNow("startup"), 6000);
  setInterval(() => void syncNow("every_5_min"), 5 * 60e3);
  // the window's own kinds (game plans) go through the same exchange
  ipcMain.handle("milo:sync-exchange", (_e, kind: Kind, rows: SyncRow[]) =>
    kind === "gameplan" && Array.isArray(rows) ? exchange(kind, rows.slice(0, 200)) : null
  );
}
