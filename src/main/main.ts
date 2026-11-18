import {
  app,
  BrowserWindow,
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
import { askMilo, ChatMessage, checkAnswer, locateInCrop, setCharacter, makePractice, Mode, teachFromScreen, TeachResult } from "./brain";

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

ipcMain.handle("milo:look", async (_e, mode: Mode, request: string) => {
  const cap = await captureScreen();
  if (!cap.ok) return cap;
  const { shot } = cap;
  const small = toJpeg(shot.full, 1568);
  const lesson = await teachFromScreen(small.b64, small.size, mode, request);
  if (!lesson.ok) return lesson;

  // Screenshot pixels -> overlay-window points.
  const t = lesson.data.target;
  const ptPerPx = 1 / (small.k * shot.pxPerPt);
  const box =
    lesson.data.found && t
      ? {
          x: shot.bounds.x + t.x * ptPerPx - shot.workArea.x,
          y: shot.bounds.y + t.y * ptPerPx - shot.workArea.y,
          width: t.width * ptPerPx,
          height: t.height * ptPerPx,
        }
      : null;
  return { ok: true, lesson: lesson.data, box };
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

ipcMain.handle("milo:check", (_e, lesson: TeachResult, answer: string) => checkAnswer(lesson, answer));
ipcMain.handle("milo:practice", (_e, lesson: TeachResult) => makePractice(lesson));
ipcMain.handle("milo:tts", (_e, text: string) => speak(text));
ipcMain.on("milo:copy", (_e, text: string) => clipboard.writeText(text));
ipcMain.on("milo:set-character", (_e, desc: string) => setCharacter(desc));
ipcMain.on("milo:quit", () => app.quit());

// ---------- app lifecycle -----------------------------------------------------

app.whenReady().then(() => {
  if (process.platform === "darwin") app.dock?.hide();
  createOverlay();

  // Open Milo's chat from anywhere.
  globalShortcut.register("CommandOrControl+Shift+M", () => {
    overlay?.webContents.send("milo:summon");
    overlay?.focus();
  });
  // The magic button: Milo looks at your screen and teaches whatever you're stuck on.
  globalShortcut.register("CommandOrControl+Shift+Y", () => {
    overlay?.webContents.send("milo:teach-screen");
  });
});

app.on("will-quit", () => globalShortcut.unregisterAll());
app.on("window-all-closed", () => app.quit());
