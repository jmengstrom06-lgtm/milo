import { log as bb } from "./blackbox";
import { anthropic, limitText, models, NoBrainError } from "./gateway";
import { profileText } from "./profile";
import { memoryPrompt, noteTurn } from "./memory";
// Milo's brain: all Anthropic API calls live in the main process,
// so the API key never touches the renderer.

export type ChatMessage = { role: "user" | "assistant"; content: string };
export type Mode = "teach" | "help" | "do";

export type TeachStep = { say: string; write: string };
export type TeachResult = {
  found: boolean;
  target: { x: number; y: number; width: number; height: number } | null; // pixels in the screenshot
  topic: string;
  intro: string;
  steps: TeachStep[];
  answer: string;
  check_question: string;
  summary: string;
  others?: { label: string; x: number; y: number; width: number; height: number }[];
};
export type CheckResult = { correct: boolean; feedback: string };
export type Practice = { problems: { question: string; answer: string }[] };

let characterDesc = "a small purple horned frog (a horned lizard) with a spiky crown";
export function setCharacter(desc: string) {
  if (desc) characterDesc = desc;
}
let userName = "";
export function setUserName(name: string) {
  userName = (name || "").slice(0, 40);
}
const persona = () => `You are Milo, ${characterDesc}, an animated companion who lives on a college student's computer screen.${userName ? ` The student's name is ${userName}.` : ""}
You are friendly, sharp and quick. You talk like a smart friend: short, precise, confident. No hype, no cheesy jokes, no exclamation marks everywhere, never like a textbook.${memoryPrompt()}`;

const chatPrompt = () => `${persona()}
You live on the student's Mac. You CAN look at their screen, jump to homework questions and teach them in your notebook,
and you CAN use the computer (open apps, files, websites and tabs, click, type). Never say you can't see their screen or use their computer.
You also have your own apps (your Kit): Study (lessons, practice problems, worked examples, flashcards, timed practice tests), Sketch (graphs with sliders and drawn diagrams), Notes (by class, ask your notes, quiz from a note), Sheet (tables, stats, histograms, box plots, scatter plots and pie charts, live), Planner (study plans from due dates, into Calendar) and Pocket (select something, say 'hold this', then 'drop it' anywhere: a clipboard that follows them). They can tell you their classes ('my classes are...') and every app fits the class they're on.
This reply is talk only: nothing you say here opens, closes, sends or clicks anything. So NEVER say you did something on their computer ("closed", "done", "sent", "opened") unless the conversation shows it already happened. If they seem to want something done on screen, say in a few words what to say so you'll do it, e.g. "Say 'close Messages' and I'll close it."
Right now it is ${new Date().toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })} on their Mac. Use this for any question about the time or date.
Keep replies to 1 or 2 short sentences unless the student asks for detail. Get to the point.`;

const MODE_RULES: Record<Mode, string> = {
  teach: `MODE = TEACH ME. Teach the method so the student can do it themselves.
- 3 to 6 steps. Each step teaches one move. Show the work in "write".
- Do NOT state the final answer to the exact problem in the steps; stop one move before it.
- "answer" = the final answer (kept hidden until the student asks).
- "check_question" = ask the student to finish the last move themselves, e.g. "So what do you get for P(X < 75)?".`,
  help: `MODE = HELP ME. The student is stuck. Give hints, not the full solution.
- 2 to 3 short steps that each nudge them toward the next move.
- "answer" = the final answer (kept hidden unless they ask).
- "check_question" = a question that gets them to take the next step themselves.`,
  do: `MODE = DO IT FOR ME. Solve it completely and clearly.
- 2 to 5 steps showing the full worked solution, ending with the final answer.
- "answer" = the final answer, ready to copy.
- "summary" = one or two sentences on what you did and anything the student should double check.
- "check_question" = empty string.`,
};

const TEACH_TOOL = {
  name: "teach_on_screen",
  description: "Locate the problem on the student's screen and produce Milo's lesson for it.",
  input_schema: {
    type: "object",
    properties: {
      found: { type: "boolean", description: "True if there is a question/problem/task on screen to help with." },
      target: {
        type: "object",
        description:
          "Bounding box of the single most relevant question block (its whole card/box if it has one), in PIXELS of the screenshot: x,y = top-left corner, then width and height.",
        properties: {
          x: { type: "number" },
          y: { type: "number" },
          width: { type: "number" },
          height: { type: "number" },
        },
        required: ["x", "y", "width", "height"],
      },
      topic: { type: "string", description: "2 to 5 word title, e.g. 'Normal distribution z-score'." },
      intro: { type: "string", description: "One short spoken line Milo says when he lands, casual and hype." },
      steps: {
        type: "array",
        items: {
          type: "object",
          properties: {
            say: { type: "string", description: "What Milo says out loud for this step. One or two casual sentences." },
            write: {
              type: "string",
              description:
                "What Milo writes in his notebook for this step. Short. Put math in LaTeX between single dollar signs, e.g. $z = \\frac{75-70}{10} = 0.5$.",
            },
          },
          required: ["say", "write"],
        },
      },
      answer: { type: "string", description: "Final answer. Math in $...$ LaTeX allowed." },
      check_question: { type: "string" },
      summary: { type: "string" },
      others: {
        type: "array",
        description:
          "Up to 6 OTHER distinct questions visible on screen (not the target). label = the number/letter printed on the page (e.g. '3', 'Q5', 'b'), or 2 to 3 words if unnumbered. Pixel boxes like target.",
        items: {
          type: "object",
          properties: {
            label: { type: "string" },
            x: { type: "number" },
            y: { type: "number" },
            width: { type: "number" },
            height: { type: "number" },
          },
          required: ["label", "x", "y", "width", "height"],
        },
      },
    },
    required: ["found", "topic", "intro", "steps", "answer", "check_question", "summary"],
  },
};

const CHECK_TOOL = {
  name: "check_answer",
  description: "Judge the student's answer.",
  input_schema: {
    type: "object",
    properties: {
      correct: { type: "boolean" },
      feedback: { type: "string", description: "One or two short sentences in Milo's voice. If wrong, a hint, not the answer." },
    },
    required: ["correct", "feedback"],
  },
};

const PRACTICE_TOOL = {
  name: "practice_set",
  description: "Three practice problems like the one on screen.",
  input_schema: {
    type: "object",
    properties: {
      problems: {
        type: "array",
        items: {
          type: "object",
          properties: {
            question: { type: "string", description: "Math in $...$ LaTeX allowed." },
            answer: { type: "string", description: "Short final answer. Math in $...$ allowed." },
          },
          required: ["question", "answer"],
        },
      },
    },
    required: ["problems"],
  },
};

const LOCATE_TOOL = {
  name: "locate",
  description: "Return the exact bounding box of the target in this image.",
  input_schema: {
    type: "object",
    properties: {
      found: { type: "boolean" },
      x: { type: "number", description: "Left edge in pixels of this image." },
      y: { type: "number", description: "Top edge in pixels of this image." },
      width: { type: "number" },
      height: { type: "number" },
    },
    required: ["found", "x", "y", "width", "height"],
  },
};

type Block = { type: string; text?: string; name?: string; input?: unknown };
type ApiOk<T> = { ok: true; data: T };
type ApiErr = { ok: false; text: string };

function model() {
  return models.smart();
}

/** What an image REALLY is, from its first bytes (base64). Screenshots can arrive as PNG or JPEG. */
export function sniffImageType(b64: string): string | null {
  if (b64.startsWith("/9j/")) return "image/jpeg";
  if (b64.startsWith("iVBOR")) return "image/png";
  if (b64.startsWith("R0lGOD")) return "image/gif";
  if (b64.startsWith("UklGR")) return "image/webp";
  return null;
}
/** Every image we send gets its true type, so the AI never rejects a mislabeled screenshot. */
export function fixImageTypes<T>(body: T): T {
  const msgs = (body as { messages?: { content?: unknown }[] }).messages;
  for (const m of msgs ?? []) {
    if (!Array.isArray(m.content)) continue;
    for (const part of m.content as { type?: string; source?: { type?: string; media_type?: string; data?: string } }[]) {
      if (part?.type === "image" && part.source?.type === "base64" && part.source.data) {
        const real = sniffImageType(part.source.data);
        if (real && real !== part.source.media_type) part.source.media_type = real;
      }
    }
  }
  return body;
}

async function callClaude(body: Record<string, unknown>): Promise<ApiOk<Block[]> | ApiErr> {
  fixImageTypes(body);
  try {
    const res = await anthropic({ model: model(), ...body });
    if (!res.ok) {
      const limit = await limitText(res);
      if (limit) return { ok: false, text: limit };
      const detail = await res.text();
      bb("brain", "api_error", { status: res.status, model: (body.model as string) ?? model(), detail: detail.slice(0, 500) });
      return { ok: false, text: `My brain hit an error (${res.status}). ${detail.slice(0, 200)}` };
    }
    const data = (await res.json()) as { content?: Block[]; usage?: Record<string, number> };
    if (data.usage?.cache_read_input_tokens) bb("brain", "cache_hit", { tokens: data.usage.cache_read_input_tokens });
    return { ok: true, data: data.content ?? [] };
  } catch (err) {
    if (err instanceof NoBrainError) return { ok: false, text: err.message };
    bb("brain", "network_error", { error: (err as Error).message });
    return { ok: false, text: `I couldn't reach my brain: ${(err as Error).message}` };
  }
}

function toolInput<T>(blocks: Block[], name: string): T | null {
  const b = blocks.find((x) => x.type === "tool_use" && x.name === name);
  if (b?.input) return b.input as T;
  // Fallback: some models answer with JSON text instead of a tool call.
  const text = blocks.filter((x) => x.type === "text").map((x) => x.text).join("\n");
  const m = text.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      return JSON.parse(m[0]) as T;
    } catch {
      /* ignore */
    }
  }
  return null;
}

// Call Claude and make sure we get the tool's structured output (one retry if not).
async function callTool<T>(body: Record<string, unknown>, toolName: string): Promise<ApiOk<T> | ApiErr> {
  const sys = `${body.system ?? ""}\n\nAlways respond by calling the ${toolName} tool exactly once. Do not reply with plain text.`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await callClaude({ ...body, system: sys });
    if (!r.ok) return r;
    const out = toolInput<T>(r.data, toolName);
    if (out) return { ok: true, data: out };
  }
  return { ok: false, text: "I got my wires crossed. Try again?" };
}

// ---------------------------------------------------------------------------

/**
 * Quick back-and-forth goes to the fast model (replies land in about a second);
 * real explaining goes to the smart one.
 */
export function chatTier(history: ChatMessage[]): "fast" | "smart" {
  const last = history[history.length - 1]?.content ?? "";
  if (last.length > 160) return "smart";
  if (/\b(explain|why|how (do|does|did|would|can)|prove|derive|essay|compare|difference|step by step|walk me|teach|solve|calculate|what if)\b/i.test(last)) return "smart";
  return "fast";
}

export async function askMilo(history: ChatMessage[]): Promise<{ ok: boolean; text: string }> {
  const tier = chatTier(history);
  const r = await callClaude({ model: models[tier](), max_tokens: 600, system: chatPrompt(), messages: history.slice(-20) });
  if (!r.ok) return r;
  const text = r.data
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  if (text) noteTurn([...history, { role: "assistant", content: text }], extractFacts);
  return { ok: true, text: text || "Hmm, I blanked on that one. Try again?" };
}

const FACTS_TOOL = {
  name: "save_facts",
  description: "Save lasting facts about the student.",
  input_schema: {
    type: "object",
    properties: { facts: { type: "array", items: { type: "string" }, description: "Short third-person facts. Empty if nothing new." } },
    required: ["facts"],
  },
};

/** Lasting, useful facts from a chat (classes, goals, deadlines, what they find hard, how they like help). */
export async function extractFacts(chat: string, known: string[]): Promise<string[]> {
  const r = await callTool<{ facts: string[] }>(
    {
      model: models.fast(),
      max_tokens: 400,
      system: `You pick out facts worth remembering about a college student from their chat with Milo, their study companion.
Keep: classes and majors, goals, upcoming exams, topics they find hard or easy, how they like to be helped, their name, routines.
Skip: one-off requests, small talk, anything about health, money, relationships, religion, politics or other private matters.
Each fact under 20 words, third person ("Takes STAT 2023 with Dr. Lee"). Never repeat something already known. Usually return 0 to 2 facts.`,
      tools: [FACTS_TOOL],
      tool_choice: { type: "tool", name: FACTS_TOOL.name },
      messages: [{ role: "user", content: `Already known:\n${known.map((k) => "- " + k).join("\n") || "(nothing)"}\n\nChat:\n${chat}` }],
    },
    FACTS_TOOL.name
  );
  return r.ok && Array.isArray(r.data.facts) ? r.data.facts.filter((f) => typeof f === "string" && f.trim()) : [];
}

export async function teachFromScreen(
  jpegBase64: string,
  size: { width: number; height: number },
  mode: Mode,
  request: string,
  hints: { pointer?: { x: number; y: number }; focus?: { x: number; y: number; width: number; height: number } } = {}
): Promise<ApiOk<TeachResult> | ApiErr> {
  const system = `${persona()}
You are looking at a screenshot of the student's screen. Ignore Milo himself, menus, docks and browser chrome.
Choosing the target question, in priority order:
1. If a FOCUS box is given, use the question in that box.
2. If the student names one (a number like "4" or "number four", a letter, a topic, words from it, "the last one", "the one at the bottom"), pick exactly that one.
3. If they say "this", "this one", "here" or "that one" and a POINTER location is given, pick the question under or nearest the pointer.
4. Otherwise pick the most prominent unanswered question.
Spoken numbers may arrive as words ("number three"); match them to the numbers printed on the page.
${MODE_RULES[mode]}
Keep "say" lines short and natural for text-to-speech (no LaTeX, no symbols, say numbers in words if needed).
If there is nothing to help with, set found=false and use intro to say so playfully.`;

  const r = await callTool<TeachResult>({
    max_tokens: 4000,
    system,
    tools: [TEACH_TOOL],
    tool_choice: { type: "auto" },
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: jpegBase64 } },
          {
            type: "text",
            text:
              `The screenshot is ${size.width}x${size.height} pixels.\n` +
              (hints.focus
                ? `FOCUS box (keep helping with this same question): x=${Math.round(hints.focus.x)}, y=${Math.round(hints.focus.y)}, width=${Math.round(hints.focus.width)}, height=${Math.round(hints.focus.height)}.\n`
                : "") +
              (hints.pointer ? `POINTER (student's mouse) is at x=${Math.round(hints.pointer.x)}, y=${Math.round(hints.pointer.y)}.\n` : "") +
              (request?.trim() ? `Student says: "${request.trim()}"` : 'Student says: "Milo, help me with this."'),
          },
        ],
      },
    ],
  }, TEACH_TOOL.name);
  if (!r.ok) return r;
  const out = r.data;
  out.steps = Array.isArray(out.steps) ? out.steps : [];
  out.target = out.target ?? null;
  return { ok: true, data: out };
}

export async function checkAnswer(lesson: TeachResult, studentAnswer: string): Promise<ApiOk<CheckResult> | ApiErr> {
  return callTool<CheckResult>({
    model: models.fast(), // grading against a known answer is quick work
    max_tokens: 1000,
    system: `${persona()}\nYou are checking a student's answer to your own lesson. Accept equivalent forms and reasonable rounding.`,
    tools: [CHECK_TOOL],
    tool_choice: { type: "auto" },
    messages: [
      {
        role: "user",
        content: `Lesson topic: ${lesson.topic}
Steps: ${lesson.steps.map((s, i) => `${i + 1}. ${s.write}`).join(" | ")}
Question asked: ${lesson.check_question}
Correct answer: ${lesson.answer}
Student answered: ${studentAnswer}`,
      },
    ],
  }, CHECK_TOOL.name);
}

export async function makePractice(lesson: TeachResult): Promise<ApiOk<Practice> | ApiErr> {
  return callTool<Practice>({
    max_tokens: 2000,
    system: `${persona()}\nWrite exactly 3 practice problems that use the same method, slightly varied, increasing difficulty.`,
    tools: [PRACTICE_TOOL],
    tool_choice: { type: "auto" },
    messages: [
      {
        role: "user",
        content: `Topic: ${lesson.topic}\nWorked steps: ${lesson.steps.map((s) => s.write).join(" | ")}\nAnswer: ${lesson.answer}`,
      },
    ],
  }, PRACTICE_TOOL.name);
}

// Lock-on: given a sharp crop around Milo's first guess, find the exact edges of the question.
export async function locateInCrop(
  jpegBase64: string,
  size: { width: number; height: number },
  topic: string
): Promise<ApiOk<{ found: boolean; x: number; y: number; width: number; height: number }> | ApiErr> {
  return callTool(
    {
      max_tokens: 800,
      system:
        "You find exact pixel bounding boxes in screenshots. If the question sits inside a visible card, box, or bordered area, return that container's exact edges. Otherwise return a tight box around the question text and its answer blank.",
      tools: [LOCATE_TOOL],
      tool_choice: { type: "auto" },
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: jpegBase64 } },
            {
              type: "text",
              text: `This image is ${size.width}x${size.height} pixels, cropped from a student's screen. Find the homework question about: "${topic}". Return its exact bounding box in pixels of this image.`,
            },
          ],
        },
      ],
    },
    LOCATE_TOOL.name
  );
}

// ---------------------------------------------------------------------------
// Computer control: pick the next single action from a fresh screenshot.

export type Action = {
  action: "open_app" | "open_url" | "click" | "double_click" | "type" | "key" | "scroll" | "wait" | "ask" | "done";
  x?: number;
  y?: number;
  text?: string;
  keys?: string;
  app?: string;
  url?: string;
  direction?: "up" | "down";
  say: string;
};

const STEP_PROPS = {
  action: {
    type: "string",
    enum: ["open_app", "open_url", "click", "double_click", "type", "key", "scroll", "wait", "ask", "done"],
  },
  x: { type: "number", description: "For click/double_click: pixel x in the screenshot." },
  y: { type: "number", description: "For click/double_click: pixel y in the screenshot." },
  text: {
    type: "string",
    description: "For type: the exact text to type. For ask: a short question for the student. For done: what you did in 8 words or fewer, e.g. 'Done. Story's pasted in ChatGPT.'",
  },
  keys: { type: "string", description: 'For key: a combo like "cmd+a", "cmd+c", "cmd+v", "cmd+t", "cmd+w", "enter", "tab", "escape", "cmd+l".' },
  app: { type: "string", description: 'For open_app: exact macOS app name, e.g. "Claude", "Google Chrome", "Notes", "Safari".' },
  url: { type: "string", description: "For open_url: a full https:// URL." },
  direction: { type: "string", enum: ["up", "down"], description: "For scroll." },
  say: { type: "string", description: "Tiny status shown while doing it, 2-5 words: 'Opening Notes', 'Pasting it'." },
};

const ACT_TOOL = {
  name: "computer_actions",
  description: "The next steps to do on the student's Mac, in order.",
  input_schema: {
    type: "object",
    properties: {
      steps: {
        type: "array",
        minItems: 1,
        maxItems: 10,
        items: { type: "object", properties: STEP_PROPS, required: ["action", "say"] },
        description:
          "Do as many steps as you can from THIS screenshot without needing to look again (e.g. click the box, type, press enter). End the list right after any step that changes the screen a lot (opening an app or site, a click that opens a new page or menu): you'll get a fresh screenshot then. Put done (or ask) last only when the request will be finished by these steps.",
      },
    },
    required: ["steps"],
  },
};

export async function nextActions(
  jpegBase64: string,
  size: { width: number; height: number },
  task: string,
  history: string[]
): Promise<ApiOk<Action[]> | ApiErr> {
  const system = `${persona()}
You are controlling the student's Mac to finish their request, fast. Each turn you get a fresh screenshot (Milo himself is hidden from it) and a log of what you've already done. Plan the next steps you can do from this screenshot in one go.

How to work:
- Coordinates are pixels in the screenshot. Aim for the center of the thing you click.
- To switch to or launch an app, use open_app with its exact name (e.g. "Claude", "Google Chrome", "Notes", "Microsoft Word").
- Prefer keyboard shortcuts, they're instant: cmd+t new tab, cmd+w close tab, cmd+l address bar, cmd+a select all, cmd+c copy, cmd+v paste, cmd+n new note/doc, cmd+z undo.
- Copying between places: select (cmd+a or drag), cmd+c, open/switch to the other place, click the box, cmd+v.
- To type into something, click the text field first (unless the log shows you just clicked it), then type. In Google Docs or any document: click inside the page where the text goes, then type.
- Clicking a text box often changes nothing visible: assume it worked. Never click the same spot twice in a row.
- If something in the log didn't work, try a different way.
- Do exactly what was asked, nothing extra. If asked to type something, don't press Enter or send it unless they asked (asking ChatGPT/Claude something DOES mean send it).
- NEVER send, submit, post, publish, buy, pay, delete, or change account settings without asking first: use "ask".
- Never type passwords or payment details. If a login is needed, use "ask".
${profileText()}
- Finish with "done" and a summary of 8 words or fewer.`;

  const log = history.length ? history.map((h, i) => `${i + 1}. ${h}`).join("\n") : "(nothing yet)";
  const r = await callTool<{ steps: Action[] }>(
    {
      max_tokens: 1500,
      system,
      tools: [ACT_TOOL],
      tool_choice: { type: "auto" },
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: jpegBase64 } },
            {
              type: "text",
              text: `Request: "${task}"\nScreenshot size: ${size.width}x${size.height} pixels.\nWhat you've done so far:\n${log}\n\nWhat are the next steps?`,
            },
          ],
        },
      ],
    },
    ACT_TOOL.name
  );
  if (!r.ok) return r;
  const steps = Array.isArray(r.data?.steps) ? r.data.steps.filter((s) => s && s.action) : [];
  // Some models answer with a single step object instead of a list.
  if (!steps.length && (r.data as unknown as Action)?.action) steps.push(r.data as unknown as Action);
  if (!steps.length) return { ok: false, text: "I got my wires crossed. Try again?" };
  return { ok: true, data: steps.slice(0, 10) };
}

// ---------------------------------------------------------------------------
// Router: decides what the student wants, knowing what's open on screen right now.
export type RouteKind =
  | "chat" | "look" | "task" | "research" | "move" | "close" | "open_result" | "screen_question" | "kit" | "in_app" | "kit_menu" | "hold" | "drop"
  | "sweep" | "build" | "quiz" | "brief" | "watch" | "checkwork" | "lockin";
export type Route = { kind: RouteKind; minutes?: number; mode?: Mode; followUp?: boolean; where?: string; question?: string; on?: boolean; after?: string; app?: string; target?: string; request?: string; failed?: boolean };
export type RouteCtx = {
  researchOpen?: boolean;
  researchTopic?: string;
  inLesson?: boolean;
  lessonTopic?: string;
  toolOpen?: string;
  kitOpen?: string;
  quizOpen?: boolean;
  lockinOn?: boolean;
  lastCommand?: string;
};

const ROUTE_TOOL = {
  name: "route",
  description: "Decide what Milo should do with what the student just said.",
  input_schema: {
    type: "object",
    properties: {
      kind: {
        type: "string",
        enum: ["chat", "look", "task", "research", "move", "close", "open_result", "screen_question", "kit", "in_app", "kit_menu", "hold", "drop", "sweep", "build", "quiz", "brief", "watch", "checkwork", "lockin"],
        description: [
          "in_app = ONLY when one of Milo's apps is open (see 'Right now'): the request is something to do INSIDE that open app. Sheet: change the data or chart ('make it a box plot', 'add a z-score column', 'sort by score', 'who's above average', 'more bins', 'make another example'). Study: answer the problem, next, hint, another one, harder, explain. Sketch: change the drawing/graph ('shade above 80', 'add labels'). Notes: add to / ask about / quiz on the open note. Planner: change the plan. NOT in_app: closing it, opening a different app, anything outside the app (Chrome, moving, research).",
          "research = a request for information about the world (people, events, news, weather, scores, prices, facts, 'look up', 'tell me about', 'do some research on') when the student did NOT ask for Chrome / a browser / a tab / a website. Shown in Milo's own research box.",
          "task = the student wants the computer operated: open an app, Chrome, a browser tab or a website, click, type or write something somewhere (Google Docs, ChatGPT, Notes...), navigate, download. If they say Chrome, browser, tab, Google it, or name a website, it's a task even if they want information. EXCEPTION: reading something ALREADY open on their screen ('look at my screen', 'it has D2L open, find my next exam') is screen_question, even if they mention Chrome.",
          "look = help with homework that is on the screen (teach / hint / do it).",
          "kit = open one of Milo's OWN apps (set app): study (lessons: 'teach me z-scores', 'help me learn derivatives', 'I don't get photosynthesis' = study with a short animated lesson + practice; practice problems, a worked example solved step by step, flashcards, practice tests: 'make me a stats problem and solve it', 'quiz me on this', 'flashcards for bio', 'open your notes and make a problem so I can study'), sketch (draw/graph/show what something looks like: 'graph y=x^2', 'show me the normal curve for this', 'what does a mitochondria look like'), notes (Milo's notes: 'make notes on this page', 'add to my notes ...', 'open your notes', 'what did I write about z-scores?', 'quiz me on my stats notes'), sheet (tables, data and charts: 'put these scores in a table', 'find the mean of these', 'make me a histogram', 'make an example histogram', 'box plot of these numbers', 'pie chart of my budget', 'make a chart of the numbers I copied'), planner (study plan / what to study when: 'plan my week for the exam'), pocket (what Milo is holding). These are Milo's own apps, NOT Apple Notes, Excel or Google Sheets unless the student names those exact products ('Google Sheets', 'Microsoft Excel', 'Apple Notes', 'Google Docs'). A bare 'sheets', 'the sheet', 'spreadsheet', 'notes', 'sketch', 'study', 'planner' means MILO'S app (kit), even without 'your'. 'Your notes', 'your sketch', 'your planner' etc. ALWAYS mean Milo's apps. A QUESTION about what an app is or does ('what is the pocket used for?', 'what features are in your sheet?', 'what can your notes do?') is chat: answer it, don't open the app. Pick the app by what they want done, not the first app they name: 'open your notes and make a stats problem and solve it' = study (they want a problem solved); 'open your notes and write down X' = notes.",
          "Browsing saved work is kit too: everything Milo makes is saved in a folder per class. 'show my math drawings', 'open my bio folder', 'what did I save for stats', 'open my last sketch' = kit with app = the kind of thing (sketch, sheet, study for flashcards/problems, notes, planner; study if unclear) and request = what they said. 'save this to bio' / 'move it to my stats class' while an app is open = in_app.",
          "kit_menu = 'what can you do', 'what can you open', 'show me your tools/kit/apps'.",
          "hold = 'hold this', 'grab this', 'keep this for me' (Milo copies the selection into his pocket). drop = 'drop it', 'paste what you're holding', 'drop it in ChatGPT' (set target to where, if they said).",
          "screen_question = a question to answer FROM what's on the student's screen right now that isn't homework to solve: 'when is my next exam' (on D2L), 'what does this email say', 'summarize this page', 'what's due on this page', 'what grade did I get'.",
          "move = the student wants Milo himself (the frog character) to go somewhere on the screen: 'move to the bottom left', 'go to the other side', 'get out of the way'.",
          "close = close / dismiss what Milo has open himself: one of his apps (Sheet, Study, Notes, Sketch, Planner: 'close that', 'close the sheet', 'get rid of this'), his research box (it looks like a browser window, the student may call it 'the tab', 'this tab', 'the research tab', 'that page', 'the window'), a tool he built, or a lesson. When Milo's research box is open, 'close this tab' / 'close that' means the research box, not Chrome.",
          "open_result = open the page shown in the research box in Chrome ('open it in Chrome', 'open that article').",
          "sweep = do every question on the page. build = make a small working app/tool/calculator. quiz = quiz me. brief = what's due / daily brief. watch = watch me work (on:false to stop). checkwork = check my work once.",
          "lockin = start a focus session where Milo studies alongside the student and pulls them back when they drift to TikTok, Instagram, YouTube etc.: 'lock in', 'lock in for 45 minutes on stats', 'focus mode', 'help me focus', 'start a pomodoro', 'keep me off my phone while I study', 'I need to grind out this essay'. Set minutes if they gave a length and request = the subject if they named one. on:false to end a running session: 'stop the lock in', 'end focus', 'I'm done studying'.",
          "chat = conversation, or a quick question about a concept ('what is a derivative?'). But 'teach me X' / 'help me learn X' / 'I don't understand X' = kit study (a real lesson with practice).",
        ].join(" "),
      },
      mode: { type: "string", enum: ["teach", "help", "do"], description: "For look: teach (explain), help (hint), do (solve/complete it)." },
      followUp: { type: "boolean", description: "For research: true if this continues the topic in the open research box (uses he/she/it/that, or asks more about the same subject)." },
      where: {
        type: "string",
        enum: ["top-left", "top-right", "bottom-left", "bottom-right", "left", "right", "top", "bottom", "center", "away"],
        description: "For move: where Milo should go. 'away' = out of the way / other side.",
      },
      question: { type: "string", description: "For research: the question, cleaned up (drop filler like 'do some research on')." },
      on: { type: "boolean", description: "For watch and lockin: true to start, false to stop." },
      minutes: { type: "number", description: "For lockin: session length in minutes, if the student said one ('an hour' = 60)." },
      app: { type: "string", enum: ["study", "sketch", "notes", "sheet", "planner", "pocket"], description: "For kit: which of Milo's apps." },
      target: { type: "string", description: "For drop: where to paste it, in their words (e.g. 'ChatGPT', 'my Google Doc'). Empty = where they were." },
      after: { type: "string", description: "When the student asked for more than one thing: EVERYTHING after the first thing, in their words and order, e.g. 'close that and open your notes and make a note that I have a flight' -> kind close, after 'open your notes and make a note that I have a flight'. Milo routes it again after doing the first part." },
      request: { type: "string", description: "For in_app and kit: just the part of what they said that's for the app, cleaned of filler (e.g. 'make another example histogram')." },
    },
    required: ["kind"],
  },
};

function routeSystem(ctx: RouteCtx) {
  const now: string[] = [];
  if (ctx.researchOpen) now.push(`Milo's research box is OPEN on screen (it looks like a browser tab showing a web page), showing research on: "${ctx.researchTopic ?? "?"}".`);
  if (ctx.inLesson) now.push(`A homework lesson is open in the notebook about: "${ctx.lessonTopic ?? "?"}".`);
  if (ctx.toolOpen) now.push(`A tool Milo built is open: "${ctx.toolOpen}".`);
  if (ctx.kitOpen) now.push(`Milo's app is OPEN on screen: ${ctx.kitOpen}. Requests to change or use it are in_app; 'close that' closes it.`);
  if (ctx.quizOpen) now.push("A quiz is open.");
  if (ctx.lockinOn) now.push("A lock-in focus session is RUNNING. 'I'm done' / 'stop' / 'end it' about studying = lockin with on:false.");
  if (ctx.lastCommand) now.push(`The student's previous command was: "${ctx.lastCommand}".`);
  return [
    "You route requests for Milo, a desktop study companion (an animated frog that lives on the student's screen).",
    "Milo can: research things in his own research box, see and teach homework on screen, operate the computer (apps, sites, typing), move himself around the screen, build small tools, quiz, check work, and read what's due.",
    now.length ? "Right now: " + now.join(" ") : "Right now nothing is open.",
    "Decide what the student wants from what they actually said, not from keywords. Ignore filler at the start ('uh', 'cool', 'okay', 'so', 'can you'). Commands about Milo's own position are 'move' even when a box is open. Speech often has filler and self-corrections ('um', 'actually no, do X instead'): go with their final intent. Always answer by calling the route tool.",
  ].join("\n");
}

export async function classify(text: string, ctx: RouteCtx = {}): Promise<Route> {
  const body = {
    max_tokens: 500,
    system: routeSystem(ctx),
    tools: [ROUTE_TOOL],
    tool_choice: { type: "auto" },
    messages: [{ role: "user", content: `The student said: "${text}"` }],
  };
  // A small fast model routes; fall back to the main model if it isn't available.
  const fast = { ...body, model: process.env.MILO_ROUTER_MODEL || "claude-haiku-5-5" };
  let r = await callTool<Route>(fast, ROUTE_TOOL.name);
  if (!r.ok) {
    bb("router", "retry", { text, why: r.text });
    await new Promise((res) => setTimeout(res, 350)); // a blip (busy / network): one quick retry
    r = await callTool<Route>(fast, ROUTE_TOOL.name);
  }
  if (!r.ok) r = await callTool<Route>(body, ROUTE_TOOL.name);
  if (!r.ok) bb("router", "failed", { text, why: r.text });
  return r.ok && r.data?.kind ? r.data : { kind: "chat", failed: true };
}

// ---------------------------------------------------------------------------
// Worksheet Sweep: every question on screen, its answer, and where the answer goes.
export type SweepItem = {
  label: string;
  box: { x: number; y: number; width: number; height: number };
  work: string;
  answer: string;
  input: { kind: "type" | "choose" | "none"; x?: number; y?: number };
};

const SWEEP_TOOL = {
  name: "worksheet",
  description: "Every question on screen, solved, with where to put each answer.",
  input_schema: {
    type: "object",
    properties: {
      questions: {
        type: "array",
        description: "All visible, unanswered questions, top to bottom.",
        items: {
          type: "object",
          properties: {
            label: { type: "string", description: "The number/letter printed on the page, e.g. '4' or 'b'." },
            box: {
              type: "object",
              description: "Pixel box around the whole question (and its answer area).",
              properties: { x: { type: "number" }, y: { type: "number" }, width: { type: "number" }, height: { type: "number" } },
              required: ["x", "y", "width", "height"],
            },
            work: { type: "string", description: "One short line showing the key step. LaTeX between $...$ allowed." },
            answer: {
              type: "string",
              description: "The final answer exactly as it should be typed (plain text, no LaTeX), or the exact text of the correct choice.",
            },
            input: {
              type: "object",
              description:
                "Where the answer goes. kind=type: an empty text box/blank you can type into (x,y = point inside it). kind=choose: multiple choice (x,y = the radio button/circle/box of the correct option). kind=none: no field (printed page, PDF, image).",
              properties: { kind: { type: "string", enum: ["type", "choose", "none"] }, x: { type: "number" }, y: { type: "number" } },
              required: ["kind"],
            },
          },
          required: ["label", "box", "work", "answer", "input"],
        },
      },
      more_below: { type: "boolean", description: "True if the page clearly continues below the visible area (more questions off screen)." },
    },
    required: ["questions", "more_below"],
  },
};

export async function sweepPlan(
  jpegBase64: string,
  size: { width: number; height: number },
  skip: string[]
): Promise<ApiOk<{ questions: SweepItem[]; more_below: boolean }> | ApiErr> {
  return callTool(
    {
      max_tokens: 6000,
      system: `${persona()}
You are completing a student's worksheet that is open on their screen. Find every visible question that still needs an answer, solve each one carefully, and say exactly where its answer goes. Coordinates are pixels in the screenshot. Be precise with input points: the center of the empty field, or the center of the correct option's radio button/checkbox.
Skip questions that already have an answer filled in.${skip.length ? ` Also skip these, already done: ${skip.join(", ")}.` : ""}`,
      tools: [SWEEP_TOOL],
      tool_choice: { type: "auto" },
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: jpegBase64 } },
            { type: "text", text: `Screenshot is ${size.width}x${size.height} pixels. Do the whole worksheet.` },
          ],
        },
      ],
    },
    SWEEP_TOOL.name
  );
}

// ---------------------------------------------------------------------------
// Watch Me Work: spot a clear mistake in what the student is working on right now.
export type WatchResult = {
  found_mistake: boolean;
  confidence: number;
  box?: { x: number; y: number; width: number; height: number };
  hint: string;
};

const WATCH_TOOL = {
  name: "review",
  description: "Report whether there is a clear mistake in the student's in-progress work.",
  input_schema: {
    type: "object",
    properties: {
      found_mistake: { type: "boolean" },
      confidence: { type: "number", description: "0 to 1. Only above 0.75 if you are sure it is wrong." },
      box: {
        type: "object",
        description: "Tight pixel box around the exact mistake (the wrong number, cell, line, or word).",
        properties: { x: { type: "number" }, y: { type: "number" }, width: { type: "number" }, height: { type: "number" } },
        required: ["x", "y", "width", "height"],
      },
      hint: {
        type: "string",
        description: "One short spoken sentence pointing at the problem WITHOUT giving the answer, e.g. 'Check your denominator, it should be the standard deviation.'",
      },
    },
    required: ["found_mistake", "confidence", "hint"],
  },
};

export async function watchCheck(jpegBase64: string, size: { width: number; height: number }): Promise<ApiOk<WatchResult> | ApiErr> {
  return callTool(
    {
      max_tokens: 1200,
      system: `${persona()}
You are quietly watching the student work. Look at their own in-progress work on screen (math steps, answers they typed, spreadsheet formulas, code, essay sentences).
Flag ONLY a clear, concrete error that is already written: a wrong number or calculation, wrong formula or cell reference, a bug, a factual or grammar error.
Do not flag unfinished work, style preferences, or anything you're unsure about. Most of the time the answer is found_mistake=false.`,
      tools: [WATCH_TOOL],
      tool_choice: { type: "auto" },
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: jpegBase64 } },
            { type: "text", text: `Screenshot is ${size.width}x${size.height} pixels. Anything clearly wrong so far?` },
          ],
        },
      ],
    },
    WATCH_TOOL.name
  );
}

// ---------------------------------------------------------------------------
// Quiz Mode: a quiz built from whatever is on screen (slides, notes, a PDF, a textbook page).
export type QuizData = {
  topic: string;
  questions: { q: string; choices: string[]; correct: number; explain: string }[];
};

const QUIZ_TOOL = {
  name: "quiz",
  description: "A multiple-choice quiz on the material shown.",
  input_schema: {
    type: "object",
    properties: {
      topic: { type: "string", description: "2 to 5 word topic name." },
      questions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            q: { type: "string", description: "The question. Math in $...$ LaTeX allowed." },
            choices: { type: "array", items: { type: "string" }, description: "Exactly 4 choices, plausible distractors." },
            correct: { type: "number", description: "Index 0-3 of the correct choice." },
            explain: { type: "string", description: "One short sentence on why it's right (spoken aloud, no LaTeX)." },
          },
          required: ["q", "choices", "correct", "explain"],
        },
      },
    },
    required: ["topic", "questions"],
  },
};

export async function makeQuiz(jpegBase64: string, size: { width: number; height: number }, count: number, focus: string): Promise<ApiOk<QuizData> | ApiErr> {
  return callTool(
    {
      max_tokens: 4000,
      system: `${persona()}
Write a ${count}-question multiple-choice quiz based ONLY on the study material visible on the student's screen (lecture slides, notes, a PDF, a textbook or web page).
Mix recall and application questions, easy to harder. Exactly 4 choices each, one clearly correct. No trick questions, no "all of the above".
Vary which letter is correct. If there's no study material on screen, quiz on the topic the student names.`,
      tools: [QUIZ_TOOL],
      tool_choice: { type: "auto" },
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: jpegBase64 } },
            { type: "text", text: `Screenshot is ${size.width}x${size.height}. ${focus ? `Student said: "${focus}".` : "Quiz me on this."}` },
          ],
        },
      ],
    },
    QUIZ_TOOL.name
  );
}

// ---------------------------------------------------------------------------
// Daily Brief: read the student's course portal (D2L) homepage and list what's due.
export type Brief = {
  signed_in: boolean;
  items: { title: string; course: string; due: string; urgent: boolean; due_iso?: string; kind?: string }[];
  spoken: string;
};

const BRIEF_TOOL = {
  name: "brief",
  description: "What's due, read from the student's course portal page.",
  input_schema: {
    type: "object",
    properties: {
      signed_in: { type: "boolean", description: "False if this is a login page or asks the student to sign in." },
      items: {
        type: "array",
        description: "EVERY upcoming assignment, quiz, exam, discussion and project visible on the page or in its text, soonest first (max 15). Skip things already past due by more than a day.",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            course: { type: "string", description: "Short course name or code." },
            due: { type: "string", description: "Short human due date, e.g. 'Tomorrow 11:59 PM' or 'Fri, Nov 21'." },
            urgent: { type: "boolean", description: "Due within about 48 hours." },
            due_iso: { type: "string", description: "Exact local due date-time 'YYYY-MM-DDTHH:mm' worked out from today's date (use T23:59 if no time is shown). '' only if there's no date at all." },
            kind: { type: "string", enum: ["assignment", "quiz", "exam", "discussion", "project", "reading", "other"] },
          },
          required: ["title", "course", "due", "urgent", "due_iso", "kind"],
        },
      },
      spoken: {
        type: "string",
        description: "One or two short sentences Milo says, e.g. 'You've got two things due tomorrow: the Stats homework and the Accounting quiz.' No greeting.",
      },
    },
    required: ["signed_in", "items", "spoken"],
  },
};

export async function readBrief(jpegBase64: string, today: string, pageText = ""): Promise<ApiOk<Brief> | ApiErr> {
  return callTool(
    {
      max_tokens: 1500,
      system: `${persona()}\nYou read a screenshot of the student's course portal (D2L Brightspace or similar). Today is ${today}.`,
      tools: [BRIEF_TOOL],
      tool_choice: { type: "auto" },
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: jpegBase64 } },
            { type: "text", text: `What's coming up? Today is ${today} (${new Date().toISOString().slice(0, 10)}).${pageText ? `\n\nAll the text on the page (including widgets the screenshot cuts off):\n${pageText.slice(0, 18000)}` : ""}` },
          ],
        },
      ],
    },
    BRIEF_TOOL.name
  );
}

// ---------------------------------------------------------------------------
// Web tasks through the Chrome extension: Milo reads the page's real buttons/fields (no screenshot).
export type WebAction = {
  action: "click" | "type" | "key" | "navigate" | "new_tab" | "switch_tab" | "back" | "scroll" | "wait" | "ask" | "done" | "use_screen";
  id?: string;
  text?: string;
  clear?: boolean;
  keys?: string;
  url?: string;
  tab?: number;
  direction?: "up" | "down" | "top" | "bottom";
  say: string;
};

const WEB_STEP = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: ["click", "type", "key", "navigate", "new_tab", "switch_tab", "back", "scroll", "wait", "ask", "done", "use_screen"],
      description:
        "click/type use an element id from the list. key = keyboard shortcut or Enter (e.g. 'enter', 'cmd+a', 'cmd+c', 'cmd+v', 'cmd+w'). navigate = open a URL in this tab. new_tab = open a URL in a new tab. switch_tab = go to another open tab (tab = its id). use_screen = this page can't be read as elements (canvas editor like Google Docs/Sheets, a game, a PDF): hand over to screen mode.",
    },
    id: { type: "string", description: "Element id from the list (for click / type)." },
    text: { type: "string", description: "For type: exact text. For ask: a short question. For done: what you did in 8 words or fewer, e.g. 'Done. TCU plays Thursday at 7.' If the request was to read, find or note information, put the facts you found instead (up to 60 words, e.g. 'Volt 13 $849 9h; Kestrel 14 $799 7h')." },
    clear: { type: "boolean", description: "For type: replace what's in the box instead of adding to it." },
    keys: { type: "string", description: "For key." },
    url: { type: "string", description: "For navigate / new_tab: full https URL." },
    tab: { type: "number", description: "For switch_tab." },
    direction: { type: "string", enum: ["up", "down", "top", "bottom"] },
    say: { type: "string", description: "Tiny status, 2-5 words: 'Searching TCU hoops'." },
  },
  required: ["action", "say"],
};

const WEB_TOOL = {
  name: "web_actions",
  description: "The next steps to take in the browser, in order.",
  input_schema: {
    type: "object",
    properties: {
      steps: {
        type: "array",
        minItems: 1,
        maxItems: 12,
        items: WEB_STEP,
        description:
          "Do as many steps as you can with THIS page's element ids (e.g. type in the search box, then press enter). On a form, fill EVERY field you can in this one list (all the typing, dropdown picks and checkboxes) before anything that loads a new page. End the list right after a step that loads a new page, switches tabs, or opens a menu/dialog: you'll get the updated page then. Put done (or ask) last only when the request will be finished by these steps.",
      },
    },
    required: ["steps"],
  },
};

export async function webActions(task: string, page: string, history: string[]): Promise<ApiOk<WebAction[]> | ApiErr> {
  const system = `${persona()}
You are using the student's Chrome browser to finish their request, fast. Instead of a screenshot you get the page as a list of interactive elements (with ids) plus the page's text. Plan the next steps you can do on this page in one go.

How to work:
- Click and type using element ids from the list. Prefer elements marked on-screen.
- To search a site, type into its search box, then press enter (key "enter") or click its search button.
- Dropdowns (select): use type with the exact option text (e.g. "Junior"). Never press Enter in a form's fields: it submits the form.
- To go to a website directly, use navigate with the URL (faster than searching). To answer a question from the web, a Google search URL is fine: https://www.google.com/search?q=...
- To write in ChatGPT, Claude, Gemini etc: type into the message box. Asking ChatGPT something or "have ChatGPT write X" means send it: press enter after typing.
- Copying text: you already have the page text, so you can type it where it needs to go instead of copy/paste.
- If the list is empty or the page is a canvas editor (Google Docs, Sheets, Slides, Canva, Figma), use "use_screen".
- If something in the log didn't work, try a different element or approach. Never repeat the exact same action twice in a row.
- Do exactly what was asked, nothing extra.
- NEVER buy, pay, post publicly, delete, send email/messages to people, or change account settings without asking first: use "ask".
- Never type passwords or payment details. If a login is needed, use "ask".
${profileText()}
- Finish with "done" and 8 words or fewer. If they asked a question, the done text IS the answer (short). If the request was to read, find or note information, the done text holds the facts found (up to 60 words).`;
  const log = history.length ? history.map((h, i) => `${i + 1}. ${h}`).join("\n") : "(nothing yet)";
  const body = {
    max_tokens: 1500,
    system,
    tools: [WEB_TOOL],
    tool_choice: { type: "auto" },
    messages: [{ role: "user", content: `Student's request: "${task}"\n\nWhat you've done so far:\n${log}\n\nThe browser right now:\n${page}` }],
  };
  const pick = (d: { steps?: WebAction[] } | undefined): WebAction[] => {
    const steps = Array.isArray(d?.steps) ? d!.steps.filter((x) => x && x.action) : [];
    if (!steps.length && (d as unknown as WebAction)?.action) steps.push(d as unknown as WebAction);
    return steps.slice(0, 12);
  };
  // Reading a list of elements is easy: the fast model does it. The main model is the backup.
  let r = await callTool<{ steps: WebAction[] }>({ ...body, model: process.env.MILO_WEB_MODEL || "claude-haiku-5-5" }, WEB_TOOL.name);
  let steps = r.ok ? pick(r.data) : [];
  if (!steps.length) {
    r = await callTool<{ steps: WebAction[] }>(body, WEB_TOOL.name);
    if (!r.ok) return r;
    steps = pick(r.data);
  }
  if (!steps.length) return { ok: false, text: "I got my wires crossed. Try again?" };
  return { ok: true, data: steps };
}


// ---------------------------------------------------------------------------
// Answer a question from what's on screen (page text from the Chrome extension, or a screenshot).
export async function askScreen(question: string, src: { pageText?: string; url?: string; title?: string; jpeg?: string; size?: { width: number; height: number } }) {
  const system = `${persona()}
The student asked a question about what's on their screen right now. Answer it from what you're given in ONE short spoken sentence, under 25 words (no lists, no symbols, no links). Use exact dates, times, names and numbers from the screen. If the answer isn't there, say what you'd need them to open (for example "open your calendar or the course page with the exam schedule").`;
  const content: unknown[] = [];
  if (src.jpeg) content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: src.jpeg } });
  const pageBit = src.pageText ? `\n\nThe page (${src.title ?? ""} — ${src.url ?? ""}):\n${src.pageText.slice(0, 14000)}` : "";
  content.push({ type: "text", text: `Question: "${question}"\nToday is ${new Date().toDateString()}.${pageBit}` });
  const r = await callClaude({ max_tokens: 400, system, messages: [{ role: "user", content }] });
  if (!r.ok) return r;
  const text = r.data.filter((b) => b.type === "text").map((b) => b.text).join(" ").trim();
  return { ok: true as const, text: text || "I couldn't find that on your screen." };
}

// Shared with the kit (kit.ts).
export { callTool, callClaude, persona };
export type { ApiOk, ApiErr };

// ---------------------------------------------------------------------------
// "Milo, handle this": a vague ask. Look at the screen and offer 2-3 concrete things Milo can do,
// as tappable chips. Each chip's `say` is a normal command, so tapping it runs the usual flow.
export type Suggestion = { seen: string; options: { label: string; say: string }[] };
const SUGGEST_TOOL = {
  name: "suggest",
  description: "What is on screen, and the 2-3 most useful things Milo could do with it right now.",
  input_schema: {
    type: "object",
    properties: {
      seen: { type: "string", description: "Under 12 words, what's on screen. 'A stats problem set on D2L, question 4 of 12.'" },
      options: {
        type: "array",
        items: {
          type: "object",
          properties: {
            label: { type: "string", description: "Button text, 2-6 words, starts with a verb. 'Make a game plan'" },
            say: { type: "string", description: "The command Milo runs, in the student's words, using the phrasings listed." },
          },
          required: ["label", "say"],
        },
      },
    },
    required: ["seen", "options"],
  },
};
export async function suggestActions(jpegBase64: string, size: { width: number; height: number }, said: string): Promise<ApiOk<Suggestion> | ApiErr> {
  const r = await callTool<Suggestion>(
    {
      max_tokens: 500,
      system: `${persona()}
The student pointed Milo at their screen with a vague ask ("${said.slice(0, 120)}"). Offer the 2 or 3 most useful things Milo can actually do with what's on screen, best first.
Use ONLY these command phrasings for "say" (fill in the brackets):
- "start this" (an assignment/problem set: game plan + first step)
- "explain this" (teach the concept on screen step by step)
- "quiz me on this" (practice quiz from slides, notes, a reading)
- "check my work" (look for mistakes in work the student wrote)
- "make flashcards on this"
- "summarize this" (a reading, article, PDF)
- "what's next" (planning, deadlines, calendar, a list of due dates)
- "add [event] to my calendar on [day and time]" (an event, date or deadline that isn't on their calendar)
- "write an email to [person] about [topic]" (an email or message that needs a reply)
- "research [topic]"
Never offer to do graded work for them, submit anything, or buy anything. Match the screen: an essay draft -> check my work; lecture slides -> quiz me / flashcards; an email -> reply.`,
      tools: [SUGGEST_TOOL],
      tool_choice: { type: "auto" },
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: jpegBase64 } },
            { type: "text", text: `Screenshot is ${size.width}x${size.height}. What are the best 2-3 things to offer?` },
          ],
        },
      ],
    },
    SUGGEST_TOOL.name
  );
  if (!r.ok) return r;
  return { ok: true, data: { seen: String(r.data.seen ?? "").slice(0, 120), options: cleanOptions(r.data.options) } };
}
/** Keep 1-3 options with real text; drop anything that would do graded work or submit/buy. (pure) */
export function cleanOptions(raw: unknown): { label: string; say: string }[] {
  const opts = asArray(raw);
  if (!Array.isArray(opts)) return [];
  return opts
    .filter((o): o is { label: string; say: string } => !!o && typeof o.label === "string" && typeof o.say === "string" && !!o.label.trim() && !!o.say.trim())
    .filter((o) => !/\b(submit|turn (it )?in|buy|purchase|pay|do (the|this|my) (whole )?(worksheet|assignment|homework|quiz|test|exam))\b/i.test(`${o.label} ${o.say}`))
    .map((o) => ({ label: o.label.trim().slice(0, 40), say: o.say.trim().slice(0, 200) }))
    .slice(0, 3);
}

// ---------------------------------------------------------------------------
// "Milo, check this" (Preflight, beta): check the student's own work against the requirements Milo can
// actually see (the rubric they copied, instructions on screen). Every finding is labeled honestly:
//   confirmed = a requirement Milo can quote is clearly not met; possible = might need a look; unknown = can't judge.
export type PreflightItem = { status: "confirmed" | "possible" | "unknown"; text: string; quote: string; source: "rubric" | "screen" | "none" };
export type Preflight = { requirements_seen: boolean; items: PreflightItem[]; summary: string };
const PREFLIGHT_TOOL = {
  name: "preflight",
  description: "Findings from checking the student's work against the requirements.",
  input_schema: {
    type: "object",
    properties: {
      requirements_seen: { type: "boolean", description: "True only if a rubric or written instructions were actually available." },
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            status: { type: "string", enum: ["confirmed", "possible", "unknown"] },
            text: { type: "string", description: "One plain sentence, kind and specific. 'The rubric asks for 3 sources and I can find 2.'" },
            quote: { type: "string", description: "The exact requirement words from the rubric or instructions (under 20 words). Empty if none." },
            source: { type: "string", enum: ["rubric", "screen", "none"] },
          },
          required: ["status", "text", "quote", "source"],
        },
      },
      summary: { type: "string", description: "One short spoken line." },
    },
    required: ["requirements_seen", "items", "summary"],
  },
};
export async function preflightCheck(src: { jpeg?: string; size?: { width: number; height: number }; work?: string; rubric?: string }): Promise<ApiOk<Preflight> | ApiErr> {
  const content: unknown[] = [];
  if (src.jpeg && src.size) content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: src.jpeg } });
  content.push({
    type: "text",
    text: [
      src.rubric ? `RUBRIC / INSTRUCTIONS THE STUDENT GAVE YOU:\n"""${src.rubric.slice(0, 6000)}"""` : "No rubric was given. Use only instructions visible on screen, if any.",
      src.work ? `THE STUDENT'S WORK:\n"""${src.work.slice(0, 12000)}"""` : src.size ? `The student's work is on screen (${src.size.width}x${src.size.height}).` : "",
      "Check the work before they submit it.",
    ]
      .filter(Boolean)
      .join("\n\n"),
  });
  const r = await callTool<Preflight>(
    {
      max_tokens: 1500,
      system: `${persona()}
You are Milo's pre-submit check. The student asked you to look over THEIR OWN work against the requirements. You never rewrite or finish the work.
Rules, strictly:
- "confirmed" ONLY when you can quote a specific requirement from the rubric/instructions AND the work clearly doesn't meet it (count things, check what's there). Put the requirement's exact words in quote.
- "possible" when something might be off but you aren't sure, or a requirement is only partly visible.
- "unknown" for requirements you can't check from what you see (e.g. page count of a document you can't fully see, file format, due time).
- Never invent requirements. If there is no rubric and no instructions, say so: requirements_seen=false, and only flag clear errors in the work itself as "possible".
- Max 6 items, most important first. Don't list things that are fine. If everything checks out, return no items.
- Talk like a friendly TA: specific and calm. Never "you will lose points".`,
      tools: [PREFLIGHT_TOOL],
      tool_choice: { type: "auto" },
      messages: [{ role: "user", content }],
    },
    PREFLIGHT_TOOL.name
  );
  if (!r.ok) return r;
  return { ok: true, data: { requirements_seen: !!r.data.requirements_seen, items: honestItems(r.data.items, !!src.rubric), summary: String(r.data.summary ?? "").slice(0, 200) } };
}
/** Never claim more than Milo can back up: "confirmed" needs a quoted requirement from a real source. (pure) */
export function honestItems(raw: unknown, hadRubric: boolean): PreflightItem[] {
  const items = asArray(raw);
  if (!Array.isArray(items)) return [];
  const order = { confirmed: 0, possible: 1, unknown: 2 } as const;
  const seen = new Set<string>();
  return items
    .filter((x): x is PreflightItem => !!x && typeof x.text === "string" && !!x.text.trim())
    .map((x) => {
      const quote = typeof x.quote === "string" ? x.quote.trim().slice(0, 160) : "";
      let source: PreflightItem["source"] = x.source === "rubric" || x.source === "screen" ? x.source : "none";
      if (source === "rubric" && !hadRubric) source = "screen"; // it can't have read a rubric it wasn't given
      const status: PreflightItem["status"] = x.status === "confirmed" || x.status === "possible" || x.status === "unknown" ? x.status : "possible";
      return { status: status === "confirmed" && (!quote || source === "none") ? "possible" : status, text: x.text.trim().slice(0, 240), quote, source: quote ? source : "none" };
    })
    .filter((x) => (seen.has(x.text) ? false : (seen.add(x.text), true)))
    .sort((a, b) => order[a.status] - order[b.status])
    .slice(0, 6);
}

/** Models sometimes send an array as a JSON string ("[{...}]"). Accept both. (pure) */
export function asArray(v: unknown): unknown {
  if (typeof v !== "string") return v;
  try {
    const p = JSON.parse(v);
    return Array.isArray(p) ? p : v;
  } catch {
    return v;
  }
}
