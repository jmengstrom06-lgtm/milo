// Crash reports (Sentry) and product analytics (PostHog), with no SDKs to install.
// Privacy: only event names and small facts (which command kind, how long, error codes) leave the Mac.
// Never what the student said, typed, or what's on their screen. MILO_NO_TELEMETRY=1 turns it all off.

import { app } from "electron";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { onLog } from "./blackbox";

const SENTRY_DSN =
  process.env.MILO_SENTRY_DSN || "https://54faa97843b44299d9ab332607d7a2bc@o4512449801551872.ingest.us.sentry.io/4512455954071552";
const POSTHOG_KEY = process.env.MILO_POSTHOG_KEY || "phc_zs24jVESL5qTidGmduvpy6T3x2qRhGh3KycMy5uQ5jFu";
const POSTHOG_HOST = process.env.MILO_POSTHOG_HOST || "https://us.i.posthog.com";

const off = () => process.env.MILO_NO_TELEMETRY === "1";
const env = () => (app.isPackaged ? "production" : "development");
const release = () => `milo@${app.getVersion()}`;

// ---- who (anonymous until sign-in) -----------------------------------------------------
let installId = "";
let userId: string | null = null;
function distinctId() {
  if (userId) return userId;
  if (installId) return installId;
  const f = path.join(app.getPath("userData"), "install-id");
  try {
    installId = fs.readFileSync(f, "utf8").trim();
  } catch {
    /* first launch */
  }
  if (!installId) {
    installId = crypto.randomUUID();
    try {
      fs.writeFileSync(f, installId);
    } catch {
      /* fine */
    }
  }
  return installId;
}

// ---- PostHog ---------------------------------------------------------------------------
type Ev = { event: string; distinct_id: string; properties: Record<string, unknown>; timestamp: string };
let queue: Ev[] = [];
let flushTimer: NodeJS.Timeout | null = null;

export function track(event: string, props: Record<string, unknown> = {}) {
  if (off()) return;
  queue.push({
    event,
    distinct_id: distinctId(),
    timestamp: new Date().toISOString(),
    properties: { ...props, $lib: "milo-desktop", app_version: app.getVersion(), environment: env(), os: `${os.platform()} ${os.release()}` },
  });
  if (queue.length >= 20) void flush();
  else if (!flushTimer) flushTimer = setTimeout(() => void flush(), 10_000);
}

export async function flush() {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  if (!queue.length) return;
  const batch = queue;
  queue = [];
  try {
    await fetch(`${POSTHOG_HOST}/batch/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ api_key: POSTHOG_KEY, batch }),
    });
  } catch {
    /* offline: drop it, analytics must never get in the way */
  }
}

/** Link the anonymous install to the signed-in student. */
export function identify(id: string, email?: string) {
  if (off() || !id || userId === id) return;
  const anon = distinctId();
  userId = id;
  track("$identify", { $anon_distinct_id: anon, $set: email ? { email } : {} });
}

// ---- Sentry ----------------------------------------------------------------------------
function sentryTarget() {
  const m = SENTRY_DSN.match(/^https:\/\/([^@]+)@([^/]+)\/(\d+)$/);
  return m ? { key: m[1], host: m[2], project: m[3] } : null;
}

function frames(stack: string) {
  return stack
    .split("\n")
    .slice(1)
    .map((l) => l.trim().match(/^at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/))
    .filter(Boolean)
    .map((m) => ({
      function: m![1] || "?",
      filename: m![2].replace(app.getAppPath(), "app:/"),
      lineno: Number(m![3]),
      colno: Number(m![4]),
      in_app: !m![2].includes("node_modules") && !m![2].startsWith("node:"),
    }))
    .reverse(); // Sentry wants oldest call first
}

export function captureError(err: unknown, where: string, extra: Record<string, unknown> = {}) {
  if (off()) return;
  const t = sentryTarget();
  if (!t) return;
  const e = err instanceof Error ? err : new Error(String(err));
  const id = crypto.randomUUID().replace(/-/g, "");
  const event = {
    event_id: id,
    timestamp: Date.now() / 1000,
    platform: "node",
    level: "error",
    release: release(),
    environment: env(),
    tags: { where, process: extra.process ?? "main" },
    user: { id: distinctId() },
    contexts: { os: { name: os.platform(), version: os.release() }, runtime: { name: "electron", version: process.versions.electron } },
    exception: { values: [{ type: e.name || "Error", value: (e.message || "").slice(0, 500), stacktrace: { frames: frames(e.stack || "") } }] },
    extra,
  };
  const body = [JSON.stringify({ event_id: id, sent_at: new Date().toISOString() }), JSON.stringify({ type: "event" }), JSON.stringify(event)].join("\n") + "\n";
  fetch(`https://${t.host}/api/${t.project}/envelope/`, {
    method: "POST",
    headers: {
      "content-type": "application/x-sentry-envelope",
      "x-sentry-auth": `Sentry sentry_version=7, sentry_key=${t.key}, sentry_client=milo-desktop/1.0`,
    },
    body,
  }).catch(() => {});
  track("error", { where, type: e.name });
}

// ---- tester feedback (Sentry User Feedback): the one thing the student chooses to send in their own words ----
export async function sendFeedback(message: string, opts: { email?: string; kind?: string; recent?: string[] } = {}): Promise<boolean> {
  const t = sentryTarget();
  const msg = message.trim().slice(0, 4000);
  if (!t || !msg) return false;
  const id = crypto.randomUUID().replace(/-/g, "");
  const event = {
    event_id: id,
    timestamp: Date.now() / 1000,
    platform: "javascript",
    level: "info",
    release: release(),
    environment: env(),
    tags: { kind: opts.kind || "feedback" },
    user: { id: distinctId(), ...(opts.email ? { email: opts.email } : {}) },
    contexts: {
      feedback: { message: msg, contact_email: opts.email || undefined, source: "milo-desktop" },
      os: { name: os.platform(), version: os.release() },
    },
    extra: { recent: (opts.recent ?? []).slice(-30) }, // only event names, never what was said
  };
  const body = [JSON.stringify({ event_id: id, sent_at: new Date().toISOString() }), JSON.stringify({ type: "feedback" }), JSON.stringify(event)].join("\n") + "\n";
  try {
    const r = await fetch(`https://${t.host}/api/${t.project}/envelope/`, {
      method: "POST",
      headers: {
        "content-type": "application/x-sentry-envelope",
        "x-sentry-auth": `Sentry sentry_version=7, sentry_key=${t.key}, sentry_client=milo-desktop/1.0`,
      },
      body,
    });
    track("feedback_sent", { kind: opts.kind || "feedback", ok: r.ok });
    return r.ok;
  } catch {
    return false;
  }
}

// ---- wiring --------------------------------------------------------------------------------

// Black-box events worth counting, and the only fields of each that may leave the Mac.
const FORWARD: Record<string, { name: string; keep: string[] }> = {
  "app:route_ai": { name: "command", keep: ["kind", "mode", "waitedMs"] },
  "app:route_instant": { name: "command_instant", keep: ["kind"] },
  "brain:api_error": { name: "ai_error", keep: ["status", "model"] },
  "brain:cache_hit": { name: "ai_cache_hit", keep: ["tokens"] },
  "voice:elevenlabs_error": { name: "voice_error", keep: ["status"] },
  "ears:deepgram_error": { name: "listen_error", keep: ["status"] },
  "ears:elevenlabs_error": { name: "listen_error", keep: ["status"] },
  "ears:backend_error": { name: "listen_error", keep: ["status"] },
  "hands:native_started": { name: "native_hands", keep: [] },
  "hands:native_missing": { name: "native_hands_missing", keep: [] },
  "account:verify": { name: "sign_in", keep: ["ok"] },
  "memory:learned": { name: "memory_learned", keep: ["count"] },
  "task:plan": { name: "computer_task", keep: [] },
  "voice:play": { name: "spoke", keep: ["engine", "chars"] },
  "app:offer_start": { name: "offer_start", keep: [] },
  "d2l:source": { name: "d2l_source", keep: ["via"] },
  "d2l:signin_needed": { name: "d2l_signin_needed", keep: ["chrome"] },
  "app:d2l_fix": { name: "d2l_fix_shown", keep: ["chrome"] },
  "app:d2l_fixed": { name: "d2l_fixed", keep: ["via", "seconds"] },
  "app:portal_set": { name: "portal_set", keep: ["signedIn", "via", "chrome"] },
  "app:offer_answer": { name: "offer_answer", keep: ["answer", "mode"] },
};

// The last few things Milo did, by event name only, so a feedback report shows what led up to it.
const recent: string[] = [];
export const recentEvents = () => [...recent];
onLog((src, ev) => {
  recent.push(`${new Date().toISOString().slice(11, 19)} ${src}:${ev}`);
  if (recent.length > 40) recent.shift();
});

export function startTelemetry() {
  if (off()) return;
  track("app_opened");
  onLog((src, ev, data) => {
    const f = FORWARD[`${src}:${ev}`];
    if (!f) return;
    const props: Record<string, unknown> = {};
    for (const k of f.keep) if (k in data && (typeof data[k] !== "string" || String(data[k]).length < 40)) props[k] = data[k];
    track(f.name, props);
  });
  process.on("uncaughtException", (err) => captureError(err, "uncaught"));
  process.on("unhandledRejection", (err) => captureError(err, "unhandled_rejection"));
  app.on("before-quit", () => void flush());
}
