// Auto-updates: every fix reaches students on its own.
// Checks shortly after launch and every 4 hours; downloads quietly; installs the next time Milo quits,
// or right away if the student taps "Restart to update". Installed (signed) app only: macOS refuses
// to install updates into an unsigned app, so until signing is on this just logs what it would do.

import { app, ipcMain, type BrowserWindow } from "electron";
import { log as bb } from "./blackbox";

// Hooks for the menu-bar frog (appshell.ts): show "Restart to update", check on demand.
let readyVersion: string | null = null;
let onChange: () => void = () => {};
let installNow: () => void = () => {};
let checkNow: () => Promise<string> = async () => (app.isPackaged ? "Updates aren't set up in this copy." : "Updates only run in the installed app.");
export const updateReady = () => readyVersion;
export const installUpdate = () => installNow();
export const checkForUpdate = (_manual = false) => checkNow();
export function startUpdater(fn: () => void) {
  onChange = fn;
}

export function startUpdates(win: BrowserWindow) {
  if (!app.isPackaged || process.env.MILO_NO_UPDATES === "1") return;
  // loaded lazily so the dev build never needs it
  type Info = { version: string };
  type Updater = {
    autoDownload: boolean;
    autoInstallOnAppQuit: boolean;
    logger: unknown;
    on(ev: "update-available" | "update-downloaded", fn: (i: Info) => void): void;
    on(ev: "update-not-available", fn: () => void): void;
    on(ev: "error", fn: (e: Error) => void): void;
    checkForUpdates(): Promise<unknown>;
    quitAndInstall(silent?: boolean, forceRunAfter?: boolean): void;
  };
  let autoUpdater: Updater;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    autoUpdater = require("electron-updater").autoUpdater as Updater;
  } catch {
    bb("update", "missing_package", {});
    return;
  }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null;
  autoUpdater.on("update-available", (i) => bb("update", "available", { version: i.version }));
  autoUpdater.on("update-not-available", () => bb("update", "none", {}));
  autoUpdater.on("update-downloaded", (i) => {
    bb("update", "ready", { version: i.version });
    readyVersion = i.version;
    onChange();
    win.webContents.send("milo:update-ready", i.version);
  });
  autoUpdater.on("error", (e) => bb("update", "error", { error: String(e?.message ?? e).slice(0, 300) }));
  ipcMain.handle("milo:update-install", () => {
    bb("update", "install_now", {});
    setImmediate(() => autoUpdater.quitAndInstall(false, true));
  });
  installNow = () => {
    bb("update", "install_now", { from: "menu" });
    setImmediate(() => autoUpdater.quitAndInstall(false, true));
  };
  checkNow = async () => {
    if (readyVersion) return `Version ${readyVersion} is ready. Pick "Restart to update".`;
    try {
      await autoUpdater.checkForUpdates();
      return "Checking… I'll let you know if there's a new Milo.";
    } catch (e) {
      return `Couldn't check for updates: ${String((e as Error)?.message ?? e).slice(0, 80)}`;
    }
  };
  const check = () => autoUpdater.checkForUpdates().catch((e) => bb("update", "check_failed", { error: String(e?.message ?? e).slice(0, 200) }));
  setTimeout(check, 45e3);
  setInterval(check, 4 * 3600e3);
}
