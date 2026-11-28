// Talks to Milo's native helper (native/hands.swift), a small process that stays running so clicks,
// keys and typing happen instantly instead of starting a new osascript each time.
// If the helper isn't built or stops working, every call returns null and hands.ts falls back to osascript.

import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { log as bb } from "./blackbox";

type Reply = { id: number; ok: boolean; error?: string; [k: string]: unknown };

let proc: ChildProcessWithoutNullStreams | null = null;
let broken = false; // gave up for this launch (missing binary or it keeps crashing)
let crashes = 0;
let nextId = 1;
const pending = new Map<number, { resolve: (r: Reply | null) => void; timer: NodeJS.Timeout }>();

export function binaryPath(): string | null {
  const candidates = [
    process.env.MILO_HANDS_BIN,
    app.isPackaged ? path.join(process.resourcesPath, "milo-hands") : "",
    path.join(app.getAppPath(), "dist", "milo-hands"),
  ].filter(Boolean) as string[];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

function start(): ChildProcessWithoutNullStreams | null {
  if (proc) return proc;
  if (broken || process.platform !== "darwin" || process.env.MILO_NO_NATIVE === "1") return null;
  const bin = binaryPath();
  if (!bin) {
    broken = true;
    bb("hands", "native_missing", { hint: "run npm run build:hands (needs Xcode Command Line Tools)" });
    return null;
  }
  const p = spawn(bin, [], { stdio: ["pipe", "pipe", "pipe"] });
  const startedAt = Date.now();
  let buf = "";
  p.stdout.setEncoding("utf8");
  p.stdout.on("data", (chunk: string) => {
    buf += chunk;
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      try {
        const r = JSON.parse(line) as Reply;
        const w = pending.get(r.id);
        if (w) {
          clearTimeout(w.timer);
          pending.delete(r.id);
          w.resolve(r);
        }
      } catch {
        /* not a reply */
      }
    }
  });
  p.stderr.on("data", (d) => bb("hands", "native_stderr", { text: String(d).slice(0, 300) }));
  p.on("exit", (code, signal) => {
    proc = null;
    const during = pending.size; // requests that were waiting when it stopped (a real crash mid-task)
    for (const [id, w] of pending) {
      clearTimeout(w.timer);
      w.resolve(null);
      pending.delete(id);
    }
    if (quitting) return void bb("hands", "native_stopped", { why: "milo quit", ranS: Math.round((Date.now() - startedAt) / 1000) }); // normal shutdown, not a crash
    // Only a helper that dies again right away is broken. One that ran a while and then quit (macOS reclaims
    // idle processes) just starts fresh on the next request, however many times that happens.
    const ranMs = Date.now() - startedAt;
    if (ranMs > 60e3) crashes = 0;
    if (++crashes >= 3) broken = true;
    bb("hands", "native_exit", { code, signal, crashes, ranS: Math.round(ranMs / 1000), during });
  });
  p.on("error", (e) => {
    broken = true;
    bb("hands", "native_error", { error: e.message });
  });
  proc = p;
  bb("hands", "native_started", { bin });
  return p;
}

// Milo quitting stops the helper too: that's not a crash
let quitting = false;
try {
  app.on("before-quit", () => (quitting = true));
} catch {
  /* tests */
}

/** Send one request to the helper. Resolves null if the helper isn't available (caller falls back). */
export function native(cmd: string, args: Record<string, unknown> = {}, timeoutMs = 8000): Promise<Reply | null> {
  const p = start();
  if (!p) return Promise.resolve(null);
  const id = nextId++;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve(null);
    }, timeoutMs);
    pending.set(id, { resolve, timer });
    try {
      p.stdin.write(JSON.stringify({ id, cmd, ...args }) + "\n");
    } catch {
      clearTimeout(timer);
      pending.delete(id);
      resolve(null);
    }
  });
}

/** True when the helper is built and running. */
export async function nativeReady(): Promise<boolean> {
  const r = await native("ping", {}, 2000);
  return !!r?.ok;
}

export type ScreenElement = { role: string; label: string; x: number; y: number; w: number; h: number };

/**
 * The real buttons, fields and text in the front window, with screen positions (points).
 * Much faster and more exact than guessing from a screenshot. Null if unavailable.
 */
export async function screenElements(limit = 250): Promise<ScreenElement[] | null> {
  const r = await native("elements", { limit }, 4000);
  return r?.ok ? (r.elements as ScreenElement[]) : null;
}

export function stopNative() {
  try {
    proc?.stdin.end();
    proc?.kill();
  } catch {
    /* already gone */
  }
  proc = null;
}
