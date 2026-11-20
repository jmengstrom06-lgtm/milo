import {
  app,
  BrowserWindow,
  session,
  clipboard,
  desktopCapturer,
  nativeImage,
  globalShortcut,
  ipcMain,
  screen,
  systemPreferences,
  shell,
} from "electron";
import path from "node:path";
import dotenv from "dotenv";
import { speak } from "./voice";
import { log as bb, saveClip, timer, LOG_DIR, LOG_FILE } from "./blackbox";
import { closeFlux, fluxAvailable, forceEndTurn, onFlux, openFlux, sendAudio } from "./flux";
import { macSpeak } from "./macvoice";
import { bridgeConnected, call as ext, startBridge } from "./bridge";
import { runWebTask } from "./webagent";
import { registerKit } from "./kitipc";
import { registerLibrary } from "./library";
import { quitAfterTest, runSelfTest, selfTestOn } from "./selftest";
import { makeGamePlan } from "./homework";
import { transcribe } from "./ears";
import { stopNative } from "./native";
import { account, onAccountChange, sendCode, signOut, startCallbackServer, userId, verifyCode } from "./account";
import { forgetAll, memories, syncMemories } from "./memory";
import { captureError, identify, startTelemetry, track } from "./telemetry";
import { allowForSession, backToWork, startFocus, stopFocus } from "./focus";
import { planBlocks } from "./focusRules";
import { rest } from "./account";
import { click, ensureBrowser, frontApp, openApp, openFolder, openLatestDownload, openUrl, pressKeys, quitApp, typeText } from "./hands";
import { plan } from "./quick";
import { research } from "./research";
import { buildTool } from "./builder";
import { askScreen } from "./brain";
import { Action, askMilo, classify, RouteCtx, makeQuiz, readBrief, setUserName, sweepPlan, watchCheck, ChatMessage, checkAnswer, locateInCrop, nextActions, setCharacter, makePractice, Mode, teachFromScreen, TeachResult } from "./brain";

dotenv.config({ path: path.join(app.getAppPath(), ".env") });
startTelemetry();

// ---------- black-box log: every request Milo handles, how long it took, what came back ----------
const QUIET = new Set(["milo:watch-check", "milo:mic-access", "milo:hands-access", "milo:log-flag"]);
const brief = (v: unknown): unknown => {
  if (v instanceof ArrayBuffer) return { bytes: v.byteLength };
  if (ArrayBuffer.isView(v)) return { bytes: v.byteLength };
  if (typeof v === "string") return v.length > 400 ? v.slice(0, 400) + "…" : v;
  if (Array.isArray(v)) return v.length > 8 ? [...v.slice(-8).map(brief), `(+${v.length - 8} more)`] : v.map(brief);
  if (v && typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) o[k] = brief(x);
    return o;
  }
  return v;
};
{
  const orig = ipcMain.handle.bind(ipcMain);
  (ipcMain as unknown as { handle: typeof ipcMain.handle }).handle = (channel, fn) =>
    orig(channel, async (e, ...args) => {
      const done = timer();
      try {
        const out = await fn(e, ...args);
        if (!QUIET.has(channel)) bb("ipc", channel.replace("milo:", ""), { ms: done(), args: brief(args), out: brief(out) });
        return out;
      } catch (err) {
        bb("ipc", channel.replace("milo:", "") + "_crash", { ms: done(), args: brief(args), error: String((err as Error)?.stack ?? err) });
        throw err;
      }
    });
}
process.on("uncaughtException", (err) => bb("main", "uncaught", { error: String(err?.stack ?? err) }));
process.on("unhandledRejection", (err) => bb("main", "unhandled_rejection", { error: String((err as Error)?.stack ?? err) }));

const isDev = process.env.MILO_DEV === "1";
let overlay: BrowserWindow | null = null;

function createOverlay() {
  // One transparent window covering the whole work area. Milo lives inside it.
  const { workArea } = screen.getPrimaryDisplay();

  overlay = new BrowserWindow({
    x: workArea.x,
    y: workArea.y,
    width: workArea.width,
    height: workArea.height,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    hasShadow: false,
    skipTaskbar: true,
    focusable: true,
    alwaysOnTop: true,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true, // live web pages inside the research panel
      // Milo's overlay is see-through, so Chromium thinks it's "in the background" and slows its timers
      // (the "Got it" countdown froze, lock-in timers drift). He's always on screen: never throttle him.
      backgroundThrottling: false,
    },
  });

  overlay.setAlwaysOnTop(true, "floating");
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // Keep Milo out of his own screenshots (and out of screen shares).
  overlay.setContentProtection(true);
  // Clicks pass through to the apps underneath, except where Milo or his UI is.
  overlay.setIgnoreMouseEvents(true, { forward: true });

  if (isDev) {
    overlay.loadURL("http://127.0.0.1:5173");
  } else {
    overlay.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  overlay.on("closed", () => (overlay = null));
}

// ---------- screen capture ---------------------------------------------------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const SCREEN_PERMISSION_HELP =
  "I can't see your screen yet! Open System Settings > Privacy & Security > Screen & System Audio Recording, turn on Terminal (and Electron if it is listed), then quit me and start me again.";

type Shot = {
  full: Electron.NativeImage; // full-resolution screenshot
  pxPerPt: number; // full-image pixels per screen point
  bounds: Electron.Rectangle;
  workArea: Electron.Rectangle;
};
let lastShot: Shot | null = null;

async function captureScreen(): Promise<{ ok: true; shot: Shot } | { ok: false; text: string }> {
  const display = screen.getPrimaryDisplay();
  const { bounds, workArea, scaleFactor } = display;

  if (process.platform === "darwin") {
    const status = systemPreferences.getMediaAccessStatus("screen");
    if (status === "denied" || status === "restricted") return { ok: false, text: SCREEN_PERMISSION_HELP };
  }

  // Content protection should hide Milo already; fade him out for the shot as a backup.
  overlay?.setOpacity(0);
  await sleep(70);
  try {
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width: Math.round(bounds.width * scaleFactor), height: Math.round(bounds.height * scaleFactor) },
    });
    const src = sources.find((s) => s.display_id === String(display.id)) ?? sources[0];
    if (!src || src.thumbnail.isEmpty()) return { ok: false, text: SCREEN_PERMISSION_HELP };
    if (process.platform === "darwin" && systemPreferences.getMediaAccessStatus("screen") !== "granted") {
      return { ok: false, text: SCREEN_PERMISSION_HELP };
    }
    const full = src.thumbnail;
    const shot: Shot = { full, pxPerPt: full.getSize().width / bounds.width, bounds, workArea };
    lastShot = shot;
    return { ok: true, shot };
  } catch (err) {
    return { ok: false, text: `I couldn't see your screen: ${(err as Error).message}` };
  } finally {
    overlay?.setOpacity(1);
  }
}

/** Downscale so the long edge is at most `max` pixels. Returns the jpeg and its size. */
function toJpeg(img: Electron.NativeImage, max: number) {
  const { width, height } = img.getSize();
  const k = Math.min(1, max / Math.max(width, height));
  const out = k < 1 ? img.resize({ width: Math.round(width * k), height: Math.round(height * k), quality: "best" }) : img;
  const size = out.getSize();
  return { b64: out.toJPEG(85).toString("base64"), size, k };
}

// ---------- IPC -------------------------------------------------------------

ipcMain.on("milo:set-clickable", (_e, clickable: boolean) => {
  if (!overlay) return;
  if (clickable) overlay.setIgnoreMouseEvents(false);
  else overlay.setIgnoreMouseEvents(true, { forward: true });
});

ipcMain.handle("milo:ask", (_e, history: ChatMessage[]) => askMilo(history));
ipcMain.handle("milo:route", (_e, text: string, ctx?: RouteCtx) => classify(String(text ?? ""), ctx && typeof ctx === "object" ? ctx : {}));

type Box = { x: number; y: number; width: number; height: number };

ipcMain.handle("milo:look", async (_e, mode: Mode, request: string, focus: Box | null) => {
  // Where the mouse is right now (so "this one" means the question you're hovering).
  const cursor = screen.getCursorScreenPoint();
  const cap = await captureScreen();
  if (!cap.ok) return cap;
  const { shot } = cap;
  const small = toJpeg(shot.full, 1568);
  const pxPerPtSmall = small.k * shot.pxPerPt;
  const { bounds, workArea } = shot;

  // overlay points <-> screenshot pixels
  const toPx = (b: Box) => ({
    x: (b.x + workArea.x - bounds.x) * pxPerPtSmall,
    y: (b.y + workArea.y - bounds.y) * pxPerPtSmall,
    width: b.width * pxPerPtSmall,
    height: b.height * pxPerPtSmall,
  });
  const toPt = (b: Box) => ({
    x: bounds.x + b.x / pxPerPtSmall - workArea.x,
    y: bounds.y + b.y / pxPerPtSmall - workArea.y,
    width: b.width / pxPerPtSmall,
    height: b.height / pxPerPtSmall,
  });

  const onScreen =
    cursor.x >= bounds.x && cursor.x <= bounds.x + bounds.width && cursor.y >= bounds.y && cursor.y <= bounds.y + bounds.height;
  const pointer = onScreen ? { x: (cursor.x - bounds.x) * pxPerPtSmall, y: (cursor.y - bounds.y) * pxPerPtSmall } : undefined;

  const lesson = await teachFromScreen(small.b64, small.size, mode, request, {
    pointer,
    focus: focus ? toPx(focus) : undefined,
  });
  if (!lesson.ok) return lesson;

  const t = lesson.data.target;
  const box = lesson.data.found && t ? toPt(t) : null;
  const others = (lesson.data.others ?? [])
    .filter((o) => o && o.width > 4 && o.height > 4)
    .slice(0, 6)
    .map((o) => ({ label: String(o.label).slice(0, 12), box: toPt(o) }));
  return { ok: true, lesson: lesson.data, box, others };
});

// Lock-on: zoom into a sharp crop around the first guess and find the exact edges.
ipcMain.handle("milo:refine", async (_e, box: { x: number; y: number; width: number; height: number }, topic: string) => {
  const shot = lastShot;
  if (!shot) return { ok: false, text: "no-shot" };
  const { full, pxPerPt, bounds, workArea } = shot;
  const img = full.getSize();

  // Box in full-image pixels, padded generously so the real edges are inside the crop.
  const bx = (box.x + workArea.x - bounds.x) * pxPerPt;
  const by = (box.y + workArea.y - bounds.y) * pxPerPt;
  const bw = box.width * pxPerPt;
  const bh = box.height * pxPerPt;
  const padX = Math.max(80 * pxPerPt, bw * 0.35);
  const padY = Math.max(60 * pxPerPt, bh * 0.5);
  const cx = Math.max(0, Math.floor(bx - padX));
  const cy = Math.max(0, Math.floor(by - padY));
  const cw = Math.min(img.width - cx, Math.ceil(bw + padX * 2));
  const ch = Math.min(img.height - cy, Math.ceil(bh + padY * 2));
  if (cw < 20 || ch < 20) return { ok: false, text: "tiny" };

  const crop = toJpeg(full.crop({ x: cx, y: cy, width: cw, height: ch }), 1400);
  const r = await locateInCrop(crop.b64, crop.size, topic);
  if (!r.ok) return r;
  const L = r.data;
  if (!L.found || L.width <= 4 || L.height <= 4) return { ok: false, text: "not-found" };

  // Crop pixels -> full pixels -> overlay points.
  const toFull = 1 / crop.k;
  const fx = cx + L.x * toFull;
  const fy = cy + L.y * toFull;
  return {
    ok: true,
    box: {
      x: bounds.x + fx / pxPerPt - workArea.x,
      y: bounds.y + fy / pxPerPt - workArea.y,
      width: (L.width * toFull) / pxPerPt,
      height: (L.height * toFull) / pxPerPt,
    },
  };
});


// ---------- computer control (Milo's hands) ---------------------------------------
let taskRunning = false;
let taskAbort = false;

function sendStep(step: { say: string; action: string; point?: { x: number; y: number } | null; status?: string }) {
  bb("task", "step", step);
  overlay?.webContents.send("milo:task-step", step);
}

ipcMain.on("milo:task-stop", () => {
  taskAbort = true;
});

ipcMain.handle("milo:task", async (_e, task: string) => {
  if (taskRunning) {
    // A new command replaces the old one (like a person would): stop it, then do this.
    taskAbort = true;
    bb("task", "replaced", { task });
    for (let i = 0; i < 40 && taskRunning; i++) await new Promise((r) => setTimeout(r, 100));
    if (taskRunning) return { ok: false, text: "I'm still finishing the last thing. Try again in a second." };
  }
  taskRunning = true;
  taskAbort = false;
  // Milo must never hold the keyboard while he works, or his typing lands in his own window.
  overlay?.setFocusable(false);
  overlay?.blur();
  globalShortcut.register("Escape", () => (taskAbort = true));
  const history: string[] = [];

  // 1) Instant commands (no AI round trip): open apps, sites, tabs, searches.
  const quick = plan(task);
  let newTabJustOpened = false;
  try {
    for (const q of quick.steps) {
      if (taskAbort) return { ok: true, status: "stopped", text: "Stopped!" };
      sendStep({ say: q.say, action: q.kind === "app" || q.kind === "download" || q.kind === "folder" ? "open_app" : q.kind === "url" ? "open_url" : "key", point: null });
      if (q.kind === "folder") {
        await openFolder(q.folder);
        history.push(`Opened the ${q.folder} folder in Finder`);
        newTabJustOpened = false;
      } else if (q.kind === "download") {
        const name = await openLatestDownload();
        history.push(`Opened the newest download: ${name}`);
        newTabJustOpened = false;
      } else if (q.kind === "app") {
        await openApp(q.app);
        history.push(`Opened the ${q.app} app`);
        newTabJustOpened = false;
      } else if (q.kind === "url") {
        if (newTabJustOpened) {
          // Use the empty tab we just made instead of opening another one.
          await pressKeys("cmd+l");
          await typeText(q.url);
          await pressKeys("enter");
          await sleep(1300);
        } else {
          await openUrl(q.url);
        }
        history.push(`Opened ${q.url} in the browser`);
        newTabJustOpened = false;
      } else if (q.kind === "type") {
        await sleep(250);
        await typeText(q.text);
        history.push(`Typed "${q.text.slice(0, 80)}"`);
        newTabJustOpened = false;
      } else if (q.kind === "quit") {
        await quitApp(q.app);
        history.push(`Closed the ${q.app} app`);
        newTabJustOpened = false;
      } else {
        if (q.browser) await ensureBrowser();
        await pressKeys(q.keys);
        history.push(`Pressed ${q.keys} (${q.say})`);
        newTabJustOpened = q.keys === "cmd+t";
        await sleep(q.keys === "cmd+n" ? 450 : 150);
      }
    }
  } catch (err) {
    taskRunning = false;
    overlay?.setFocusable(true);
    globalShortcut.unregister("Escape");
    return { ok: false, text: (err as Error).message };
  }
  if (quick.steps.length) {
    // Hand the rest back to the renderer: it decides if it's homework ("…and solve the problem")
    // or more computer work ("…and write a poem").
    taskRunning = false;
    overlay?.setFocusable(true);
    globalShortcut.unregister("Escape");
    return { ok: true, status: "quick", text: "", rest: quick.rest, did: history };
  }

  let lastClick: { x: number; y: number } | null = null; // screen point of the previous action if it was a click
  let typeTarget: { x: number; y: number } | null = null; // last place he clicked (to refocus before typing)
  let lastSig = ""; // the previous action, to catch loops ("open Chrome", "open Chrome", "open Chrome"...)
  let stuck = 0;
  try {
    // 2) Web tasks with the Chrome extension: read the page and use real elements (fast, no screenshots).
    const front = await frontApp().catch(() => "");
    const webby = /\b(chrome|browser|website|site|tab|search|google|youtube|chatgpt|chat gpt|gmail|amazon|reddit|wikipedia|online|web|internet|d2l|canvas|quizlet|espn)\b|\.(com|org|edu|net|io|ai)\b/i.test(task);
    if (bridgeConnected() && (/Google Chrome/i.test(front) || webby)) {
      if (!/Google Chrome/i.test(front)) {
        await openApp("Google Chrome");
        history.push("Opened Google Chrome");
      }
      const wa = screen.getPrimaryDisplay().workArea;
      bb("task", "web_mode", { task });
      const w = await runWebTask(
        task,
        history,
        (st) => sendStep({ say: st.say, action: st.action, point: st.screenPt ? { x: st.screenPt.x - wa.x, y: st.screenPt.y - wa.y } : null }),
        () => taskAbort,
        pressKeys
      );
      if (w.status === "done" || w.status === "ask" || w.status === "stopped") return { ok: true, status: w.status, text: w.text };
      if (w.status === "error") return { ok: false, text: w.text };
      bb("task", "web_mode_handoff_to_screen", { why: w.text });
    }

    // 3) Screen mode: look at a screenshot, plan several steps, do them back to back, look again.
    for (let round = 0; round < 10; round++) {
      if (taskAbort) return { ok: true, status: "stopped", text: "Stopped!" };
      const cap = await captureScreen();
      if (!cap.ok) return cap;
      const { shot } = cap;
      const small = toJpeg(shot.full, 1568);
      const k = small.k * shot.pxPerPt; // screenshot px per screen point
      const r = await nextActions(small.b64, small.size, task, history);
      if (taskAbort) return { ok: true, status: "stopped", text: "Stopped!" };
      if (!r.ok) return r;
      bb("task", "plan", { round, steps: r.data.map((a) => `${a.action}${a.keys ? " " + a.keys : ""}${a.app ? " " + a.app : ""}${a.text && a.action === "type" ? " \"" + a.text.slice(0, 30) + "\"" : ""}`) });

      for (let si = 0; si < r.data.length; si++) {
        const a = r.data[si];
        if (taskAbort) return { ok: true, status: "stopped", text: "Stopped!" };
        // Screen point (for the click) and overlay point (for Milo to hop to).
        const screenPt =
          a.x !== undefined && a.y !== undefined ? { x: shot.bounds.x + a.x / k, y: shot.bounds.y + a.y / k } : null;
        const overlayPt = screenPt ? { x: screenPt.x - shot.workArea.x, y: screenPt.y - shot.workArea.y } : null;

        if (a.action === "done") return { ok: true, status: "done", text: a.text || a.say || "Done." };
        if (a.action === "ask") return { ok: true, status: "ask", text: a.text || a.say || "Should I go ahead?" };

        // Don't repeat the exact same non-click action from the last round: it already happened.
        const sig = `${a.action}|${a.app ?? ""}|${a.url ?? ""}|${a.keys ?? ""}|${a.text ?? ""}`;
        if (a.action !== "click" && a.action !== "double_click" && a.action !== "wait" && a.action !== "key" && sig === lastSig) {
          stuck++;
          history.push(`(You just did "${a.action}${a.app ? " " + a.app : ""}" already and it worked. Don't repeat it; do the next step or a different approach.)`);
          if (stuck >= 3) return { ok: false, text: "I got stuck repeating myself, so I stopped. Can you say it a bit differently?" };
          break;
        }
        lastSig = sig;

        // Don't click the same spot twice in a row: the first click already worked.
        if ((a.action === "click" || a.action === "double_click") && screenPt && lastClick &&
            Math.hypot(screenPt.x - lastClick.x, screenPt.y - lastClick.y) < 25) {
          history.push("(Skipped a repeat click on the same spot: it's already selected. Do the next thing, e.g. type.)");
          lastClick = null;
          continue;
        }

        sendStep({ say: a.say, action: a.action, point: overlayPt });
        if (overlayPt) await sleep(260); // a quick hop so you can see where he's about to click
        if (taskAbort) return { ok: true, status: "stopped", text: "Stopped!" };

        overlay?.setIgnoreMouseEvents(true, { forward: true }); // never click on Milo himself
        lastClick = a.action === "click" || a.action === "double_click" ? screenPt : null;
        let changesScreen = false;
        switch (a.action) {
          case "open_app":
            if (!a.app) throw new Error("No app name");
            history.push(`Opened ${await openApp(a.app)} (it's now in front with a window)`);
            changesScreen = true;
            break;
          case "open_url":
            if (!a.url || !/^https?:\/\//.test(a.url)) throw new Error("Bad URL");
            await openUrl(a.url);
            history.push(`Opened ${a.url}`);
            changesScreen = true;
            break;
          case "click":
          case "double_click":
            if (!screenPt) throw new Error("Click without a point");
            await click(screenPt.x, screenPt.y, a.action === "double_click" ? 2 : 1);
            typeTarget = screenPt;
            history.push(`${a.action === "click" ? "Clicked" : "Double-clicked"} at (${a.x}, ${a.y}): ${a.say}`);
            await sleep(180);
            break;
          case "type": {
            sendStep({ say: a.say, action: "typing", point: null });
            // If Milo's own window somehow has the keyboard, click the box again before typing.
            const front = await frontApp();
            if (/^(Electron|Milo)$/i.test(front) && typeTarget) {
              await click(typeTarget.x, typeTarget.y);
              await sleep(200);
            }
            await typeText(a.text ?? "");
            history.push(`Typed "${(a.text ?? "").slice(0, 80)}"`);
            break;
          }
          case "key":
            await pressKeys(a.keys ?? "");
            history.push(`Pressed ${a.keys}`);
            changesScreen = /^(enter|return|cmd\+(t|n|w|l|tab)|cmd\+shift\+t|ctrl\+tab)$/i.test((a.keys ?? "").trim());
            await sleep(changesScreen ? 500 : 120);
            break;
          case "scroll":
            await pressKeys(a.direction === "up" ? "pageup" : "pagedown");
            history.push(`Scrolled ${a.direction ?? "down"}`);
            changesScreen = true;
            break;
          case "wait":
            await sleep(1000);
            history.push("Waited");
            break;
        }
        if (changesScreen) {
          // Keyboard-only steps after it (type the URL, press enter, cmd+n...) don't depend on where things
          // are on screen, so keep going. Anything that clicks a spot needs a fresh look first.
          const rest = r.data.slice(si + 1);
          if (rest.length && rest.every((x) => ["type", "key", "wait", "done", "ask"].includes(x.action))) {
            await sleep(a.action === "open_app" || a.action === "open_url" ? 900 : 450);
            continue;
          }
          break; // the rest of the plan was made for the old screen: look again
        }
      }
      await sleep(300); // let the screen settle before the next look
    }
    return { ok: true, status: "done", text: "I took a bunch of steps. Check if that's what you wanted!" };
  } catch (err) {
    return { ok: false, text: (err as Error).message };
  } finally {
    taskRunning = false;
    overlay?.setFocusable(true);
    globalShortcut.unregister("Escape");
  }
});

// ---------- worksheet sweep -------------------------------------------------------------
ipcMain.handle("milo:sweep-plan", async (_e, skip: string[]) => {
  const cap = await captureScreen();
  if (!cap.ok) return cap;
  const { shot } = cap;
  const small = toJpeg(shot.full, 1568);
  const k = small.k * shot.pxPerPt;
  const r = await sweepPlan(small.b64, small.size, skip ?? []);
  if (!r.ok) return r;
  const { bounds, workArea } = shot;
  const toOverlay = (x: number, y: number) => ({ x: bounds.x + x / k - workArea.x, y: bounds.y + y / k - workArea.y });
  const items = (r.data.questions ?? [])
    .filter((q) => q && q.box && q.answer)
    .map((q) => {
      const tl = toOverlay(q.box.x, q.box.y);
      const hasPt = q.input?.kind !== "none" && q.input?.x !== undefined && q.input?.y !== undefined;
      const inOverlay = hasPt ? toOverlay(q.input.x!, q.input.y!) : null;
      return {
        label: String(q.label ?? "").slice(0, 8),
        work: q.work ?? "",
        answer: q.answer,
        box: { x: tl.x, y: tl.y, width: q.box.width / k, height: q.box.height / k },
        kind: hasPt ? q.input.kind : "none",
        point: inOverlay, // overlay coords (for Milo to hop to)
        screen: hasPt ? { x: bounds.x + q.input.x! / k, y: bounds.y + q.input.y! / k } : null, // for the click
      };
    });
  return { ok: true, items, more: !!r.data.more_below };
});

ipcMain.handle(
  "milo:sweep-fill",
  async (_e, item: { kind: string; screen: { x: number; y: number } | null; answer: string }) => {
    if (!item.screen) return { ok: true };
    overlay?.setFocusable(false);
    overlay?.blur();
    overlay?.setIgnoreMouseEvents(true, { forward: true });
    try {
      await click(item.screen.x, item.screen.y);
      if (item.kind === "type") {
        await sleep(150);
        await pressKeys("cmd+a"); // replace anything already in the box
        await typeText(item.answer);
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, text: (err as Error).message };
    } finally {
      overlay?.setFocusable(true);
    }
  }
);

ipcMain.handle("milo:scroll-page", async () => {
  overlay?.setFocusable(false);
  overlay?.blur();
  try {
    await pressKeys("escape"); // leave any text box so the page itself scrolls
    await pressKeys("pagedown");
    await sleep(700);
    return { ok: true };
  } catch (err) {
    return { ok: false, text: (err as Error).message };
  } finally {
    overlay?.setFocusable(true);
  }
});

// ---------- watch me work ------------------------------------------------------------------
let lastThumb: Buffer | null = null;

/** Tiny grayscale fingerprint of the screen, to skip checks when nothing changed. */
function thumb(img: Electron.NativeImage) {
  return img.resize({ width: 64, height: 40, quality: "good" }).toBitmap();
}
function changed(a: Buffer | null, b: Buffer) {
  if (!a || a.length !== b.length) return true;
  let diff = 0;
  for (let i = 0; i < b.length; i += 4) diff += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
  return diff / (b.length / 4) > 2.5; // average change per pixel
}

ipcMain.handle("milo:watch-check", async (_e, force: boolean) => {
  const cap = await captureScreen();
  if (!cap.ok) return cap;
  const { shot } = cap;
  const t = thumb(shot.full);
  if (!force && !changed(lastThumb, t)) return { ok: true, changed: false };
  lastThumb = t;
  const small = toJpeg(shot.full, 1568);
  const r = await watchCheck(small.b64, small.size);
  if (!r.ok) return r;
  const k = small.k * shot.pxPerPt;
  const b = r.data.box;
  const box =
    r.data.found_mistake && b
      ? {
          x: shot.bounds.x + b.x / k - shot.workArea.x,
          y: shot.bounds.y + b.y / k - shot.workArea.y,
          width: b.width / k,
          height: b.height / k,
        }
      : null;
  return { ok: true, changed: true, mistake: r.data.found_mistake && (r.data.confidence ?? 0) >= 0.75 && !!box, box, hint: r.data.hint };
});
ipcMain.on("milo:watch-reset", () => (lastThumb = null));

// ---------- quiz -----------------------------------------------------------------------------
ipcMain.handle("milo:quiz", async (_e, focus: string) => {
  const cap = await captureScreen();
  if (!cap.ok) return cap;
  const small = toJpeg(cap.shot.full, 1568);
  const r = await makeQuiz(small.b64, small.size, 6, focus || "");
  if (!r.ok) return r;
  const questions = (r.data.questions ?? [])
    .filter((q) => q && Array.isArray(q.choices) && q.choices.length >= 2)
    .map((q) => ({ ...q, choices: q.choices.slice(0, 4), correct: Math.max(0, Math.min(3, Math.round(q.correct))) }));
  return { ok: true, topic: r.data.topic || "Quiz", questions };
});

// ---------- daily brief ------------------------------------------------------------------------
ipcMain.handle("milo:brief", async (_e, dataUrl: string, pageText?: string) => {
  // The portal snapshot arrives as a big PNG: shrink it to a JPEG the model reads well.
  const img = nativeImage.createFromDataURL(String(dataUrl));
  const b64 = img.isEmpty() ? String(dataUrl).replace(/^data:image\/\w+;base64,/, "") : toJpeg(img, 1800).b64;
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  return readBrief(b64, today, typeof pageText === "string" ? pageText.slice(0, 20000) : "");
});

// ---------- research ----------------------------------------------------------------
let researchAbort: AbortController | null = null;
ipcMain.handle("milo:research", async (_e, question: string, history?: { q: string; a: string }[]) => {
  researchAbort?.abort();
  researchAbort = new AbortController();
  const h = Array.isArray(history) ? history.filter((t) => t && typeof t.q === "string").map((t) => ({ q: String(t.q).slice(0, 2000), a: String(t.a ?? "").slice(0, 4000) })) : [];
  await research(question, (ev) => overlay?.webContents.send("milo:research-event", ev), researchAbort.signal, h);
  return true;
});
ipcMain.on("milo:research-stop", () => researchAbort?.abort());

let buildAbort: AbortController | null = null;
ipcMain.handle("milo:build", async (_e, request: string) => {
  buildAbort?.abort();
  buildAbort = new AbortController();
  await buildTool(request, (ev) => overlay?.webContents.send("milo:build-event", ev), buildAbort.signal);
  return true;
});
ipcMain.on("milo:build-stop", () => buildAbort?.abort());
ipcMain.on("milo:open-url", (_e, url: string) => {
  if (/^https?:\/\//.test(url)) openUrl(url);
});

ipcMain.handle("milo:check", (_e, lesson: TeachResult, answer: string) => checkAnswer(lesson, answer));
ipcMain.handle("milo:practice", (_e, lesson: TeachResult) => makePractice(lesson));
ipcMain.handle("milo:stt", async (_e, audio: ArrayBuffer) => {
  const clip = saveClip(audio); // so we can hear exactly what Milo heard
  const r = await transcribe(audio);
  bb("ears", "transcript", { clip, ok: r.ok, text: r.text });
  return r;
});

// Logs from the overlay (what the mic did, what Milo decided, when he spoke).
ipcMain.on("milo:log", (_e, src: string, ev: string, data: Record<string, unknown>) => {
  if (typeof src === "string" && typeof ev === "string") bb(src.slice(0, 20), ev.slice(0, 60), data && typeof data === "object" ? data : {});
});
// "Milo, that was wrong" / Cmd+Shift+B: mark the moment so it's easy to find.
ipcMain.handle("milo:log-flag", (_e, note?: string) => {
  bb("user", "FLAG", { note: typeof note === "string" ? note : "" });
  return { file: LOG_FILE, dir: LOG_DIR };
});
ipcMain.on("milo:open-logs", () => shell.showItemInFolder(LOG_FILE));

// ---------- smart ears (Deepgram Flux) + free voice rendered to audio ----------
onFlux((ev) => overlay?.webContents.send("milo:flux-event", ev));
ipcMain.handle("milo:flux-available", () => fluxAvailable());
ipcMain.handle("milo:flux-open", () => openFlux());
ipcMain.on("milo:flux-audio", (_e, pcm: ArrayBuffer) => {
  if (pcm instanceof ArrayBuffer || ArrayBuffer.isView(pcm)) sendAudio(pcm instanceof ArrayBuffer ? pcm : (pcm as Uint8Array).buffer as ArrayBuffer);
});
ipcMain.on("milo:flux-force", () => forceEndTurn());
ipcMain.on("milo:flux-close", () => closeFlux());
ipcMain.on("milo:save-clip", (_e, wav: ArrayBuffer, note?: string) => {
  if (wav instanceof ArrayBuffer) bb("ears", "clip", { clip: saveClip(wav), note: typeof note === "string" ? note.slice(0, 200) : "" });
});
ipcMain.handle("milo:bridge-status", () => bridgeConnected());

registerLibrary();
registerKit({
  captureJpeg: async () => {
    const cap = await captureScreen();
    return cap.ok ? toJpeg(cap.shot.full, 1568).b64 : null;
  },
  frontApp: () => frontApp(),
  pressKeys: (k) => pressKeys(k),
  setOverlayFocusable: (on) => overlay?.setFocusable(on),
});

// "Milo, look at my screen and find out when my next exam is": answer from the page text (Chrome) + a screenshot.
ipcMain.handle("milo:screen-ask", async (_e, question: string) => {
  const q = String(question ?? "").slice(0, 500);
  const front = await frontApp().catch(() => "");
  let page: { text?: string; url?: string; title?: string; canvasHeavy?: boolean } | null = null;
  if (bridgeConnected() && /Google Chrome|Electron|Milo/i.test(front)) {
    page = await ext("snapshot", { max: 20 }, 8000).catch(() => null);
  }
  const cap = await captureScreen();
  const jpeg = cap.ok ? toJpeg(cap.shot.full, 1568).b64 : undefined;
  if (!jpeg && !page?.text) return { ok: false, text: cap.ok ? "I couldn't see your screen." : cap.text };
  bb("screen", "ask", { q, front, usedPage: !!page?.text, url: page?.url });
  return askScreen(q, { jpeg, pageText: page?.canvasHeavy ? undefined : page?.text, url: page?.url, title: page?.title });
});
// "Start my homework": read the assignment that's open (page text + screenshot) and make a game plan.
ipcMain.handle("milo:gameplan", async (_e, hint: string) => {
  const front = await frontApp().catch(() => "");
  let page: { text?: string; url?: string; title?: string; canvasHeavy?: boolean } | null = null;
  if (bridgeConnected() && /Google Chrome/i.test(front)) page = await ext("snapshot", { max: 30 }, 8000).catch(() => null);
  const cap = await captureScreen();
  const jpeg = cap.ok ? toJpeg(cap.shot.full, 1568).b64 : undefined;
  if (!jpeg && !page?.text) return { ok: false, text: cap.ok ? "I couldn't see your screen." : cap.text };
  bb("homework", "plan_start", { front, usedPage: !!page?.text, url: page?.url });
  const r = await makeGamePlan({ hint: String(hint ?? "").slice(0, 300), jpeg, pageText: page?.canvasHeavy ? undefined : page?.text, url: page?.url, title: page?.title });
  if (r.ok) bb("homework", "plan", { found: r.data.found, title: r.data.title, steps: r.data.steps.length, minutes: r.data.total_minutes });
  return r;
});
ipcMain.handle("milo:mac-say", (_e, text: string) => macSpeak(String(text ?? "")));
ipcMain.handle("milo:hands-access", () =>
  process.platform === "darwin" ? systemPreferences.isTrustedAccessibilityClient(true) : true
);
ipcMain.handle("milo:mic-access", async () => {
  if (process.platform !== "darwin") return true;
  if (systemPreferences.getMediaAccessStatus("microphone") === "granted") return true;
  return systemPreferences.askForMediaAccess("microphone");
});
ipcMain.handle("milo:tts", (_e, text: string, urgent?: boolean, around?: { previous?: string; next?: string }) => speak(text, !!urgent, around ?? {}));

// ---------- account + memory ----------
ipcMain.handle("milo:account", () => account());
ipcMain.handle("milo:account-send", (_e, email: string) => sendCode(email));
ipcMain.handle("milo:account-verify", async (_e, email: string, code: string) => {
  const r = await verifyCode(email, code);
  if (r.ok) {
    const id = userId();
    if (id) identify(id, account().email);
    await syncMemories();
  }
  return r;
});
ipcMain.handle("milo:account-signout", () => {
  signOut();
  track("sign_out");
  return account();
});
// Signed in from the browser link: catch up and tell the window.
onAccountChange(async () => {
  const id = userId();
  if (id) identify(id, account().email);
  await syncMemories();
  overlay?.webContents.send("milo:account-changed");
});
// ---------- lock-in mode ----------
ipcMain.handle("milo:focus-start", (_e, minutes: number) => {
  startFocus((st) => overlay?.webContents.send("milo:focus-state", st));
  const m = Math.max(5, Math.min(240, Math.round(Number(minutes) || 25)));
  track("lockin_start", { minutes: m });
  return planBlocks(m);
});
ipcMain.handle("milo:focus-stop", () => {
  stopFocus();
  return true;
});
ipcMain.handle("milo:focus-allow", (_e, label: string) => {
  allowForSession(String(label || "").slice(0, 40));
  return true;
});
ipcMain.handle("milo:focus-back", () => backToWork());
ipcMain.handle(
  "milo:focus-save",
  async (_e, s: { topic?: string; plannedMinutes: number; focusedSeconds: number; slips: number; longestStreakSeconds: number; completed: boolean; startedAt: string }) => {
    track("lockin_done", { minutes: Math.round(s.focusedSeconds / 60), slips: s.slips, completed: s.completed });
    if (!userId()) return false;
    const r = await rest("focus_sessions", {
      method: "POST",
      prefer: "return=minimal",
      body: {
        topic: s.topic?.slice(0, 60) || null,
        planned_minutes: Math.max(1, Math.min(600, Math.round(s.plannedMinutes))),
        focused_seconds: Math.max(0, Math.round(s.focusedSeconds)),
        slips: Math.max(0, Math.round(s.slips)),
        longest_streak_seconds: Math.max(0, Math.round(s.longestStreakSeconds)),
        completed: !!s.completed,
        started_at: s.startedAt,
      },
    });
    return !!r;
  }
);
ipcMain.handle("milo:memories", () => memories());
ipcMain.handle("milo:forget-all", async () => {
  await forgetAll();
  return true;
});
// Errors from Milo's window, so they reach crash reports too.
ipcMain.on("milo:renderer-error", (_e, err: { name?: string; message?: string; stack?: string }) => {
  const e = new Error(err?.message || "renderer error");
  e.name = err?.name || "Error";
  e.stack = err?.stack || e.stack;
  captureError(e, "renderer", { process: "renderer" });
});
ipcMain.on("milo:copy", (_e, text: string) => clipboard.writeText(text));
ipcMain.on("milo:set-character", (_e, desc: string) => setCharacter(desc));
ipcMain.on("milo:set-name", (_e, name: string) => setUserName(name));
ipcMain.on("milo:quit", () => app.quit());

// ---------- app lifecycle -----------------------------------------------------

// Web pages shown in the research panel get no access to Milo's internals; links open in Chrome.
app.on("web-contents-created", (_e, contents) => {
  contents.on("will-attach-webview", (_ev, prefs) => {
    delete (prefs as { preload?: string }).preload;
    prefs.nodeIntegration = false;
    prefs.contextIsolation = true;
    prefs.sandbox = true;
  });
  if (contents.getType() === "webview") {
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//.test(url)) openUrl(url);
      return { action: "deny" };
    });
  }
});

app.whenReady().then(() => {
  startBridge(path.join(app.getAppPath(), "extension"));
  if (process.platform === "darwin") app.dock?.hide();
  // Let Milo's window use the microphone.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === "media"));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === "media");
  createOverlay();
  // `npm run test:milo`: drive Milo through his self-test, write the report, quit. (Sound muted so it runs quietly.)
  if (selfTestOn() && overlay) {
    const win = overlay;
    win.webContents.setAudioMuted(true);
    win.webContents.once("did-finish-load", () => void runSelfTest(win).finally(quitAfterTest));
  }
  // Ready for an emailed sign-in link even if Milo restarted after sending it.
  void startCallbackServer();
  // Pick up where we left off: account, memories.
  const uid = userId();
  if (uid) identify(uid, account().email);
  void syncMemories();

  // Open Milo's chat from anywhere.
  globalShortcut.register("CommandOrControl+Shift+B", () => overlay?.webContents.send("milo:flag"));
  globalShortcut.register("CommandOrControl+Shift+M", () => {
    overlay?.webContents.send("milo:summon");
    overlay?.focus();
  });
  // Talk to Milo from anywhere.
  globalShortcut.register("CommandOrControl+Shift+Space", () => {
    overlay?.webContents.send("milo:talk");
  });
  // The magic button: Milo looks at your screen and teaches whatever you're stuck on.
  globalShortcut.register("CommandOrControl+Shift+Y", () => {
    overlay?.webContents.send("milo:teach-screen");
  });
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  stopFocus();
  stopNative();
});
app.on("window-all-closed", () => app.quit());
