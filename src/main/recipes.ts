// Muscle memory: when a web task works, Milo remembers exactly what he did (which button, which box,
// what he typed) and next time just does it again, no AI needed. Fast and nearly free.
//
// - Tasks are matched by their "shape": "sign up with name {0} and email {1}" matches any name/email.
// - Elements are remembered by what they ARE (a textbox labeled "Email"), not by page ids that change.
// - A recipe is only replayed after it's been proven: checked by the job engine, or worked twice.
// - Anything that submits, sends, buys or deletes is never replayed without the student's yes.
// - If the page changed and a step can't be matched, the replay stops and the AI takes over from there.

import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

export type ElDesc = { tag: string; role?: string; type?: string; label: string; placeholder?: string };
export type RStep = {
  action: "click" | "type" | "key" | "navigate" | "new_tab" | "back" | "scroll" | "wait";
  el?: ElDesc;
  text?: string; // may contain {0}, {1} for the task's values
  clear?: boolean;
  keys?: string;
  url?: string;
  direction?: string;
};
export type Recipe = { key: string; task: string; steps: RStep[]; wins: number; fails: number; verified: boolean; created: number; lastUsed: number };

export const RISKY = /\b(submit|send|post|publish|pay|buy|purchase|place (the |my |an? )?order|check ?out|delete|remove|turn in|unenroll|drop (the )?class)\b/i;
export const APPROVED = /already approved|student said yes|approved placing|I approve/i;

// ---------- task shape ----------
const VALUE = /"[^"]{1,120}"|'[^']{2,120}'|https?:\/\/\S+|[\w.+-]+@[\w-]+\.[\w.]+|\$?\d+(?:[.,]\d+)*%?/g;
/** The task's first line with its specific values swapped for slots. */
export function shapeOf(task: string): { key: string; values: string[] } {
  const line = task.split("\n")[0].trim();
  const values: string[] = [];
  const key = line
    .replace(VALUE, (m) => {
      values.push(m.replace(/^["']|["']$/g, ""));
      return `{${values.length - 1}}`;
    })
    .toLowerCase()
    .replace(/[^a-z0-9{} ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { key, values };
}
/** Put the task's values back into a recorded text. */
export const fill = (text: string, values: string[]) => text.replace(/\{(\d+)\}/g, (_, i) => values[+i] ?? "");
/** Turn the values in a typed text into slots, so the recipe works for other values. */
export function generalize(text: string, values: string[]) {
  let out = text;
  values
    .map((v, i) => ({ v, i }))
    .filter((x) => x.v.length >= 2)
    .sort((a, b) => b.v.length - a.v.length)
    .forEach(({ v, i }) => (out = out.split(v).join(`{${i}}`)));
  return out;
}

// ---------- matching elements ----------
type ElLike = ElDesc & { id: string; inView?: boolean; disabled?: boolean };
const clean = (s = "") => s.toLowerCase().replace(/\s+/g, " ").trim();
export function describeEl(e: ElLike): ElDesc {
  return { tag: e.tag, role: e.role, type: e.type, label: (e.label ?? "").slice(0, 120), placeholder: e.placeholder };
}
/** Find the element that matches a remembered one. Only a single clear match counts. */
export function findEl<T extends ElLike>(els: T[], d: ElDesc): T | null {
  const same = (e: T) => e.tag === d.tag && (e.type ?? "") === (d.type ?? "") && (e.role ?? "") === (d.role ?? "");
  const exact = els.filter((e) => same(e) && clean(e.label) === clean(d.label) && (!d.placeholder || clean(e.placeholder) === clean(d.placeholder)) && !e.disabled);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) {
    const inView = exact.filter((e) => e.inView !== false);
    return inView.length === 1 ? inView[0] : null;
  }
  // label changed slightly (e.g. "Email *" -> "Email"): same kind + same placeholder
  if (d.placeholder) {
    const ph = els.filter((e) => same(e) && clean(e.placeholder) === clean(d.placeholder) && !e.disabled);
    if (ph.length === 1) return ph[0];
  }
  return null;
}

// ---------- saved recipes ----------
const file = () => path.join(app.getPath("userData"), "recipes.json");
let book: Recipe[] | null = null;
const all = () => {
  if (book) return book;
  try {
    book = JSON.parse(fs.readFileSync(file(), "utf8"));
    if (!Array.isArray(book)) book = [];
  } catch {
    book = [];
  }
  return book!;
};
const persist = () => {
  try {
    fs.writeFileSync(file(), JSON.stringify(all().slice(0, 300)));
  } catch {
    /* not fatal */
  }
};

/** Remember what just worked. */
export function saveRecipe(task: string, steps: RStep[]) {
  const { key, values } = shapeOf(task);
  if (!key || steps.length === 0 || steps.length > 40) return;
  const gen = steps.map((s) => ({ ...s, text: s.text !== undefined ? generalize(s.text, values) : undefined, url: s.url ? generalize(s.url, values) : undefined }));
  const xs = all();
  const old = xs.find((r) => r.key === key);
  if (old) {
    // the same steps again: one more win. Different steps: the newer way replaces it.
    if (JSON.stringify(old.steps) === JSON.stringify(gen)) old.wins++;
    else Object.assign(old, { steps: gen, wins: 1, fails: 0, verified: false });
    old.lastUsed = Date.now();
  } else xs.unshift({ key, task: task.split("\n")[0].slice(0, 200), steps: gen, wins: 1, fails: 0, verified: false, created: Date.now(), lastUsed: Date.now() });
  persist();
}
/** The job engine checked the result on screen: this recipe is proven. */
export function verifyRecipe(task: string) {
  const r = all().find((x) => x.key === shapeOf(task).key);
  if (r) {
    r.verified = true;
    r.fails = 0;
    persist();
  }
}
/** A replay didn't hold up: after 2 strikes it's forgotten. */
export function failRecipe(task: string) {
  const key = shapeOf(task).key;
  const r = all().find((x) => x.key === key);
  if (!r) return;
  r.fails++;
  r.verified = false;
  if (r.fails >= 2) book = all().filter((x) => x !== r);
  persist();
}
/** A proven recipe for this task, ready to replay (values filled in), or null. */
export function recipeFor(task: string): { recipe: Recipe; values: string[] } | null {
  const { key, values } = shapeOf(task);
  const r = all().find((x) => x.key === key);
  if (!r || !(r.verified || r.wins >= 2)) return null;
  return { recipe: r, values };
}
export const recipeCount = () => all().length;
