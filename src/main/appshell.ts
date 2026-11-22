// Milo as a real Mac app: where keys live, the menu bar frog, start at login.

import { app, BrowserWindow, clipboard, Menu, nativeImage, shell, Tray } from "electron";
import dotenv from "dotenv";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { log as bb, LOG_DIR } from "./blackbox";

/** Keys live in Milo's own data folder (~/Library/Application Support/Milo/.env), never inside the app. */
export const KEYS_FILE = () => path.join(app.getPath("userData"), ".env");
const DEV_ENV = () => path.join(app.getAppPath(), ".env");
const CLONE_ENV = path.join(os.homedir(), "milo", ".env");

export function loadKeys() {
  try {
    fs.mkdirSync(path.dirname(KEYS_FILE()), { recursive: true });
    // First launch of the app: bring over the keys from the developer copy (~/milo/.env).
    if (!fs.existsSync(KEYS_FILE()) && fs.existsSync(CLONE_ENV)) {
      fs.copyFileSync(CLONE_ENV, KEYS_FILE());
      fs.chmodSync(KEYS_FILE(), 0o600);
      bb("app", "keys_migrated", {});
    }
  } catch (e) {
    bb("app", "keys_migrate_failed", { error: (e as Error).message });
  }
  // Later files never overwrite earlier ones: app data first, then the developer copy.
  dotenv.config({ path: KEYS_FILE() });
  if (!app.isPackaged) dotenv.config({ path: DEV_ENV() });
  dotenv.config({ path: CLONE_ENV });
}

const KEY_TYPES: [RegExp, string, string][] = [
  [/^sk-ant-/, "ANTHROPIC_API_KEY", "Anthropic (brain)"],
  [/^sk_[A-Za-z0-9]{20,}$/, "ELEVENLABS_API_KEY", "ElevenLabs (voice)"],
  [/^[a-f0-9]{40}$/i, "DEEPGRAM_API_KEY", "Deepgram (ears)"],
  [/^sk-(proj-|svcacct-)?[A-Za-z0-9_-]{20,}$/, "OPENAI_API_KEY", "OpenAI (images)"],
];
/** Copy a key, click "Set a key from clipboard": saved, never shown. */
export function saveKeyFromClipboard(): string {
  const key = clipboard.readText().trim().replace(/^["']|["']$/g, "");
  const hit = KEY_TYPES.find(([re]) => re.test(key));
  if (!hit || key.length < 20 || /\s/.test(key)) return "That's not a key I recognize. Copy just the key and try again.";
  const [, name, label] = hit;
  let env = "";
  try {
    env = fs.readFileSync(KEYS_FILE(), "utf8");
  } catch {
    /* new file */
  }
  const line = `${name}=${key}`;
  env = new RegExp(`^${name}=.*$`, "m").test(env) ? env.replace(new RegExp(`^${name}=.*$`, "m"), line) : `${env.trimEnd()}\n${line}\n`.trimStart();
  fs.mkdirSync(path.dirname(KEYS_FILE()), { recursive: true });
  fs.writeFileSync(KEYS_FILE(), env, { mode: 0o600 });
  process.env[name] = key;
  clipboard.writeText(""); // don't leave a key sitting on the clipboard
  bb("app", "key_saved", { name });
  return `Saved your ${label} key (ending ${key.slice(-4)}).`;
}

/** Folders the Chrome extension can be loaded from (its connection file goes in each). */
export function extensionDirs(): string[] {
  const dirs: string[] = [];
  if (app.isPackaged) {
    // The app carries the extension; copy it somewhere Chrome can load it from.
    const bundled = path.join(process.resourcesPath, "extension");
    const target = path.join(app.getPath("userData"), "Chrome Extension");
    try {
      fs.mkdirSync(target, { recursive: true });
      for (const f of fs.readdirSync(bundled)) if (f !== "config.json") fs.copyFileSync(path.join(bundled, f), path.join(target, f));
      dirs.push(target);
    } catch (e) {
      bb("app", "extension_copy_failed", { error: (e as Error).message });
    }
  } else dirs.push(path.join(app.getAppPath(), "extension"));
  // Already loaded from the developer copy (~/milo/extension)? Keep it working, no re-setup.
  const clone = path.join(os.homedir(), "milo", "extension");
  if (fs.existsSync(path.join(clone, "manifest.json")) && !dirs.includes(clone)) dirs.push(clone);
  return dirs;
}

// ---- menu bar frog ---------------------------------------------------------------------------
let tray: Tray | null = null;
export type TrayHooks = {
  overlay: () => BrowserWindow | null;
  talk: () => void;
  activity?: () => void;
  feedback?: () => void;
  say: (text: string) => void;
  checkUpdates: () => void;
  updateReady: () => string | null; // version waiting to install
  installUpdate: () => void;
};

export function createTray(h: TrayHooks) {
  const img = nativeImage.createFromPath(path.join(app.getAppPath(), "build", "trayTemplate.png"));
  img.setTemplateImage(true);
  tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img);
  if (img.isEmpty()) tray.setTitle("Milo");
  tray.setToolTip("Milo");
  const rebuild = () => {
    const win = h.overlay();
    const visible = !!win && win.isVisible();
    const ready = h.updateReady();
    const login = app.getLoginItemSettings().openAtLogin;
    tray?.setContextMenu(
      Menu.buildFromTemplate([
        ...(ready ? [{ label: `Restart to update (v${ready})`, click: () => h.installUpdate() }, { type: "separator" as const }] : []),
        { label: visible ? "Hide Milo" : "Show Milo", click: () => (visible ? win?.hide() : win?.showInactive()) },
        { label: "Talk to Milo", accelerator: "CommandOrControl+Shift+Space", click: () => h.talk() },
        { label: "What Milo did…", click: () => h.activity?.() },
        { label: "Send feedback…", click: () => h.feedback?.() },
        { type: "separator" },
        { label: "Set a key from clipboard", click: () => h.say(saveKeyFromClipboard()) },
        { label: "Open Milo's logs", click: () => shell.openPath(LOG_DIR) },
        { label: "Show Chrome extension folder", click: () => shell.openPath(extensionDirs()[0]) },
        { type: "separator" },
        { label: "Start Milo when my Mac starts", type: "checkbox", checked: login, click: () => app.setLoginItemSettings({ openAtLogin: !login }) },
        { label: "Check for updates", click: () => h.checkUpdates() },
        { label: `Version ${app.getVersion()}`, enabled: false },
        { type: "separator" },
        { label: "Quit Milo", accelerator: "CommandOrControl+Q", click: () => app.quit() },
      ])
    );
  };
  rebuild();
  tray.on("mouse-enter", rebuild);
  tray.on("click", rebuild);
  return { refresh: rebuild };
}

/** First launch of the real app: start at login by default (you can turn it off in the menu). */
export function firstRunDefaults() {
  if (!app.isPackaged) return;
  const flag = path.join(app.getPath("userData"), ".first-run-done");
  if (fs.existsSync(flag)) return;
  app.setLoginItemSettings({ openAtLogin: true });
  fs.writeFileSync(flag, new Date().toISOString());
  bb("app", "first_run", { version: app.getVersion() });
}
