// Home base: Milo's real app window (sidebar, Today, chat, classes). The same agent as the frog:
// what you type here runs through the overlay's command router, and what Milo does shows in both.

import { app, BrowserWindow, shell } from "electron";
import path from "node:path";
import { log as bb } from "./blackbox";

let win: BrowserWindow | null = null;
export const homeWin = () => (win && !win.isDestroyed() ? win : null);

/** Send to Home base if it's open. */
export function toHome(channel: string, payload?: unknown) {
  const w = homeWin();
  if (w) w.webContents.send(channel, payload);
}

export function openHome(isDev: boolean) {
  const w = homeWin();
  if (w) {
    if (w.isMinimized()) w.restore();
    w.show();
    w.focus();
    return w;
  }
  win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 980,
    minHeight: 640,
    title: "Milo",
    show: false,
    backgroundColor: "#0A0A0B",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 18 },
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  // A real app while Home base is open (Dock icon, ⌘Tab); back to a quiet menu bar app when it closes.
  if (process.platform === "darwin") void app.dock?.show();
  win.once("ready-to-show", () => win?.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.on("closed", () => {
    win = null;
    if (process.platform === "darwin") app.dock?.hide();
    bb("home", "closed", {});
  });
  if (isDev) void win.loadURL("http://127.0.0.1:5173/#home");
  else void win.loadFile(path.join(__dirname, "../renderer/index.html"), { hash: "home" });
  bb("home", "opened", {});
  return win;
}
