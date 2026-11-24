// Milo speaks first: short heads-ups from the desktop frog, only when they're worth it.
// Pure: the frog decides *when* (calm moment, not paused, not quiet hours); this decides *what*.
import { fixWeek, type WItem } from "./home/weekFix";

export type Nudge = { id: string; text: string; actions: ("week" | "did" | "start" | "checkup" | "dismiss")[]; start?: string };

const HOUR = 3600e3;
const DAY = 24 * HOUR;

/** "Thursday's stacked": once a day, if the coming week has a real problem, offer to fix it. */
export function weekNudge(items: WItem[], now: number, lastShown: number): Nudge | null {
  const h = new Date(now).getHours();
  if (h < 10 || h >= 21) return null;
  if (now - lastShown < 20 * HOUR) return null;
  const f = fixWeek(items, [], now);
  const p = f.problems.find((x) => x.kind === "crunch" || x.kind === "tight");
  if (!p) return null;
  return { id: `week-${new Date(now).toDateString()}`, text: `Heads up: ${p.text} Want me to spread the work out?`, actions: ["week", "dismiss"] };
}

type Act = { at: number; title: string; undone?: number };
type Due = { title: string; course?: string; dueAt: number | null; firstSeen: number };

/** Welcome back after being away a while: what Milo did, what's new, what's next. Null if there's nothing worth saying. */
export function backNudge(awayMs: number, now: number, acts: Act[], due: Due[]): Nudge | null {
  if (awayMs < 30 * 60e3) return null;
  const since = now - awayMs;
  const did = acts.filter((a) => a.at >= since && !a.undone);
  const fresh = due.filter((d) => d.firstSeen >= since && (d.dueAt == null || d.dueAt > now));
  const soon = due.filter((d) => d.dueAt != null && d.dueAt > now && d.dueAt - now < DAY).sort((a, b) => a.dueAt! - b.dueAt!);
  const bits: string[] = [];
  const lecture = did.find((a) => /^Took notes on a lecture/i.test(a.title));
  if (lecture) bits.push(`I took your notes: ${lecture.title.replace(/^Took notes on a lecture:\s*/i, "")}`);
  const others = did.filter((a) => a !== lecture);
  if (others.length) bits.push(`I did ${others.length} thing${others.length > 1 ? "s" : ""} for you`);
  if (fresh.length) bits.push(`${fresh.length} new thing${fresh.length > 1 ? "s" : ""} got posted${fresh[0].course ? ` (${fresh[0].course})` : ""}`);
  if (soon.length) bits.push(`${soon[0].title} is due in ${Math.max(1, Math.round((soon[0].dueAt! - now) / HOUR))} hours`);
  if (!bits.length) return null;
  const where = awayMs >= 50 * 60e3 && awayMs < 4 * HOUR ? "While you were in class" : "While you were away";
  const actions: Nudge["actions"] = [];
  if (did.length) actions.push("did");
  if (soon.length) actions.push("start");
  actions.push("dismiss");
  return { id: `back-${Math.round(now / 60e3)}`, text: `${where}: ${bits.join(". ")}.`, actions, start: soon[0]?.title };
}
