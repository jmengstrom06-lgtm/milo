// Milo's hands: clicks, typing and shortcuts on macOS.
// Uses only built-in tools (osascript / JavaScript for Automation), so there are no native modules to install.
// Needs Accessibility permission for Terminal (dev) or Milo (packaged app).

import { execFile } from "node:child_process";
import { app, clipboard } from "electron";
import fs from "node:fs";
import path from "node:path";

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 15000 }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message).trim()));
      else resolve(stdout.trim());
    });
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const ACCESSIBILITY_HELP =
  "I need permission to use your keyboard and mouse. Open System Settings > Privacy & Security > Accessibility, turn on Terminal (and Electron if listed), then restart me.";

function friendly(err: unknown): Error {
  const msg = (err as Error).message || String(err);
  if (/not allowed|1002|assistive|accessibility|-25211|1743/i.test(msg)) return new Error(ACCESSIBILITY_HELP);
  return new Error(msg);
}

// ---- mouse --------------------------------------------------------------------
// CoreGraphics through JXA. Numbers instead of constant names because the JXA bridge
// doesn't expose every enum: MouseMoved=5, LeftDown=1, LeftUp=2, button left=0, HID tap=0, clickState field=1.
const CLICK_JXA = `
ObjC.import('CoreGraphics');
function run(argv) {
  var x = Number(argv[0]), y = Number(argv[1]), n = Number(argv[2] || 1);
  var p = { x: x, y: y };
  $.CGEventPost(0, $.CGEventCreateMouseEvent(null, 5, p, 0));
  delay(0.06);
  for (var i = 1; i <= n; i++) {
    var d = $.CGEventCreateMouseEvent(null, 1, p, 0);
    $.CGEventSetIntegerValueField(d, 1, i);
    $.CGEventPost(0, d);
    var u = $.CGEventCreateMouseEvent(null, 2, p, 0);
    $.CGEventSetIntegerValueField(u, 1, i);
    $.CGEventPost(0, u);
    delay(0.04);
  }
}`;

export async function click(x: number, y: number, count = 1) {
  const X = String(Math.round(x));
  const Y = String(Math.round(y));
  try {
    await run("osascript", ["-l", "JavaScript", "-e", CLICK_JXA, X, Y, String(count)]);
  } catch (e) {
    const err = friendly(e);
    if (err.message === ACCESSIBILITY_HELP) throw err;
    // Backup: System Events can click at a screen point too.
    try {
      for (let i = 0; i < count; i++) {
        await run("osascript", ["-e", `tell application "System Events" to click at {${X}, ${Y}}`]);
      }
    } catch (e2) {
      throw friendly(e2);
    }
  }
}

// ---- keyboard -----------------------------------------------------------------
const KEY_CODES: Record<string, number> = {
  enter: 36, return: 36, tab: 48, space: 49, delete: 51, backspace: 51, escape: 53, esc: 53,
  left: 123, right: 124, down: 125, up: 126, pageup: 116, pagedown: 121, home: 115, end: 119, forwarddelete: 117,
};
const MODS: Record<string, string> = {
  cmd: "command down", command: "command down", ctrl: "control down", control: "control down",
  alt: "option down", option: "option down", opt: "option down", shift: "shift down",
};

/** Turn "cmd+shift+t" / "enter" into one AppleScript line. Exported for tests. */
export function keyScript(combo: string): string {
  const parts = combo.toLowerCase().replace(/\s+/g, "").split("+").filter(Boolean);
  const mods = parts.filter((p) => MODS[p]).map((p) => MODS[p]);
  const key = parts.filter((p) => !MODS[p]).pop() ?? "";
  if (!key) throw new Error(`Bad key combo: ${combo}`);
  const using = mods.length ? ` using {${mods.join(", ")}}` : "";
  const code = KEY_CODES[key];
  if (code !== undefined) return `tell application "System Events" to key code ${code}${using}`;
  if (key.length === 1) return `tell application "System Events" to keystroke "${key.replace(/"/g, '\\"')}"${using}`;
  throw new Error(`Unknown key: ${key}`);
}

export async function pressKeys(combo: string) {
  try {
    await run("osascript", ["-e", keyScript(combo)]);
  } catch (e) {
    throw friendly(e);
  }
}

/** Make text typeable key by key: swap smart quotes and dashes for plain ones. */
function plainify(text: string) {
  return text
    .replace(/[\u201C\u201D\u201E]/g, '"')
    .replace(/[\u2018\u2019\u201A]/g, "'")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u00A0/g, " ")
    .replace(/\r\n?/g, "\n");
}

const KEYSTROKE = ["-e", "on run argv", "-e", 'tell application "System Events" to keystroke (item 1 of argv)', "-e", "end run"];

/**
 * Type text so it visibly appears character by character (it looks great on video).
 * Long or non-English text falls back to a paste.
 */
export async function typeText(text: string) {
  const t = plainify(text);
  try {
    if (/^[\x20-\x7E\n\t]*$/.test(t) && t.length <= 2500) {
      const lines = t.split("\n");
      for (let li = 0; li < lines.length; li++) {
        const line = lines[li];
        for (let i = 0; i < line.length; i += 48) {
          await run("osascript", [...KEYSTROKE, line.slice(i, i + 48)]);
        }
        if (li < lines.length - 1) await run("osascript", ["-e", 'tell application "System Events" to key code 36']);
      }
      return;
    }
    const saved = clipboard.readText();
    clipboard.writeText(text);
    await sleep(60);
    await run("osascript", ["-e", 'tell application "System Events" to keystroke "v" using {command down}']);
    await sleep(400);
    clipboard.writeText(saved);
  } catch (e) {
    throw friendly(e);
  }
}

// ---- apps -----------------------------------------------------------------------
const ALIASES: Record<string, string> = {
  chrome: "Google Chrome", "google chrome": "Google Chrome", word: "Microsoft Word", excel: "Microsoft Excel",
  powerpoint: "Microsoft PowerPoint", outlook: "Microsoft Outlook", teams: "Microsoft Teams", zoom: "zoom.us",
  "vs code": "Visual Studio Code", vscode: "Visual Studio Code", settings: "System Settings", imessage: "Messages",
  "chat gpt": "ChatGPT", chatgpt: "ChatGPT",
};

const norm = (s: string) =>
  s.toLowerCase().replace(/\.app$/, "").replace(/\b(the|my|app|application|browser|program)\b/g, "").replace(/[^a-z0-9]+/g, " ").trim();

let appCache: string[] | null = null;
function installedApps(): string[] {
  if (appCache) return appCache;
  const dirs = ["/Applications", "/System/Applications", "/System/Applications/Utilities", "/Applications/Utilities", path.join(app.getPath("home"), "Applications")];
  const names = new Set<string>();
  for (const d of dirs) {
    try {
      for (const f of fs.readdirSync(d)) if (f.endsWith(".app")) names.add(f.slice(0, -4));
    } catch {
      /* folder missing */
    }
  }
  appCache = [...names];
  return appCache;
}

/** "chrome browser" -> "Google Chrome", "the notes app" -> "Notes", "photoshop" -> "Adobe Photoshop 2026". */
export function resolveApp(name: string): string {
  const n = norm(name);
  if (ALIASES[n]) return ALIASES[n];
  const apps = installedApps();
  const exact = apps.find((a) => norm(a) === n);
  if (exact) return exact;
  const words = n.split(" ").filter(Boolean);
  const scored = apps
    .map((a) => {
      const an = norm(a);
      const hits = words.filter((w) => an.split(" ").includes(w)).length;
      return { a, score: hits * 10 - Math.abs(an.length - n.length) / 10 + (an.includes(n) ? 5 : 0) };
    })
    .filter((x) => x.score > 0)
    .sort((x, y) => y.score - x.score);
  return scored[0]?.a ?? name;
}

const isBrowser = (a: string) => /^(Google Chrome|Safari|Arc|Firefox|Microsoft Edge|Brave Browser|Opera)$/.test(a);

// ---- Chrome without the "Who's using Chrome?" profile picker ---------------------------
/** The Chrome profile you used last (e.g. "Default" or "Profile 1"). */
function lastChromeProfile(): string {
  try {
    const file = path.join(app.getPath("home"), "Library/Application Support/Google/Chrome/Local State");
    const state = JSON.parse(fs.readFileSync(file, "utf8"));
    return state?.profile?.last_used || "Default";
  } catch {
    return "Default";
  }
}
async function chromeRunning() {
  try {
    await run("pgrep", ["-x", "Google Chrome"]);
    return true;
  } catch {
    return false;
  }
}
/**
 * Open Chrome (optionally at a URL) straight into your last profile. Launching Chrome with a
 * profile named skips the picker; if Chrome is already running we just use the window you're in.
 */
async function openChrome(url?: string) {
  const profile = lastChromeProfile();
  if (!(await chromeRunning())) {
    await run("open", ["-a", "Google Chrome", "--args", `--profile-directory=${profile}`, ...(url ? [url] : [])]);
    await sleep(1500);
    return;
  }
  if (url) {
    await run("open", ["-a", "Google Chrome", url]);
  } else {
    // Running but maybe no window: open one in your profile (this path never shows the picker).
    const hasWindow = await run("osascript", ["-e", 'tell application "Google Chrome" to count of windows']).catch(() => "0");
    if (Number(hasWindow) === 0) await run("open", ["-na", "Google Chrome", "--args", `--profile-directory=${profile}`]);
    await run("osascript", ["-e", 'tell application "Google Chrome" to activate']).catch(() => {});
  }
  await sleep(600);
}

/** Quit an app the normal way (it can still ask to save). */
export async function quitApp(name: string) {
  const real = resolveApp(name);
  await run("osascript", ["-e", `tell application "${real.replace(/"/g, "")}" to quit`]).catch(() => {});
  await sleep(400);
  return real;
}

export async function openApp(name: string) {
  const real = resolveApp(name);
  if (real === "Google Chrome") {
    await openChrome();
    return real;
  }
  try {
    await run("open", ["-a", real]);
  } catch {
    throw new Error(`I couldn't find an app called "${name}" on your Mac.`);
  }
  await sleep(700);
  // Browsers can be "open" with no window at all; make sure one is showing.
  if (isBrowser(real)) {
    try {
      await run("osascript", ["-e", `tell application "${real}" to if (count of windows) = 0 then make new window`]);
    } catch {
      /* not scriptable (e.g. Arc): fine */
    }
    await run("osascript", ["-e", `tell application "${real}" to activate`]).catch(() => {});
  }
  await sleep(300);
  return real;
}

export async function openUrl(url: string) {
  // Prefer Chrome (in your profile, no picker); fall back to the default browser.
  try {
    await openChrome(url);
  } catch {
    await run("open", [url]);
  }
  await sleep(900);
}


export async function frontApp(): Promise<string> {
  try {
    return await run("osascript", ["-e", 'tell application "System Events" to get name of first application process whose frontmost is true']);
  } catch {
    return "";
  }
}

/** Make sure a browser is in front (for tab shortcuts). Opens Chrome if none is. */
export async function ensureBrowser() {
  const front = await frontApp();
  if (!isBrowser(front)) await openApp("Google Chrome");
}

/** Open the newest file in ~/Downloads. Returns its name. */
export async function openLatestDownload(): Promise<string> {
  const dir = app.getPath("downloads");
  const files = fs
    .readdirSync(dir)
    .filter((f) => !f.startsWith(".") && !/\.(crdownload|download|part|tmp)$/i.test(f))
    .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  if (!files.length) throw new Error("Your Downloads folder is empty.");
  await run("open", [path.join(dir, files[0].f)]);
  await sleep(1800); // give Preview / Word / the browser a moment to show it
  return files[0].f;
}

export async function openFolder(which: "downloads" | "desktop" | "documents") {
  await run("open", [app.getPath(which)]);
  await sleep(700);
}
