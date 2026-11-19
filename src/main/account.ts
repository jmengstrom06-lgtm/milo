// Milo accounts (Supabase Auth, email code sign-in) and the backend door.
// No SDK: plain fetch, so there's nothing native to install. The anon key below is public by design;
// it can only do what row-level security allows a signed-in student to do.

import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { log as bb } from "./blackbox";

export const SUPABASE_URL = process.env.MILO_SUPABASE_URL || "https://ptfvptkhzxnpvdhgnfcp.supabase.co";
export const SUPABASE_ANON =
  process.env.MILO_SUPABASE_ANON ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB0ZnZwdGtoenhucHZkaGduZmNwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTUwNTA5MjUsImV4cCI6MjExMDYyNjkyNX0.mC3xaAR52KxW918DscQq8zY7kiDiY_LXjgkjFDsgxNU";

type Session = { access_token: string; refresh_token: string; expires_at: number; email: string; user_id: string };

let session: Session | null = null;
let loaded = false;
const file = () => path.join(app.getPath("userData"), "account.json");

function load() {
  if (loaded) return;
  loaded = true;
  try {
    session = JSON.parse(fs.readFileSync(file(), "utf8"));
  } catch {
    session = null;
  }
}
function save() {
  try {
    if (session) fs.writeFileSync(file(), JSON.stringify(session), { mode: 0o600 });
    else fs.rmSync(file(), { force: true });
  } catch (e) {
    bb("account", "save_failed", { error: (e as Error).message });
  }
}

async function auth(pathname: string, body: unknown) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/${pathname}`, {
    method: "POST",
    headers: { apikey: SUPABASE_ANON, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, any>;
  return { ok: res.ok, status: res.status, data };
}

function take(data: Record<string, any>) {
  session = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + Number(data.expires_in || 3600),
    email: data.user?.email ?? session?.email ?? "",
    user_id: data.user?.id ?? session?.user_id ?? "",
  };
  save();
}

// ---- sign-in ----------------------------------------------------------------------------
// The email has a "Log In" link (and, once custom email is set up, a 6-digit code too).
// The link opens the browser, Supabase sends it back to a tiny page Milo serves on this Mac,
// and that page hands the session to Milo. Pasting the link or typing the code also works.

export const CALLBACK_PORT = Number(process.env.MILO_AUTH_PORT || 47323);
export const CALLBACK_URL = `http://127.0.0.1:${CALLBACK_PORT}/auth`;

let onChange: () => void = () => {};
/** Tell the window when sign-in finishes from the browser. */
export function onAccountChange(fn: () => void) {
  onChange = fn;
}

const CALLBACK_PAGE = `<!doctype html><meta charset="utf-8"><title>Milo</title>
<body style="font-family:-apple-system,system-ui;background:#16121f;color:#fff;display:grid;place-items:center;height:100vh;margin:0">
<div style="text-align:center"><h1 id="t">Signing you in…</h1><p id="s" style="opacity:.7"></p></div>
<script>
const h = new URLSearchParams(location.hash.slice(1));
const q = new URLSearchParams(location.search);
const err = h.get("error_description") || q.get("error_description");
const t = document.getElementById("t"), s = document.getElementById("s");
if (err) { t.textContent = "That link didn't work"; s.textContent = err + ". Send a new one from Milo."; }
else fetch("/auth/done", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ access_token: h.get("access_token"), refresh_token: h.get("refresh_token"), expires_in: h.get("expires_in"),
    token_hash: q.get("token_hash"), type: q.get("type") }) })
  .then(r => r.json()).then(d => { t.textContent = d.ok ? "You're signed in to Milo" : "That link didn't work";
    s.textContent = d.ok ? "You can close this tab." : "Send a new one from Milo."; history.replaceState(null, "", "/auth"); })
  .catch(() => { t.textContent = "Couldn't reach Milo"; s.textContent = "Make sure Milo is running, then click the link again."; });
</script></body>`;

let server: import("node:http").Server | null = null;
export async function startCallbackServer() {
  if (server) return;
  const http = await import("node:http");
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", CALLBACK_URL);
    if (req.method === "GET" && url.pathname === "/auth") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      return res.end(CALLBACK_PAGE);
    }
    if (req.method === "POST" && url.pathname === "/auth/done") {
      let body = "";
      req.on("data", (c) => (body += c).length > 20_000 && req.destroy());
      req.on("end", async () => {
        let ok = false;
        try {
          const d = JSON.parse(body);
          if (d.access_token && d.refresh_token) ok = await acceptTokens(d.access_token, d.refresh_token, Number(d.expires_in) || 3600);
          else if (d.token_hash) ok = (await verifyHash(d.token_hash, d.type || "magiclink")).ok;
        } catch {
          ok = false;
        }
        bb("account", "verify", { ok, via: "browser" });
        if (ok) onChange();
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok }));
      });
      return;
    }
    res.writeHead(404).end();
  });
  server.on("error", (e) => {
    bb("account", "callback_server_error", { error: (e as Error).message });
    server = null;
  });
  server.listen(CALLBACK_PORT, "127.0.0.1");
}

/** Tokens straight from the browser: check them with Supabase before trusting them. */
async function acceptTokens(access: string, refresh: string, expiresIn: number): Promise<boolean> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${access}` } });
  if (!res.ok) return false;
  const user = (await res.json()) as { id?: string; email?: string };
  if (!user.id) return false;
  take({ access_token: access, refresh_token: refresh, expires_in: expiresIn, user });
  return true;
}

async function verifyHash(tokenHash: string, type: string): Promise<{ ok: boolean; text: string }> {
  const r = await auth("verify", { type, token_hash: tokenHash });
  if (!r.ok || !r.data.access_token) return { ok: false, text: "That link didn't work (they expire after an hour). Send a new one." };
  take(r.data);
  return { ok: true, text: `Signed in as ${session!.email}.` };
}

// ---- sign-in from any device (PKCE + pairing) --------------------------------------------
// The email link can be tapped anywhere (usually a phone). It lands on our milo-auth function with a
// one-time code, parked under a random pair id. Milo polls for it and trades it for a session using a
// secret verifier that never leaves this Mac, so the code is useless to anyone else.

export const PAIR_URL = `${SUPABASE_URL}/functions/v1/milo-auth`;
const b64url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
let waiting: { pair: string; verifier: string; until: number; timer: NodeJS.Timeout | null } | null = null;

function stopWaiting() {
  if (waiting?.timer) clearTimeout(waiting.timer);
  waiting = null;
}

async function pollPair() {
  const w = waiting;
  if (!w) return;
  if (Date.now() > w.until) return stopWaiting();
  try {
    const res = await fetch(PAIR_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pair: w.pair }) });
    const d = (await res.json().catch(() => ({}))) as { code?: string | null };
    if (d.code && waiting === w) {
      const r = await auth("token?grant_type=pkce", { auth_code: d.code, code_verifier: w.verifier });
      stopWaiting();
      bb("account", "verify", { ok: r.ok && !!r.data.access_token, via: "link" });
      if (r.ok && r.data.access_token) {
        take(r.data);
        onChange();
      }
      return;
    }
  } catch (e) {
    bb("account", "pair_poll_error", { error: (e as Error).message });
  }
  if (waiting === w) w.timer = setTimeout(pollPair, 2000);
}

/** Step 1: email the student a sign-in link. Tapping it on any device signs Milo in here. */
export async function sendCode(email: string): Promise<{ ok: boolean; text: string }> {
  const e = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return { ok: false, text: "That doesn't look like an email." };
  const crypto = await import("node:crypto");
  const verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  const pair = crypto.randomBytes(24).toString("hex");
  const redirect = `${PAIR_URL}?pair=${pair}`;
  const r = await auth(`otp?redirect_to=${encodeURIComponent(redirect)}`, {
    email: e,
    create_user: true,
    code_challenge: challenge,
    code_challenge_method: "s256",
  });
  bb("account", "send_code", { ok: r.ok, status: r.status });
  if (r.ok) {
    stopWaiting();
    waiting = { pair, verifier, until: Date.now() + 60 * 60_000, timer: null };
    waiting.timer = setTimeout(pollPair, 2000);
    return { ok: true, text: "Check your email and tap Log In, on your phone or here. Milo signs in on his own." };
  }
  if (r.status === 429) return { ok: false, text: "Email limit hit. The free email service only sends a couple per hour. Try again later." };
  return { ok: false, text: r.data.msg || r.data.error_description || "I couldn't send the email." };
}

/** Step 2 (by hand): a 6-digit code, or the Log In link pasted in. */
export async function verifyCode(email: string, input: string): Promise<{ ok: boolean; text: string }> {
  const raw = input.trim();
  let result: { ok: boolean; text: string };
  if (/^https?:\/\//i.test(raw)) {
    let token = "";
    let type = "magiclink";
    try {
      const u = new URL(raw);
      token = u.searchParams.get("token") || u.searchParams.get("token_hash") || "";
      type = u.searchParams.get("type") || type;
    } catch {
      /* not a URL */
    }
    result = token ? await verifyHash(token, type) : { ok: false, text: "That link doesn't look right. Copy the Log In link from the email." };
  } else {
    const r = await auth("verify", { type: "email", email: email.trim().toLowerCase(), token: raw.replace(/\s/g, "") });
    result = r.ok && r.data.access_token ? (take(r.data), { ok: true, text: `Signed in as ${session!.email}.` }) : { ok: false, text: "That code didn't work. Check it, or send a new one." };
  }
  bb("account", "verify", { ok: result.ok, via: "manual" });
  return result;
}

export function signOut() {
  session = null;
  save();
}

export function account(): { signedIn: boolean; email: string } {
  load();
  return { signedIn: !!session, email: session?.email ?? "" };
}

/** A fresh access token, refreshing if it's about to expire. Null when signed out. */
export async function accessToken(): Promise<string | null> {
  load();
  if (!session) return null;
  if (session.expires_at - 60 > Date.now() / 1000) return session.access_token;
  const r = await auth("token?grant_type=refresh_token", { refresh_token: session.refresh_token });
  if (!r.ok || !r.data.access_token) {
    bb("account", "refresh_failed", { status: r.status });
    if (r.status === 400 || r.status === 401) signOut(); // refresh token revoked or expired
    return null;
  }
  take(r.data);
  return session.access_token;
}

export function userId(): string | null {
  load();
  return session?.user_id ?? null;
}

/** Call the backend function. */
export async function backend(route: string, init: { body: BodyInit; contentType?: string; signal?: AbortSignal }): Promise<Response | null> {
  const token = await accessToken();
  if (!token) return null;
  return fetch(`${SUPABASE_URL}/functions/v1/milo/${route}`, {
    method: "POST",
    signal: init.signal,
    headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON, "content-type": init.contentType ?? "application/json" },
    body: init.body,
  });
}

/** Read/write the student's own rows (row-level security keeps it to them). */
export async function rest(pathAndQuery: string, init: { method?: string; body?: unknown; prefer?: string } = {}): Promise<any> {
  const token = await accessToken();
  if (!token) return null;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: SUPABASE_ANON,
      "content-type": "application/json",
      ...(init.prefer ? { Prefer: init.prefer } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (!res.ok) {
    bb("account", "rest_error", { path: pathAndQuery.split("?")[0], status: res.status });
    return null;
  }
  const text = await res.text();
  return text ? JSON.parse(text) : true;
}
