// Milo's smart ears: Deepgram Flux. It streams what you say and decides when you're DONE talking
// from the words themselves (not just silence), so a pause mid-sentence doesn't cut you off.
// Lives in the main process so the key never reaches the overlay.

import { account, backend } from "./account";
import WebSocket from "ws";
import { log as bb } from "./blackbox";

export type FluxEvent =
  | { type: "open" }
  | { type: "start"; turn: number }
  | { type: "update"; turn: number; text: string }
  | { type: "resumed"; turn: number }
  | { type: "end"; turn: number; text: string; confidence: number; trigger?: string }
  | { type: "closed"; reason: string }
  | { type: "error"; text: string };

let ws: WebSocket | null = null;
let opening: Promise<boolean> | null = null;
let backlog: Buffer[] = []; // audio that arrived while the connection was opening
let emit: (e: FluxEvent) => void = () => {};
let openedAt = 0;
let lastTurnText = "";

export const fluxAvailable = () => !!process.env.DEEPGRAM_API_KEY || account().signedIn;

export function onFlux(fn: (e: FluxEvent) => void) {
  emit = fn;
}

// Signed in: a 10-minute Deepgram token from the backend (our key never touches the Mac).
let grant: { token: string; until: number } | null = null;
async function fluxAuth(): Promise<string | null> {
  if (account().signedIn) {
    if (grant && grant.until > Date.now() + 30_000) return `Bearer ${grant.token}`;
    try {
      const res = await backend("deepgram-token", { body: "{}" });
      if (res?.ok) {
        const d = (await res.json()) as { access_token: string; expires_in: number };
        grant = { token: d.access_token, until: Date.now() + d.expires_in * 1000 };
        return `Bearer ${grant.token}`;
      }
      bb("flux", "grant_failed", { status: res?.status });
    } catch (e) {
      bb("flux", "grant_error", { error: (e as Error).message });
    }
  }
  const key = process.env.DEEPGRAM_API_KEY;
  return key ? `Token ${key}` : null;
}

function url() {
  const q = new URLSearchParams({
    model: "flux-general-en",
    encoding: "linear16",
    sample_rate: "16000",
    // How sure Flux must be that you're done. Higher = waits longer for the rest of your sentence.
    eot_threshold: process.env.MILO_EOT_THRESHOLD || "0.8",
    // Hard stop: end the turn this long after you stop talking, no matter what.
    eot_timeout_ms: process.env.MILO_EOT_TIMEOUT_MS || "6000",
  });
  // Help it spell the names it hears most.
  for (const k of ["Milo", "TCU", "D2L", "Chrome", "ChatGPT", "Google Docs"]) q.append("keyterm", k);
  return `${process.env.MILO_FLUX_URL || "wss://api.deepgram.com/v2/listen"}?${q}`;
}

/** Open the stream (no-op if it's already open). Resolves false if Flux isn't usable. */
export function openFlux(): Promise<boolean> {
  if (ws && ws.readyState === WebSocket.OPEN) return Promise.resolve(true);
  if (opening) return opening;
  opening = new Promise<boolean>(async (resolve) => {
    const auth = await fluxAuth();
    if (!auth) {
      opening = null;
      return resolve(false);
    }
    const sock = new WebSocket(url(), { headers: { Authorization: auth } });
    let settled = false;
    const settle = (ok: boolean) => {
      if (!settled) {
        settled = true;
        opening = null;
        resolve(ok);
      }
    };
    const timeout = setTimeout(() => {
      bb("flux", "open_timeout");
      sock.terminate();
      settle(false);
    }, 5000);
    sock.on("open", () => {
      clearTimeout(timeout);
      ws = sock;
      openedAt = Date.now();
      bb("flux", "open");
      for (const b of backlog) sock.send(b);
      backlog = [];
      emit({ type: "open" });
      settle(true);
    });
    sock.on("message", (raw) => {
      let m: any;
      try {
        m = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (m.type === "TurnInfo") {
        const turn = Number(m.turn_index ?? 0);
        const text = String(m.transcript ?? "").trim();
        switch (m.event) {
          case "StartOfTurn":
            emit({ type: "start", turn });
            break;
          case "Update":
            if (text && text !== lastTurnText) {
              lastTurnText = text;
              emit({ type: "update", turn, text });
            }
            break;
          case "TurnResumed":
            emit({ type: "resumed", turn });
            break;
          case "EndOfTurn":
            lastTurnText = "";
            bb("flux", "end_of_turn", { turn, text, confidence: m.end_of_turn_confidence, trigger: m.trigger });
            emit({ type: "end", turn, text, confidence: Number(m.end_of_turn_confidence ?? 0), trigger: m.trigger });
            break;
        }
      } else if (m.type === "Error" || m.type === "error") {
        bb("flux", "server_error", { message: m.description ?? m.message ?? m });
        emit({ type: "error", text: String(m.description ?? m.message ?? "Deepgram error") });
      }
    });
    sock.on("unexpected-response", (_req, res) => {
      clearTimeout(timeout);
      bb("flux", "rejected", { status: res.statusCode });
      emit({ type: "error", text: res.statusCode === 401 || res.statusCode === 403 ? "key" : `http-${res.statusCode}` });
      settle(false);
    });
    sock.on("error", (err) => {
      clearTimeout(timeout);
      bb("flux", "socket_error", { error: err.message });
      settle(false);
    });
    sock.on("close", (code, reason) => {
      clearTimeout(timeout);
      if (ws === sock) ws = null;
      bb("flux", "closed", { code, reason: reason.toString(), openSeconds: openedAt ? Math.round((Date.now() - openedAt) / 1000) : 0 });
      emit({ type: "closed", reason: String(code) });
      settle(false);
    });
  });
  return opening;
}

/** 16 kHz mono 16-bit PCM. */
export function sendAudio(pcm: ArrayBuffer) {
  const b = Buffer.from(new Uint8Array(pcm));
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(b);
  else if (opening) {
    backlog.push(b);
    if (backlog.length > 60) backlog.shift(); // ~4s max
  }
}

/** Push-to-talk "send now": end the turn on what's been heard so far. */
export function forceEndTurn() {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ForceEndTurn" }));
}

/** Close the stream (stops billing). */
export function closeFlux() {
  backlog = [];
  if (!ws) return;
  try {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "CloseStream" }));
  } catch {
    /* ignore */
  }
  const s = ws;
  setTimeout(() => s.close(), 500);
  ws = null;
}
