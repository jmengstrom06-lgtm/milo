import {
  app,
  BrowserWindow,
  session,
  clipboard,
  desktopCapturer,
  globalShortcut,
  ipcMain,
  screen,
  systemPreferences,
} from "electron";
import path from "node:path";
import dotenv from "dotenv";
import { speak } from "./voice";
import { transcribe } from "./ears";
import { click, ensureBrowser, frontApp, openApp, openFolder, openLatestDownload, openUrl, pressKeys, typeText } from "./hands";
import { plan } from "./quick";
import { research } from "./research";
import { Action, askMilo, classify, sweepPlan, ChatMessage, checkAnswer, locateInCrop, nextAction, setCharacter, makePractice, Mode, teachFromScreen, TeachResult } from "./brain";

dotenv.config({ path: path.join(app.getAppPath(), ".env") });

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
ipcMain.handle("milo:route", (_e, text: string) => classify(text));

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
  overlay?.webContents.send("milo:task-step", step);
}

ipcMain.on("milo:task-stop", () => {
  taskAbort = true;
});

ipcMain.handle("milo:task", async (_e, task: string) => {
  if (taskRunning) return { ok: false, text: "I'm already doing something. Say stop first." };
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
      } else {
        if (q.browser) await ensureBrowser();
        await pressKeys(q.keys);
        history.push(`Pressed ${q.keys} (${q.say})`);
        newTabJustOpened = q.keys === "cmd+t";
        await sleep(300);
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
    for (let step = 0; step < 14; step++) {
      if (taskAbort) return { ok: true, status: "stopped", text: "Stopped!" };
      const cap = await captureScreen();
      if (!cap.ok) return cap;
      const { shot } = cap;
      const small = toJpeg(shot.full, 1568);
      const k = small.k * shot.pxPerPt; // screenshot px per screen point
      const r = await nextAction(small.b64, small.size, task, history);
      if (taskAbort) return { ok: true, status: "stopped", text: "Stopped!" };
      if (!r.ok) return r;
      const a: Action = r.data;

      // Screen point (for the click) and overlay point (for Milo to hop to).
      const screenPt =
        a.x !== undefined && a.y !== undefined ? { x: shot.bounds.x + a.x / k, y: shot.bounds.y + a.y / k } : null;
      const overlayPt = screenPt ? { x: screenPt.x - shot.workArea.x, y: screenPt.y - shot.workArea.y } : null;

      if (a.action === "done") return { ok: true, status: "done", text: a.text || a.say || "All done!" };

      // Don't repeat the exact same non-click action: it already happened. Nudge the AI to try something else.
      const sig = `${a.action}|${a.app ?? ""}|${a.url ?? ""}|${a.keys ?? ""}|${a.text ?? ""}`;
      if (a.action !== "click" && a.action !== "double_click" && a.action !== "wait" && sig === lastSig) {
        stuck++;
        history.push(`(You just did "${a.action}${a.app ? " " + a.app : ""}" already and it worked. Don't repeat it; do the next step or a different approach.)`);
        if (stuck >= 3) return { ok: false, text: "I got stuck doing the same thing over and over, so I stopped. Can you tell me a bit more?" };
        continue;
      }
      lastSig = sig;

      // Don't click the same spot twice in a row: the first click already worked (text fields look the same after).
      if ((a.action === "click" || a.action === "double_click") && screenPt && lastClick &&
          Math.hypot(screenPt.x - lastClick.x, screenPt.y - lastClick.y) < 25) {
        history.push("(Skipped a repeat click on the same spot: it's already selected. Do the next thing, e.g. type.)");
        lastClick = null;
        continue;
      }
      if (a.action === "ask") return { ok: true, status: "ask", text: a.text || a.say || "Should I go ahead?" };

      sendStep({ say: a.say, action: a.action, point: overlayPt });
      await sleep(650); // let Milo hop over before acting
      if (taskAbort) return { ok: true, status: "stopped", text: "Stopped!" };

      overlay?.setIgnoreMouseEvents(true, { forward: true }); // never click on Milo himself
      lastClick = a.action === "click" || a.action === "double_click" ? screenPt : null;
      switch (a.action) {
        case "open_app":
          if (!a.app) throw new Error("No app name");
          history.push(`Opened ${await openApp(a.app)} (it's now in front with a window)`);
          break;
        case "open_url":
          if (!a.url || !/^https?:\/\//.test(a.url)) throw new Error("Bad URL");
          await openUrl(a.url);
          history.push(`Opened ${a.url}`);
          break;
        case "click":
        case "double_click":
          if (!screenPt) throw new Error("Click without a point");
          await click(screenPt.x, screenPt.y, a.action === "double_click" ? 2 : 1);
          typeTarget = screenPt;
          history.push(`${a.action === "click" ? "Clicked" : "Double-clicked"} at (${a.x}, ${a.y}): ${a.say}`);
          break;
        case "type": {
          sendStep({ say: a.say, action: "typing", point: null });
          // If Milo's own window somehow has the keyboard, click the box again before typing.
          const front = await frontApp();
          if (/^(Electron|Milo)$/i.test(front) && typeTarget) {
            await click(typeTarget.x, typeTarget.y);
            await sleep(250);
          }
          await typeText(a.text ?? "");
          history.push(`Typed "${(a.text ?? "").slice(0, 80)}"`);
          break;
        }
        case "key":
          await pressKeys(a.keys ?? "");
          history.push(`Pressed ${a.keys}`);
          break;
        case "scroll":
          await pressKeys(a.direction === "up" ? "pageup" : "pagedown");
          history.push(`Scrolled ${a.direction ?? "down"}`);
          break;
        case "wait":
          await sleep(1200);
          history.push("Waited");
          break;
      }
      await sleep(450); // let the screen update before the next look
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

// ---------- research ----------------------------------------------------------------
let researchAbort: AbortController | null = null;
ipcMain.handle("milo:research", async (_e, question: string) => {
  researchAbort?.abort();
  researchAbort = new AbortController();
  await research(question, (ev) => overlay?.webContents.send("milo:research-event", ev), researchAbort.signal);
  return true;
});
ipcMain.on("milo:research-stop", () => researchAbort?.abort());
ipcMain.on("milo:open-url", (_e, url: string) => {
  if (/^https?:\/\//.test(url)) openUrl(url);
});

ipcMain.handle("milo:check", (_e, lesson: TeachResult, answer: string) => checkAnswer(lesson, answer));
ipcMain.handle("milo:practice", (_e, lesson: TeachResult) => makePractice(lesson));
ipcMain.handle("milo:stt", (_e, audio: ArrayBuffer) => transcribe(audio));
ipcMain.handle("milo:hands-access", () =>
  process.platform === "darwin" ? systemPreferences.isTrustedAccessibilityClient(true) : true
);
ipcMain.handle("milo:mic-access", async () => {
  if (process.platform !== "darwin") return true;
  if (systemPreferences.getMediaAccessStatus("microphone") === "granted") return true;
  return systemPreferences.askForMediaAccess("microphone");
});
ipcMain.handle("milo:tts", (_e, text: string, urgent?: boolean) => speak(text, !!urgent));
ipcMain.on("milo:copy", (_e, text: string) => clipboard.writeText(text));
ipcMain.on("milo:set-character", (_e, desc: string) => setCharacter(desc));
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
  if (process.platform === "darwin") app.dock?.hide();
  // Let Milo's window use the microphone.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === "media"));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === "media");
  createOverlay();

  // Open Milo's chat from anywhere.
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

app.on("will-quit", () => globalShortcut.unregisterAll());
app.on("window-all-closed", () => app.quit());
