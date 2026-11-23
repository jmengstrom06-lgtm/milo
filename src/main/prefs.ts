// Small settings the student picks in Home base that the main process has to respect
// (notifications today). Saved on this Mac.

import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

export type Prefs = { notifyAway: boolean; quiet: boolean; quietFrom: number; quietTo: number };
const DEFAULTS: Prefs = { notifyAway: true, quiet: true, quietFrom: 23, quietTo: 8 };
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
  if (Number.isInteger(p.quietFrom) && p.quietFrom! >= 0 && p.quietFrom! < 24) next.quietFrom = p.quietFrom!;
  if (Number.isInteger(p.quietTo) && p.quietTo! >= 0 && p.quietTo! < 24) next.quietTo = p.quietTo!;
  cache = next;
  try {
    fs.writeFileSync(file(), JSON.stringify(next), { mode: 0o600 });
  } catch {
    /* keep it in memory */
  }
  return next;
}

/** Is this hour inside quiet hours? Handles ranges that cross midnight (23 to 8). (pure) */
export function inQuiet(hour: number, from: number, to: number): boolean {
  if (from === to) return false;
  return from < to ? hour >= from && hour < to : hour >= from || hour < to;
}
