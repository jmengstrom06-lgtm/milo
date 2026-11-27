// Deadline radar: remembers every assignment Milo has seen in D2L, notices what's NEW and what MOVED,
// and decides when to warn (3 days out, the day before, the morning of). Pure logic: no React, no I/O.

export type Warn = "new" | "moved" | "d3" | "d1" | "today";
export type ScanItem = { title: string; course: string; due: string; due_iso?: string; kind?: string };
export type RadarItem = {
  id: string;
  title: string;
  course: string;
  due: string;
  dueAt: number | null;
  kind: string;
  firstSeen: number;
  lastSeen: number;
  prevDue?: string; // what it said before it moved
  movedAt?: number;
  warned: Partial<Record<Warn, number>>;
};
export type Radar = { items: RadarItem[]; scans: number; lastScan: number };
export type Alert = { item: RadarItem; why: Warn[] };

export const emptyRadar = (): Radar => ({ items: [], scans: 0, lastScan: 0 });
const HOUR = 3600e3;
const DAY = 24 * HOUR;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export const keyOf = (course: string, title: string) => `${norm(course)}|${norm(title)}`;

/** "2026-11-21T23:59" (local time) -> ms. */
export function parseDue(iso?: string): number | null {
  const m = String(iso ?? "").match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2}))?/);
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 23, m[5] ? +m[5] : 59);
  return isNaN(d.getTime()) ? null : d.getTime();
}

const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString();
const startOfDay = (t: number) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
/** Calendar days from today to the due date (0 = today, 1 = tomorrow). */
export const daysUntil = (dueAt: number, now: number) => Math.round((startOfDay(dueAt) - startOfDay(now)) / DAY);

/** Two titles are the same assignment if they share most of their words (D2L sometimes adds "(Due …)", "Submission", etc.). */
function similar(a: string, b: string) {
  const A = new Set(norm(a).split(" ").filter((w) => w.length > 1));
  const B = new Set(norm(b).split(" ").filter((w) => w.length > 1));
  if (!A.size || !B.size) return false;
  let both = 0;
  A.forEach((w) => B.has(w) && both++);
  return both / Math.min(A.size, B.size) >= 0.75;
}

/** Same class, however it was written: "Org Behavior & Strategy" = "Organizational Behavior and Strategy". (pure) */
export function sameCourse(a: string, b: string): boolean {
  const words = (x: string) => norm(x.replace(/&/g, " and ")).split(" ").filter((w) => w && !/^(and|of|the|to|in|intro|introduction)$/.test(w));
  const A = words(a);
  const B = words(b);
  if (!A.length || !B.length) return !A.length && !B.length;
  if (A.join(" ") === B.join(" ")) return true;
  const [short, long] = A.length <= B.length ? [A, B] : [B, A];
  // every word of the shorter name starts a word of the longer one ("org" -> "organizational", "bio" -> "biology")
  const pre = (w: string, l: string) => {
    let i = 0;
    while (i < w.length && i < l.length && w[i] === l[i]) i++;
    return i >= Math.min(4, w.length, l.length) && i >= 3;
  };
  return short.every((w) => w.length >= 3 && long.some((l) => pre(w, l)));
}
/** One assignment seen twice (two sources wrote the class or title a bit differently)? (pure) */
function sameItem(x: { course: string; title: string; dueAt: number | null }, y: { course: string; title: string; dueAt: number | null }) {
  if (!similar(x.title, y.title)) return false;
  if (sameCourse(x.course, y.course)) return true;
  // the class written as a code on one side ("MANA 30253"): same title, due the very same minute
  return x.dueAt != null && x.dueAt === y.dueAt && norm(x.title) === norm(y.title);
}
/** Fold copies of the same assignment into one (keeps the most recently seen version's wording). (pure) */
export function dedupe(list: RadarItem[]): RadarItem[] {
  const items = list.map((x) => ({ ...x, warned: { ...x.warned } }));
  const out: RadarItem[] = [];
  for (const x of [...items].sort((a, b) => b.lastSeen - a.lastSeen)) {
    const twin = out.find((y) => sameItem(x, y));
    if (!twin) out.push(x);
    else {
      twin.firstSeen = Math.min(twin.firstSeen, x.firstSeen);
      twin.warned = { ...x.warned, ...twin.warned }; // never warn twice for one thing
      if (twin.dueAt == null) twin.dueAt = x.dueAt;
    }
  }
  return items.filter((x) => out.includes(x));
}

/** Fold one D2L scan into what Milo already knows. */
export function mergeScan(r: Radar, scan: ScanItem[], now: number): Radar {
  const first = r.scans === 0;
  const items = r.items.map((x) => ({ ...x, warned: { ...x.warned } }));
  for (const s of scan) {
    if (!s || !s.title) continue;
    const dueAt = parseDue(s.due_iso);
    const id = keyOf(s.course, s.title);
    const old = items.find((x) => x.id === id) ?? items.find((x) => sameItem(x, { course: s.course, title: s.title, dueAt }));
    if (!old) {
      items.push({
        id,
        title: s.title,
        course: s.course,
        due: s.due,
        dueAt,
        kind: s.kind || "assignment",
        firstSeen: now,
        lastSeen: now,
        // the very first scan is "what's already there", not news
        warned: first ? { new: now } : {},
      });
      continue;
    }
    old.lastSeen = now;
    old.title = s.title;
    old.course = s.course || old.course; // the newest source's spelling of the class
    old.id = keyOf(old.course, old.title);
    if (dueAt != null && old.dueAt != null && Math.abs(dueAt - old.dueAt) > 30 * 60e3) {
      old.prevDue = old.due;
      old.movedAt = now;
      delete old.warned.moved;
      // a new date means the countdown starts over
      if (dueAt > old.dueAt) {
        delete old.warned.d3;
        delete old.warned.d1;
        delete old.warned.today;
      }
    }
    if (dueAt != null) old.dueAt = dueAt;
    old.due = s.due || old.due;
  }
  // forget things more than a day past due, and things not seen for 2 weeks
  const kept = dedupe(items).filter((x) => (x.dueAt == null ? now - x.lastSeen < 14 * DAY : x.dueAt > now - DAY));
  return { items: kept, scans: r.scans + 1, lastScan: now };
}

/** What Milo should warn about right now (each item once per reason). Soonest first. */
export function pendingAlerts(r: Radar, now: number): Alert[] {
  const out: Alert[] = [];
  for (const x of dedupe(r.items)) {
    if (x.dueAt != null && x.dueAt < now) continue; // past due: too late to warn
    const why: Warn[] = [];
    if (!x.warned.new && now - x.firstSeen < 3 * DAY) why.push("new");
    if (x.movedAt && !x.warned.moved) why.push("moved");
    if (x.dueAt != null) {
      const days = daysUntil(x.dueAt, now);
      const hour = new Date(now).getHours();
      if (days === 0 && hour >= 8 && !x.warned.today) why.push("today");
      else if (days === 1 && !x.warned.d1 && !x.warned.today) why.push("d1");
      else if (days >= 2 && days <= 3 && !x.warned.d3 && !x.warned.d1 && !x.warned.today) why.push("d3");
    }
    if (why.length) out.push({ item: x, why });
  }
  return out.sort((a, b) => (a.item.dueAt ?? Infinity) - (b.item.dueAt ?? Infinity));
}

/** After warning: remember it, so it's never said twice. A closer warning also covers the farther ones. */
export function markWarned(r: Radar, alerts: Alert[], now: number): Radar {
  const ids = new Map(alerts.map((a) => [a.item.id, a.why]));
  return {
    ...r,
    items: r.items.map((x) => {
      const why = ids.get(x.id);
      if (!why) return x;
      const w = { ...x.warned };
      for (const k of why) w[k] = now;
      if (why.includes("today")) w.d1 = w.d1 ?? now;
      if (why.includes("today") || why.includes("d1")) w.d3 = w.d3 ?? now;
      if (x.dueAt != null) {
        // a "new" or "moved" alert already said when it's due: don't repeat the same countdown
        const days = daysUntil(x.dueAt, now);
        if (days === 1) w.d1 = w.d1 ?? now;
        if (days >= 1 && days <= 3) w.d3 = w.d3 ?? now;
      }
      return { ...x, warned: w };
    }),
  };
}

/** Coming up, soonest first. range: days ahead (Infinity = everything). */
export function upcoming(r: Radar, now: number, range = Infinity): RadarItem[] {
  return dedupe(r.items)
    .filter((x) => x.dueAt == null || (x.dueAt >= now - HOUR && daysUntil(x.dueAt, now) <= range))
    .sort((a, b) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity));
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
/** "today at 11:59 PM", "tomorrow", "Friday", "Nov 28". */
export function whenText(dueAt: number | null, now: number, fallback = ""): string {
  if (dueAt == null) return fallback;
  const d = new Date(dueAt);
  const time = d.getHours() === 23 && d.getMinutes() === 59 ? "11:59 PM" : d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const days = daysUntil(dueAt, now);
  if (days === 0) return `today at ${time}`;
  if (days === 1) return `tomorrow at ${time}`;
  if (days < 7) return DAYS[d.getDay()];
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
/** Short chip: "Today", "Tomorrow", "3 days", "Nov 28". */
export function chipText(dueAt: number | null, now: number, fallback = ""): string {
  if (dueAt == null) return fallback || "No date";
  const days = daysUntil(dueAt, now);
  if (days <= 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days < 7) return `${days} days`;
  return new Date(dueAt).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** What Milo says when he warns. One item: specific. Several: the most urgent, plus a count. */
export function alertLine(alerts: Alert[], now: number): string {
  if (!alerts.length) return "";
  const a = alerts[0];
  const x = a.item;
  const name = `${x.title}${x.course ? ` for ${x.course}` : ""}`;
  const when = whenText(x.dueAt, now, x.due);
  let one: string;
  if (a.why.includes("moved")) one = `Heads up: ${name} moved to ${when}${x.prevDue ? `, it used to be ${x.prevDue}` : ""}.`;
  else if (a.why.includes("today")) one = `Heads up: ${name} is due ${when}.`;
  else if (a.why.includes("d1")) one = `Heads up: ${name} is due ${when}.`;
  else if (a.why.includes("new")) one = `New in D2L: ${name}, due ${when || "soon"}.`;
  else one = `Heads up: ${name} is due ${when}.`;
  const more = alerts.length - 1;
  return `${one}${more ? ` Plus ${more} more coming up.` : ""} Want to start it?`;
}
