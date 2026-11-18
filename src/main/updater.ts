// Milo updates himself: when GitHub's checks pass, GitHub builds a new Milo.app and publishes it as a
// release. Milo checks for it, downloads it in the background, and asks to restart. On quit, it installs.

import { app, net, Notification } from "electron";
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { log as bb } from "./blackbox";

const REPO = "jmengstrom06-lgtm/milo";
const ASSET = "Milo-mac-arm64.zip";
const EVERY_MS = 30 * 60 * 1000;

let ready: { version: string; app: string } | null = null;
let busy = false;
let onReady: (v: string) => void = () => {};

const newer = (a: string, b: string) => {
  const pa = a.replace(/^v/, "").split(".").map(Number), pb = b.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  return false;
};
const run = (cmd: string, args: string[]) =>
  new Promise<void>((res, rej) => execFile(cmd, args, { timeout: 120000 }, (err, _o, se) => (err ? rej(new Error(se || err.message)) : res())));

/** The .app bundle this copy of Milo is running from. */
const bundlePath = () => path.resolve(process.execPath, "..", "..", "..");

export async function checkForUpdate(manual = false): Promise<string> {
  if (!app.isPackaged) return "Updates only run in the installed app.";
  if (ready) return `Version ${ready.version} is ready. Restart Milo to use it.`;
  if (busy) return "Already checking.";
  busy = true;
  try {
    const r = await net.fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { accept: "application/vnd.github+json", "user-agent": "Milo" } });
    if (!r.ok) throw new Error(`release check ${r.status}`);
    const rel = (await r.json()) as { tag_name: string; assets: { name: string; browser_download_url: string }[] };
    const latest = rel.tag_name.replace(/^v/, "");
    if (!newer(latest, app.getVersion())) {
      bb("update", "up_to_date", { have: app.getVersion(), latest });
      return `You're on the latest version (${app.getVersion()}).`;
    }
    const asset = rel.assets.find((a) => a.name === ASSET);
    if (!asset) throw new Error("release has no app zip");
    bb("update", "downloading", { from: app.getVersion(), to: latest });
    const dl = await net.fetch(asset.browser_download_url);
    if (!dl.ok) throw new Error(`download ${dl.status}`);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "milo-update-"));
    const zip = path.join(dir, ASSET);
    fs.writeFileSync(zip, Buffer.from(await dl.arrayBuffer()));
    await run("/usr/bin/ditto", ["-x", "-k", zip, dir]);
    const next = path.join(dir, "Milo.app");
    if (!fs.existsSync(next)) throw new Error("zip had no Milo.app");
    await run("/usr/bin/codesign", ["--verify", "--deep", next]); // never install a broken or tampered copy
    ready = { version: latest, app: next };
    bb("update", "ready", { version: latest });
    onReady(latest);
    if (Notification.isSupported()) {
      const n = new Notification({ title: "Milo update ready", body: `Version ${latest}. Click to restart Milo.` });
      n.on("click", () => installUpdate());
      n.show();
    }
    return `Version ${latest} downloaded. Restart Milo to use it.`;
  } catch (e) {
    bb("update", "failed", { error: (e as Error).message, manual });
    return manual ? "I couldn't check for updates right now." : "";
  } finally {
    busy = false;
  }
}

/** Swap the app in place after Milo quits, then (optionally) reopen it. */
function swap(relaunch: boolean) {
  if (!ready) return;
  const cur = bundlePath();
  if (!cur.endsWith(".app")) return;
  const script = `
    while kill -0 ${process.pid} 2>/dev/null; do sleep 0.2; done
    rm -rf "${cur}.old"
    mv "${cur}" "${cur}.old" && mv "${ready.app}" "${cur}" && rm -rf "${cur}.old" || { [ -d "${cur}.old" ] && [ ! -d "${cur}" ] && mv "${cur}.old" "${cur}"; }
    ${relaunch ? `open "${cur}"` : ""}
  `;
  spawn("/bin/bash", ["-c", script], { detached: true, stdio: "ignore" }).unref();
  bb("update", "installing", { version: ready.version, relaunch });
}

export function installUpdate() {
  if (!ready) return;
  swap(true);
  ready = null;
  app.quit();
}

export function updateReady() {
  return ready?.version ?? null;
}

export function startUpdater(cb: (version: string) => void) {
  onReady = cb;
  if (!app.isPackaged) return;
  setTimeout(() => checkForUpdate(), 20_000);
  setInterval(() => checkForUpdate(), EVERY_MS);
  // Quitting with an update waiting: install it, so the next launch is the new version.
  app.on("will-quit", () => {
    if (ready) swap(false);
  });
}
