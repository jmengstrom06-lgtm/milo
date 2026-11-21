// D2L, the direct way: Brightspace's own data feed, read with the student's signed-in session (the same
// session Milo's D2L sign-in panel uses). No screenshots, no AI, about a second. Read-only: nothing here
// can submit, post or change anything.
//
// Mapped from TCU's D2L (tcu.brightspace.com), but these are standard Brightspace addresses, so it works
// at any D2L school.

import { BrowserWindow } from "electron";
import { log as bb } from "./blackbox";
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

async function d2lPage(portal: string): Promise<BrowserWindow> {
  if (page && !page.isDestroyed() && Date.now() - pageAt < 30 * 60e3) return page;
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
    if (status === 401 || status === 403 || !/\/d2l\/(home|lp\/homepage|le\/)/.test(url)) throw new SignInNeeded("Sign in to D2L in Milo first.");
    throw new Error(`D2L's data feed answered ${status} at ${new URL(url).host}`);
  }
  origin = new URL(url).origin;
  return page;
}

async function api<T>(portal: string, path: string): Promise<T> {
  const w = await d2lPage(portal);
  const r = (await w.webContents.executeJavaScript(
    `fetch(${JSON.stringify(path)}, { headers: { Accept: "application/json" }, credentials: "include" }).then(async (r) => ({ s: r.status, t: r.headers.get("content-type") || "", b: await r.text() }))`,
    true
  )) as { s: number; t: string; b: string };
  if (r.s !== 200 || !r.t.includes("json")) bb("d2l", "api_miss", { path: path.split("?")[0], status: r.s, type: r.t.slice(0, 40) });
  if (r.s === 401 || r.s === 403 || !r.t.includes("json")) {
    pageAt = 0; // session may have expired: reopen (and re-check sign-in) next time
    throw new SignInNeeded("Sign in to D2L in Milo first.");
  }
  if (r.s !== 200) throw new Error(`D2L said ${r.s} for ${path}`);
  return JSON.parse(r.b) as T;
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
export async function d2lCheck(portal: string): Promise<{ ok: boolean; signin: boolean; text: string }> {
  try {
    await d2lPage(portal);
    return { ok: true, signin: false, text: "" };
  } catch (e) {
    return { ok: false, signin: e instanceof SignInNeeded, text: (e as Error).message };
  }
}
