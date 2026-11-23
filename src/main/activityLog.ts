// The app's one timeline, saved on this Mac (userData/activity.json), plus the IPC for the panel.
import { app, BrowserWindow, ipcMain } from "electron";
import fs from "node:fs";
import path from "node:path";
import { makeActivity, proofOf, sayActivity, type ActEntry } from "./activity";
import { log as bb } from "./blackbox";
import { track } from "./telemetry";

const file = () => path.join(app.getPath("userData"), "activity.json");

export const activity = makeActivity(
  {
    load: () => {
      try {
        return JSON.parse(fs.readFileSync(file(), "utf8")) as ActEntry[];
      } catch {
        return [];
      }
    },
    save: (all) => {
      try {
        fs.writeFileSync(file(), JSON.stringify(all), { mode: 0o600 });
      } catch (e) {
        bb("activity", "save_failed", { error: (e as Error).message });
      }
    },
  },
  {
    onChange: (all) => {
      for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send("milo:activity", all.slice(0, 100));
    },
  }
);

/** Log it, black-box it, count it. */
export function did(e: Parameters<typeof activity.record>[0]): string {
  bb("activity", "did", { kind: e.kind, undoable: !!e.undo });
  return activity.record(e);
}

export function registerActivity() {
  ipcMain.handle("milo:activity-list", () => activity.list(100).map((e) => ({ ...e, proof: proofOf(e), canUndo: activity.canUndo(e) })));
  ipcMain.handle("milo:activity-undo", async (_e, id: string) => {
    const r = await activity.undo(String(id));
    bb("activity", "undo", { ok: r.ok });
    track("undo", { ok: r.ok, how: "button" });
    return r;
  });
  ipcMain.handle("milo:activity-undo-last", async () => {
    const r = await activity.undoLast();
    track("undo", { ok: r.ok, how: "voice" });
    return r;
  });
  ipcMain.handle("milo:activity-say", (_e, since?: number) => {
    const t = Number(since) || new Date(new Date().toDateString()).getTime();
    return sayActivity(activity.since(t).reverse(), since ? "while you were away" : "today");
  });
  ipcMain.handle("milo:activity-clear", () => activity.clear());
}
