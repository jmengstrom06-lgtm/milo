// `npm run eval:classes` : "ask anything about my classes", graded. Real AI over a realistic D2L snapshot
// (4 classes: grades with feedback, quizzes, discussions, turn-ins, one part D2L wouldn't give). 40 different
// things students ask, each checked for the RIGHT fact (or the right action), and that nothing is invented.
// Needs ANTHROPIC_API_KEY. Fails under 90%.
import path from "node:path";
import dotenv from "dotenv";
import { answerClasses, type ClassAnswer } from "../src/main/classesAsk";
import type { ClassInfo, Snapshot } from "../src/main/classData";

dotenv.config({ path: path.join(__dirname, "..", ".env") });
const BAR = 0.9;
const NOW = Date.parse("2026-11-27T18:00:00Z"); // Friday
const day = (n: number, h = 23, m = 59) => new Date(Date.UTC(2026, 10, 27 + n, h + 6, m)).toISOString(); // Central time
const C = (id: number, short: string, name: string) => ({ id, short, name, code: "", subject: "" });

const stats: ClassInfo = {
  course: C(1, "Statistics", "Statistical Analysis 2023"),
  current: { pct: 86.4, shown: "86.4 %" },
  categories: [
    { name: "Homework", weight: 20, pct: 82.5 },
    { name: "Exams", weight: 50, pct: 88.7 },
    { name: "Final", weight: 30, pct: null },
  ],
  grades: [
    { id: 1, name: "Exam 1", category: "Exams", score: 42, outOf: 50, pct: 84, shown: "84 %", weight: null, feedback: "Good work. Watch your units on #4.", when: day(-50, 10) },
    { id: 2, name: "Exam 2", category: "Exams", score: 91, outOf: 100, pct: 91, shown: "91 %", weight: null, feedback: "", when: day(-20, 10) },
    { id: 3, name: "Exam 3", category: "Exams", score: null, outOf: 100, pct: null, shown: "", weight: null, feedback: "", when: null },
    { id: 4, name: "HW 1", category: "Homework", score: 10, outOf: 10, pct: 100, shown: "", weight: null, feedback: "", when: day(-60, 10) },
    { id: 5, name: "HW 2", category: "Homework", score: 9, outOf: 10, pct: 90, shown: "", weight: null, feedback: "", when: day(-45, 10) },
    { id: 6, name: "HW 3", category: "Homework", score: 6, outOf: 10, pct: 60, shown: "", weight: null, feedback: "Late, 40% off.", when: day(-2, 14) },
    { id: 7, name: "Final Exam", category: "Final", score: null, outOf: 150, pct: null, shown: "", weight: null, feedback: "", when: null },
  ],
  quizzes: [
    { id: 11, name: "Quiz 5: Sampling Distributions", due: day(4), start: null, end: day(4), minutes: 30, attempts: 2, about: "Covers chapter 7." },
    { id: 12, name: "Quiz 4", due: day(-10), start: null, end: day(-10), minutes: 30, attempts: 2, about: "" },
  ],
  discussions: [],
  assignments: [{ id: 21, name: "Project Proposal", due: day(6), submitted: false, at: null }],
  unread: [],
};
const bio: ClassInfo = {
  course: C(2, "Biology", "Contemporary Issues in Biology 1003"),
  current: { pct: 79.2, shown: "79.2 %" },
  categories: [],
  grades: [
    { id: 31, name: "Lab 3", category: "", score: 18, outOf: 20, pct: 90, shown: "", weight: 10, feedback: "", when: day(-12, 9) },
    { id: 32, name: "Midterm", category: "", score: 68, outOf: 100, pct: 68, shown: "", weight: 25, feedback: "Review cell respiration.", when: day(-1, 16) },
  ],
  quizzes: [{ id: 41, name: "Quiz 8: Genetics", due: day(2), start: day(1, 8, 0), end: day(3), minutes: 20, attempts: 1, about: "Mendelian genetics and Punnett squares." }],
  discussions: [],
  assignments: [
    { id: 51, name: "Lab Report 4", due: day(-1), submitted: true, at: day(-2, 21) },
    { id: 52, name: "Lab Report 5", due: day(8), submitted: null, at: null },
  ],
  unread: [],
};
const psych: ClassInfo = {
  course: C(3, "Psychology", "General Psychology 10213"),
  current: { pct: 93.1, shown: "93.1 %" },
  categories: [],
  grades: [{ id: 61, name: "Discussion Week 12", category: "", score: 10, outOf: 10, pct: 100, shown: "", weight: null, feedback: "", when: day(-6, 9) }],
  quizzes: [{ id: 71, name: "Chapter 11 Quiz", due: day(9), start: null, end: null, minutes: null, attempts: null, about: "" }],
  discussions: [
    { forumId: 1, topicId: 81, name: "Week 13: Social Influence", forum: "Weekly Discussions", due: day(2), end: null, locked: false, posted: false, replies: 0 },
    { forumId: 1, topicId: 82, name: "Week 12: Memory", forum: "Weekly Discussions", due: day(-5), end: null, locked: false, posted: true, replies: 2 },
  ],
  assignments: [],
  unread: [],
};
const english: ClassInfo = {
  course: C(4, "Composition", "Composition: Intro to Writing ENGL 10803"),
  current: { pct: 81, shown: "B-" },
  categories: [],
  grades: [{ id: 91, name: "Persuasive Essay", category: "", score: 41, outOf: 50, pct: 82, shown: "", weight: 20, feedback: "Strong evidence, but your thesis is buried in paragraph two. Move it to the end of the intro.", when: day(-3, 11) }],
  quizzes: [],
  discussions: [],
  assignments: [
    { id: 101, name: "Reflection 3", due: day(-2), submitted: false, at: null },
    { id: 102, name: "Research Paper Draft", due: day(10), submitted: false, at: null },
  ],
  unread: ["quizzes"],
};
const ALL: Snapshot = { at: NOW, all: true, classes: [stats, bio, psych, english] };
const ONLY_STATS: Snapshot = { at: NOW, all: false, classes: [stats] };

type Check = (a: ClassAnswer) => true | string;
const say = (re: RegExp, why = String(re)): Check => (a) => re.test(`${a.answer} ${a.rows.map((r) => `${r.label} ${r.value} ${r.note ?? ""}`).join(" ")}`) || `missing ${why}: "${a.answer}"`;
const spoken = (re: RegExp): Check => (a) => re.test(a.answer) || `answer should match ${re}: "${a.answer}"`;
const not = (re: RegExp): Check => (a) => !re.test(a.answer) || `said ${re}: "${a.answer}"`;
const act = (kind: string, more: (x: Record<string, string>) => boolean = () => true): Check => (a) => (a.action.kind === kind && more(a.action as unknown as Record<string, string>)) || `action ${JSON.stringify(a.action)}, wanted ${kind}`;
const all = (...cs: Check[]): Check => (a) => {
  for (const c of cs) {
    const r = c(a);
    if (r !== true) return r;
  }
  return true;
};
type Case = { ask: string; snap?: Snapshot; check: Check; also?: (a: ClassAnswer) => true | string };
const CASES: Case[] = [
  // grades
  { ask: "what's my grade in stats", check: all(spoken(/86\.4/), act("none")) },
  { ask: "what did I get on exam 2 in stats", check: spoken(/\b91\b/) },
  { ask: "how many points was stats exam 1 out of", check: spoken(/\b50\b/) },
  { ask: "what's my lowest grade in statistics", check: spoken(/HW 3|homework 3/i) },
  { ask: "which class am I doing worst in", check: all(spoken(/bio/i), spoken(/79/)) },
  { ask: "which class is my best", check: spoken(/psych/i) },
  { ask: "what's my average across all my classes", check: spoken(/8[45]\.\d|85\b|84\b/) },
  { ask: "how am I doing in my classes", check: all(spoken(/psych|93/i), spoken(/bio|79/i)) },
  { ask: "am I passing biology", check: all(spoken(/\byes\b|passing/i), spoken(/79/)) },
  { ask: "any new grades?", check: spoken(/HW 3|homework 3|midterm/i) },
  { ask: "what did I get on my bio midterm", check: spoken(/\b68\b/) },
  { ask: "has stats exam 3 been graded yet", check: all(spoken(/\bnot\b|hasn't|isn't|no\b/i), not(/\b\d{2}(\.\d)?\s*(%|percent|out of)/i)) },
  { ask: "what's left to be graded in stats", check: all(say(/exam 3/i), say(/final/i)) },
  { ask: "how much is homework worth in stats", check: spoken(/20/) },
  { ask: "what's my homework average in stats", check: spoken(/82\.5/) },
  { ask: "what's my GPA", check: not(/\b[0-4]\.\d{1,2}\b(?!\s*%)/) },
  { ask: "what's my grade in history", check: all(not(/\b\d{2}(\.\d)?\s*(%|percent)/i), spoken(/history/i)) },
  // feedback
  { ask: "what did my professor say about my essay", check: spoken(/thesis/i) },
  { ask: "did I get any feedback on stats exam 1", check: spoken(/unit/i) },
  { ask: "why did I lose points on homework 3", check: spoken(/late/i) },
  // quizzes
  { ask: "when's my next quiz", check: spoken(/genetics|quiz 8|bio/i) },
  { ask: "how long is the bio quiz", check: spoken(/20\s*min|twenty min/i) },
  { ask: "how many attempts do I get on the stats quiz", check: spoken(/\b(2|two)\b/i) },
  { ask: "is there a time limit on my psych quiz", check: all(spoken(/no|doesn't|not|isn't/i), not(/\b\d+\s*min/i)) },
  { ask: "when does the bio quiz open", check: spoken(/sat|tomorrow|nov(ember)? 28|28/i) },
  { ask: "do I have any quizzes in english", check: all(spoken(/couldn't|could not|can't|wasn't able|unable|not able|didn't/i), not(/\bno quizzes\b/i)) },
  { ask: "what's on the stats quiz", check: spoken(/chapter 7|sampling/i) },
  // discussions
  { ask: "did I post in psych this week", check: all(spoken(/\bno\b|haven't|not yet|didn't/i), spoken(/social influence|week 13/i)) },
  { ask: "which discussions haven't I done", check: spoken(/social influence|week 13|psych/i) },
  { ask: "did I reply to anyone in the psych memory discussion", check: spoken(/\b(2|two)\b/i) },
  // turn-ins
  { ask: "did I turn in my bio lab report", check: all(spoken(/\byes\b|turned|submitted/i), spoken(/4|lab report/i)) },
  { ask: "am I missing anything", check: spoken(/reflection 3/i) },
  { ask: "did I submit lab report 5", check: all(spoken(/can't tell|not sure|don't know|can't see|unknown|doesn't show|isn't due|not due|can't confirm|no record|not showing|couldn't/i), not(/\byes\b/i)) },
  // actions
  { ask: "what do I need on the final for a B in stats", check: act("forecast", (x) => /^B$/i.test(x.letter) && /final/i.test(x.exam)) },
  { ask: "help me get ready for my bio quiz", check: act("quiz_prep", (x) => /bio/i.test(x.course)) },
  { ask: "can you help me study for the stats quiz", check: act("quiz_prep", (x) => /stat/i.test(x.course)) },
  { ask: "pull up my stats grades", check: act("open", (x) => x.page === "grades" && /stat/i.test(x.course)) },
  { ask: "write my psych discussion post", check: act("discussion", (x) => /psych/i.test(x.course)) },
  // only one class read
  { ask: "what's my grade in bio", snap: ONLY_STATS, check: (a) => a.needMore || `need_more not set: "${a.answer}"` },
  { ask: "what's my stats grade", snap: ONLY_STATS, check: all(spoken(/86\.4/), (a) => !a.needMore || "asked for more") },
];

async function main() {
  const only = (process.env.CLASSES_ONLY ?? "").split(",").map((x) => Number(x.trim())).filter((n) => n > 0);
  const picked = CASES.map((c, i) => ({ c, i: i + 1 })).filter((x) => !only.length || only.includes(x.i));
  let pass = 0;
  const fails: string[] = [];
  const t0 = Date.now();
  // a few at a time, like real use
  for (let k = 0; k < picked.length; k += 5) {
    const batch = picked.slice(k, k + 5);
    const out = await Promise.all(
      batch.map(async ({ c, i }) => {
        const s = Date.now();
        const r = await answerClasses(c.ask, c.snap ?? ALL, NOW).catch((e) => ({ ok: false as const, text: (e as Error).message }));
        const verdict = r.ok ? c.check(r.data) : `error: ${r.text}`;
        return { i, c, r, verdict, ms: Date.now() - s };
      })
    );
    for (const o of out) {
      const ok = o.verdict === true;
      if (ok) pass++;
      else fails.push(`#${o.i} "${o.c.ask}": ${o.verdict}`);
      console.log(`${ok ? "PASS" : "FAIL"} #${o.i} (${(o.ms / 1000).toFixed(1)}s) ${o.c.ask}${o.r.ok ? `\n   -> ${o.r.data.answer}${o.r.data.action.kind !== "none" ? ` [${JSON.stringify(o.r.data.action)}]` : ""}` : ""}${ok ? "" : `\n   !! ${o.verdict}`}`);
    }
  }
  const rate = pass / picked.length;
  console.log(`\nClasses bench: ${pass}/${picked.length} (${Math.round(rate * 100)}%) in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  if (fails.length) console.log(`Failed:\n${fails.join("\n")}`);
  if (rate < BAR) process.exit(1);
}
void main();
