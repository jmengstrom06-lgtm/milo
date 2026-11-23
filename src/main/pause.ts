// "Pause Milo": one switch that really stops him. While paused he doesn't look at the screen,
// doesn't listen, and doesn't run anything. Saved on this Mac, so it survives a restart, and it can
// turn itself back on after a set time.

import { app, BrowserWindow } from "electron";
import fs from "node:fs";
import path from "node:path";
import { log as bb } from "./blackbox";

export type PauseState = { on: boolean; since: number | null; until: number | null };

const file = () => path.join(app.getPath("userData"), "pause.json");
let state: PauseState = { on: false, since: null, until: null };
let loaded = false;
let timer: NodeJS.Timeout | null = null;

function load() {
  if (loaded) return;
  loaded = true;
  try {
    const s = JSON.parse(fs.readFileSync(file(), "utf8")) as PauseState;
    if (s && typeof s.on === "boolean") state = s;
  } catch {
    /* never paused */
  }
  arm();
}
function save() {
  try {
    fs.writeFileSync(file(), JSON.stringify(state), { mode: 0o600 });
  } catch (e) {
    bb("pause", "save_failed", { error: (e as Error).message });
  }
}
function broadcast() {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send("milo:pause", state);
}
function arm() {
  if (timer) clearTimeout(timer);
  timer = null;
  if (state.on && state.until) timer = setTimeout(() => setPause(false), Math.max(0, state.until - Date.now()));
}

export function pauseState(): PauseState {
  load();
  if (state.on && state.until && Date.now() >= state.until) setPause(false);
  return state;
}
export const isPaused = () => pauseState().on;

/** minutes: undefined or 0 = until turned back on. */
export function setPause(on: boolean, minutes?: number, onPause?: () => void): PauseState {
  load();
  state = on ? { on: true, since: Date.now(), until: minutes && minutes > 0 ? Date.now() + minutes * 60e3 : null } : { on: false, since: null, until: null };
  save();
  arm();
  bb("pause", on ? "on" : "off", { minutes: minutes ?? null });
  if (on) onPause?.();
  broadcast();
  return state;
}

export const PAUSED_TEXT = "I'm paused, so I'm not looking at your screen or listening. Turn me back on in Home base whenever you want.";
