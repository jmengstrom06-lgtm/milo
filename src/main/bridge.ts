// Bridge to Milo's Chrome extension: a WebSocket on 127.0.0.1 that only the extension can join
// (it needs the secret Milo writes into the extension folder at every launch).

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import { log as bb } from "./blackbox";

let client: WebSocket | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
const token = crypto.randomBytes(24).toString("hex");

const BRIDGE_FILE = path.join(os.homedir(), "Library", "Application Support", "Milo", "bridge.json");

/** Milo's extension IDs: the one you load by hand while building, and the Chrome Web Store one.
 *  After the first store upload, put its ID here (Developer Dashboard > Package) and ship an update. */
const STORE_EXTENSION_ID = ""; // ← the Chrome Web Store Item ID goes here after Google approves it
export const EXTENSION_IDS = ["hdijeeoabiejhlbcjjdlkanhpkcnngce", STORE_EXTENSION_ID].filter((x) => /^[a-p]{32}$/.test(x));
const HOST = "app.milo.bridge";

/** Tell Chrome (and Brave, Edge, Chromium) how Milo's extension can find Milo: Chrome's official "native messaging". */
export function registerNativeHost(helperPath: string | null) {
  if (process.platform !== "darwin" || !helperPath) return;
  const manifest = {
    name: HOST,
    description: "Lets Milo's browser extension find Milo on this Mac",
    path: helperPath,
    type: "stdio",
    allowed_origins: EXTENSION_IDS.map((id) => `chrome-extension://${id}/`),
  };
  const browsers = ["Google/Chrome", "Google/Chrome Beta", "Chromium", "BraveSoftware/Brave-Browser", "Microsoft Edge"];
  for (const b of browsers) {
    const root = path.join(os.homedir(), "Library", "Application Support", b);
    if (!fs.existsSync(root)) continue; // not installed
    try {
      const dir = path.join(root, "NativeMessagingHosts");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${HOST}.json`), JSON.stringify(manifest, null, 2));
    } catch (e) {
      bb("bridge", "native_host_failed", { browser: b, error: (e as Error).message });
    }
  }
  bb("bridge", "native_host", { ids: EXTENSION_IDS.length, helper: helperPath });
}

export const bridgeConnected = () => !!client && client.readyState === WebSocket.OPEN;

export function startBridge(extensionDir: string, port = 47321, tries = 0) {
  const wss = new WebSocketServer({
    host: "127.0.0.1",
    port,
    verifyClient: ({ origin, req }, done) => {
      const u = new URL(req.url ?? "/", "http://127.0.0.1");
      const ok = (origin ?? "").startsWith("chrome-extension://") && u.searchParams.get("token") === token;
      if (!ok) bb("bridge", "rejected_connection", { origin });
      done(ok, 401);
    },
  });
  wss.on("listening", () => {
    try {
      fs.writeFileSync(path.join(extensionDir, "config.json"), JSON.stringify({ port, token }), { mode: 0o600 });
      // For the Chrome Web Store version: Chrome asks Milo's native host, which reads this (only Milo's extension can ask).
      fs.mkdirSync(path.dirname(BRIDGE_FILE), { recursive: true });
      fs.writeFileSync(BRIDGE_FILE, JSON.stringify({ port, token }), { mode: 0o600 });
      bb("bridge", "listening", { port });
    } catch (e) {
      bb("bridge", "config_write_failed", { error: (e as Error).message });
    }
  });
  wss.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE" && tries < 5) startBridge(extensionDir, port + 1, tries + 1);
    else bb("bridge", "server_error", { error: err.message });
  });
  wss.on("connection", (sock) => {
    client?.close();
    client = sock;
    bb("bridge", "extension_connected");
    const ping = setInterval(() => call("ping", {}, 5000).catch(() => {}), 20000); // keeps Chrome's worker awake
    sock.on("message", (raw) => {
      let m: { id: number; ok: boolean; data?: unknown; error?: string };
      try {
        m = JSON.parse(raw.toString());
      } catch {
        return;
      }
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      clearTimeout(p.timer);
      if (m.ok) p.resolve(m.data);
      else p.reject(new Error(m.error || "Extension error"));
    });
    sock.on("close", () => {
      clearInterval(ping);
      if (client === sock) client = null;
      bb("bridge", "extension_disconnected");
    });
  });
}

/** Ask the extension to do something. Rejects if it isn't connected or doesn't answer in time. */
export function call<T = any>(cmd: string, args: Record<string, unknown> = {}, timeoutMs = 10000): Promise<T> {
  if (!bridgeConnected()) return Promise.reject(new Error("Chrome extension not connected"));
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Chrome didn't answer (${cmd})`));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    client!.send(JSON.stringify({ id, cmd, args }));
  });
}
