// Black-box log: a timeline of what Milo heard, decided and did, so bugs get fixed from facts.
// Everything stays on this Mac, in ~/Milo Logs. One file per launch, plus the last few voice clips.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const LOG_DIR = path.join(os.homedir(), "Milo Logs");
const CLIP_DIR = path.join(LOG_DIR, "clips");
const KEEP_CLIPS = 40;
const KEEP_SESSIONS = 30;

const started = Date.now();
const stamp = new Date(started).toISOString().replace(/[:T]/g, "-").slice(0, 19);
export const LOG_FILE = path.join(LOG_DIR, `session-${stamp}.jsonl`);

let ready = false;
let clipN = 0;

function ensure() {
  if (ready) return;
  fs.mkdirSync(CLIP_DIR, { recursive: true });
  // Keep the folder small: drop the oldest sessions.
  try {
    const old = fs.readdirSync(LOG_DIR).filter((f) => f.startsWith("session-")).sort();
    for (const f of old.slice(0, Math.max(0, old.length - KEEP_SESSIONS + 1))) fs.rmSync(path.join(LOG_DIR, f), { force: true });
  } catch {
    /* ignore */
  }
  ready = true;
}

// Never write secrets, even by accident.
function scrub(v: unknown): unknown {
  if (typeof v === "string") return v.replace(/sk-ant-[\w-]+/g, "sk-ant-…").replace(/\bsk_[\w]{10,}/g, "sk_…").slice(0, 2000);
  if (Array.isArray(v)) return v.slice(0, 50).map(scrub);
  if (v && typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      if (/key|token|secret|password|audio|jpeg|image|wav/i.test(k) && typeof x === "string" && x.length > 40) o[k] = `(${x.length} chars)`;
      else o[k] = scrub(x);
    }
    return o;
  }
  return v;
}

/** Add one line to the timeline. src: "main" | "ears" | "app" | "voice" | ... */
export function log(src: string, ev: string, data: Record<string, unknown> = {}) {
  try {
    ensure();
    const line = { t: new Date().toISOString().slice(11, 23), ms: Date.now() - started, src, ev, ...(scrub(data) as object) };
    fs.appendFileSync(LOG_FILE, JSON.stringify(line) + "\n");
  } catch {
    /* logging must never break Milo */
  }
}

/** Save what the mic recorded for one utterance. Returns the clip's file name. */
export function saveClip(wav: ArrayBuffer | Uint8Array): string {
  try {
    ensure();
    const name = `clip-${stamp}-${String(++clipN).padStart(3, "0")}.wav`;
    fs.writeFileSync(path.join(CLIP_DIR, name), Buffer.from(wav instanceof Uint8Array ? wav : new Uint8Array(wav)));
    const clips = fs.readdirSync(CLIP_DIR).filter((f) => f.endsWith(".wav")).sort();
    for (const f of clips.slice(0, Math.max(0, clips.length - KEEP_CLIPS))) fs.rmSync(path.join(CLIP_DIR, f), { force: true });
    return name;
  } catch {
    return "";
  }
}

/** Time a step: const done = timer(); ... log("main","x",{ ms: done() }) */
export const timer = () => {
  const t = Date.now();
  return () => Date.now() - t;
};

log("main", "session_start", { platform: process.platform, arch: process.arch, electron: process.versions.electron, node: process.versions.node });
