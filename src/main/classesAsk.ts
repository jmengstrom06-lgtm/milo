// "Ask anything about my classes": grades, a single score, the professor's feedback, quizzes, discussions,
// assignments, what's missing, how they compare. One answerer over the real D2L data (classData.ts), not one
// regex per phrasing. It only reads: numbers come from D2L as worked out in classData, never estimated.
// Things that need doing (exact "what do I need" math, a discussion post, quiz prep, opening a page) come
// back as an action for Milo to run.

import { callTool, persona } from "./brain";
import { models } from "./gateway";
import { snapshotText, type Snapshot } from "./classData";

export type ClassAction =
  | { kind: "none" }
  | { kind: "forecast"; course: string; letter: string; exam: string }
  | { kind: "open"; course: string; page: "grades" | "quizzes" | "discussions" | "assignments" | "content" | "home" | "announcements" }
  | { kind: "discussion"; course: string; topic: string }
  | { kind: "quiz_prep"; course: string; quiz: string };
export type ClassAnswer = { answer: string; course: string; rows: { label: string; value: string; note?: string }[]; action: ClassAction; needMore: boolean };

const TOOL = {
  name: "classes_answer",
  description: "Answer the student's question about their classes from the D2L data.",
  input_schema: {
    type: "object",
    properties: {
      answer: { type: "string", description: "What Milo says out loud: the direct answer first, 1 to 3 short sentences, plain words, no markdown, no em dashes." },
      course: { type: "string", description: "Short name of the class this is about, or empty if several/none." },
      rows: {
        type: "array",
        description: "The specific facts behind the answer to show on screen (max 8), copied from the data: e.g. label 'Exam 2', value '42/50 (84%)', note 'Feedback: ...'. Empty for a simple yes/no.",
        items: { type: "object", properties: { label: { type: "string" }, value: { type: "string" }, note: { type: "string" } }, required: ["label", "value"] },
      },
      action: {
        type: "object",
        description:
          "Something Milo should DO after answering, only when the student asked for it. forecast = 'what do I need on X to get/keep a Y' (exact math happens there, never do it yourself). open = they asked to see/open/go to/pull up a D2L page. discussion = they want to write/do/reply to a discussion post. quiz_prep = they want to study/practice/prepare/get ready for a quiz or exam. none otherwise.",
        properties: {
          kind: { type: "string", enum: ["none", "forecast", "open", "discussion", "quiz_prep"] },
          course: { type: "string" },
          letter: { type: "string", description: "forecast: the letter they want (A, B+, C...)." },
          exam: { type: "string", description: "forecast: which exam/item, e.g. 'final', 'exam 3'." },
          page: { type: "string", enum: ["grades", "quizzes", "discussions", "assignments", "content", "home", "announcements"] },
          topic: { type: "string", description: "discussion: the topic name if known." },
          quiz: { type: "string", description: "quiz_prep: the quiz or exam name if known." },
        },
        required: ["kind"],
      },
      need_more: { type: "boolean", description: "True ONLY if the question is about a class that isn't in the data below (only some classes were read)." },
    },
    required: ["answer", "rows", "action"],
  },
};

/** The answerer's instructions (exported for the bench). */
export const RULES = `You answer a college student's questions about their own classes, using ONLY the D2L data given (their real grades, quizzes, discussions and assignments).
- Answer exactly what was asked, first. "What did I get on exam 2" = that score. "How am I doing" = current grade (+ the one thing that stands out). "Anything new?" = the most recently updated grades.
- Never invent or estimate a grade, a date, a time limit or a comment. Copy numbers as given; you may compare, count and pick highest/lowest, but don't compute new grades. If what they asked isn't in the data, say plainly what's missing (e.g. "Your professor hasn't posted Exam 3 yet" or "D2L doesn't show a time limit for that quiz") and, if it helps, where to look.
- "What do I need on the final to get a B" is a forecast action, never your own math: answer "Let me work that out." and set action forecast.
- Dates: say them relative to today when close ("tomorrow at 11:59 PM", "Tuesday", "in 3 days"), else the date.
- Professor feedback: say what it says, briefly, in your words unless they ask for the exact words.
- "Missing" or "behind" = past due and not turned in / not posted, and graded zeros.
- If they didn't name a class and the answer differs by class, cover every class briefly (biggest first) instead of asking.
- Speak like a friend, short. No markdown, no em dashes, no lists in the answer (rows are for the list).`;

/** Read the student's question against the data. */
export async function answerClasses(ask: string, snap: Snapshot, now = Date.now()): Promise<{ ok: true; data: ClassAnswer } | { ok: false; text: string }> {
  const r = await callTool<{ answer: string; course?: string; rows?: { label: string; value: string; note?: string }[]; action?: Record<string, string>; need_more?: boolean }>(
    {
      model: models.smart(),
      max_tokens: 1500,
      system: `${persona()}\n${RULES}${snap.all ? "" : `\nOnly ${snap.classes.map((c) => c.course.short).join(", ")} was read. If the question is about a different class (or needs all of them), set need_more.`}`,
      tools: [TOOL],
      tool_choice: { type: "tool", name: TOOL.name },
      messages: [{ role: "user", content: `D2L data:\n${snapshotText(snap, now)}\n\nThe student asked: "${ask}"` }],
    },
    TOOL.name
  );
  if (!r.ok) return { ok: false, text: r.text };
  return { ok: true, data: cleanAnswer(r.data) };
}

/** Tidy what the model gave: known action kinds only, rows capped, no em dashes. (pure) */
export function cleanAnswer(d: { answer?: string; course?: string; rows?: { label: string; value: string; note?: string }[]; action?: Record<string, string>; need_more?: boolean }): ClassAnswer {
  const a = d.action ?? {};
  const s = (x: unknown) => (typeof x === "string" ? x.trim() : "");
  const course = s(a.course) || s(d.course);
  const page = ["grades", "quizzes", "discussions", "assignments", "content", "home", "announcements"].includes(s(a.page)) ? (s(a.page) as Extract<ClassAction, { kind: "open" }>["page"]) : "home";
  const action: ClassAction =
    a.kind === "forecast" && s(a.letter)
      ? { kind: "forecast", course, letter: s(a.letter).toUpperCase(), exam: s(a.exam) || "final" }
      : a.kind === "open"
        ? { kind: "open", course, page }
        : a.kind === "discussion"
          ? { kind: "discussion", course, topic: s(a.topic) }
          : a.kind === "quiz_prep"
            ? { kind: "quiz_prep", course, quiz: s(a.quiz) }
            : { kind: "none" };
  const dash = (t: string) => t.replace(/\s*[—–]\s*/g, ", ");
  return {
    answer: dash(s(d.answer)) || "I couldn't find that in D2L.",
    course: s(d.course),
    rows: (Array.isArray(d.rows) ? d.rows : []).filter((x) => x && s(x.label)).slice(0, 8).map((x) => ({ label: dash(s(x.label)).slice(0, 80), value: dash(s(x.value)).slice(0, 80), ...(s(x.note) ? { note: dash(s(x.note)).slice(0, 300) } : {}) })),
    action,
    needMore: !!d.need_more,
  };
}
