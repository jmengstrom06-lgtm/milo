// "Milo, what's next?": look at everything due this week plus the calendar, find the problems
// (pile-ups, not enough time, things due at 8 AM), and propose study blocks that fix them.
// Pure: no clock, no network. The same engine runs the first-run demo and the real week.

export type WItem = { id: string; title: string; course: string; dueAt: number; kind?: "exam" | "quiz" | "assignment"; minutes?: number };
export type WEvent = { title: string; start: number; end: number };
export type Problem = { kind: "crunch" | "tight" | "early"; text: string; items: string[] };
export type Block = { id: string; itemId: string; title: string; course: string; start: number; end: number; why: string };
export type WeekFix = { problems: Problem[]; blocks: Block[]; minutes: number; doneEarly: number; say: string };

const MIN = 60e3;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** How long a thing usually takes, in minutes, from its title. Students can't tell us, so guess sensibly. */
export function estimate(it: Pick<WItem, "title" | "kind" | "minutes">): number {
  if (it.minutes && it.minutes > 0) return Math.min(600, Math.round(it.minutes));
  const t = it.title.toLowerCase();
  if (it.kind === "exam" || /\b(midterm|final|exam)\b/.test(t)) return 180;
  if (it.kind === "quiz" || /\bquiz\b/.test(t)) return 60;
  if (/\b(paper|essay|draft|report|research)\b/.test(t)) return 150;
  if (/\b(problem set|homework|hw|ps ?\d|worksheet|lab)\b/.test(t)) return 120;
  if (/\b(response|reflection|reading)\b/.test(t)) return 75;
  if (/\b(discussion|post|reply|forum)\b/.test(t)) return 30;
  return 60;
}

const dayStart = (t: number) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
const at = (day: number, h: number) => day + h * HOUR;
const label = (t: number) => new Date(t).toLocaleDateString("en-US", { weekday: "long" });

/** Free time from now through `days`, between wakeHour and sleepHour, around the calendar (15 min buffer). */
export function freeSlots(now: number, events: WEvent[], days = 7, wakeHour = 9, sleepHour = 22): { start: number; end: number }[] {
  const busy = events
    .filter((e) => e.end > now && e.end > e.start)
    .map((e) => ({ start: e.start - 15 * MIN, end: e.end + 15 * MIN }))
    .sort((a, b) => a.start - b.start);
  const out: { start: number; end: number }[] = [];
  const first = Math.ceil(now / (30 * MIN)) * 30 * MIN;
  for (let d = 0; d < days; d++) {
    const day = dayStart(now) + d * DAY;
    let s = Math.max(at(day, wakeHour), first);
    const e = at(day, sleepHour);
    for (const b of busy) {
      if (b.end <= s || b.start >= e) continue;
      if (b.start > s) out.push({ start: s, end: Math.min(b.start, e) });
      s = Math.max(s, b.end);
      if (s >= e) break;
    }
    if (e - s >= 30 * MIN) out.push({ start: s, end: e });
  }
  return out.filter((x) => x.end - x.start >= 30 * MIN);
}

/** Find this week's problems and the study blocks that fix them. */
export function fixWeek(items: WItem[], events: WEvent[], now: number, opts: { wakeHour?: number; sleepHour?: number; maxBlock?: number; maxDay?: number } = {}): WeekFix {
  const maxBlock = (opts.maxBlock ?? 60) * MIN;
  const upcoming = items.filter((i) => i.dueAt > now && i.dueAt - now < 8 * DAY).sort((a, b) => a.dueAt - b.dueAt);
  const slots = freeSlots(now, events, 8, opts.wakeHour, opts.sleepHour);
  const problems: Problem[] = [];

  // 1) pile-ups: two or more things due on the same day, or an exam within a day of something else
  const byDay = new Map<number, WItem[]>();
  for (const i of upcoming) byDay.set(dayStart(i.dueAt), [...(byDay.get(dayStart(i.dueAt)) ?? []), i]);
  for (const [d, list] of byDay) {
    const exam = list.find((i) => estimate(i) >= 180);
    if (list.length >= 2) problems.push({ kind: "crunch", text: `${list.length} things due ${label(d)}${exam ? `, including ${exam.title}` : ""}.`, items: list.map((i) => i.id) });
  }
  for (const ex of upcoming.filter((i) => estimate(i) >= 180)) {
    const near = upcoming.filter((o) => o.id !== ex.id && Math.abs(o.dueAt - ex.dueAt) < DAY && dayStart(o.dueAt) !== dayStart(ex.dueAt));
    if (near.length) problems.push({ kind: "crunch", text: `${near[0].title} is due right next to ${ex.title}.`, items: [ex.id, near[0].id] });
  }
  // 2) due early in the morning = really due the night before
  for (const i of upcoming) {
    const h = new Date(i.dueAt).getHours();
    if (h >= 0 && h < 10 && estimate(i) < 180) problems.push({ kind: "early", text: `${i.title} is due ${label(i.dueAt)} at ${new Date(i.dueAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}, so it really has to be done the night before.`, items: [i.id] });
  }

  // 3) place work: finish everything at least a few hours early, spread over days, biggest risks first
  const free = slots.map((s) => ({ ...s }));
  const blocks: Block[] = [];
  const dayTotal = new Map<number, number>(); // keep any one day to a sane amount of work
  const dayMax = (opts.maxDay ?? 240) * MIN;
  let doneEarly = 0;
  let n = 0;
  for (const it of upcoming) {
    let need = estimate(it) * MIN;
    const deadline = it.dueAt - (estimate(it) >= 180 ? 12 : 3) * HOUR; // exams: done studying the evening before
    const perDay = new Map<number, number>();
    const dayCap = it.dueAt - now < 2 * DAY ? need : Math.max(maxBlock, need / 2);
    let last = 0;
    for (const s of free) {
      if (need <= 0) break;
      if (s.start >= deadline) break;
      const d = dayStart(s.start);
      const used = perDay.get(d) ?? 0;
      const room = Math.min(dayCap - used, dayMax - (dayTotal.get(d) ?? 0));
      const want = Math.max(30 * MIN, Math.ceil(Math.min(maxBlock, need, room) / (15 * MIN)) * 15 * MIN);
      const len = Math.min(want, s.end - s.start, deadline - s.start);
      if (len < 30 * MIN || room < 30 * MIN) continue;
      const prev = blocks[blocks.length - 1];
      if (prev && prev.itemId === it.id && prev.end === s.start && prev.end - prev.start + len <= 90 * MIN) prev.end += len;
      else blocks.push({ id: `b${n++}`, itemId: it.id, title: `${estimate(it) >= 180 ? "Study for" : "Work on"} ${it.title}`, course: it.course, start: s.start, end: s.start + len, why: "" });
      s.start = Math.min(s.end, s.start + len + 15 * MIN); // a short break before the next block
      perDay.set(d, used + len);
      dayTotal.set(d, (dayTotal.get(d) ?? 0) + len);
      need -= len;
      last = s.start;
    }
    if (need > 0) {
      const got = estimate(it) - Math.round(need / MIN);
      problems.push({ kind: "tight", text: `Not enough free time before ${it.title}: I found ${hrs(got)} of the ${hrs(estimate(it))} it usually takes.`, items: [it.id] });
    } else if (last && it.dueAt - last >= DAY) doneEarly++;
  }
  // explain each block in one line
  for (const b of blocks) {
    const it = upcoming.find((i) => i.id === b.itemId)!;
    const p = problems.find((x) => x.items.includes(it.id));
    b.why = p?.kind === "crunch" ? "Gets it done before the pile-up." : p?.kind === "early" ? "So you're not up late the night before." : p?.kind === "tight" ? "Every free minute counts on this one." : `Due ${label(it.dueAt)}.`;
  }
  blocks.sort((a, b) => a.start - b.start);
  const minutes = Math.round(blocks.reduce((s, b) => s + (b.end - b.start), 0) / MIN);
  const say = !upcoming.length
    ? "Nothing due this week. You're clear."
    : `${problems.length ? `I found ${problems.length} problem${problems.length > 1 ? "s" : ""}. ` : "Your week looks fine. "}I'd add ${blocks.length} study block${blocks.length === 1 ? "" : "s"}, ${hrs(minutes)} total${doneEarly ? `, and ${doneEarly} thing${doneEarly > 1 ? "s" : ""} would be done a day early` : ""}.`;
  return { problems: dedupe(problems), blocks, minutes, doneEarly, say };
}

function hrs(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}
export { hrs as hoursText };

function dedupe(p: Problem[]): Problem[] {
  const seen = new Set<string>();
  return p.filter((x) => (seen.has(x.text) ? false : (seen.add(x.text), true)));
}

/** A believable sample week, built around "now", for the first-run demo and demo mode. Fictional student and classes. */
export function sampleWeek(now: number): { items: WItem[]; events: WEvent[] } {
  const d = (n: number, h: number, m = 0) => dayStart(now) + n * DAY + h * HOUR + m * MIN;
  return {
    items: [
      { id: "s1", title: "Problem Set 7: Normal distributions", course: "Intro to Statistics", dueAt: d(1, 23, 59) },
      { id: "s2", title: "Discussion post: Week 12", course: "American Writers", dueAt: d(2, 9, 0) },
      { id: "s3", title: "Biology Midterm 2", course: "Cell Biology", dueAt: d(3, 10, 0), kind: "exam" },
      { id: "s4", title: "Lab report: Enzyme rates", course: "Cell Biology", dueAt: d(3, 23, 59) },
      { id: "s5", title: "Essay draft: The Yellow Wallpaper", course: "American Writers", dueAt: d(4, 23, 59) },
    ],
    events: [
      ...[0, 1, 2, 3, 4].flatMap((n) => [
        { title: "Class", start: d(n, 10), end: d(n, 11, 15) },
        { title: "Class", start: d(n, 13), end: d(n, 14, 15) },
      ]),
      { title: "Work shift", start: d(1, 16), end: d(1, 20) },
      { title: "Work shift", start: d(3, 16), end: d(3, 20) },
      { title: "Intramurals", start: d(2, 19), end: d(2, 21) },
    ],
  };
}
