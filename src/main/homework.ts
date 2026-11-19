// "Milo, start my stats homework": read the assignment that's open and turn it into a Game Plan.
// Small concrete steps, each with minutes, and a step 1 so small it's easy to start (the hardest part).

import { callTool, persona } from "./brain";

export type PlanStep = { text: string; minutes: number; kind: "read" | "solve" | "write" | "research" | "review" | "submit"; detail: string };
export type GamePlan = {
  found: boolean;
  title: string;
  course: string;
  due: string;
  steps: PlanStep[];
  total_minutes: number;
  say: string;
  missing: string;
};

const PLAN_TOOL = {
  name: "game_plan",
  description: "The student's assignment, broken into a game plan.",
  input_schema: {
    type: "object",
    properties: {
      found: { type: "boolean", description: "Is an assignment, homework, problem set, quiz, essay prompt, lab or reading actually visible?" },
      title: { type: "string", description: "Assignment name as shown, short (e.g. 'Homework 7: Hypothesis Tests')." },
      course: { type: "string", description: "Course name or code if visible, else ''." },
      due: { type: "string", description: "Due date/time as shown, short (e.g. 'Fri 11:59 PM'), else ''." },
      steps: {
        type: "array",
        minItems: 0,
        maxItems: 7,
        items: {
          type: "object",
          properties: {
            text: { type: "string", description: "Imperative, at most 9 words, names the real questions/parts (e.g. 'Solve questions 1 to 3: p-values')." },
            minutes: { type: "integer", minimum: 2, maximum: 90 },
            kind: { type: "string", enum: ["read", "solve", "write", "research", "review", "submit"] },
            detail: { type: "string", description: "One sentence: exactly what to do and what 'done' looks like." },
          },
          required: ["text", "minutes", "kind", "detail"],
        },
      },
      total_minutes: { type: "integer" },
      say: { type: "string", description: "What Milo says out loud, under 30 words, upbeat and concrete. Name the assignment, the step count, the time, and step 1." },
      missing: { type: "string", description: "If found is false: one short sentence telling them what to open (e.g. 'Open the assignment page in D2L and say start this.')." },
    },
    required: ["found", "title", "course", "due", "steps", "total_minutes", "say", "missing"],
  },
};

export async function makeGamePlan(src: { hint: string; jpeg?: string; pageText?: string; url?: string; title?: string }) {
  const system = `${persona()}
The student wants to START an assignment and is probably procrastinating. Read the assignment on their screen and build a game plan.
Rules:
- 3 to 7 steps, in the order they should do them. Base every step on what's actually there: real question numbers, parts, word counts, files to submit.
- Step 1 must be tiny and under 5 minutes (read the prompt, open the dataset, write one sentence, do question 1 only). Starting is the hard part.
- Group small questions together; split big ones. Realistic minutes for a college student. Last step is usually checking and submitting.
- You plan; you don't do the work. No answers in the steps.
- If what's on screen isn't an assignment (a home page, a list of courses, an email), set found to false, no steps, and say what to open.`;
  const content: unknown[] = [];
  if (src.jpeg) content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: src.jpeg } });
  const page = src.pageText ? `\n\nThe page (${src.title ?? ""} — ${src.url ?? ""}):\n${src.pageText.slice(0, 16000)}` : "";
  content.push({ type: "text", text: `They said: "${src.hint}". Today is ${new Date().toDateString()}.${page}` });
  const r = await callTool<GamePlan>({ max_tokens: 1800, system, tools: [PLAN_TOOL], tool_choice: { type: "auto" }, messages: [{ role: "user", content }] }, PLAN_TOOL.name);
  if (!r.ok) return r;
  const p = r.data;
  p.steps = (p.steps ?? []).filter((s) => s && s.text).slice(0, 7);
  if (!p.steps.length) p.found = false;
  p.total_minutes = p.steps.reduce((a, s) => a + (Number(s.minutes) || 0), 0) || p.total_minutes || 0;
  return { ok: true as const, data: p };
}
