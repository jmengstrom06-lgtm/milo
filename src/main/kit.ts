// Milo's Kit: the AI behind his own apps (Study Deck, Sketch, Sheet, Notes, Planner).

import { callClaude, callTool, persona, type ApiErr, type ApiOk } from "./brain";
import { log as bb } from "./blackbox";

/** Set before each Kit request: the class it's for (see classes.ts). */
let classCtx = "";
export function setClassCtx(s: string) {
  classCtx = s;
}

// ---------------------------------------------------------------------------
// Graphs (drawn by Milo in code: crisp, instant, free)
export type GraphSpec =
  | { type: "normal"; mean: number; sd: number; shadeFrom?: number | null; shadeTo?: number | null; markers?: number[]; xlabel?: string }
  | { type: "function"; exprs: string[]; xmin: number; xmax: number; ymin?: number; ymax?: number; points?: { x: number; y: number; label?: string }[]; params?: { name: string; min: number; max: number; value: number }[] }
  | { type: "bar"; labels: string[]; values: number[]; xlabel?: string; ylabel?: string }
  | { type: "line"; labels: string[]; values: number[]; xlabel?: string; ylabel?: string }
  | { type: "scatter"; points: { x: number; y: number }[]; fit?: boolean; xlabel?: string; ylabel?: string }
  | { type: "histogram"; values: number[]; bins?: number; xlabel?: string; stats?: boolean }
  | { type: "box"; groups: { label: string; values: number[] }[]; xlabel?: string }
  | { type: "pie"; labels: string[]; values: number[] };

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
    params: {
      type: "array",
      description: "For function graphs: sliders the student can drag. Use single letters a, b, c, k, m, h in exprs (e.g. 'a*(x-h)^2+k') and list them here with a sensible range.",
      items: { type: "object", properties: { name: { type: "string" }, min: { type: "number" }, max: { type: "number" }, value: { type: "number" } }, required: ["name", "min", "max", "value"] },
    },
    bins: { type: "number" },
    xlabel: { type: "string" },
    ylabel: { type: "string" },
  },
  required: ["type"],
};

export type Sketch = { title: string; say: string; graph: GraphSpec | null; svg: string | null; image_prompt: string | null };

export async function makeSketch(request: string, context = ""): Promise<ApiOk<Sketch> | ApiErr> {
  const r = await callTool<Sketch>(
    {
      max_tokens: 12000,
      system: `${persona()}${classCtx}
The student wants to SEE something. Pick the best way:
1. graph: anything plottable (functions, probability, statistics, data). Precise numbers. For "how does a/b/c change the curve" questions, add params (sliders).
2. svg: everything else (a house, a plant cell, the water cycle, a timeline, a flowchart, a free body diagram, a map, a concept). YOU draw it as an SVG illustration or a labeled diagram:
   - <svg viewBox="0 0 800 500" xmlns="http://www.w3.org/2000/svg">, no width/height, transparent background.
   - It is shown on a DARK background: outlines #e9e9f1 or #c4b5fd (stroke-width 2-3, round caps/joins), soft fills with low opacity (#a78bfa, #38bdf8, #34d399, #f472b6, #fbbf24 at fill-opacity 0.15-0.45).
   - Clean, modern, flat. Real shapes and proportions, not stick figures. For study diagrams, label every important part: <text> with font-family="Inter, sans-serif" font-size 16-20 fill #e9e9f1, plus thin leader lines.
   - Draw big shapes first, then details, then labels (Milo animates it in that order).
   - Only these elements: svg g path rect circle ellipse line polyline polygon text tspan defs linearGradient radialGradient stop. No script, no images, no foreignObject, no CSS.
3. image_prompt: ONLY if they explicitly want a realistic photo / picture of a real scene. Still include an svg as a fallback.
"say" = one short spoken sentence about it.`,
      tools: [
        {
          name: "sketch",
          description: "What Milo draws.",
          input_schema: {
            type: "object",
            properties: {
              title: { type: "string", description: "Short title, like 'P(X > 75) for N(70, 5)' or 'Plant cell'." },
              say: { type: "string" },
              graph: { anyOf: [GRAPH_SCHEMA, { type: "null" }] },
              svg: { type: ["string", "null"], description: "The full SVG markup, when it isn't a graph." },
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
  if (!r.ok) return r;
  return { ok: true, data: { ...r.data, graph: r.data.graph ?? null, svg: r.data.svg ?? null, image_prompt: r.data.image_prompt ?? null } };
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
export type StudySet = { title: string; subject: string; items: StudyItem[]; say: string; lesson?: { points: StudyStep[] } | null };

const STUDY_TOOL = {
  name: "study_set",
  description: "A set of study items.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Short, like 'Normal distribution: z-scores'." },
      subject: { type: "string", description: "Class or subject, like 'Statistics'." },
      say: { type: "string", description: "One short spoken intro, under 15 words." },
      lesson: {
        type: ["object", "null"],
        description: "Only in learn mode: the mini-lesson Milo teaches before any problems. 3-5 points, each: say (spoken, plain words) + write (shown, key idea or formula in $...$).",
        properties: { points: { type: "array", items: { type: "object", properties: { say: { type: "string" }, write: { type: "string" } }, required: ["say", "write"] } } },
      },
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
  opts: { mode: "worked" | "practice" | "cards" | "test" | "learn"; count: number; weak: string[]; pageText?: string; jpeg?: string; context?: string }
): Promise<ApiOk<StudySet> | ApiErr> {
  const how = {
    worked: "Make worked examples: realistic exam-style problems with a complete, clear step-by-step solution. These are shown solved, step by step.",
    practice: "Make practice problems the student will solve themselves, easy to harder. Include full worked steps (shown only after they answer).",
    cards: "Make flashcards (kind card): short front, short back. Key terms, formulas, facts. steps can be one step explaining it.",
    test: "Make a realistic practice test: exam-style problems, mixed skills, easy to hard, with full worked steps.",
    learn: "The student wants to LEARN this from scratch. Write lesson.points (a short, clear mini-lesson: the idea, why it works, the key formula, a common mistake). Then items: the FIRST item is a worked example (it'll be solved for them step by step), the rest are practice problems for them, easy to harder.",
  }[opts.mode];
  const content: unknown[] = [];
  if (opts.jpeg) content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: opts.jpeg } });
  content.push({
    type: "text",
    text: [
      `Student's request: "${request}"`,
      `Make ${opts.count} items. ${how}`,
      opts.weak.length ? `They've been missing these skills lately, so lean on them: ${opts.weak.join("; ")}.` : "",
      opts.context ? `Base it on this material:\n${opts.context.slice(0, 12000)}` : "",
      /\b(easier|simpler|more basic)\b/i.test(request) ? "Make these EASIER than before: smaller numbers, one idea at a time." : "",
      /\b(harder|tougher|challenge|more advanced)\b/i.test(request) ? "Make these HARDER: multi-step, exam-level tricky (but fair)." : "",
      opts.pageText ? `Their screen (course page / notes):\n${opts.pageText.slice(0, 9000)}` : "",
      opts.jpeg || opts.pageText ? "Base the items on the material on their screen." : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
  });
  const r = await callTool<StudySet>(
    {
      max_tokens: 8000,
      system: `${persona()}${classCtx}
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
      system: `${persona()}${classCtx}
Check a student's answer. Accept equivalent forms, reasonable rounding, and spoken math ("point six nine" = 0.69). feedback = one short sentence: if right, a quick confirmation; if wrong, what went wrong (don't give the full answer). If they showed their work, name the exact line where it first went wrong and why (e.g. "Line 2: you subtracted the mean from the wrong value.").`,
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
export type Table = { title: string; columns: string[]; rows: (string | number)[][]; say: string; chart?: ChartPick | null };

const CHART_SCHEMA = {
  type: ["object", "null"],
  description: "A chart to draw from the table (Milo computes it from the columns). histogram/box: y = a numeric column. bar/line/pie: x = labels column, y = values column. scatter: x and y numeric columns.",
  properties: {
    kind: { type: "string", enum: ["histogram", "bar", "line", "scatter", "box", "pie"] },
    x: { type: "string" },
    y: { type: "string" },
    bins: { type: "number" },
  },
  required: ["kind", "y"],
};

export async function makeTable(request: string, context = ""): Promise<ApiOk<Table> | ApiErr> {
  return callTool<Table>(
    {
      max_tokens: 4000,
      system: `${persona()}${classCtx}
Turn the request into a clean table. Use the student's numbers exactly if they gave any (or the data on their screen / clipboard). Numbers as numbers. No totals row (Milo computes stats himself).
If they want an EXAMPLE (e.g. "make me an example histogram", "show me what a skewed distribution looks like"), invent a realistic data set that fits their class: 20-40 rows, believable values, with the shape they asked for.
If they asked for a chart/graph/plot/histogram (or one would obviously help), set chart. Column names should be short and clear (include units). say = one short sentence.`,
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
              chart: CHART_SCHEMA,
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
      system: `${persona()}${classCtx}
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
      system: `${persona()}${classCtx}
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

// ---------------------------------------------------------------------------
// "What did I write about z-scores?": answer from the student's own notes.
export async function askNotes(question: string, notes: { id: string; title: string; course: string; body: string }[]): Promise<ApiOk<{ answer: string; note_id: string | null }> | ApiErr> {
  const pack = notes.map((n) => `[${n.id}] ${n.title} (${n.course})\n${n.body.slice(0, 3000)}`).join("\n\n---\n\n").slice(0, 40000);
  return callTool(
    {
      max_tokens: 600,
      system: `${persona()}${classCtx}
Answer the student's question using ONLY their own notes below. One or two short spoken sentences. note_id = the note it came from (or null). If the notes don't cover it, say so plainly.`,
      tools: [
        {
          name: "answer",
          description: "Answer from the notes.",
          input_schema: { type: "object", properties: { answer: { type: "string" }, note_id: { type: ["string", "null"] } }, required: ["answer"] },
        },
      ],
      tool_choice: { type: "auto" },
      messages: [{ role: "user", content: `Question: "${question}"\n\nTheir notes:\n${pack || "(no notes yet)"}` }],
    },
    "answer"
  );
}

// ---------------------------------------------------------------------------
// Sheet: "add a z-score column", "sort by score", "who's above average?". The AI picks the operations;
// Milo computes every number himself (no AI arithmetic).
export type TableOp =
  | { op: "add_column"; name: string; expr: string }
  | { op: "sort"; column: string; desc?: boolean }
  | { op: "filter"; column: string; cmp: ">" | "<" | ">=" | "<=" | "=" | "!="; value: string }
  | { op: "remove_column"; column: string }
  | { op: "rename_column"; column: string; to: string }
  | { op: "add_row"; values: (string | number)[] }
  | { op: "graph"; kind: ChartKind; x?: string; y: string; bins?: number }
  | { op: "set_table"; title?: string; columns: string[]; rows: (string | number)[][] }
  | { op: "sample"; name: string; dist: "normal" | "uniform" | "skewed_right" | "skewed_left" | "bimodal"; n: number; mean?: number; sd?: number; min?: number; max?: number; decimals?: number };
export type ChartKind = "histogram" | "bar" | "line" | "scatter" | "box" | "pie";
export type ChartPick = { kind: ChartKind; x?: string; y: string; bins?: number };

export async function tableOps(request: string, t: { columns: string[]; rows: (string | number)[][] }, stats: string, extra = ""): Promise<ApiOk<{ ops: TableOp[]; say: string }> | ApiErr> {
  const empty = t.rows.every((r) => r.every((v) => v === "" || v === null || v === undefined));
  const vars = t.columns.map((c, k) => `c${k} = "${c}"`).join(", ");
  const rows = t.rows.slice(0, 200).map((r) => r.join(" | ")).join("\n");
  return callTool(
    {
      max_tokens: 5000,
      system: `${persona()}${classCtx}
You operate a small spreadsheet for a student. Turn their request into operations; Milo computes everything himself.
Column variables: ${vars}. For each numeric column ck you can also use mean_ck, sd_ck (sample), median_ck, min_ck, max_ck, sum_ck, n_ck.
add_column.expr is a math expression over those (+ - * / ^, sqrt, abs, ln, log, exp), e.g. z-score of c1: "(c1 - mean_c1)/sd_c1". Use column NAMES (not ck) in sort/filter/graph/remove/rename. filter.value can be a number or one of mean/median/min/max.
If they just asked a question about the data, use no ops and answer in say (read the data carefully). say = one short spoken sentence.
CHARTS: graph op with kind histogram (one numeric column, y), box (numeric y; x = optional group column), bar/line/pie (x = labels column, y = numbers), scatter (x and y numeric). bins only if they ask.
DATA: set_table replaces the whole table (use it for numbers they give you, or when the sheet is empty/blank and they want a chart or example: write a realistic 20-40 row data set that fits their class, THEN add a graph op). sample adds a generated numeric column Milo computes himself (dist normal/uniform/skewed_right/skewed_left/bimodal, n, mean, sd or min/max, decimals) - great for "an example of a right-skewed histogram". Graph ops can name columns created earlier in the same list.
Never say you can't because the sheet is empty: make example data.`,
      tools: [
        {
          name: "table_ops",
          description: "Operations on the table.",
          input_schema: {
            type: "object",
            properties: {
              say: { type: "string" },
              ops: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    op: { type: "string", enum: ["add_column", "sort", "filter", "remove_column", "rename_column", "add_row", "graph", "set_table", "sample"] },
                    title: { type: "string" },
                    columns: { type: "array", items: { type: "string" } },
                    rows: { type: "array", items: { type: "array", items: { type: ["string", "number"] } } },
                    dist: { type: "string", enum: ["normal", "uniform", "skewed_right", "skewed_left", "bimodal"] },
                    n: { type: "number" },
                    mean: { type: "number" },
                    sd: { type: "number" },
                    min: { type: "number" },
                    max: { type: "number" },
                    decimals: { type: "number" },
                    bins: { type: "number" },
                    name: { type: "string" },
                    expr: { type: "string" },
                    column: { type: "string" },
                    desc: { type: "boolean" },
                    cmp: { type: "string", enum: [">", "<", ">=", "<=", "=", "!="] },
                    value: { type: "string" },
                    to: { type: "string" },
                    values: { type: "array", items: { type: ["string", "number"] } },
                    kind: { type: "string", enum: ["histogram", "bar", "line", "scatter", "box", "pie"] },
                    x: { type: "string" },
                    y: { type: "string" },
                  },
                  required: ["op"],
                },
              },
            },
            required: ["ops", "say"],
          },
        },
      ],
      tool_choice: { type: "auto" },
      messages: [
        {
          role: "user",
          content: `Request: "${request}"\n\n${empty ? "THE SHEET IS EMPTY (blank cells only)." : `Columns: ${t.columns.join(" | ")}\n${rows}\n\nStats: ${stats}`}${extra ? `\n\nThey copied / have on screen:\n${extra.slice(0, 6000)}` : ""}`,
        },
      ],
    },
    "table_ops"
  );
}
