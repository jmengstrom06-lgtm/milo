// What Milo's thinking costs, measured on every AI call, plus the guardrails that keep one student
// from running up a huge bill. Counts per day (saved), per session, and per "meter" (a job, a bench run).
//
// Guardrails (per student per day, in dollars of AI time):
//   soft limit -> the big model is swapped for the small one on anything without a picture
//   hard limit -> no more new AI work today except quick chat on the small model
// Defaults are generous for a $10-20/month plan; override with MILO_SOFT_BUDGET / MILO_HARD_BUDGET.

import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { log as bb } from "./blackbox";

/** $ per million tokens. Haiku 5.5 is 5x pricier for prompts over 100k tokens. */
const PRICES: Record<string, { in: number; out: number; read: number; write: number; longIn?: number; longOut?: number }> = {
  haiku: { in: 0.1, out: 0.5, read: 0.01, write: 0.125, longIn: 0.5, longOut: 2.5 },
  sonnet: { in: 2, out: 10, read: 0.1, write: 2.5 },
  opus: { in: 4, out: 20, read: 0.2, write: 5 },
};
const priceOf = (model: string) => PRICES[/haiku/i.test(model) ? "haiku" : /opus/i.test(model) ? "opus" : "sonnet"];

export type Usage = { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };

/** Dollars for one call. */
export function costOf(model: string, u: Usage): number {
  const p = priceOf(model);
  const inTok = u.input_tokens ?? 0;
  const read = u.cache_read_input_tokens ?? 0;
  const write = u.cache_creation_input_tokens ?? 0;
  const long = p.longIn !== undefined && inTok + read + write > 100_000;
  const pin = long ? p.longIn! : p.in;
  const pout = long ? p.longOut! : p.out;
  const mul = long ? p.longIn! / p.in : 1;
  return (inTok * pin + (u.output_tokens ?? 0) * pout + read * p.read * mul + write * p.write * mul) / 1e6;
}

type Tally = { calls: number; cost: number; inTok: number; outTok: number; smart: number; fast: number; images: number };
const blank = (): Tally => ({ calls: 0, cost: 0, inTok: 0, outTok: 0, smart: 0, fast: 0, images: 0 });

const today = () => new Date().toLocaleDateString("en-CA"); // 2026-11-21
let day = { date: today(), t: blank() };
const session = blank();
const meters = new Map<string, Tally>();
let loaded = false;

const file = () => path.join(app.getPath("userData"), "usage.json");
function load() {
  if (loaded) return;
  loaded = true;
  try {
    const d = JSON.parse(fs.readFileSync(file(), "utf8"));
    if (d?.date === today() && d.t) day = { date: d.date, t: { ...blank(), ...d.t } };
  } catch {
    /* first run */
  }
}
let saveTimer: NodeJS.Timeout | null = null;
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.writeFileSync(file(), JSON.stringify(day));
    } catch {
      /* not fatal */
    }
  }, 2000);
}

function add(t: Tally, model: string, u: Usage, cost: number, image: boolean) {
  t.calls++;
  t.cost += cost;
  t.inTok += (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
  t.outTok += u.output_tokens ?? 0;
  if (/haiku/i.test(model)) t.fast++;
  else t.smart++;
  if (image) t.images++;
}

/** Record one finished AI call. */
export function record(model: string, u: Usage | undefined, image: boolean) {
  if (!u) return;
  load();
  if (day.date !== today()) day = { date: today(), t: blank() };
  const c = costOf(model, u);
  add(day.t, model, u, c, image);
  add(session, model, u, c, image);
  for (const m of meters.values()) add(m, model, u, c, image);
  save();
}

// ---------- meters (a job, a bench task) ----------
export function startMeter(id: string) {
  meters.set(id, blank());
}
export function stopMeter(id: string): Tally {
  const t = meters.get(id) ?? blank();
  meters.delete(id);
  return t;
}
export const readMeter = (id: string): Tally => ({ ...(meters.get(id) ?? blank()) });

// ---------- guardrails ----------
// While developing and testing (npm run dev / test:*), limits are high so testing doesn't hit them.
const DEV = () => process.env.MILO_DEV === "1";
const SOFT = () => Number(process.env.MILO_SOFT_BUDGET || (DEV() ? 15 : 0.6));
const HARD = () => Number(process.env.MILO_HARD_BUDGET || (DEV() ? 30 : 1.5));
export function spentToday() {
  load();
  return day.date === today() ? day.t.cost : 0;
}
export type Budget = "ok" | "soft" | "hard";
export function budget(): Budget {
  const s = spentToday();
  return s >= HARD() ? "hard" : s >= SOFT() ? "soft" : "ok";
}
let warned: Budget = "ok";
/** Called before each AI call: which model to really use, or a refusal. */
export function guard(model: string, hasImage: boolean, kind: "chat" | "work"): { model: string; refuse?: string } {
  const b = budget();
  if (b !== warned) {
    warned = b;
    bb("usage", "budget", { level: b, spent: Math.round(spentToday() * 1000) / 1000 });
  }
  if (b === "ok") return { model };
  const fast = process.env.MILO_FAST_MODEL || "claude-haiku-5-5";
  if (b === "hard" && kind === "work") return { model, refuse: "I've done a ton of heavy lifting today, so big jobs are paused until tomorrow. I can still chat and help you study." };
  // over the soft line: the small model handles everything it can (pictures still need the big one)
  if (!hasImage && !/haiku/i.test(model)) return { model: fast };
  return { model };
}

export const usageToday = () => {
  load();
  return { ...day.t, soft: SOFT(), hard: HARD() };
};
export const usageSession = () => ({ ...session });
