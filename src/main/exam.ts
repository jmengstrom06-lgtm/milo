// Exam-proof mode: a practice test that looks like the real one, built from what this class has actually
// covered (saved notes, study sets, what's due). Homework help turns into passing the exam.

import { callTool, persona, type QuizData } from "./brain";
import { loadClasses } from "./classes";
import { listItems } from "./library";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Everything Milo has saved for this class, as text (capped). */
export function classMaterials(course: string): { className: string; text: string } {
  const classes = loadClasses().classes ?? [];
  const n = norm(course);
  const k = classes.find((c) => norm(c.name) === n || norm(c.code) === n) ?? classes.find((c) => n && (norm(c.name).includes(n) || n.includes(norm(c.name)) || (c.code && n.includes(norm(c.code)))));
  const items = k ? listItems({ classId: k.id, app: "all" }) : [];
  const parts = items
    .filter((i) => i.app !== "sketch") // drawings are pictures, not text
    .slice(0, 20)
    .map((i) => `## ${i.title} (${i.app})\n${JSON.stringify(i.data).replace(/\\n/g, "\n").slice(0, 4000)}`);
  return { className: k ? k.name : course, text: parts.join("\n\n").slice(0, 40000) };
}

const EXAM_TOOL = {
  name: "practice_exam",
  description: "A practice exam.",
  input_schema: {
    type: "object",
    properties: {
      topic: { type: "string", description: "e.g. 'Stats midterm practice'." },
      questions: {
        type: "array",
        minItems: 6,
        maxItems: 15,
        items: {
          type: "object",
          properties: {
            q: { type: "string", description: "Exam-style question. Math in $...$ LaTeX allowed. Mix: concepts, worked problems, and 'which is true' traps students get wrong." },
            choices: { type: "array", items: { type: "string" }, description: "Exactly 4 choices with realistic wrong answers (common mistakes)." },
            correct: { type: "number", description: "Index 0-3." },
            explain: { type: "string", description: "One short spoken sentence on why (no LaTeX)." },
          },
          required: ["q", "choices", "correct", "explain"],
        },
      },
    },
    required: ["topic", "questions"],
  },
};

export async function makeExam(course: string, kind: string, extra: string, count = 10, from?: { material?: string; docs?: string[]; className?: string }) {
  const m = classMaterials(course);
  const mine = [from?.material, m.text].filter(Boolean).join("\n\n").slice(0, 60000);
  const material = mine || (from?.docs?.length ? "(the attached course files)" : "(No saved notes for this class yet: use what a typical course with this name covers at this point in the semester, and say so in the topic.)");
  const docs = (from?.docs ?? []).slice(0, 2).map((d) => ({ type: "document", source: { type: "base64", media_type: "application/pdf", data: d } }));
  return callTool<QuizData>(
    {
      max_tokens: 6000,
      system: `${persona()}\nWrite a practice ${kind || "exam"} for a college student. Make it feel like the real thing: the same kinds of questions a professor would put on a ${kind || "exam"}, at real difficulty, not easy recall. Build it from the class material given. ${count} questions.`,
      tools: [EXAM_TOOL],
      tool_choice: { type: "auto" },
      messages: [{ role: "user", content: [...docs, { type: "text", text: `Class: ${from?.className || m.className}\nWhat's coming up: ${extra || "(unknown)"}\n\nClass material:\n${material}` }] }],
    },
    EXAM_TOOL.name
  );
}
