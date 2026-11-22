// D2L, the direct way: Brightspace's own data feed, read with the student's signed-in session (the same
// session Milo's D2L sign-in panel uses). No screenshots, no AI, about a second. Read-only: nothing here
// can submit, post or change anything.
//
// Mapped from TCU's D2L (tcu.brightspace.com), but these are standard Brightspace addresses, so it works
// at any D2L school.

import { app, BrowserWindow, session } from "electron";
import { log as bb } from "./blackbox";
import { bridgeConnected, call as ext } from "./bridge";
import type { GradeSheet } from "./gradeMath";
import type { Assignment } from "./school";

const LP = "1.64"; // platform API version (falls back below if a school runs an older one)
const LE = "1.100"; // learning environment API version
const PARTITION = "persist:milo-research"; // where the student signed in to D2L inside Milo

export type Course = { id: number; name: string; short: string; code: string; subject: string };

// ---------- plumbing ----------
// D2L only answers its data feed from inside one of its own pages (a plain request gets 403), so Milo keeps
// one hidden D2L page open in his signed-in session and asks from there.
let origin: string | null = null;
let page: BrowserWindow | null = null;
let pageAt = 0;
export class SignInNeeded extends Error {}

/** The sign-in bounces through several pages (school login, then back to D2L). Wait until it has
 *  really landed on a D2L page and stopped loading. */
async function settle(w: BrowserWindow, ms = 20000): Promise<string> {
  const t0 = Date.now();
  let last = "";
  let still = 0;
  while (Date.now() - t0 < ms) {
    const url = w.webContents.getURL();
    const landed = /\/d2l\/(home|lp\/homepage|le\/)/.test(url) && !w.webContents.isLoading();
    still = url === last && !w.webContents.isLoading() ? still + 1 : 0;
    last = url;
    if (landed && still >= 2) return url;
    if (still >= 6 && !w.webContents.isLoading()) return url; // stopped somewhere else (a login page)
    await new Promise((r) => setTimeout(r, 400));
  }
  return w.webContents.getURL();
}
const feedStatus = async (w: BrowserWindow) =>
  (await w.webContents.executeJavaScript(`fetch("/d2l/api/lp/${LP}/users/whoami", { headers: { Accept: "application/json" }, credentials: "include" }).then((r) => r.status).catch(() => 0)`, true)) as number;

let opening: Promise<BrowserWindow> | null = null;
function d2lPage(portal: string): Promise<BrowserWindow> {
  if (page && !page.isDestroyed() && Date.now() - pageAt < 30 * 60e3) return Promise.resolve(page);
  if (!opening) opening = openD2lPage(portal).finally(() => (opening = null));
  return opening;
}
async function openD2lPage(portal: string): Promise<BrowserWindow> {
  if (page && !page.isDestroyed()) page.destroy();
  const start = new URL(/^https?:\/\//.test(portal) ? portal : `https://${portal}`).origin;
  page = new BrowserWindow({ show: false, width: 1000, height: 700, webPreferences: { partition: PARTITION, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  page.webContents.setAudioMuted(true);
  page.loadURL(`${start}/d2l/home`).catch(() => {});
  const url = await settle(page);
  pageAt = Date.now();
  const status = /\/d2l\//.test(url) ? await feedStatus(page) : 0;
  const title = page.webContents.getTitle().slice(0, 60);
  bb("d2l", "page", { host: new URL(url || start).host, path: new URL(url || start).pathname.slice(0, 40), title, whoami: status });
  if (status !== 200) {
    page.destroy();
    page = null;
    // a login page (or the school's sign-in) = not signed in inside Milo; anything else = D2L is having a moment
    if (status === 401 || status === 403 || !/\/d2l\/(home|lp\/homepage|le\/)/.test(url)) throw new SignInNeeded("Sign in to D2L first.");
    throw new Error(`D2L's data feed answered ${status} at ${new URL(url).host}`);
  }
  origin = new URL(url).origin;
  return page;
}

// ---------- the student's own Chrome (first choice: no Milo sign-in at all) ----------
// Milo's Chrome extension reads D2L with the sign-in the student already has in Chrome.
// Only if that's not possible (no Chrome / extension, or signed out there too) does Milo use his own sign-in.
type Via = "chrome" | "milo";
let via: Via | null = null;
let chromeOutUntil = 0; // after Chrome says "signed out", don't ask it again for a few seconds
let lastChrome: { status: number; type: string; where: string } | null = null;
/** What Chrome said last time (for the self-test and the log). */
export const lastChromeAnswer = () => lastChrome;
export const resetChromeWait = () => (chromeOutUntil = 0);
const originOf = (portal: string) => new URL(/^https?:\/\//.test(portal) ? portal : `https://${portal}`).origin;
function using(v: Via) {
  if (via !== v) bb("d2l", "source", { via: v });
  via = v;
}
export const d2lVia = () => via;
type Raw = { s: number; t: string; b: string | null; url?: string };
/** Chrome's answer, asked twice before giving up: right after Milo starts, the first answer can be a page instead of data. */
/** Chrome's extension naps (Chrome stops idle extensions) and reconnects within a few seconds: wait for it. */
async function bridgeReady(ms = 5000): Promise<boolean> {
  if (bridgeConnected()) return true;
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    await new Promise((r) => setTimeout(r, 250));
    if (bridgeConnected()) {
      bb("d2l", "chrome_reconnected", { waitedMs: Date.now() - t0 });
      return true;
    }
  }
  bb("d2l", "chrome_not_connected", {});
  return false;
}
async function chromeFetch(portal: string, path: string, binary = false, maxBytes = 12e6, text = false): Promise<Raw | null> {
  if (Date.now() < chromeOutUntil) return null; // just said "signed out": don't ask again yet
  if (!(await bridgeReady())) return null;
  const first = await chromeFetchOnce(portal, path, binary, maxBytes, text);
  if (first || !bridgeConnected()) return first;
  await new Promise((r) => setTimeout(r, 1200));
  chromeOutUntil = 0;
  const second = await chromeFetchOnce(portal, path, binary, maxBytes, text);
  if (second) bb("d2l", "chrome_retry_ok", {});
  return second;
}
async function chromeFetchOnce(portal: string, path: string, binary = false, maxBytes = 12e6, text = false): Promise<Raw | null> {
  if (!bridgeConnected() || Date.now() < chromeOutUntil) return null;
  const url = /^https?:/.test(path) ? path : `${originOf(portal)}${path}`;
  try {
    const r = await ext<Raw>("d2l_fetch", { url, binary, maxBytes, text }, binary ? 30000 : 12000);
    const signedOut = r.s === 401 || r.s === 403 || (!binary && !text && r.s === 200 && !r.t.includes("json")) || /okta|login|sso|saml|microsoftonline/i.test(r.url ?? "");
    if (signedOut) {
      chromeOutUntil = Date.now() + 15e3;
      let where = "";
      try {
        where = r.url ? new URL(r.url).host + new URL(r.url).pathname.slice(0, 30) : "";
      } catch {
        /* ignore */
      }
      lastChrome = { status: r.s, type: r.t.slice(0, 40), where };
      bb("d2l", "chrome_signed_out", lastChrome);
      return null;
    }
    lastChrome = { status: r.s, type: r.t.slice(0, 40), where: "" };
    return r;
  } catch (e) {
    lastChrome = { status: -1, type: "", where: (e as Error).message.slice(0, 80) };
    bb("d2l", "chrome_failed", { error: lastChrome.where }); // an old extension without d2l_fetch, or Chrome busy
    return null;
  }
}
/** Signed in somewhere Milo can use? Chrome first, then Milo's own. */
export async function signedInVia(portal: string): Promise<Via | null> {
  const c = await chromeFetch(portal, `/d2l/api/lp/${LP}/users/whoami`);
  if (c && c.s === 200) {
    using("chrome");
    return "chrome";
  }
  try {
    await d2lPage(portal);
    using("milo");
    return "milo";
  } catch {
    return null;
  }
}

async function api<T>(portal: string, path: string): Promise<T> {
  const c = await chromeFetch(portal, path);
  if (c) {
    if (c.s === 200 && c.b) {
      using("chrome");
      return JSON.parse(c.b) as T;
    }
    if (c.s === 404 || c.s >= 500) throw new Error(`D2L said ${c.s} for ${path}`);
  }
  const w = await d2lPage(portal).catch((e) => {
    if (e instanceof SignInNeeded) bb("d2l", "signin_needed", { chrome: bridgeConnected() });
    throw e;
  });
  using("milo");
  const r = (await w.webContents.executeJavaScript(
    `fetch(${JSON.stringify(path)}, { headers: { Accept: "application/json" }, credentials: "include" }).then(async (r) => ({ s: r.status, t: r.headers.get("content-type") || "", b: await r.text() }))`,
    true
  )) as { s: number; t: string; b: string };
  if (r.s !== 200 || !r.t.includes("json")) bb("d2l", "api_miss", { path: path.split("?")[0], status: r.s, type: r.t.slice(0, 40) });
  if (r.s === 401 || r.s === 403 || !r.t.includes("json")) {
    pageAt = 0; // session may have expired: reopen (and re-check sign-in) next time
    throw new SignInNeeded("Sign in to D2L first.");
  }
  if (r.s !== 200) throw new Error(`D2L said ${r.s} for ${path}`);
  return JSON.parse(r.b) as T;
}

// ---------- calendar link (the backup that never signs out) ----------
/** D2L's personal calendar feed link (".../feed.ics?token=..."), read from its "Subscribe" page while signed in.
 *  Saved by the app so "what's due" keeps working even when every sign-in has run out. Null if the school turned it off. */
/** The D2L page where the student presses Reset once to make their calendar link. */
export async function subscribePageUrl(portal: string): Promise<string> {
  const org = await api<{ Identifier: string }>(portal, `/d2l/api/lp/${LP}/organization/info`);
  return `${originOf(portal)}/d2l/le/calendar/${org.Identifier}/subscribe/subscribeDialogLaunch?subscriptionOptionId=-1`;
}
export async function calendarFeedUrl(portal: string): Promise<string | null> {
  const org = await api<{ Identifier: string }>(portal, `/d2l/api/lp/${LP}/organization/info`);
  const path = `/d2l/le/calendar/${org.Identifier}/subscribe/subscribeDialogLaunch?subscriptionOptionId=-1`;
  let html: string | null = null;
  const c = await chromeFetch(portal, path, false, 12e6, true);
  if (c && c.s === 200) html = c.b;
  else {
    const w = await d2lPage(portal);
    html = (await w.webContents.executeJavaScript(`fetch(${JSON.stringify(path)}, { credentials: "include" }).then((r) => (r.ok ? r.text() : null)).catch(() => null)`, true)) as string | null;
  }
  const url = findFeedUrl(html ?? "", originOf(portal));
  bb("d2l", "feed_link", { found: !!url });
  return url;
}
/** The feed link inside the Subscribe page, plain or JSON-escaped; only with a real token. (pure) */
export function findFeedUrl(html: string, origin: string): string | null {
  const t = html.replace(/\\\//g, "/");
  const m = t.match(/(https:\/\/[^"'\s<>]+)?(\/d2l\/le\/calendar\/feed\/user\/feed\.ics\?token=[A-Za-z0-9%_\-]{8,})/);
  if (!m) return null;
  return `${m[1] ? m[1].replace(/\/d2l.*$/, "") : origin}${m[2]}`;
}

// ---------- names ----------
/** "Statistical Analysis 035/045/065 (Weltman)" -> "Statistical Analysis"; the lab section -> "... Lab". */
export function shortName(name: string, code = ""): string {
  let s = name.replace(/\s*\([^)]*\)\s*$/, "").trim();
  if (/\s[A-Z]\s+\d{1,2}-\d{1,2}$/.test(s) || /\bLAB\b/i.test(s) || / 1\d\d$/.test(code)) s = s.replace(/\s[A-Z]\s+\d{1,2}-\d{1,2}$/, "").replace(/\s+LAB\b.*$/i, "").trim() + " Lab";
  return s.replace(/\s+\d{3}(\/\d{3})*$/, "").replace(/\s+Lab Lab$/, " Lab").trim();
}
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
/** "stats" -> Statistical Analysis, "geology" -> Understanding the Earth (GEOL), "OB" -> Organizational Behavior... */
export function matchCourse(said: string, courses: Course[]): Course | null {
  const n = norm(said).replace(/\b(class|course|lab)\b/g, "").trim();
  if (!n) return null;
  const wantLab = /\blab\b/i.test(said);
  const score = (c: Course) => {
    const name = norm(c.short);
    let s = 0;
    if (name === n) s += 100;
    if (name.includes(n)) s += 50;
    if (norm(c.subject) === n || norm(c.code).includes(n)) s += 40;
    const words = n.split(" ");
    if (words.every((w) => name.split(" ").some((x) => x.startsWith(w.slice(0, Math.max(3, Math.min(4, w.length))))))) s += 30;
    if (words.some((w) => w.length >= 4 && c.subject.toLowerCase().startsWith(w.slice(0, 4)))) s += 30; // "english" -> ENGL, "management" -> MANA
    else if (words.some((w) => w.length >= 4 && name.includes(w.slice(0, 4)))) s += 10;
    const initials = name.split(" ").filter((w) => !["and", "of", "the", "to", "in"].includes(w)).map((w) => w[0]).join("");
    const ini = n.replace(/ /g, "");
    if (ini.length >= 2 && ini.length <= 4 && (initials === ini || initials.startsWith(ini))) s += 35; // "OB" -> Organizational Behavior (and Strategy)
    if (/ lab$/i.test(c.short) !== wantLab) s -= 5;
    return s;
  };
  const best = courses.map((c) => ({ c, s: score(c) })).sort((a, b) => b.s - a.s)[0];
  return best && best.s >= 25 ? best.c : null;
}

// ---------- courses ----------
let courseCache: { at: number; list: Course[] } | null = null;
export async function courses(portal: string): Promise<Course[]> {
  if (courseCache && Date.now() - courseCache.at < 6 * 3600e3) return courseCache.list;
  type E = { Items: { OrgUnit: { Id: number; Name: string; Code: string }; Access?: { CanAccess?: boolean; EndDate?: string | null } }[]; PagingInfo?: { HasMoreItems: boolean; Bookmark: string } };
  const all: E["Items"] = [];
  let bookmark = "";
  for (let i = 0; i < 5; i++) {
    const e = await api<E>(portal, `/d2l/api/lp/${LP}/enrollments/myenrollments/?orgUnitTypeId=3${bookmark ? `&bookmark=${encodeURIComponent(bookmark)}` : ""}`);
    all.push(...e.Items);
    if (!e.PagingInfo?.HasMoreItems) break;
    bookmark = e.PagingInfo.Bookmark;
  }
  const now = Date.now();
  const list = all
    .filter((i) => i.Access?.CanAccess && i.Access?.EndDate && Date.parse(i.Access.EndDate) > now) // this term's real classes (not the tutorial)
    .map((i) => {
      const code = i.OrgUnit.Code ?? "";
      const subject = (code.match(/\b([A-Z]{3,5})\d{4,5}\b/) ?? [])[1] ?? "";
      return { id: i.OrgUnit.Id, name: i.OrgUnit.Name, short: shortName(i.OrgUnit.Name, code), code, subject };
    });
  courseCache = { at: Date.now(), list };
  bb("d2l", "courses", { n: list.length });
  return list;
}

// ---------- due dates ----------
const pad = (n: number) => String(n).padStart(2, "0");
const localIso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const human = (d: Date) => d.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const kindOf = (t: string) => (/\b(final exam|midterm|exam|test)\b/i.test(t) ? "exam" : /\bquiz/i.test(t) ? "quiz" : /\b(discussion|post|reply)\b/i.test(t) ? "discussion" : "assignment");

/** Everything due across all classes, from D2L's calendar (yesterday through `days` ahead). */
export async function dueSoon(portal: string, days = 60): Promise<Assignment[]> {
  const cs = await courses(portal);
  if (!cs.length) return [];
  type Ev = { Title: string; OrgUnitId: number; EndDateTime: string; EventType: number; CalendarEventViewUrl?: string };
  const from = new Date(Date.now() - 86400e3).toISOString();
  const to = new Date(Date.now() + days * 86400e3).toISOString();
  const r = await api<{ Objects: Ev[] }>(portal, `/d2l/api/le/${LE}/calendar/events/myEvents/?orgUnitIdsCSV=${cs.map((c) => c.id).join(",")}&startDateTime=${from}&endDateTime=${to}`);
  const byId = new Map(cs.map((c) => [c.id, c]));
  const out = new Map<string, Assignment>();
  for (const e of r.Objects ?? []) {
    if (e.EventType !== 6 && !/\bdue\b/i.test(e.Title)) continue; // 6 = a due date (3 = when it closes)
    const d = new Date(e.EndDateTime);
    const c = byId.get(e.OrgUnitId);
    const title = e.Title.replace(/\s*[-–]\s*due$/i, "").trim();
    const a: Assignment = { title, course: c?.short ?? "", due: human(d), due_iso: localIso(d), kind: kindOf(title), url: e.CalendarEventViewUrl, source: "feed" };
    out.set(`${a.course}|${title}`.toLowerCase(), a);
  }
  return [...out.values()].sort((a, b) => (a.due_iso ?? "").localeCompare(b.due_iso ?? ""));
}

// ---------- grades ----------
type GObj = { Id: number; Name: string; GradeType: string; Weight: number; MaxPoints: number; CategoryId: number };
type GCat = { Id: number; Name: string; Weight: number };
type GVal = { GradeObjectIdentifier: string; GradeObjectName: string; PointsNumerator: number | null; PointsDenominator: number | null; DisplayedGrade: string };

/** A class's grades as a grade sheet: weights and scores exactly as D2L has them. Null if nothing's posted. */
export async function gradeSheet(portal: string, c: Course, exam = "final"): Promise<{ sheet: GradeSheet; examItem: string | null } | null> {
  const L = `/d2l/api/le/${LE}/${c.id}`;
  const [objs, cats, vals, fin] = await Promise.all([
    api<GObj[]>(portal, `${L}/grades/`).catch(() => [] as GObj[]),
    api<GCat[]>(portal, `${L}/grades/categories/`).catch(() => [] as GCat[]),
    api<GVal[]>(portal, `${L}/grades/values/myGradeValues/`).catch(() => [] as GVal[]),
    api<{ DisplayedGrade?: string }>(portal, `${L}/grades/final/values/myGradeValue`).catch(() => null),
  ]);
  if (!objs.length) return null;
  const valOf = new Map(vals.map((v) => [String(v.GradeObjectIdentifier), v]));
  const pctOf = (o: GObj) => {
    const v = valOf.get(String(o.Id));
    return v && v.PointsNumerator != null && v.PointsDenominator ? (100 * v.PointsNumerator) / v.PointsDenominator : null;
  };
  const current = fin?.DisplayedGrade ? parseFloat(fin.DisplayedGrade) : null;
  const weightedCats = cats.filter((k) => k.Weight > 0);
  let parts: { name: string; weight: number; percent: number | null }[];
  if (weightedCats.length) {
    parts = weightedCats.map((k) => {
      const items = objs.filter((o) => o.CategoryId === k.Id);
      const got = items.map((o) => ({ p: pctOf(o), max: o.MaxPoints || 1 })).filter((x) => x.p != null);
      const pts = got.reduce((n, x) => n + x.max, 0);
      return { name: k.Name, weight: k.Weight, percent: got.length ? got.reduce((n, x) => n + x.p! * x.max, 0) / pts : null };
    });
  } else {
    parts = objs.filter((o) => o.Weight > 0).map((o) => ({ name: o.Name, weight: o.Weight, percent: pctOf(o) }));
  }
  if (!parts.length) return null;
  // the exam they asked about: by name ("final", "exam 4"), else the one big ungraded item left
  const want = norm(exam);
  let examPart = parts.find((p) => norm(p.name) === want) ?? parts.find((p) => norm(p.name).includes(want) && p.percent == null) ?? null;
  if (!examPart && /final/.test(want)) {
    const open = parts.filter((p) => p.percent == null);
    if (open.length === 1) examPart = open[0];
  }
  const sheet: GradeSheet = {
    course: c.short,
    categories: parts.map((p) => ({ name: p.name, weight: p.weight, percent: p.percent })),
    final: examPart ? { name: examPart.name, weight: examPart.weight, possible: null } : null,
    current_percent: current != null && isFinite(current) ? current : null,
  };
  bb("d2l", "grades", { course: c.short, parts: parts.length, graded: parts.filter((p) => p.percent != null).length, exam: examPart?.name ?? null });
  return { sheet, examItem: examPart?.name ?? null };
}

// ---------- pages Milo can jump straight to ----------
export function links(origin_: string, ou: number) {
  const o = origin ?? origin_;
  return {
    home: `${o}/d2l/home/${ou}`,
    content: `${o}/d2l/le/content/${ou}/Home`,
    assignments: `${o}/d2l/lms/dropbox/user/folders_list.d2l?ou=${ou}&isprv=0`,
    grades: `${o}/d2l/lms/grades/my_grades/main.d2l?ou=${ou}`,
    quizzes: `${o}/d2l/lms/quizzing/user/quizzes_list.d2l?ou=${ou}`,
    discussions: `${o}/d2l/le/${ou}/discussions/List`,
    announcements: `${o}/d2l/lms/news/main.d2l?ou=${ou}`,
    calendar: `${o}/d2l/le/calendar/${ou}`,
  };
}

/** Is Milo signed in to D2L right now? (startup check + self-test) */
export async function d2lCheck(portal: string): Promise<{ ok: boolean; signin: boolean; text: string; via?: Via; chrome: boolean }> {
  const c = await chromeFetch(portal, `/d2l/api/lp/${LP}/users/whoami`);
  const chrome = bridgeConnected(); // after asking: the extension may have just woken up
  if (c && c.s === 200) {
    using("chrome");
    return { ok: true, signin: false, text: "", via: "chrome", chrome };
  }
  try {
    await d2lPage(portal);
    using("milo");
    return { ok: true, signin: false, text: "", via: "milo", chrome };
  } catch (e) {
    if (e instanceof SignInNeeded) bb("d2l", "signin_needed", { chrome });
    return { ok: false, signin: e instanceof SignInNeeded, text: (e as Error).message, chrome };
  }
}

/** Stay signed in: D2L and the school's login (Okta, Microsoft) use "session" cookies that vanish when Milo
 *  quits, so students had to sign in after every restart. Keep them for 14 days, like "keep me signed in",
 *  only in Milo's own storage on this Mac. */
export function keepSignedIn() {
  const ses = session.fromPartition(PARTITION);
  const SCHOOL = /brightspace|d2l|desire2learn|okta|microsoftonline|login\.live|duosecurity/i;
  ses.cookies.on("changed", (_e, c, _cause, removed) => {
    if (removed || !c.session || !SCHOOL.test(c.domain ?? "")) return;
    const host = (c.domain ?? "").replace(/^\./, "");
    ses.cookies
      .set({
        url: `${c.secure ? "https" : "http"}://${host}${c.path ?? "/"}`,
        name: c.name,
        value: c.value,
        ...(c.hostOnly ? {} : { domain: c.domain }),
        path: c.path,
        secure: c.secure,
        httpOnly: c.httpOnly,
        sameSite: c.sameSite,
        expirationDate: Math.floor(Date.now() / 1000) + 14 * 86400,
      })
      .catch(() => {});
  });
  // write them to disk now and then (and the moment Milo quits)
  setInterval(() => void ses.cookies.flushStore().catch(() => {}), 60e3);
  app.on("before-quit", () => void ses.cookies.flushStore().catch(() => {}));
}

// ---------- course files (syllabus) ----------
type Topic = { Title: string; Url: string; TypeIdentifier: string };
type Mod = { Title: string; Topics?: Topic[]; Modules?: Mod[] };
/** Every file/page in a course's Content, with where it sits ("Administrative > Syllabus"). */
export async function contentTopics(portal: string, c: Course): Promise<(Topic & { path: string })[]> {
  const toc = await api<{ Modules: Mod[] }>(portal, `/d2l/api/le/${LE}/${c.id}/content/toc`);
  const out: (Topic & { path: string })[] = [];
  const walk = (mods: Mod[] = [], p = "") => {
    for (const m of mods) {
      for (const t of m.Topics ?? []) out.push({ ...t, path: p + m.Title });
      walk(m.Modules, `${p}${m.Title} > `);
    }
  };
  walk(toc.Modules);
  return out;
}
/** Download a course file through the signed-in D2L page. Base64, or null if too big / not there. */
export async function fileBase64(portal: string, url: string, maxBytes = 12e6): Promise<string | null> {
  const c = await chromeFetch(portal, url, true, maxBytes);
  if (c) return c.s === 200 ? c.b : null;
  const w = await d2lPage(portal);
  const b64 = (await w.webContents.executeJavaScript(
    `fetch(${JSON.stringify(url)}, { credentials: "include" }).then(async (r) => {
      if (!r.ok) return null;
      const u = new Uint8Array(await r.arrayBuffer());
      if (u.length > ${maxBytes}) return null;
      let s = "";
      for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
      return btoa(s);
    }).catch(() => null)`,
    true
  )) as string | null;
  return b64;
}
