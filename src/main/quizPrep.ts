// "Help me get ready for my bio quiz": find the quiz in D2L, find the course files it covers (same chapter /
// module / week, or the words in its name and description), and build a practice quiz from them.
// Milo never takes or submits the real quiz from here. Ranking is pure (tested).

import { log as bb } from "./blackbox";
import { contentTopics, type Course } from "./d2l";
import { makeExam } from "./exam";
import { readTopic } from "./syllabus";
import type { QuizInfo } from "./classData";

type T = { Title: string; Url: string; TypeIdentifier?: string; path: string };
const STOP = new Set(["quiz", "quizzes", "exam", "test", "midterm", "final", "practice", "review", "online", "graded", "points", "minutes", "attempt", "attempts", "this", "that", "with", "from", "will", "your", "have", "covers", "cover", "over", "about", "questions", "question", "chapter", "chapters", "module", "unit", "week", "lesson", "part", "section", "the", "and", "for"]);
const UNIT = /\b(chapter|chapters|ch|module|mod|unit|week|wk|lesson|lecture|section|topic)\.?\s*(\d{1,2})(?:\s*(?:-|–|to|and|&)\s*(\d{1,2}))?/gi;

/** Numbers like "Chapter 5" or "Chapters 3-4" or "Quiz 5" (a quiz number often = the chapter). (pure) */
export function unitsOf(text: string): number[] {
  const out = new Set<number>();
  for (const m of text.matchAll(UNIT)) {
    const a = Number(m[2]);
    const b = m[3] ? Number(m[3]) : a;
    for (let i = a; i <= Math.min(b, a + 6); i++) out.add(i);
  }
  return [...out];
}

/** The course files a quiz most likely covers, best first. (pure) */
export function pickMaterial(topics: T[], quiz: { name: string; about?: string }, n = 3): T[] {
  const text = `${quiz.name} ${quiz.about ?? ""}`;
  let units = unitsOf(text);
  if (!units.length) {
    const q = quiz.name.match(/\b(?:quiz|exam|test)\s*#?\s*(\d{1,2})\b/i);
    if (q) units = [Number(q[1])];
  }
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOP.has(w) && !/^\d+$/.test(w));
  const scored = topics
    .filter((t) => !/syllabus|rubric|schedule|calendar|welcome|introduction to the course|course policies/i.test(`${t.path} ${t.Title}`))
    .map((t) => {
      const hay = `${t.path} ${t.Title}`.toLowerCase();
      let s = 0;
      const tu = unitsOf(`${t.path} ${t.Title}`);
      const sameUnit = units.length > 0 && tu.some((u) => units.includes(u));
      const hits = words.filter((w) => hay.includes(w)).length;
      if (!sameUnit && !hits) return { t, s: 0 }; // nothing ties it to this quiz
      if (sameUnit) s += 10;
      if (units.length && tu.length && !sameUnit) s -= 6; // a different chapter
      s += hits * 3;
      if (/\.(pdf|docx|pptx?|html?)(\?|$)/i.test(t.Url)) s += 1;
      if (/notes|slides|lecture|reading|study guide|review/i.test(hay)) s += 2;
      return { t, s };
    })
    .filter((x) => x.s >= 3)
    .sort((a, b) => b.s - a.s);
  return scored.slice(0, n).map((x) => x.t);
}

/** Build the practice quiz. `quiz` is what D2L knows about the real one (or just its name). */
export async function prepQuiz(portal: string, c: Course, quiz: Pick<QuizInfo, "name" | "about" | "minutes" | "due"> | null, progress: (t: string) => void) {
  const name = quiz?.name || "the next quiz";
  progress(`Finding what ${name} covers…`);
  const topics = (await contentTopics(portal, c).catch(() => [])) as T[];
  const picks = pickMaterial(topics, { name, about: quiz?.about });
  const docs: string[] = [];
  const texts: string[] = [];
  for (const t of picks) {
    const got = await readTopic(portal, t).catch(() => null);
    if (got?.pdf && docs.length < 2) docs.push(got.pdf);
    else if (got?.text) texts.push(`## ${t.path} > ${t.Title}\n${got.text.slice(0, 15000)}`);
  }
  bb("quiz_prep", "material", { course: c.short, quiz: name, topics: topics.length, picked: picks.map((p) => p.Title.slice(0, 40)), pdfs: docs.length, texts: texts.length });
  progress(`Writing your practice quiz for ${name}…`);
  const extra = `${name}${quiz?.due ? `, due ${new Date(quiz.due).toDateString()}` : ""}${quiz?.minutes ? `, ${quiz.minutes} minutes` : ""}${quiz?.about ? `. What the professor says it covers: ${quiz.about}` : ""}`;
  const r = await makeExam(c.short, "quiz", extra, 8, { material: texts.join("\n\n"), docs, className: c.name });
  return { r, used: picks.map((p) => p.Title) };
}
