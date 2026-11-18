// Bridge to Milo's Chrome extension: a WebSocket on 127.0.0.1 that only the extension can join
// (it needs the secret Milo writes into the extension folder at every launch).

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import { log as bb } from "./blackbox";

let client: WebSocket | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
const token = crypto.randomBytes(24).toString("hex");

export const bridgeConnected = () => !!client && client.readyState === WebSocket.OPEN;

export function startBridge(extensionDir: string | string[], port = 47321, tries = 0) {
  const dirs = Array.isArray(extensionDir) ? extensionDir : [extensionDir];
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
      for (const dir of dirs) fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify({ port, token }), { mode: 0o600 });
      bb("bridge", "listening", { port, dirs: dirs.length });
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
