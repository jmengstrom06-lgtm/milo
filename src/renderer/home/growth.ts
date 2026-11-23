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
