// Your classes. Every Kit app tailors itself to the class you're working on: a stats class gets
// data sets and histograms, an English class gets thesis practice and plot diagrams, and so on.

import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { callTool, persona, type ApiErr, type ApiOk } from "./brain";

export type Subject = "math" | "stats" | "science" | "english" | "history" | "language" | "cs" | "business" | "arts" | "other";
export type Klass = { id: string; name: string; code: string; subject: Subject; color: string };
type Store = { classes: Klass[]; active: string | null; updated?: number };
// sync: told when the class list changes (not when you just switch classes)
const listeners: (() => void)[] = [];
export const onClassesChange = (fn: () => void) => listeners.push(fn);

export const SUBJECTS: Subject[] = ["math", "stats", "science", "english", "history", "language", "cs", "business", "arts", "other"];
export const COLORS = ["#a78bfa", "#38bdf8", "#34d399", "#f472b6", "#fbbf24", "#fb923c", "#60a5fa"];

const file = () => path.join(app.getPath("userData"), "classes.json");
export function loadClasses(): Store {
  try {
    const s = JSON.parse(fs.readFileSync(file(), "utf8")) as Store;
    return { classes: Array.isArray(s.classes) ? s.classes : [], active: s.active ?? null, updated: Number(s.updated) || 0 };
  } catch {
    return { classes: [], active: null };
  }
}
export function saveClasses(s: Store, fromSync?: number) {
  const before = loadClasses();
  const clean: Store = {
    classes: s.classes.slice(0, 8).map((c, i) => ({
      id: String(c.id || `c${Date.now().toString(36)}${i}`),
      name: String(c.name || "").slice(0, 80),
      code: String(c.code || "").slice(0, 24),
      subject: SUBJECTS.includes(c.subject) ? c.subject : "other",
      color: c.color || COLORS[i % COLORS.length],
    })).filter((c) => c.name.trim()),
    active: s.active,
  };
  if (clean.active && !clean.classes.some((c) => c.id === clean.active)) clean.active = null;
  // the list itself changed (not just which class is on): stamp it, so the newest list wins across your Macs
  const changed = JSON.stringify(before.classes) !== JSON.stringify(clean.classes);
  clean.updated = fromSync ?? (changed ? Date.now() : before.updated ?? 0);
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(file(), JSON.stringify(clean, null, 1));
  } catch {
    /* ignore */
  }
  if (changed && fromSync === undefined) for (const fn of listeners) fn();
  return clean;
}

export const SUBJECT_WORDS: Record<Subject, RegExp> = {
  stats: /\b(stats?|statistics|probability|biostat)/i,
  math: /\b(math|calc(ulus)?|algebra|trig|geometry|precalc|linear algebra|differential)/i,
  science: /\b(bio(logy)?|chem(istry)?|physics|anatomy|science|geology|astronomy|neuro|lab)\b/i,
  english: /\b(english|writing|comp(osition)?|lit(erature)?|essay|rhetoric|poetry)\b/i,
  history: /\b(history|hist|government|gov|poli ?sci|political|civics|religion|theology|philosophy)\b/i,
  language: /\b(spanish|french|german|italian|chinese|mandarin|japanese|latin|arabic|portuguese|language)\b/i,
  cs: /\b(computer science|cs|coding|programming|python|java|software)\b/i,
  business: /\b(business|econ(omics)?|accounting|finance|marketing|management|supply chain)\b/i,
  arts: /\b(art|music|design|film|theat(er|re)|drawing)\b/i,
  other: /$^/,
};

/** Which class is this request about? An explicit mention wins, otherwise the active class. */
/** Only a class the text actually names (code, name, or subject + "class"); never falls back to the active class. */
export function classNamed(text: string): Klass | null {
  const s = loadClasses();
  const t = text.toLowerCase();
  for (const c of s.classes) {
    const words = [c.code, c.name].filter(Boolean).map((w) => w.toLowerCase());
    if (words.some((w) => w.length > 2 && t.includes(w))) return c;
    const code = c.code.toLowerCase().match(/^([a-z]{2,5})\s*(\d{3,5})/);
    if (code && new RegExp(`\\b${code[1]}\\s*${code[2]}\\b`).test(t)) return c;
    // the first real word of the name ("Statistical" in "Statistical Analysis") or its short form ("stats")
    const first = c.name.toLowerCase().split(/\s+/).find((w) => w.length > 3 && !["intro", "introduction", "principles", "understanding"].includes(w));
    if (first && new RegExp(`\\b${first.slice(0, 4)}`).test(t)) return c;
  }
  for (const c of s.classes) if (c.subject !== "other" && SUBJECT_WORDS[c.subject].test(t)) return c;
  return null;
}
export const classById = (id: string | null) => (id ? loadClasses().classes.find((c) => c.id === id) ?? null : null);

export function classFor(request: string): Klass | null {
  const s = loadClasses();
  const t = request.toLowerCase();
  for (const c of s.classes) {
    const words = [c.code, c.name].filter(Boolean).map((w) => w.toLowerCase());
    if (words.some((w) => w.length > 2 && t.includes(w))) return c;
    const code = c.code.toLowerCase().match(/^([a-z]{2,5})\s*(\d{3,5})/);
    if (code && new RegExp(`\\b${code[1]}\\s*${code[2]}\\b`).test(t)) return c;
  }
  for (const c of s.classes) if (c.subject !== "other" && SUBJECT_WORDS[c.subject].test(t) && /\b(class|course|for|in|my)\b/.test(t)) return c;
  return s.classes.find((c) => c.id === s.active) ?? null;
}

const GUIDE: Record<Subject, string> = {
  stats:
    "Statistics class: use real-feeling data sets (test scores, heights, survey results, sports stats), proper notation (x̄, s, μ, σ, p̂, z, t), and show calculator-free steps. Histograms, box plots, normal curves and scatter plots are the natural visuals.",
  math:
    "Math class: precise notation in $...$, exam-style problems with every algebra step, graphs of functions when they help.",
  science:
    "Science class: labeled diagrams (cells, organs, molecules, forces, circuits), units and significant figures in every number, lab-style data tables with units in the column names.",
  english:
    "English/writing class: NO math. Think close reading, thesis statements, claims and evidence, literary devices, grammar, MLA citations, vocabulary. Visuals are plot diagrams, essay outline maps, character maps and argument maps. Tables are source trackers, quote logs with page numbers and reading logs.",
  history:
    "History/social science class: dates, causes and effects, key people, primary source analysis, compare and contrast. Visuals are timelines, cause-and-effect chains and maps. Tables are timelines and comparison charts.",
  language:
    "Foreign language class: vocabulary with translations, verb conjugation tables, short sentences to translate both ways, common phrases. Keep the target language accurate, with accents.",
  cs: "Computer science class: short code snippets in monospace, tracing exercises (what does this print?), big-O, data structures. Visuals are flowcharts and memory/data-structure diagrams.",
  business:
    "Business/economics class: realistic numbers in dollars, supply and demand, elasticity, break-even, financial ratios, budgets. Graphs are supply/demand curves, cost curves and bar/line charts of money over time.",
  arts: "Arts class: terms, movements, artists, techniques, analysis vocabulary. Visuals are labeled diagrams and timelines.",
  other: "",
};

export function classLine(c: Klass | null): string {
  if (!c) return "";
  return `\nThe student is working on their class "${c.code ? `${c.code} ` : ""}${c.name}". Tailor everything to it. ${GUIDE[c.subject]}`;
}

/** "My classes are stats, English comp, bio, US history and Spanish" (or a D2L course list) -> classes. */
export async function parseClasses(text: string): Promise<ApiOk<{ classes: { name: string; code: string; subject: Subject }[]; say: string }> | ApiErr> {
  return callTool(
    {
      max_tokens: 1000,
      model: process.env.MILO_FAST_MODEL || "claude-haiku-5-5",
      system: `${persona()}
Pull the student's classes out of the text (up to 7). name = a clean readable course name ("Elementary Statistics", "English Composition"); code = the course code if one is given (like "STAT 2023"), else "". subject = the best fit from: ${SUBJECTS.join(", ")}. say = one short sentence confirming them.`,
      tools: [
        {
          name: "classes",
          description: "The student's classes.",
          input_schema: {
            type: "object",
            properties: {
              classes: {
                type: "array",
                items: {
                  type: "object",
                  properties: { name: { type: "string" }, code: { type: "string" }, subject: { type: "string", enum: SUBJECTS } },
                  required: ["name", "subject"],
                },
              },
              say: { type: "string" },
            },
            required: ["classes", "say"],
          },
        },
      ],
      tool_choice: { type: "auto" },
      messages: [{ role: "user", content: text.slice(0, 8000) }],
    },
    "classes"
  );
}
