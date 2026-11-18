// Milo's Kit: the AI behind his own apps (Study Deck, Sketch, Sheet, Notes, Planner).

import { callClaude, callTool, persona, type ApiErr, type ApiOk } from "./brain";
import { log as bb } from "./blackbox";

// ---------------------------------------------------------------------------
// Graphs (drawn by Milo in code: crisp, instant, free)
export type GraphSpec =
  | { type: "normal"; mean: number; sd: number; shadeFrom?: number | null; shadeTo?: number | null; markers?: number[]; xlabel?: string }
  | { type: "function"; exprs: string[]; xmin: number; xmax: number; ymin?: number; ymax?: number; points?: { x: number; y: number; label?: string }[] }
  | { type: "bar"; labels: string[]; values: number[]; xlabel?: string; ylabel?: string }
  | { type: "line"; labels: string[]; values: number[]; xlabel?: string; ylabel?: string }
  | { type: "scatter"; points: { x: number; y: number }[]; fit?: boolean; xlabel?: string; ylabel?: string }
  | { type: "histogram"; values: number[]; bins?: number; xlabel?: string };

const GRAPH_SCHEMA = {
  type: "object",
  description:
    "A graph Milo draws. type normal: a normal curve with mean, sd and optional shaded region shadeFrom..shadeTo (null = to infinity). type function: exprs like 'x^2-3', '2*sin(x)', 'sqrt(x)' (use x, + - * / ^, sin cos tan sqrt abs log ln exp, pi, e). bar/line: labels + values. scatter: points (+ fit for a regression line). histogram: raw values.",
  properties: {
    type: { type: "string", enum: ["normal", "function", "bar", "line", "scatter", "histogram"] },
    mean: { type: "number" },
    sd: { type: "number" },
    shadeFrom: { type: ["number", "null"] },
    shadeTo: { type: ["number", "null"] },
    markers: { type: "array", items: { type: "number" } },
    exprs: { type: "array", items: { type: "string" } },
    xmin: { type: "number" },
    xmax: { type: "number" },
    ymin: { type: "number" },
    ymax: { type: "number" },
    labels: { type: "array", items: { type: "string" } },
    values: { type: "array", items: { type: "number" } },
    points: { type: "array", items: { type: "object", properties: { x: { type: "number" }, y: { type: "number" }, label: { type: "string" } }, required: ["x", "y"] } },
    fit: { type: "boolean" },
    bins: { type: "number" },
    xlabel: { type: "string" },
    ylabel: { type: "string" },
  },
  required: ["type"],
};

export type Sketch = { title: string; say: string; graph: GraphSpec | null; image_prompt: string | null };

export async function makeSketch(request: string, context = ""): Promise<ApiOk<Sketch> | ApiErr> {
  return callTool<Sketch>(
    {
      max_tokens: 2000,
      system: `${persona()}
The student wants to SEE something. If it's math, stats, data or anything plottable, make a graph (precise numbers). If it's a picture of a thing, place or idea (a cell, a dorm room, a historical scene), set graph to null and write image_prompt for an image generator (clear, detailed, realistic or clean illustration style, no text in the image).
"say" = one short spoken sentence about what the picture shows.`,
      tools: [
        {
          name: "sketch",
          description: "What Milo draws.",
          input_schema: {
            type: "object",
            properties: {
              title: { type: "string", description: "Short title, like 'P(X > 75) for N(70, 5)'." },
              say: { type: "string" },
              graph: { anyOf: [GRAPH_SCHEMA, { type: "null" }] },
              image_prompt: { type: ["string", "null"] },
            },
            required: ["title", "say"],
          },
        },
      ],
      tool_choice: { type: "auto" },
      messages: [{ role: "user", content: `Request: "${request}"${context ? `\n\nContext from the student's screen:\n${context.slice(0, 6000)}` : ""}` }],
    },
    "sketch"
  );
}

/** Image generation (OpenAI). Returns base64 PNG. */
export async function generateImage(prompt: string): Promise<{ ok: true; b64: string } | { ok: false; text: string }> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return { ok: false, text: "no-key" };
  try {
    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: process.env.MILO_IMAGE_MODEL || "gpt-image-1", prompt: prompt.slice(0, 3000), size: "1024x1024", n: 1 }),
    });
    if (!res.ok) {
      const detail = await res.text();
      bb("kit", "image_error", { status: res.status, detail: detail.slice(0, 300) });
      return { ok: false, text: res.status === 401 ? "OpenAI rejected my key." : /billing|quota|credit/i.test(detail) ? "The image service is out of credit." : `Image error (${res.status}).` };
    }
    const data = (await res.json()) as { data?: { b64_json?: string }[] };
    const b64 = data.data?.[0]?.b64_json;
    return b64 ? { ok: true, b64 } : { ok: false, text: "No image came back." };
  } catch (e) {
    return { ok: false, text: `Couldn't reach the image service: ${(e as Error).message}` };
  }
}

// ---------------------------------------------------------------------------
// Study Deck
export type StudyStep = { say: string; write: string };
export type StudyItem = {
  id: string;
  kind: "problem" | "card";
  skill: string;
  prompt: string;
  answer: string;
  hint: string;
  steps: StudyStep[];
  graph: GraphSpec | null;
};
export type StudySet = { title: string; subject: string; items: StudyItem[]; say: string };

const STUDY_TOOL = {
  name: "study_set",
  description: "A set of study items.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Short, like 'Normal distribution: z-scores'." },
      subject: { type: "string", description: "Class or subject, like 'Statistics'." },
      say: { type: "string", description: "One short spoken intro, under 15 words." },
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["problem", "card"] },
            skill: { type: "string", description: "The skill it practices, 2-5 words (used to track weak spots)." },
            prompt: { type: "string", description: "The problem or the card front. Math in $...$ LaTeX." },
            answer: { type: "string", description: "The final answer or card back. Math in $...$." },
            hint: { type: "string", description: "One nudge without giving it away." },
            steps: {
              type: "array",
              description: "Worked solution, 2-6 steps. say = what Milo says out loud (plain words, no LaTeX). write = what appears in the notebook (math in $...$).",
              items: { type: "object", properties: { say: { type: "string" }, write: { type: "string" } }, required: ["say", "write"] },
            },
            graph: { anyOf: [GRAPH_SCHEMA, { type: "null" }], description: "A graph that makes this problem click (e.g. the shaded normal curve). null if not useful." },
          },
          required: ["kind", "skill", "prompt", "answer", "hint", "steps"],
        },
      },
    },
    required: ["title", "subject", "items", "say"],
  },
};

export async function makeStudySet(
  request: string,
  opts: { mode: "worked" | "practice" | "cards" | "test"; count: number; weak: string[]; pageText?: string; jpeg?: string }
): Promise<ApiOk<StudySet> | ApiErr> {
  const how = {
    worked: "Make worked examples: realistic exam-style problems with a complete, clear step-by-step solution. These are shown solved, step by step.",
    practice: "Make practice problems the student will solve themselves, easy to harder. Include full worked steps (shown only after they answer).",
    cards: "Make flashcards (kind card): short front, short back. Key terms, formulas, facts. steps can be one step explaining it.",
    test: "Make a realistic practice test: exam-style problems, mixed skills, easy to hard, with full worked steps.",
  }[opts.mode];
  const content: unknown[] = [];
  if (opts.jpeg) content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: opts.jpeg } });
  content.push({
    type: "text",
    text: [
      `Student's request: "${request}"`,
      `Make ${opts.count} items. ${how}`,
      opts.weak.length ? `They've been missing these skills lately, so lean on them: ${opts.weak.join("; ")}.` : "",
      opts.pageText ? `Their screen (course page / notes):\n${opts.pageText.slice(0, 9000)}` : "",
      opts.jpeg || opts.pageText ? "Base the items on the material on their screen." : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
  });
  const r = await callTool<StudySet>(
    {
      max_tokens: 8000,
      system: `${persona()}
You make study material for a college student. Be accurate: double-check every number and answer. Use realistic numbers. Graphs only when they genuinely help (normal curves for probability questions, functions for algebra/calculus, charts for data).`,
      tools: [STUDY_TOOL],
      tool_choice: { type: "auto" },
      messages: [{ role: "user", content }],
    },
    STUDY_TOOL.name
  );
  if (!r.ok) return r;
  const items = (r.data.items ?? []).slice(0, 25).map((it, i) => ({
    ...it,
    id: `${Date.now().toString(36)}-${i}`,
    steps: Array.isArray(it.steps) ? it.steps : [],
    graph: it.graph ?? null,
    hint: it.hint ?? "",
  }));
  return { ok: true, data: { ...r.data, items } };
}

export async function checkStudy(item: { prompt: string; answer: string }, student: string): Promise<ApiOk<{ correct: boolean; feedback: string }> | ApiErr> {
  return callTool(
    {
      max_tokens: 600,
      model: process.env.MILO_FAST_MODEL || "claude-haiku-5-5",
      system: `${persona()}
Check a student's answer. Accept equivalent forms, reasonable rounding, and spoken math ("point six nine" = 0.69). feedback = one short sentence: if right, a quick confirmation; if wrong, what went wrong (don't give the full answer).`,
      tools: [
        {
          name: "check",
          description: "Grade it.",
          input_schema: { type: "object", properties: { correct: { type: "boolean" }, feedback: { type: "string" } }, required: ["correct", "feedback"] },
        },
      ],
      tool_choice: { type: "auto" },
      messages: [{ role: "user", content: `Problem: ${item.prompt}\nCorrect answer: ${item.answer}\nStudent said: "${student}"` }],
    },
    "check"
  );
}

// ---------------------------------------------------------------------------
// Sheet
export type Table = { title: string; columns: string[]; rows: (string | number)[][]; say: string };

export async function makeTable(request: string, context = ""): Promise<ApiOk<Table> | ApiErr> {
  return callTool<Table>(
    {
      max_tokens: 4000,
      system: `${persona()}
Turn the request into a clean table. Use the student's numbers exactly if they gave any (or the data on their screen). Numbers as numbers. No totals row (Milo computes stats himself). say = one short sentence.`,
      tools: [
        {
          name: "table",
          description: "A table.",
          input_schema: {
            type: "object",
            properties: {
              title: { type: "string" },
              columns: { type: "array", items: { type: "string" } },
              rows: { type: "array", items: { type: "array", items: { type: ["string", "number"] } } },
              say: { type: "string" },
            },
            required: ["title", "columns", "rows", "say"],
          },
        },
      ],
      tool_choice: { type: "auto" },
      messages: [{ role: "user", content: `Request: "${request}"${context ? `\n\nOn their screen:\n${context.slice(0, 8000)}` : ""}` }],
    },
    "table"
  );
}

// ---------------------------------------------------------------------------
// Notes
export type NoteDraft = { title: string; course: string; body: string; say: string };

export async function makeNote(request: string, opts: { pageText?: string; jpeg?: string; existingCourses: string[] }): Promise<ApiOk<NoteDraft> | ApiErr> {
  const content: unknown[] = [];
  if (opts.jpeg) content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: opts.jpeg } });
  content.push({
    type: "text",
    text: `Request: "${request}"\nExisting classes: ${opts.existingCourses.join(", ") || "(none yet)"}${opts.pageText ? `\n\nTheir screen:\n${opts.pageText.slice(0, 9000)}` : ""}`,
  });
  return callTool<NoteDraft>(
    {
      max_tokens: 3000,
      system: `${persona()}
Write a study note. If they dictated something, keep their words. If they asked to summarize their screen, write tight study notes: short headings (lines starting with "## "), bullets (lines starting with "- "), key formulas in $...$. course = the class it belongs to (reuse an existing class name if it fits). say = under 10 words.`,
      tools: [
        {
          name: "note",
          description: "A note.",
          input_schema: {
            type: "object",
            properties: { title: { type: "string" }, course: { type: "string" }, body: { type: "string" }, say: { type: "string" } },
            required: ["title", "course", "body", "say"],
          },
        },
      ],
      tool_choice: { type: "auto" },
      messages: [{ role: "user", content }],
    },
    "note"
  );
}

// ---------------------------------------------------------------------------
// Planner
export type Plan = {
  title: string;
  say: string;
  days: { date: string; label: string; tasks: { text: string; kind: "study" | "review" | "due" | "exam"; topic?: string; minutes?: number }[] }[];
};

export async function makePlan(request: string, today: string, items: { title: string; course: string; due: string }[], pageText = ""): Promise<ApiOk<Plan> | ApiErr> {
  return callTool<Plan>(
    {
      max_tokens: 4000,
      system: `${persona()}
Build a realistic study plan. Today is ${today}. Spread studying out before each exam/deadline (short sessions, harder topics earlier, review the day before). Mark deadlines (kind due) and exams (kind exam) on their day. 7 to 14 days max. Each study task names a concrete topic (used to open practice problems). say = one short sentence, like "Exam 3 is in 7 days. Here's your plan."`,
      tools: [
        {
          name: "plan",
          description: "A day-by-day plan.",
          input_schema: {
            type: "object",
            properties: {
              title: { type: "string" },
              say: { type: "string" },
              days: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    date: { type: "string", description: "YYYY-MM-DD" },
                    label: { type: "string", description: "Like 'Thu, Nov 19'" },
                    tasks: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          text: { type: "string" },
                          kind: { type: "string", enum: ["study", "review", "due", "exam"] },
                          topic: { type: "string" },
                          minutes: { type: "number" },
                        },
                        required: ["text", "kind"],
                      },
                    },
                  },
                  required: ["date", "label", "tasks"],
                },
              },
            },
            required: ["title", "say", "days"],
          },
        },
      ],
      tool_choice: { type: "auto" },
      messages: [
        {
          role: "user",
          content: `Request: "${request}"\n\nKnown deadlines:\n${items.map((i) => `- ${i.title} (${i.course}) due ${i.due}`).join("\n") || "(none known)"}${pageText ? `\n\nOn their screen:\n${pageText.slice(0, 8000)}` : ""}`,
        },
      ],
    },
    "plan"
  );
}

/** Quick plain answer (used for short spoken replies inside kit apps). */
export async function quickSay(prompt: string): Promise<string> {
  const r = await callClaude({ max_tokens: 200, system: `${persona()}\nOne short sentence.`, messages: [{ role: "user", content: prompt }] });
  return r.ok ? r.data.filter((b) => b.type === "text").map((b) => b.text).join(" ").trim() : "";
}
