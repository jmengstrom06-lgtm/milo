// Saved on this Mac: which classes follow their syllabus AI rules, and what each rule says.
import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { ClassRule, Rules } from "./classRules";

const file = () => path.join(app.getPath("userData"), "class-rules.json");
let cache: Rules | null = null;

export function loadRules(): Rules {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(file(), "utf8")) as Rules;
  } catch {
    cache = {};
  }
  return cache;
}
export function saveRule(classId: string, rule: ClassRule | null): Rules {
  const next = { ...loadRules() };
  if (rule) next[classId] = rule;
  else delete next[classId];
  cache = next;
  try {
    fs.writeFileSync(file(), JSON.stringify(next), { mode: 0o600 });
  } catch {
    /* keep in memory */
  }
  return next;
}
