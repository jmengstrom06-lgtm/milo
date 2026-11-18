import { app, BrowserWindow, globalShortcut, ipcMain, screen } from "electron";
import path from "node:path";
import dotenv from "dotenv";
import { askMilo, ChatMessage } from "./brain";

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

  // Stay above normal apps and follow the user across Spaces / full-screen apps.
  overlay.setAlwaysOnTop(true, "floating");
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // Clicks pass through to the apps underneath, except where Milo or his panel is.
  // The renderer flips this when the mouse enters/leaves Milo.
  overlay.setIgnoreMouseEvents(true, { forward: true });

  if (isDev) {
    overlay.loadURL("http://127.0.0.1:5173");
  } else {
    overlay.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  overlay.on("closed", () => (overlay = null));
}

ipcMain.on("milo:set-clickable", (_e, clickable: boolean) => {
  if (!overlay) return;
  if (clickable) {
    overlay.setIgnoreMouseEvents(false);
  } else {
    overlay.setIgnoreMouseEvents(true, { forward: true });
  }
});

ipcMain.handle("milo:ask", async (_e, history: ChatMessage[]) => {
  return askMilo(history);
});

ipcMain.on("milo:quit", () => app.quit());

app.whenReady().then(() => {
  if (process.platform === "darwin") app.dock?.hide();
  createOverlay();

  // Summon Milo from anywhere.
  globalShortcut.register("CommandOrControl+Shift+M", () => {
    overlay?.webContents.send("milo:summon");
    overlay?.focus();
  });
});

app.on("will-quit", () => globalShortcut.unregisterAll());
app.on("window-all-closed", () => app.quit());
