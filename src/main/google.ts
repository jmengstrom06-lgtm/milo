// Google, the direct way: Gmail, Calendar, Docs and Drive through Google's own APIs (no clicking around in
// a browser: about a second, nearly free). The student signs in with Google once, in their own browser.
// Sending an email or adding an event always waits for the student's yes (the renderer asks).
//
// Setup (once, by the developer): a Google Cloud project with an OAuth client of type "Desktop app".
// Put its ID and secret in .env as MILO_GOOGLE_CLIENT_ID / MILO_GOOGLE_CLIENT_SECRET.
// (A desktop app's "secret" isn't really secret: Google's own docs say so. The sign-in uses PKCE.)

import { app, safeStorage, shell } from "electron";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { log as bb } from "./blackbox";
import { googleBackend } from "./account";

// Pilot scopes: Calendar + Docs only. Gmail and all-of-Drive are "restricted" at Google (a paid security audit to
// get approved), so they're only asked for in developer copies (MILO_GOOGLE_FULL=1).
const BASE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.events", // see and add calendar events
  "https://www.googleapis.com/auth/documents", // make and edit Google Docs
];
const FULL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly", // read email (search, unread)
  "https://www.googleapis.com/auth/gmail.compose", // write drafts, send (only after the student says yes)
  "https://www.googleapis.com/auth/drive.readonly", // find files in Drive
];
const SCOPES = () => (process.env.MILO_GOOGLE_FULL === "1" ? [...BASE_SCOPES, ...FULL_SCOPES] : BASE_SCOPES);

type Tokens = { access: string; refresh: string; expires: number; email?: string; scope?: string };
const file = () => path.join(app.getPath("userData"), "google.bin");
let cached: Tokens | null = null;

// Two ways to sign in: a developer's own keys (.env), or Milo's server (every installed copy). The server holds the
// client secret; the app only ever gets the public client ID.
const localId = () => process.env.MILO_GOOGLE_CLIENT_ID ?? "";
const localSecret = () => process.env.MILO_GOOGLE_CLIENT_SECRET ?? "";
const local = () => !!localId() && !!localSecret();
let serverId = "";
/** Ask Milo's server if Google sign-in is set up (cached). Call at startup and before signing in. */
export async function refreshGoogleConfig(): Promise<boolean> {
  if (local()) return true;
  const r = await googleBackend("config").catch(() => null);
  serverId = r && r.status === 200 && r.data?.configured && typeof r.data.clientId === "string" ? r.data.clientId : "";
  return !!serverId;
}
const clientId = () => (local() ? localId() : serverId);
export const googleReady = () => !!clientId();
/** Trade a code / refresh token for tokens: directly with a developer's keys, otherwise through Milo's server. */
async function tokenCall(params: Record<string, string>): Promise<{ access_token?: string; refresh_token?: string; expires_in?: number; id_token?: string; scope?: string; error?: string }> {
  if (local()) {
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: localId(), client_secret: localSecret(), ...params }),
    });
    return (await r.json()) as never;
  }
  const route = params.grant_type === "refresh_token" ? "refresh" : "token";
  const r = await googleBackend(route, route === "refresh" ? { refresh_token: params.refresh_token } : { code: params.code, code_verifier: params.code_verifier, redirect_uri: params.redirect_uri });
  if (!r) return { error: "Sign in to Milo first (Home base, Settings, Account)." };
  return r.data ?? { error: "server_error" };
}
/** Did this sign-in include Gmail? (Pilot sign-ins don't: email opens in Gmail for the student to send.) */
export const hasGmail = () => /gmail/.test(load()?.scope ?? (process.env.MILO_GOOGLE_FULL === "1" ? "gmail" : ""));

function load(): Tokens | null {
  if (cached) return cached;
  try {
    const raw = fs.readFileSync(file());
    cached = JSON.parse(safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(raw) : raw.toString("utf8"));
  } catch {
    cached = null;
  }
  return cached;
}
function store(t: Tokens | null) {
  cached = t;
  try {
    if (!t) return fs.rmSync(file(), { force: true });
    const json = JSON.stringify(t);
    fs.writeFileSync(file(), safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(json) : Buffer.from(json)); // encrypted with the Mac's keychain
  } catch (e) {
    bb("google", "store_failed", { error: (e as Error).message });
  }
}
export const googleStatus = () => {
  const t = load();
  // "connected" only when Milo can really use it: a sign-in AND the app's Google keys (or the sign-in can't refresh)
  return { ready: googleReady(), connected: googleReady() && !!t?.refresh, email: t?.email ?? null };
};
export const googleDisconnect = () => store(null);

// ---------- sign in (in the student's own browser, back to Milo on this Mac) ----------
let signingIn: Promise<{ ok: boolean; text: string }> | null = null;
export function googleConnect(): Promise<{ ok: boolean; text: string }> {
  if (signingIn) return signingIn;
  signingIn = new Promise<{ ok: boolean; text: string }>(async (resolve) => {
    if (!googleReady() && !(await refreshGoogleConfig())) return resolve({ ok: false, text: "Google sign-in isn't set up on Milo's server yet. (Make sure you're signed in to Milo first.)" });
    const verifier = crypto.randomBytes(48).toString("base64url");
    const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
    const state = crypto.randomBytes(16).toString("hex");
    const srv = http.createServer(async (req, res) => {
      const u = new URL(req.url ?? "/", "http://127.0.0.1");
      if (u.pathname !== "/google") return void res.writeHead(404).end();
      const done = (ok: boolean, text: string) => {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(`<!doctype html><meta charset="utf-8"><title>Milo</title><body style="font:18px -apple-system,sans-serif;text-align:center;padding:80px"><h2>${ok ? "You're connected" : "That didn't work"}</h2><p>${text}</p><p>You can close this tab.</p></body>`);
        srv.close();
        clearTimeout(timer);
        resolve({ ok, text });
      };
      if (u.searchParams.get("state") !== state) return done(false, "Something didn't match. Try again from Milo.");
      const code = u.searchParams.get("code");
      if (!code) return done(false, u.searchParams.get("error") === "access_denied" ? "No problem, nothing was connected." : "Google didn't send a code.");
      try {
        const port = (srv.address() as { port: number }).port;
        const t = await tokenCall({ code, redirect_uri: `http://127.0.0.1:${port}/google`, grant_type: "authorization_code", code_verifier: verifier });
        if (!t.access_token || !t.refresh_token) return done(false, t.error ?? "Google didn't give Milo access.");
        const email = t.id_token ? (JSON.parse(Buffer.from(t.id_token.split(".")[1], "base64url").toString()) as { email?: string }).email : undefined;
        store({ access: t.access_token, refresh: t.refresh_token, expires: Date.now() + (t.expires_in ?? 3000) * 1000, email, scope: t.scope });
        bb("google", "connected", {});
        done(true, `Milo can now use your Google account${email ? ` (${email})` : ""}.`);
      } catch (e) {
        done(false, (e as Error).message);
      }
    });
    const timer = setTimeout(() => {
      srv.close();
      resolve({ ok: false, text: "The Google sign-in timed out. Say connect Google to try again." });
    }, 5 * 60e3);
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as { port: number }).port;
      const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      url.search = new URLSearchParams({
        client_id: clientId(),
        redirect_uri: `http://127.0.0.1:${port}/google`,
        response_type: "code",
        scope: SCOPES().join(" "),
        access_type: "offline",
        prompt: "consent",
        code_challenge: challenge,
        code_challenge_method: "S256",
        state,
      }).toString();
      void shell.openExternal(url.toString());
    });
  }).finally(() => (signingIn = null));
  return signingIn;
}

// ---------- calling Google ----------
export class GoogleNotConnected extends Error {}
async function token(): Promise<string> {
  const t = load();
  if (!t?.refresh) throw new GoogleNotConnected("Connect Google first.");
  if (Date.now() < t.expires - 60e3) return t.access;
  if (!googleReady()) await refreshGoogleConfig();
  const j = await tokenCall({ refresh_token: t.refresh, grant_type: "refresh_token" });
  if (!j.access_token) {
    if (j.error === "invalid_grant") store(null); // they removed Milo's access in their Google account
    throw new GoogleNotConnected("Connect Google again.");
  }
  store({ ...t, access: j.access_token, expires: Date.now() + (j.expires_in ?? 3000) * 1000 });
  return j.access_token;
}
async function g<T>(url: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(url, { ...init, headers: { authorization: `Bearer ${await token()}`, "content-type": "application/json", ...(init.headers ?? {}) } });
  if (r.status === 401) throw new GoogleNotConnected("Connect Google again.");
  if (!r.ok) throw new Error(`Google said ${r.status}: ${(await r.text()).slice(0, 160)}`);
  return (r.status === 204 ? {} : await r.json()) as T;
}

// ---------- Calendar ----------
export type Ev = { title: string; start: string; end: string; allDay: boolean; where?: string };
export async function calendarUpcoming(days = 7): Promise<Ev[]> {
  const from = new Date();
  const to = new Date(Date.now() + days * 86400e3);
  type R = { items?: { summary?: string; location?: string; start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string } }[] };
  const r = await g<R>(`https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${from.toISOString()}&timeMax=${to.toISOString()}&singleEvents=true&orderBy=startTime&maxResults=25`);
  return (r.items ?? []).map((e) => ({ title: e.summary ?? "(no title)", start: e.start?.dateTime ?? e.start?.date ?? "", end: e.end?.dateTime ?? e.end?.date ?? "", allDay: !e.start?.dateTime, where: e.location }));
}
/** Busy time for the week planner: timed events only (all-day ones don't block hours), as epoch ms. */
export async function calendarBusy(days = 8): Promise<{ title: string; start: number; end: number }[]> {
  const from = new Date();
  const to = new Date(Date.now() + days * 86400e3);
  type R = { items?: { summary?: string; transparency?: string; start?: { dateTime?: string }; end?: { dateTime?: string } }[] };
  const r = await g<R>(`https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${from.toISOString()}&timeMax=${to.toISOString()}&singleEvents=true&orderBy=startTime&maxResults=250`);
  return (r.items ?? [])
    .filter((e) => e.start?.dateTime && e.end?.dateTime && e.transparency !== "transparent")
    .map((e) => ({ title: e.summary ?? "", start: Date.parse(e.start!.dateTime!), end: Date.parse(e.end!.dateTime!) }))
    .filter((e) => e.end > e.start);
}
/** What's on the calendar right now (started up to 20 min from now, or already going). */
export async function calendarNow(): Promise<Ev[]> {
  const from = new Date(Date.now() - 4 * 3600e3);
  const to = new Date(Date.now() + 20 * 60e3);
  type R = { items?: { summary?: string; location?: string; start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string } }[] };
  const r = await g<R>(`https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${from.toISOString()}&timeMax=${to.toISOString()}&singleEvents=true&orderBy=startTime&maxResults=20`);
  const now = Date.now();
  return (r.items ?? [])
    .filter((e) => e.start?.dateTime && e.end?.dateTime && Date.parse(e.end.dateTime) > now - 10 * 60e3 && Date.parse(e.start.dateTime) < now + 20 * 60e3)
    .map((e) => ({ title: e.summary ?? "", start: e.start!.dateTime!, end: e.end!.dateTime!, allDay: false, where: e.location }));
}
/** Add an event (the renderer asks the student first). `start`/`end` are local "2026-11-24T15:00" or a date "2026-11-24". */
export async function calendarAdd(ev: { title: string; start: string; end?: string; where?: string }) {
  const allDay = /^\d{4}-\d{2}-\d{2}$/.test(ev.start);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const endOf = () => {
    if (ev.end) return ev.end;
    if (allDay) return ev.start;
    const d = new Date(ev.start);
    d.setHours(d.getHours() + 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };
  const when = (v: string) => (allDay ? { date: v } : { dateTime: v.length === 16 ? `${v}:00` : v, timeZone: tz });
  const r = await g<{ id?: string; htmlLink?: string }>("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
    method: "POST",
    body: JSON.stringify({ summary: ev.title, location: ev.where, start: when(ev.start), end: when(endOf()) }),
  });
  bb("google", "event_added", {});
  return { id: r.id ?? "", link: r.htmlLink ?? "" };
}
/** Take an event back out (Undo in "What Milo did"). Already gone counts as done. */
export async function calendarDelete(id: string) {
  if (!id) throw new Error("I don't know which event that was.");
  try {
    await g(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(id)}`, { method: "DELETE" });
  } catch (e) {
    if (!/said (404|410)/.test((e as Error).message)) throw e;
  }
  bb("google", "event_removed", {});
}

// ---------- Gmail ----------
export type Mail = { id: string; from: string; email: string; subject: string; snippet: string; date: string };
export async function gmailSearch(q: string, max = 8): Promise<Mail[]> {
  const list = await g<{ messages?: { id: string }[] }>(`https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${max}&q=${encodeURIComponent(q)}`);
  const ids = (list.messages ?? []).map((m) => m.id);
  type M = { id: string; snippet?: string; payload?: { headers?: { name: string; value: string }[] } };
  const msgs = await Promise.all(ids.map((id) => g<M>(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`)));
  return msgs.map((m) => {
    const h = (n: string) => m.payload?.headers?.find((x) => x.name.toLowerCase() === n.toLowerCase())?.value ?? "";
    return { id: m.id, from: h("From").replace(/\s*<.*>$/, "").replace(/"/g, ""), email: (h("From").match(/[\w.+-]+@[\w-]+\.[\w.]+/) ?? [])[0] ?? "", subject: h("Subject"), snippet: (m.snippet ?? "").slice(0, 160), date: h("Date") };
  });
}
export const gmailUnread = (max = 8) => gmailSearch("is:unread in:inbox", max);

/** From "Name <a@b.com>, Other <c@d.com>" headers, the address that belongs to `name` (pure). */
export function pickAddress(headers: string[], name: string): string {
  const words = name.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter((w) => w.length > 1);
  if (!words.length) return "";
  let best = "", bestScore = 0;
  for (const h of headers)
    for (const part of h.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)) {
      const addr = (part.match(/[\w.+-]+@[\w-]+\.[\w.]+/) ?? [])[0];
      if (!addr) continue;
      const hay = `${part.replace(/<.*>/, "")} ${addr.split("@")[0].replace(/[._-]/g, " ")}`.toLowerCase();
      const score = words.filter((w) => hay.includes(w)).length;
      if (score > bestScore) [best, bestScore] = [addr.toLowerCase(), score];
    }
  // a last name alone is enough; a first name alone only if it's the only word they said
  return bestScore >= Math.min(2, words.length) || (bestScore >= 1 && words.length >= 2 && best.includes(words[words.length - 1])) ? best : "";
}
/** Someone's email address: from mail they sent you, you sent them, or they were cc'd on. */
export async function findAddress(name: string): Promise<string> {
  const q = name.replace(/["()]/g, "").trim();
  const list = await g<{ messages?: { id: string }[] }>(`https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=8&q=${encodeURIComponent(`from:(${q}) OR to:(${q}) OR cc:(${q})`)}`);
  type M = { payload?: { headers?: { name: string; value: string }[] } };
  const msgs = await Promise.all((list.messages ?? []).map((m) => g<M>(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc`)));
  const headers = msgs.flatMap((m) => (m.payload?.headers ?? []).map((h) => h.value));
  return pickAddress(headers, q);
}

const b64url = (s: string) => Buffer.from(s, "utf8").toString("base64url");
/** Make a draft (never sends). */
export async function gmailDraft(m: { to: string; subject: string; body: string }) {
  const raw = b64url([`To: ${m.to}`, `Subject: ${m.subject}`, "Content-Type: text/plain; charset=UTF-8", "", m.body].join("\r\n"));
  const r = await g<{ id: string; message?: { id: string } }>("https://gmail.googleapis.com/gmail/v1/users/me/drafts", { method: "POST", body: JSON.stringify({ message: { raw } }) });
  bb("google", "draft_made", {});
  return { draftId: r.id, link: `https://mail.google.com/mail/u/0/#drafts?compose=${r.message?.id ?? ""}` };
}
/** Throw a draft away (Undo). Already gone counts as done. */
export async function gmailDeleteDraft(draftId: string) {
  try {
    await g(`https://gmail.googleapis.com/gmail/v1/users/me/drafts/${encodeURIComponent(draftId)}`, { method: "DELETE" });
  } catch (e) {
    if (!/said 404/.test((e as Error).message)) throw e;
  }
  bb("google", "draft_removed", {});
}
/** Send a draft. Only ever called after the student says yes. */
export async function gmailSendDraft(draftId: string) {
  await g("https://gmail.googleapis.com/gmail/v1/users/me/drafts/send", { method: "POST", body: JSON.stringify({ id: draftId }) });
  bb("google", "draft_sent", {});
  return { ok: true };
}

// ---------- Docs + Drive ----------
export async function docsCreate(title: string, text = "") {
  const d = await g<{ documentId: string }>("https://docs.googleapis.com/v1/documents", { method: "POST", body: JSON.stringify({ title }) });
  if (text) await g(`https://docs.googleapis.com/v1/documents/${d.documentId}:batchUpdate`, { method: "POST", body: JSON.stringify({ requests: [{ insertText: { location: { index: 1 }, text } }] }) });
  bb("google", "doc_made", { chars: text.length });
  return { id: d.documentId, url: `https://docs.google.com/document/d/${d.documentId}/edit` };
}
/** An empty Google Doc (the paper writer fills it in live, so the student watches it appear). */
export async function docsNew(title: string) {
  const d = await g<{ documentId: string }>("https://docs.googleapis.com/v1/documents", { method: "POST", body: JSON.stringify({ title }) });
  bb("google", "doc_made", { chars: 0 });
  return { id: d.documentId, url: `https://docs.google.com/document/d/${d.documentId}/edit` };
}
/** A doc's plain text (the self-test reads back what the paper writer wrote). */
export async function docsText(id: string): Promise<string> {
  type El = { paragraph?: { elements?: { textRun?: { content?: string } }[] } };
  const d = await g<{ body?: { content?: El[] } }>(`https://docs.googleapis.com/v1/documents/${id}`);
  return (d.body?.content ?? []).map((e) => (e.paragraph?.elements ?? []).map((x) => x.textRun?.content ?? "").join("")).join("");
}
/** A whole doc: title, body structure (for exact in-place edits) and revision. */
export async function docsFull(id: string): Promise<{ title: string; content: import("./docEdit").DocEl[]; revisionId?: string }> {
  type L = Record<string, { listProperties?: { nestingLevels?: { glyphType?: string; glyphSymbol?: string }[] } }>;
  const d = await g<{ title?: string; revisionId?: string; body?: { content?: import("./docEdit").DocEl[] }; lists?: L }>(`https://docs.googleapis.com/v1/documents/${id}`);
  const content = d.body?.content ?? [];
  // is each list paragraph a bullet or a number? (Docs keeps that on the list, not the paragraph)
  for (const el of content) {
    const b = el.paragraph?.bullet;
    if (!b?.listId) continue;
    const lvl = d.lists?.[b.listId]?.listProperties?.nestingLevels?.[b.nestingLevel ?? 0];
    b.kind = lvl?.glyphType && lvl.glyphType !== "GLYPH_TYPE_UNSPECIFIED" && lvl.glyphType !== "NONE" ? "numbered" : "bullet";
  }
  return { title: d.title ?? "", content, revisionId: d.revisionId };
}
/** Apply Docs edits (insert text, styles) in one go. */
export async function docsBatch(id: string, requests: unknown[]) {
  if (!requests.length) return;
  await g(`https://docs.googleapis.com/v1/documents/${id}:batchUpdate`, { method: "POST", body: JSON.stringify({ requests }) });
}
export async function driveSearch(words: string, max = 8) {
  const q = `name contains '${words.replace(/['\\]/g, " ")}' and trashed = false`;
  const r = await g<{ files?: { id: string; name: string; webViewLink?: string; mimeType: string; modifiedTime: string }[] }>(
    `https://www.googleapis.com/drive/v3/files?pageSize=${max}&orderBy=modifiedTime desc&fields=files(id,name,webViewLink,mimeType,modifiedTime)&q=${encodeURIComponent(q)}`
  );
  return r.files ?? [];
}
