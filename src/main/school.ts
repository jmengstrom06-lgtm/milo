// The school adapter layer: every LMS (D2L, Canvas, Blackboard, Moodle, Google Classroom) turns into the
// same simple list Milo's features read: assignments with a course, a title, a due date and a kind.
// Pure logic (no Electron, no React): shared by the main process and the renderer, and easy to test.
//
// Sources today:
//   - the LMS's calendar feed (.ics link every LMS gives students): works at ANY school, no AI, instant
//   - D2L's pages read in a hidden signed-in view (the original radar scan)
// More adapters (Canvas API, Blackboard, Moodle) plug in here and output the same Assignment list.

export type LmsKind = "d2l" | "canvas" | "blackboard" | "moodle" | "classroom" | "other";
export type Assignment = { title: string; course: string; due: string; due_iso?: string; kind?: string; url?: string; source?: "feed" | "page" };

export const LMS: Record<LmsKind, { name: string; feedHelp: string; grades: string }> = {
  d2l: {
    name: "D2L Brightspace",
    feedHelp: "In D2L, open Calendar, click the gear or Subscribe, and copy the calendar link.",
    grades: "Open the course, then Grades (or Progress, then Grades).",
  },
  canvas: {
    name: "Canvas",
    feedHelp: "In Canvas, open Calendar, click Calendar Feed at the bottom right, and copy the link.",
    grades: "Open the course, then Grades in the left menu.",
  },
  blackboard: {
    name: "Blackboard",
    feedHelp: "In Blackboard, open Calendar, click the gear, choose Share calendar, and copy the link.",
    grades: "Open the course, then Gradebook or My Grades.",
  },
  moodle: {
    name: "Moodle",
    feedHelp: "In Moodle, open Calendar, click Export calendar, choose all events, then Get calendar URL and copy it.",
    grades: "Open the course, then Grades.",
  },
  classroom: {
    name: "Google Classroom",
    feedHelp: "In Google Calendar, open your class calendar's settings and copy the Secret address in iCal format.",
    grades: "Open the class, then Your work.",
  },
  other: {
    name: "your school's site",
    feedHelp: "Open your school site's Calendar and look for Subscribe, Export or Calendar feed, then copy that link.",
    grades: "Open the course and find its Grades page.",
  },
};

/** Which LMS is this? (from the portal link the student gave in setup) */
export function detectLms(url: string): LmsKind {
  const u = url.toLowerCase();
  if (/d2l|brightspace|desire2learn/.test(u)) return "d2l";
  if (/instructure\.com|canvas\./.test(u)) return "canvas";
  if (/blackboard|\/ultra\/|webapps\/portal|learn\.[a-z0-9-]+\.edu/.test(u)) return "blackboard";
  if (/moodle/.test(u)) return "moodle";
  if (/classroom\.google/.test(u)) return "classroom";
  return "other";
}

/** Is this a calendar feed link? webcal:// links become https://. */
export function feedUrl(raw: string): string | null {
  const t = raw.trim().replace(/^<|>$/g, "");
  if (!/^(webcals?|https?):\/\//i.test(t)) return null;
  const url = t.replace(/^webcals?:\/\//i, "https://");
  if (/\.ics(\?|$)|\/feeds?\/|calendar.*(export|feed|ical)|ical|\/calendar\/.*\.ics|feeds\/calendars|export_execute|basic\.ics/i.test(url)) return url;
  return null;
}

// ---------- calendar feed (iCalendar) ----------
const pad = (n: number) => String(n).padStart(2, "0");
const localIso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const human = (d: Date, timed: boolean) => {
  const h = d.getHours() % 12 || 12;
  const t = timed ? ` ${h}${d.getMinutes() ? ":" + pad(d.getMinutes()) : ""} ${d.getHours() < 12 ? "AM" : "PM"}` : "";
  return `${DAY[d.getDay()]} ${MONTH[d.getMonth()]} ${d.getDate()}${t}`;
};
const unescape = (s: string) => s.replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1").trim();

/** "20261121T235900Z" / "20261121T235900" / "20261121" -> a Date (Z = UTC, else this Mac's time). */
export function icsDate(v: string): { date: Date; timed: boolean } | null {
  const m = v.trim().match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (!h) return { date: new Date(+y, +mo - 1, +d, 23, 59), timed: false };
  const date = z ? new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s ?? 0))) : new Date(+y, +mo - 1, +d, +h, +mi, +(s ?? 0));
  return isNaN(date.getTime()) ? null : { date, timed: true };
}

const kindOf = (title: string) =>
  /\b(final exam|midterm|exam|test)\b/i.test(title) ? "exam" : /\bquiz\b/i.test(title) ? "quiz" : /\b(discussion|post|reply)\b/i.test(title) ? "discussion" : /\b(project|paper|essay|lab report|presentation)\b/i.test(title) ? "project" : "assignment";

/** Split "Homework 3 [MATH 1234]" / "Homework 3 - MATH 1234" / "MATH 1234: Homework 3" into title + course. */
export function splitCourse(summary: string, fallback = ""): { title: string; course: string } {
  let s = summary.replace(/\s*[-–(]\s*(due|is due|availability ends|ends)\)?\s*$/i, "").replace(/\s+(is )?due$/i, "").trim();
  let course = fallback;
  const br = s.match(/^(.*?)\s*\[([^\]]+)\]\s*$/);
  if (br) {
    s = br[1];
    course = br[2];
  } else {
    const pre = s.match(/^([A-Z]{2,5}[- ]?\d{3,5}[A-Z]?(?:[- ]\d{2,3})?)\s*[:\-–]\s*(.+)$/);
    if (pre) {
      course = pre[1];
      s = pre[2];
    }
  }
  return { title: s.trim() || summary.trim(), course: course.trim() };
}

/** Turn a calendar feed into assignments (yesterday through the next 4 months). */
export function parseIcs(text: string, now = Date.now()): Assignment[] {
  const lines = text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "").split("\n"); // unfold wrapped lines
  const out: Assignment[] = [];
  let ev: Record<string, string> | null = null;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line === "BEGIN:VEVENT") ev = {};
    else if (line === "END:VEVENT") {
      if (ev) {
        const when = icsDate(ev.DUE ?? ev.DTEND ?? ev.DTSTART ?? "");
        const summary = unescape(ev.SUMMARY ?? "");
        if (when && summary && when.date.getTime() > now - 86400e3 && when.date.getTime() < now + 120 * 86400e3) {
          const { title, course } = splitCourse(summary, unescape(ev.LOCATION ?? ev.CATEGORIES ?? ""));
          out.push({ title, course, due: human(when.date, when.timed), due_iso: localIso(when.date), kind: kindOf(title), url: ev.URL ? unescape(ev.URL) : undefined, source: "feed" });
        }
      }
      ev = null;
    } else if (ev) {
      const i = line.indexOf(":");
      if (i < 0) continue;
      const name = line.slice(0, i).split(";")[0].toUpperCase();
      if (!(name in ev)) ev[name] = line.slice(i + 1);
    }
  }
  // the same assignment can show up twice (start + due): keep one, the later time
  const seen = new Map<string, Assignment>();
  for (const a of out) {
    const k = `${a.course.toLowerCase()}|${a.title.toLowerCase()}`;
    const prev = seen.get(k);
    if (!prev || (a.due_iso ?? "") > (prev.due_iso ?? "")) seen.set(k, a);
  }
  return [...seen.values()].sort((a, b) => (a.due_iso ?? "").localeCompare(b.due_iso ?? ""));
}
