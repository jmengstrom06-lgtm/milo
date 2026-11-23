// "He's yours and he grows": Milo's XP, level, streak and wardrobe.
// XP only comes from real studying (game plan steps finished, lock-in days), never from opening the
// app or "Do it for me". Kept in a ledger on this Mac so XP never goes backward when old plans are pruned.

import type { FrogOutfit } from "./MiloFrog";

export const XP = { step: 10, focusDay: 40 } as const;
const LEVELS = [0, 50, 150, 300, 500, 750, 1050, 1400, 1800, 2250];
const NAMES = ["New friend", "Study pal", "Desk buddy", "Study buddy", "Lock-in legend", "Focus pro", "Exam crusher", "Dean's list", "Professor", "Legend"];

export const OUTFITS: { id: FrogOutfit; label: string; level: number; how: string }[] = [
  { id: "none", label: "Just Milo", level: 1, how: "Always" },
  { id: "beanie", label: "Beanie", level: 2, how: "Level 2" },
  { id: "headphones", label: "Headphones", level: 3, how: "Level 3" },
  { id: "scarf", label: "Scarf", level: 5, how: "Level 5" },
  { id: "gradcap", label: "Grad cap", level: 7, how: "Level 7" },
];

export type Ledger = Record<string, number>;
export type PlanLike = { key: string; done: number[] };

/** Add any new XP events from the sources. Never removes old ones. */
export function syncLedger(ledger: Ledger, plans: PlanLike[], focusDays: string[]): Ledger {
  const next = { ...ledger };
  for (const p of plans) for (const i of p.done ?? []) next[`step:${p.key}:${i}`] ??= XP.step;
  for (const d of focusDays) next[`focus:${d}`] ??= XP.focusDay;
  return next;
}

export function totalXp(ledger: Ledger): number {
  return Object.values(ledger).reduce((a, b) => a + (Number(b) || 0), 0);
}

export function levelOf(xp: number) {
  let i = 0;
  while (i + 1 < LEVELS.length && xp >= LEVELS[i + 1]) i++;
  const floor = LEVELS[i];
  const ceil = LEVELS[i + 1] ?? floor;
  return { level: i + 1, name: NAMES[i], floor, ceil, toNext: Math.max(0, ceil - xp), pct: ceil > floor ? (xp - floor) / (ceil - floor) : 1 };
}

const dayKey = (d: Date) => d.toISOString().slice(0, 10);
/** Days in a row with real studying, ending today (or yesterday, so it isn't "lost" until tonight). */
export function streakOf(days: string[], now = new Date()): number {
  const set = new Set(days);
  const d = new Date(now);
  if (!set.has(dayKey(d))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (set.has(dayKey(d))) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

export function unlocked(level: number, id: FrogOutfit): boolean {
  return level >= (OUTFITS.find((o) => o.id === id)?.level ?? 99);
}

// ---------- on this Mac ----------
const read = <T,>(k: string, fallback: T): T => {
  try {
    const v = JSON.parse(localStorage.getItem(k) || "null");
    return v ?? fallback;
  } catch {
    return fallback;
  }
};

export function readGrowth(now = new Date()) {
  const plans = read<PlanLike[]>("milo.gameplans", []);
  const focusDays = read<string[]>("milo.focusDays", []);
  const ledger = syncLedger(read<Ledger>("milo.xp", {}), Array.isArray(plans) ? plans : [], Array.isArray(focusDays) ? focusDays : []);
  try {
    localStorage.setItem("milo.xp", JSON.stringify(ledger));
  } catch {
    /* full */
  }
  const xp = totalXp(ledger);
  const lv = levelOf(xp);
  const saved = (localStorage.getItem("milo.outfit") || "none") as FrogOutfit;
  const week = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now);
    d.setDate(d.getDate() - (6 - i));
    return { label: d.toLocaleDateString("en-US", { weekday: "narrow" }), on: focusDays.includes(dayKey(d)), today: i === 6 };
  });
  return {
    xp,
    ...lv,
    streak: streakOf(focusDays, now),
    week,
    stepsDone: Object.keys(ledger).filter((k) => k.startsWith("step:")).length,
    focusDays: Object.keys(ledger).filter((k) => k.startsWith("focus:")).length,
    outfit: unlocked(lv.level, saved) ? saved : ("none" as FrogOutfit),
  };
}

export function setOutfit(id: FrogOutfit) {
  try {
    localStorage.setItem("milo.outfit", id);
  } catch {
    /* full */
  }
}

/** Longest run of consecutive days in the list. (pure) */
export function longestStreak(days: string[]): number {
  const sorted = Array.from(new Set(days)).sort();
  let best = 0;
  let run = 0;
  let prev: number | null = null;
  for (const d of sorted) {
    const t = Date.parse(`${d}T00:00:00Z`);
    run = prev != null && t - prev === 86400e3 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = t;
  }
  return best;
}

export type MomentRow = { id: string; what: string; when: string; at: number; mood: "celebrate" | "happy" | "focus" | "wave" | "write"; kicker: string; big: string; small: string };
type SavedPlanLike = { key: string; done: number[]; at: number; plan?: { title?: string; course?: string; steps?: unknown[] } };

/** Real moments from this Mac's history, newest first. Nothing made up: if it didn't happen, it isn't here. */
export function readMoments(): MomentRow[] {
  const out: MomentRow[] = [];
  const fmt = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const plans = read<SavedPlanLike[]>("milo.gameplans", []);
  for (const p of Array.isArray(plans) ? plans : []) {
    const n = p.plan?.steps?.length ?? 0;
    if (n && (p.done?.length ?? 0) >= n) {
      const title = (p.plan?.title || "an assignment").slice(0, 60);
      out.push({ id: `plan:${p.key}`, what: `Finished every step of ${title}`, when: `${p.plan?.course ? `${p.plan.course} · ` : ""}${fmt(p.at)}`, at: p.at, mood: "celebrate", kicker: "DONE AND DUSTED", big: `${n} steps. All done.`, small: "Started small, finished strong" });
    }
  }
  const days = read<string[]>("milo.focusDays", []);
  if (Array.isArray(days) && days.length) {
    const first = [...days].sort()[0];
    const at = Date.parse(`${first}T12:00:00Z`);
    out.push({ id: "first-lockin", what: "Your first lock-in with Milo", when: fmt(at), at, mood: "focus", kicker: "LOCKED IN", big: "First lock-in done.", small: "Phone down, Milo up" });
    const best = longestStreak(days);
    if (best >= 3) {
      const last = Date.parse(`${[...days].sort().slice(-1)[0]}T12:00:00Z`);
      out.push({ id: "best-streak", what: `Longest streak: ${best} days in a row`, when: "Personal best", at: last, mood: "celebrate", kicker: "STUDY STREAK", big: `${best} days in a row.`, small: "Locked in every single day" });
    }
  }
  const met = Number(localStorage.getItem("milo.home.welcomed") || 0);
  if (met) out.push({ id: "met", what: "The day you met Milo", when: fmt(met), at: met, mood: "wave", kicker: "DAY ONE", big: "Met my study buddy.", small: "He reads D2L so I don't have to" });
  return out.sort((a, b) => b.at - a.at);
}

/** The level Milo has already celebrated. First run: no party for levels you already had. */
export function levelSeen(current: number): number {
  const raw = localStorage.getItem("milo.levelSeen");
  if (raw == null) {
    try {
      localStorage.setItem("milo.levelSeen", String(current));
    } catch {
      /* full */
    }
    return current;
  }
  return Number(raw) || 1;
}
export function markLevelSeen(level: number) {
  try {
    localStorage.setItem("milo.levelSeen", String(level));
  } catch {
    /* full */
  }
}
