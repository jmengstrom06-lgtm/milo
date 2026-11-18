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
import { askMilo, ChatMessage, checkAnswer, makePractice, Mode, teachFromScreen, TeachResult } from "./brain";

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

async function captureScreen(): Promise<
  | { ok: true; jpegBase64: string; bounds: Electron.Rectangle; workArea: Electron.Rectangle }
  | { ok: false; text: string }
> {
  const display = screen.getPrimaryDisplay();
  const { bounds, workArea } = display;

  if (process.platform === "darwin") {
    const status = systemPreferences.getMediaAccessStatus("screen");
    if (status === "denied" || status === "restricted") return { ok: false, text: SCREEN_PERMISSION_HELP };
  }

  // Content protection should hide Milo already; fade him out for the shot as a backup.
  overlay?.setOpacity(0);
  await sleep(70);
  try {
    // Capture at a size the vision model handles well (long edge ~1568px).
    const scale = Math.min(1, 1568 / Math.max(bounds.width, bounds.height));
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width: Math.round(bounds.width * scale), height: Math.round(bounds.height * scale) },
    });
    const src = sources.find((s) => s.display_id === String(display.id)) ?? sources[0];
    if (!src || src.thumbnail.isEmpty()) return { ok: false, text: SCREEN_PERMISSION_HELP };
    if (process.platform === "darwin" && systemPreferences.getMediaAccessStatus("screen") !== "granted") {
      return { ok: false, text: SCREEN_PERMISSION_HELP };
    }
    return { ok: true, jpegBase64: src.thumbnail.toJPEG(82).toString("base64"), bounds, workArea };
  } catch (err) {
    return { ok: false, text: `I couldn't see your screen: ${(err as Error).message}` };
  } finally {
    overlay?.setOpacity(1);
  }
}

// ---------- IPC -------------------------------------------------------------

ipcMain.on("milo:set-clickable", (_e, clickable: boolean) => {
  if (!overlay) return;
  if (clickable) overlay.setIgnoreMouseEvents(false);
  else overlay.setIgnoreMouseEvents(true, { forward: true });
});

ipcMain.handle("milo:ask", (_e, history: ChatMessage[]) => askMilo(history));

ipcMain.handle("milo:look", async (_e, mode: Mode, request: string) => {
  const shot = await captureScreen();
  if (!shot.ok) return shot;
  const lesson = await teachFromScreen(shot.jpegBase64, mode, request);
  if (!lesson.ok) return lesson;

  // Convert the target box from screenshot fractions to overlay-window pixels.
  const t = lesson.data.target;
  const { bounds, workArea } = shot;
  const box =
    lesson.data.found && t
      ? {
          x: bounds.x + t.x * bounds.width - workArea.x,
          y: bounds.y + t.y * bounds.height - workArea.y,
          width: t.width * bounds.width,
          height: t.height * bounds.height,
        }
      : null;
  return { ok: true, lesson: lesson.data, box };
});

ipcMain.handle("milo:check", (_e, lesson: TeachResult, answer: string) => checkAnswer(lesson, answer));
ipcMain.handle("milo:practice", (_e, lesson: TeachResult) => makePractice(lesson));
ipcMain.on("milo:copy", (_e, text: string) => clipboard.writeText(text));
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
