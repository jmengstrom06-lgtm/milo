// Grade forecaster: opens the course's grades page, reads it (the AI only reads), and the exact math
// happens in gradeMath.ts. Grade sheets are cached for a few hours so asking again is instant.

import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { log as bb } from "./blackbox";
import { callTool, persona } from "./brain";
import { forecast, forecastLine, targetFor, type GradeSheet } from "./gradeMath";
import { LMS, detectLms } from "./school";

const file = () => path.join(app.getPath("userData"), "grades.json");
const FRESH = 6 * 3600e3;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
function cache(): Record<string, GradeSheet> {
  try {
    return JSON.parse(fs.readFileSync(file(), "utf8")) ?? {};
  } catch {
    return {};
  }
}
function remember(s: GradeSheet) {
  const c = cache();
  c[norm(s.course)] = { ...s, fetchedAt: Date.now() };
  try {
    fs.writeFileSync(file(), JSON.stringify(c));
  } catch {
    /* not fatal */
  }
}
const cached = (course: string) => {
  const c = cache();
  const k = Object.keys(c).find((x) => x === norm(course) || x.includes(norm(course)) || norm(course).includes(x));
  return k && Date.now() - (c[k].fetchedAt ?? 0) < FRESH ? c[k] : null;
};

const SHEET_TOOL = {
  name: "grade_sheet",
  description: "The grades on this page, exactly as shown.",
  input_schema: {
    type: "object",
    properties: {
      found: { type: "boolean", description: "False if this isn't a grades page." },
      course: { type: "string" },
      categories: {
        type: "array",
        description: "Weighted grade categories (e.g. Homework 20%), if the class uses weights. Include categories with no grades yet (earned/possible null).",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            weight: { type: ["number", "null"], description: "Percent of the final grade, e.g. 20." },
            earned: { type: ["number", "null"] },
            possible: { type: ["number", "null"] },
            percent: { type: ["number", "null"], description: "The category's percent if the page shows one." },
          },
          required: ["name", "weight"],
        },
      },
      earned: { type: ["number", "null"], description: "Points-based classes: total points earned so far (graded items only)." },
      possible: { type: ["number", "null"], description: "...out of this many points (graded items only)." },
      final: {
        type: ["object", "null"],
        description: "The final exam (or the exam the student asked about). Null if the page doesn't show one.",
        properties: { name: { type: "string" }, weight: { type: ["number", "null"] }, possible: { type: ["number", "null"] } },
        required: ["name"],
      },
      current_percent: { type: ["number", "null"], description: "The current overall grade percent shown on the page." },
      scheme: { type: "array", description: "The letter grade scale, only if the page shows it.", items: { type: "object", properties: { letter: { type: "string" }, min: { type: "number" } }, required: ["letter", "min"] } },
    },
    required: ["found", "course", "categories", "final"],
  },
};

/** Read a grades page (its text) into a grade sheet. */
export async function readGrades(pageText: string, course: string, exam: string) {
  const r = await callTool<GradeSheet & { found: boolean }>(
    {
      max_tokens: 2000,
      system: `${persona()}\nRead the student's grades page exactly. Copy numbers as shown; never guess a number that isn't on the page (use null). The student is asking about their ${exam || "final"}.`,
      tools: [SHEET_TOOL],
      tool_choice: { type: "auto" },
      messages: [{ role: "user", content: `Course: ${course}\n\nThe grades page:\n${pageText.slice(0, 30000)}` }],
    },
    SHEET_TOOL.name
  );
  if (!r.ok) return r;
  if (!r.data.found) return { ok: false as const, text: "That page didn't look like a grades page." };
  const s: GradeSheet = { ...r.data, course: r.data.course || course, categories: Array.isArray(r.data.categories) ? r.data.categories : [] };
  remember(s);
  return { ok: true as const, data: s };
}

export type ForecastDeps = {
  doTask: (task: string) => Promise<{ ok: boolean; status?: string; text?: string }>;
  pageText: () => Promise<string | null>;
};

/** "What do I need on the final for a B in stats?" -> one spoken answer. */
export async function askForecast(q: { course: string; letter: string; exam?: string; portal?: string; fresh?: boolean }, deps: ForecastDeps): Promise<{ ok: boolean; text: string }> {
  const exam = q.exam || "final";
  let sheet = q.fresh ? null : cached(q.course);
  if (!sheet) {
    if (!q.portal) return { ok: false, text: "Set up your school site first, then I can read your grades." };
    const where = LMS[detectLms(q.portal)].grades;
    const r = await deps.doTask(`In Chrome, go to ${q.portal}, open my ${q.course} course, and open its grades page (${where}) Stop as soon as the grades page is open.`);
    if (!r.ok || r.status === "stopped") return { ok: false, text: r.text || "I couldn't open your grades." };
    if (r.status === "blocked" || r.status === "ask") return { ok: false, text: r.text || "I need your help getting to that page." };
    const text = await deps.pageText();
    if (!text) return { ok: false, text: "I opened it but couldn't read the grades page." };
    const g = await readGrades(text, q.course, exam);
    if (!g.ok) return g;
    sheet = g.data;
  }
  const { target, note } = targetFor(q.letter, sheet.scheme);
  const f = forecast(sheet, target);
  bb("forecast", "answer", { course: q.course, letter: q.letter, ok: !!f, basis: f?.basis, needed: f?.needed });
  if (!f) return { ok: false, text: `I read your ${sheet.course} grades, but I can't tell how much the ${exam} counts. Is it in the syllabus? Tell me, like "the final is worth 25 percent".` };
  return { ok: true, text: `${forecastLine(f, q.letter.toUpperCase(), sheet.final?.name ?? exam)} ${note} ${f.notes.join(" ")}`.trim() };
}

/** "The final is worth 25 percent": fill in what the grades page didn't show. */
export function setFinalWeight(course: string, weight: number) {
  const s = cached(course);
  if (!s) return false;
  s.final = { name: s.final?.name ?? "final", weight, possible: s.final?.possible ?? null };
  remember(s);
  return true;
}
