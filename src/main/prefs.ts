// Small settings the student picks in Home base that the main process has to respect
// (notifications today). Saved on this Mac.

import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

export type Prefs = { notifyAway: boolean; quiet: boolean; quietFrom: number; quietTo: number; noRecord: string[]; okRecord: string[]; autofill: boolean; preflight: boolean }; // preflight: "check this" uses the rubric check (beta); autofill: type answers into worksheets (off = show them, the student types) // noRecord: class ids Milo never listens to; okRecord: classes the student said allow recording
const DEFAULTS: Prefs = { notifyAway: true, quiet: true, quietFrom: 23, quietTo: 8, noRecord: [], okRecord: [], autofill: false, preflight: false };
const file = () => path.join(app.getPath("userData"), "prefs.json");
let cache: Prefs | null = null;

export function prefs(): Prefs {
  if (cache) return cache;
  try {
    cache = { ...DEFAULTS, ...(JSON.parse(fs.readFileSync(file(), "utf8")) as Partial<Prefs>) };
  } catch {
    cache = { ...DEFAULTS };
  }
  return cache;
}
export function setPrefs(p: Partial<Prefs>): Prefs {
  const next = { ...prefs() };
  if (typeof p.notifyAway === "boolean") next.notifyAway = p.notifyAway;
  if (typeof p.quiet === "boolean") next.quiet = p.quiet;
  if (typeof p.autofill === "boolean") next.autofill = p.autofill;
  if (typeof p.preflight === "boolean") next.preflight = p.preflight;
  if (Number.isInteger(p.quietFrom) && p.quietFrom! >= 0 && p.quietFrom! < 24) next.quietFrom = p.quietFrom!;
  if (Number.isInteger(p.quietTo) && p.quietTo! >= 0 && p.quietTo! < 24) next.quietTo = p.quietTo!;
  if (Array.isArray(p.noRecord)) next.noRecord = Array.from(new Set(p.noRecord.filter((x) => typeof x === "string" && x))).slice(0, 50);
  if (Array.isArray(p.okRecord)) next.okRecord = Array.from(new Set(p.okRecord.filter((x) => typeof x === "string" && x))).slice(0, 50);
  // a class can't be both: the newest choice wins
  if (Array.isArray(p.okRecord)) next.noRecord = next.noRecord.filter((x) => !next.okRecord.includes(x));
  else if (Array.isArray(p.noRecord)) next.okRecord = next.okRecord.filter((x) => !next.noRecord.includes(x));
  cache = next;
  try {
    fs.writeFileSync(file(), JSON.stringify(next), { mode: 0o600 });
  } catch {
    /* keep it in memory */
  }
  return next;
}

/** Copied text that reads like a rubric or assignment instructions. (pure) */
export function looksLikeRubric(t: string): boolean {
  if (!t || t.length < 60 || t.length > 20000) return false;
  const hits = (t.match(/\b(rubric|criteria|points?|pts|requirements?|must|should|at least|minimum|maximum|words?|pages?|sources?|citations?|format|grading|include|exemplary|proficient)\b/gi) ?? []).length;
  return hits >= 3;
}

/** Safe default: Milo only records a class after the student says it's allowed there. (pure) */
export function recordDecision(classId: string | null, p: Pick<Prefs, "noRecord" | "okRecord">, confirmed: boolean): "record" | "never" | "ask" {
  if (classId && p.noRecord.includes(classId)) return "never";
  if (confirmed || (classId && p.okRecord.includes(classId))) return "record";
  return "ask";
}

/** Is this hour inside quiet hours? Handles ranges that cross midnight (23 to 8). (pure) */
export function inQuiet(hour: number, from: number, to: number): boolean {
  if (from === to) return false;
  return from < to ? hour >= from && hour < to : hour >= from || hour < to;
}
