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

/** Type text. Short plain text is typed key by key (looks like Milo typing); long or fancy text is pasted. */
export async function typeText(text: string) {
  const plain = /^[\x20-\x7E]*$/.test(text);
  try {
    if (plain && text.length <= 120) {
      await run("osascript", [
        "-e", "on run argv",
        "-e", 'tell application "System Events"',
        "-e", "repeat with c in characters of (item 1 of argv)",
        "-e", "keystroke c",
        "-e", "delay 0.012",
        "-e", "end repeat",
        "-e", "end tell",
        "-e", "end run",
        text,
      ]);
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
export async function openApp(name: string) {
  try {
    await run("open", ["-a", name]);
  } catch {
    try {
      await run("osascript", ["-e", `tell application "${name.replace(/"/g, "")}" to activate`]);
    } catch (e) {
      throw new Error(`I couldn't find an app called "${name}".`);
    }
  }
  await sleep(900); // let it come to the front
}

export async function openUrl(url: string) {
  // Prefer Chrome; fall back to the default browser.
  try {
    await run("open", ["-a", "Google Chrome", url]);
  } catch {
    await run("open", [url]);
  }
  await sleep(1300);
}

const BROWSERS = /^(Google Chrome|Safari|Arc|Firefox|Microsoft Edge|Brave Browser|Opera)$/;

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
  if (!BROWSERS.test(front)) await openApp("Google Chrome");
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
