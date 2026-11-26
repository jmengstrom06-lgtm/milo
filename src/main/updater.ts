// Auto-updates: every fix reaches students on its own.
// Milo isn't signed with an Apple Developer ID yet, and macOS's built-in updater (Squirrel) refuses to update
// unsigned apps. So Milo updates himself the same way the one-line installer does: check GitHub for a newer
// release, download the zip quietly, and swap the app in /Applications the next time he quits (or right away
// on "Restart to update"). Checks shortly after launch and every 4 hours.

import { app, ipcMain, net, type BrowserWindow } from "electron";
import { spawn, execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { log as bb } from "./blackbox";

const REPO = "jmengstrom06-lgtm/milo";
const ASSET = "Milo-mac-arm64.zip";

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

/** "0.2.166" > "0.2.160"? (pure) */
export function newer(a: string, b: string): boolean {
  const x = a.replace(/^v/, "").split(".").map(Number);
  const y = b.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
}

/** The shell step that runs after Milo quits: wait for him to exit, swap the app, keep the old one if anything fails. */
export const SWAP_SCRIPT = `#!/bin/bash
PID="$1"; NEW="$2"; APP="$3"; RELAUNCH="$4"
for i in $(seq 1 150); do kill -0 "$PID" 2>/dev/null || break; sleep 0.2; done
rm -rf "$APP.old"
if mv "$APP" "$APP.old" && ditto "$NEW" "$APP"; then
  rm -rf "$APP.old"
else
  rm -rf "$APP"; mv "$APP.old" "$APP"
fi
xattr -dr com.apple.quarantine "$APP" >/dev/null 2>&1
if [ "$RELAUNCH" = "1" ]; then open "$APP"; fi
`;

const run = (cmd: string, args: string[]) => new Promise<void>((res, rej) => execFile(cmd, args, (e) => (e ? rej(e) : res())));

export function startUpdates(win: BrowserWindow) {
  if (!app.isPackaged || process.env.MILO_NO_UPDATES === "1" || process.platform !== "darwin") return;
  const appPath = path.resolve(process.execPath, "..", "..", ".."); // /Applications/Milo.app
  const work = path.join(app.getPath("userData"), "update"); // survives restarts, unlike /tmp
  const stagedVersion = () => {
    try {
      const plist = fs.readFileSync(path.join(work, "out", "Milo.app", "Contents", "Info.plist"), "utf8");
      return plist.match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/)?.[1] ?? null;
    } catch {
      return null;
    }
  };
  let staged: string | null = null; // unzipped new Milo.app, ready to swap in
  let busy = false;
  let swapping = false;

  const canSwap = () => {
    try {
      fs.accessSync(path.dirname(appPath), fs.constants.W_OK);
      fs.accessSync(appPath, fs.constants.W_OK);
      return /\.app$/.test(appPath);
    } catch {
      return false;
    }
  };

  async function check(manual = false): Promise<string> {
    if (readyVersion) return `Version ${readyVersion} is ready. Pick "Restart to update".`;
    if (busy) return "Already downloading the new Milo…";
    busy = true;
    try {
      const r = await net.fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: "application/vnd.github+json", "User-Agent": "Milo" } });
      if (!r.ok) throw new Error(`GitHub said ${r.status}`);
      const rel = (await r.json()) as { tag_name: string; assets: { name: string; browser_download_url: string }[] };
      const latest = rel.tag_name.replace(/^v/, "");
      if (!newer(latest, app.getVersion())) {
        bb("update", "none", { have: app.getVersion(), latest });
        return manual ? `You're on the newest Milo (${app.getVersion()}).` : "";
      }
      if (!canSwap()) {
        bb("update", "cant_write", { appPath });
        return "There's a new Milo, but I can't update myself in this folder. Run the installer once.";
      }
      if (stagedVersion() === latest) {
        // already downloaded last time: ready right away
        staged = path.join(work, "out", "Milo.app");
        readyVersion = latest;
        bb("update", "ready", { version: latest, reused: true });
        onChange();
        win.webContents.send("milo:update-ready", latest);
        return `Version ${latest} is ready. Pick "Restart to update".`;
      }
      const asset = rel.assets.find((x) => x.name === ASSET);
      if (!asset) throw new Error("no Mac download in the release");
      bb("update", "available", { version: latest });
      fs.rmSync(work, { recursive: true, force: true });
      fs.mkdirSync(work, { recursive: true });
      const zip = path.join(work, "Milo.zip");
      bb("update", "downloading", { version: latest });
      const d = await net.fetch(asset.browser_download_url);
      if (!d.ok) throw new Error(`download ${d.status}`);
      fs.writeFileSync(zip, Buffer.from(await d.arrayBuffer()));
      const out = path.join(work, "out");
      await run("/usr/bin/ditto", ["-x", "-k", zip, out]);
      const appNew = path.join(out, "Milo.app");
      const plist = fs.readFileSync(path.join(appNew, "Contents", "Info.plist"), "utf8");
      if (!plist.includes(`<string>${latest}</string>`)) throw new Error("downloaded app has the wrong version");
      staged = appNew;
      readyVersion = latest;
      bb("update", "ready", { version: latest });
      onChange();
      win.webContents.send("milo:update-ready", latest);
      return `Version ${latest} is ready. Pick "Restart to update".`;
    } catch (e) {
      bb("update", "check_failed", { error: String((e as Error)?.message ?? e).slice(0, 200) });
      return manual ? `Couldn't check for updates: ${String((e as Error)?.message ?? e).slice(0, 80)}` : "";
    } finally {
      busy = false;
    }
  }

  /** Hand the swap to a small script that runs after Milo exits. */
  function swap(relaunch: boolean) {
    if (!staged || swapping) return false;
    swapping = true;
    const script = path.join(work, "swap.sh");
    fs.writeFileSync(script, SWAP_SCRIPT, { mode: 0o755 });
    const child = spawn("/bin/bash", [script, String(process.pid), staged, appPath, relaunch ? "1" : "0"], { detached: true, stdio: "ignore" });
    child.unref();
    bb("update", "install", { version: readyVersion, relaunch });
    return true;
  }

  ipcMain.handle("milo:update-install", () => {
    if (swap(true)) setImmediate(() => app.quit());
  });
  installNow = () => {
    if (swap(true)) setImmediate(() => app.quit());
  };
  checkNow = () => check(true);
  const sv = stagedVersion();
  const tried = path.join(work, "tried.txt");
  const triedV = (() => { try { return fs.readFileSync(tried, "utf8").trim(); } catch { return ""; } })();
  if (sv && newer(sv, app.getVersion()) && triedV !== sv && canSwap()) {
    try { fs.writeFileSync(tried, sv); } catch { /* ignore */ }
    staged = path.join(work, "out", "Milo.app");
    readyVersion = sv;
    bb("update", "install_at_launch", { from: app.getVersion(), to: sv });
    win.webContents.once("did-finish-load", () => win.webContents.send("milo:updating", sv));
    setTimeout(() => {
      if (swap(true)) app.quit();
    }, 1500);
    return;
  }
  app.on("will-quit", () => void swap(false)); // installs the next time Milo quits
  setTimeout(() => void check(), 8e3);
  setInterval(() => void check(), 4 * 3600e3);
}
