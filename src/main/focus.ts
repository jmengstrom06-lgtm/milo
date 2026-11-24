// Lock-in mode, main-process side: every 1.5s, what's in front (app, browser tab, window position)?
// Tells Milo's window when the student drifts and where the distracting window is, so he can walk
// over and knock on it. "Take me back" returns them to the exact app (and Chrome tab) they were working in.

import { execFile } from "node:child_process";
import { screen } from "electron";
import { log as bb } from "./blackbox";
import { judge, isBrowser, hostOf } from "./focusRules";
import { native } from "./native";

export type FocusState = {
  status: "work" | "distracted" | "neutral";
  label?: string; // "TikTok"
  app: string;
  box?: { x: number; y: number; width: number; height: number } | null; // the distracting window, in Milo's window coordinates
};

function osa(script: string, timeout = 2500): Promise<string> {
  return new Promise((resolve) => {
    execFile("osascript", ["-e", script], { timeout }, (err, out) => resolve(err ? "" : String(out).trim()));
  });
}

/** The active tab's URL and title in a browser (empty if the browser isn't scriptable). */
async function activeTab(app: string): Promise<{ url: string; title: string }> {
  const a = app.replace(/"/g, "");
  let script = "";
  if (/^safari$/i.test(a)) script = `tell application "Safari" to return (URL of current tab of front window) & "\n" & (name of current tab of front window)`;
  else if (/^(google chrome|arc|brave browser|microsoft edge|chromium|vivaldi|opera|dia)$/i.test(a))
    script = `tell application "${a}" to return (URL of active tab of front window) & "\n" & (title of active tab of front window)`;
  if (!script) return { url: "", title: "" };
  const out = await osa(script);
  const [url = "", title = ""] = out.split("\n");
  return { url, title };
}

/** Front app, and its focused window's position (points, whole-screen coordinates). */
export async function frontWindow(): Promise<{ app: string; title: string; frame: { x: number; y: number; w: number; h: number } | null }> {
  const r = await native("window", {}, 1500);
  if (r?.ok && typeof r.name === "string") {
    const has = typeof r.x === "number" && typeof r.w === "number";
    return {
      app: r.name,
      title: String(r.title ?? ""),
      frame: has ? { x: r.x as number, y: r.y as number, w: r.w as number, h: r.h as number } : null,
    };
  }
  // Older helper / no helper: name only via System Events.
  const app = await osa('tell application "System Events" to get name of first application process whose frontmost is true');
  return { app, title: "", frame: null };
}

// ---- the watcher -----------------------------------------------------------------------

let timer: NodeJS.Timeout | null = null;
let send: (s: FocusState) => void = () => {};
let allowed = new Set<string>();
let last = "";
/** Where the student was last actually working, so "Take me back" can return them there. */
let workSpot: { app: string; url?: string } | null = null;

async function tick() {
  try {
    const w = await frontWindow();
    let url = "";
    let title = w.title;
    if (isBrowser(w.app)) {
      const tab = await activeTab(w.app);
      url = tab.url;
      title = tab.title || title;
    }
    const v = judge(w.app, url, title, allowed);
    if (v.status === "work" && w.app) workSpot = { app: w.app, url: url || undefined };

    let box: FocusState["box"] = null;
    if (v.status === "distracted" && w.frame) {
      const wa = screen.getPrimaryDisplay().workArea;
      box = { x: w.frame.x - wa.x, y: w.frame.y - wa.y, width: w.frame.w, height: w.frame.h };
    }
    const state: FocusState = { status: v.status, label: v.status === "distracted" ? v.label : undefined, app: w.app, box };
    const key = `${state.status}|${state.label ?? ""}|${state.app}|${box ? `${box.x},${box.y},${box.width},${box.height}` : ""}`;
    if (key !== last) {
      last = key;
      if (state.status === "distracted") bb("focus", "distracted", { label: state.label });
      send(state);
    }
  } catch (e) {
    bb("focus", "tick_error", { error: (e as Error).message });
  }
  if (timer) timer = setTimeout(tick, 1500);
}

export function startFocus(onState: (s: FocusState) => void) {
  stopFocus();
  send = onState;
  allowed = new Set();
  last = "";
  workSpot = null;
  timer = setTimeout(tick, 300);
  bb("focus", "start");
}

export function stopFocus() {
  if (timer) clearTimeout(timer);
  timer = null;
}

/** "It's for school": stop counting this site/app as a distraction for the rest of the session. */
export function allowForSession(label: string) {
  allowed.add(label);
  last = ""; // re-judge right away
  bb("focus", "allowed", { label });
}

/** Take the student back to where they were working: the same app, and the same Chrome tab if we know it. */
export async function backToWork(): Promise<string | null> {
  const spot = workSpot;
  if (!spot) return null;
  const app = spot.app.replace(/"/g, "");
  if (spot.url && isBrowser(app) && !/^safari$/i.test(app)) {
    const host = hostOf(spot.url);
    const target = spot.url.replace(/"/g, "");
    // Find the tab with that exact page and bring it (and its window) to the front.
    const found = await osa(
      `tell application "${app}"
        set wi to 0
        repeat with w in windows
          set wi to wi + 1
          set ti to 0
          repeat with t in tabs of w
            set ti to ti + 1
            if (URL of t) is "${target}" then
              set active tab index of w to ti
              set index of w to 1
              activate
              return "ok"
            end if
          end repeat
        end repeat
        return ""
      end tell`,
      4000
    );
    if (found === "ok") return host || app;
  } else if (spot.url && /^safari$/i.test(app)) {
    const target = spot.url.replace(/"/g, "");
    const found = await osa(
      `tell application "Safari"
        repeat with w in windows
          repeat with t in tabs of w
            if (URL of t) is "${target}" then
              set current tab of w to t
              set index of w to 1
              activate
              return "ok"
            end if
          end repeat
        end repeat
        return ""
      end tell`,
      4000
    );
    if (found === "ok") return hostOf(spot.url) || app;
  }
  await new Promise<void>((resolve) => execFile("open", ["-a", app], () => resolve()));
  return app;
}
