// Milo's own gradebook, for classes where D2L doesn't post grades.
// - The syllabus gives the weights (read once per class, from whatever's on screen).
// - The student tells Milo scores: "I got an 85 on the midterm in stats".
// - The forecaster does exact math on that (gradeMath.ts).

import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { log as bb } from "./blackbox";
import { callTool, persona } from "./brain";
import type { GradeSheet } from "./gradeMath";

export type Score = { name: string; cat: string; earned: number; possible: number; at: number };
export type ClassBook = { course: string; cats: { name: string; weight: number }[]; scheme?: { letter: string; min: number }[]; scores: Score[]; updated: number };

const file = () => path.join(app.getPath("userData"), "gradebook.json");
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
function load(): Record<string, ClassBook> {
  try {
    return JSON.parse(fs.readFileSync(file(), "utf8")) ?? {};
  } catch {
    return {};
  }
}
function store(all: Record<string, ClassBook>) {
  try {
    fs.writeFileSync(file(), JSON.stringify(all, null, 1));
  } catch {
    /* not fatal */
  }
}
/** The class's book: exact name first, then a close match ("stats" finds "Elementary Statistics"). */
export function findBook(course: string): ClassBook | null {
  const all = load();
  const n = norm(course);
  if (!n) return null;
  const k = Object.keys(all).find((x) => x === n) ?? Object.keys(all).find((x) => x.includes(n) || n.includes(x) || (n.length >= 4 && x.split(" ").some((w) => w.startsWith(n.slice(0, 4)))));
  return k ? all[k] : null;
}
function saveBook(b: ClassBook) {
  const all = load();
  const old = Object.keys(all).find((x) => all[x] === findBook(b.course) || x === norm(b.course));
  if (old && old !== norm(b.course)) delete all[old];
  all[norm(b.course)] = { ...b, updated: Date.now() };
  store(all);
}

// ---------- which part of the grade a score belongs to ----------
const GROUPS: [RegExp, RegExp][] = [
  [/\bfinal\b/, /\bfinal\b/],
  [/\bmid ?term|exam|test\b/, /\bmid ?term|exam|test\b/],
  [/\bquiz/, /\bquiz/],
  [/\bhw\b|home ?work|problem set|\bps\b|assignment/, /home ?work|assignment|problem/],
  [/\blab\b/, /\blab\b/],
  [/\bessay|paper|writing|report/, /essay|paper|writing|report/],
  [/\bproject|presentation/, /project|presentation/],
  [/\bparticipation|attendance|discussion|clicker/, /participation|attendance|discussion|clicker/],
];
export function catFor(scoreName: string, cats: { name: string }[]): string | null {
  const s = scoreName.toLowerCase();
  const direct = cats.find((c) => s.includes(c.name.toLowerCase()) || c.name.toLowerCase().includes(s));
  if (direct) return direct.name;
  for (const [scoreRe, catRe] of GROUPS) if (scoreRe.test(s)) {
    const c = cats.find((x) => catRe.test(x.name.toLowerCase()));
    if (c) return c.name;
  }
  return null;
}

// ---------- scores ----------
/** "I got an 85 on the midterm in stats" -> saved. Returns what Milo says back. */
export function addScore(course: string, name: string, earned: number, possible = 100): { ok: boolean; text: string } {
  let b = findBook(course);
  if (!b) b = { course, cats: [], scores: [], updated: Date.now() };
  const cat = b.cats.length ? catFor(name, b.cats) : null;
  const label = name.replace(/\b\w/g, (c) => c.toUpperCase());
  b.scores = b.scores.filter((x) => norm(x.name) !== norm(name)); // saying it again replaces it
  b.scores.push({ name: label, cat: cat ?? "Other", earned, possible, at: Date.now() });
  saveBook(b);
  bb("gradebook", "score", { course: b.course, cat: cat ?? "Other" });
  const pct = Math.round((1000 * earned) / possible) / 10;
  if (!b.cats.length) return { ok: true, text: `Saved: ${pct}% on ${label} in ${b.course}. Show me the syllabus once and say "read my syllabus" so I know what everything's worth.` };
  return { ok: true, text: `Saved: ${pct}% on ${label}${cat ? `, under ${cat}` : ""}.` };
}

// ---------- syllabus ----------
const WEIGHTS_TOOL = {
  name: "grade_weights",
  description: "How the class's final grade is calculated, from its syllabus.",
  input_schema: {
    type: "object",
    properties: {
      found: { type: "boolean", description: "False if this isn't a syllabus or it doesn't say how the grade is calculated." },
      course: { type: "string", description: "Course name or code from the syllabus." },
      categories: { type: "array", items: { type: "object", properties: { name: { type: "string" }, weight: { type: "number", description: "Percent of the final grade. If the syllabus uses points, convert to percent of total points." } }, required: ["name", "weight"] } },
      scheme: { type: "array", description: "Letter grade cutoffs if listed.", items: { type: "object", properties: { letter: { type: "string" }, min: { type: "number" } }, required: ["letter", "min"] } },
    },
    required: ["found", "categories"],
  },
};
/** Read the grading section of a syllabus (page text and/or a screenshot of it). */
export async function readSyllabus(course: string, src: { pageText?: string; jpeg?: string; pdf?: string }): Promise<{ ok: boolean; text: string }> {
  const content: unknown[] = [];
  if (src.pdf) content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: src.pdf } });
  if (src.jpeg) content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: src.jpeg } });
  content.push({ type: "text", text: `Class: ${course || "(say which)"}\n${src.pageText ? `Syllabus text:\n${src.pageText.slice(0, 30000)}` : src.pdf ? "The syllabus is the attached PDF." : "The syllabus is on screen."}` });
  const r = await callTool<{ found: boolean; course?: string; categories: { name: string; weight: number }[]; scheme?: { letter: string; min: number }[] }>(
    {
      max_tokens: 1200,
      system: `${persona()}\nRead how this class's final grade is calculated. Copy the categories and their weights exactly as the syllabus gives them. Never guess numbers that aren't there.`,
      tools: [WEIGHTS_TOOL],
      tool_choice: { type: "auto" },
      messages: [{ role: "user", content }],
    },
    WEIGHTS_TOOL.name
  );
  if (!r.ok) return r;
  const cats = (r.data.categories ?? []).filter((c) => c?.name && c.weight > 0);
  if (!r.data.found || !cats.length) return { ok: false, text: "I couldn't find how the grade is calculated on this page. Scroll to the grading part of the syllabus and ask me again." };
  const name = course || r.data.course || "this class";
  const b = findBook(name) ?? { course: name, cats: [], scores: [], updated: Date.now() };
  b.cats = cats;
  if (r.data.scheme?.length) b.scheme = r.data.scheme;
  b.scores = b.scores.map((s) => (s.cat === "Other" ? { ...s, cat: catFor(s.name, cats) ?? "Other" } : s)); // file earlier scores
  saveBook(b);
  bb("gradebook", "syllabus", { course: b.course, cats: cats.length });
  const total = cats.reduce((n, c) => n + c.weight, 0);
  return { ok: true, text: `Got it. ${b.course}: ${cats.map((c) => `${c.name} ${c.weight}%`).join(", ")}.${Math.abs(total - 100) > 2 ? ` That adds up to ${total}%, so double-check me.` : ""} Now just tell me your scores as you get them.` };
}

// ---------- for the forecaster ----------
/** The book as a grade sheet (each category = the average of its scores). Null if no weights yet. */
export function bookSheet(course: string, exam = "final"): GradeSheet | null {
  const b = findBook(course);
  if (!b || !b.cats.length) return null;
  const finalCat = b.cats.find((c) => new RegExp(`\\b${exam}\\b`, "i").test(c.name)) ?? b.cats.find((c) => /final/i.test(c.name)) ?? null;
  const categories = b.cats.map((c) => {
    const s = b.scores.filter((x) => x.cat === c.name);
    return s.length ? { name: c.name, weight: c.weight, percent: (100 * s.reduce((n, x) => n + x.earned / x.possible, 0)) / s.length } : { name: c.name, weight: c.weight, percent: null };
  });
  return { course: b.course, categories, final: finalCat ? { name: finalCat.name, weight: finalCat.weight, possible: null } : null, scheme: b.scheme };
}
/** "What's my grade in stats?" from the scores so far. */
export function gradeNow(course: string): { ok: boolean; text: string } {
  const b = findBook(course);
  if (!b || !b.scores.length) return { ok: false, text: `I don't have any scores for ${course} yet. Tell me one, like "I got an 85 on the midterm".` };
  if (!b.cats.length) {
    const avg = (100 * b.scores.reduce((n, x) => n + x.earned / x.possible, 0)) / b.scores.length;
    return { ok: true, text: `Your average so far in ${b.course} is about ${Math.round(avg)}%. Show me the syllabus so I can weight it right.` };
  }
  const graded = bookSheet(b.course)!.categories.filter((c) => c.percent != null);
  const w = graded.reduce((n, c) => n + (c.weight ?? 0), 0);
  const pct = graded.reduce((n, c) => n + (c.weight ?? 0) * (c.percent ?? 0), 0) / (w || 1);
  return { ok: true, text: `You're at about ${Math.round(pct)}% in ${b.course}, counting ${graded.map((c) => c.name).join(", ")} so far.` };
}

/** "The final is worth 25 percent": add or fix one part of the grade. */
export function setWeight(course: string, part: string, weight: number): boolean {
  const b = findBook(course);
  if (!b) return false;
  const name = part.replace(/\b\w/g, (c) => c.toUpperCase());
  const c = b.cats.find((x) => catFor(part, [x]) || x.name.toLowerCase() === part.toLowerCase());
  if (c) c.weight = weight;
  else b.cats.push({ name, weight });
  b.scores = b.scores.map((x) => (x.cat === "Other" ? { ...x, cat: catFor(x.name, b.cats) ?? "Other" } : x)); // file earlier scores
  saveBook(b);
  return true;
}

/** The class's letter-grade cutoffs (from its syllabus). Creates the class's book if needed. */
export function setScheme(course: string, scheme: { letter: string; min: number }[]) {
  const b = findBook(course) ?? { course, cats: [], scores: [], updated: Date.now() };
  b.scheme = scheme;
  saveBook(b);
}
