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
You are friendly, upbeat, fast and a little playful. You talk like a smart friend, never like a textbook.`;

const chatPrompt = () => `${persona()}
You live on the student's Mac. You CAN look at their screen, jump to homework questions and teach them in your notebook,
and you CAN use the computer (open apps, files, websites and tabs, click, type). Never say you can't see their screen or use their computer.
If they want something done on screen, tell them you're on it in a few words.
Keep chat replies short (1 to 4 sentences) unless the student asks for detail.`;

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
  return process.env.MILO_MODEL || "claude-sonnet-5-5";
}

async function callClaude(body: Record<string, unknown>): Promise<ApiOk<Block[]> | ApiErr> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { ok: false, text: "I don't have a brain yet! Add your ANTHROPIC_API_KEY to the .env file and restart me." };
  }
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model: model(), ...body }),
    });
    if (!res.ok) {
      const detail = await res.text();
      return { ok: false, text: `My brain hit an error (${res.status}). ${detail.slice(0, 200)}` };
    }
    const data = (await res.json()) as { content?: Block[] };
    return { ok: true, data: data.content ?? [] };
  } catch (err) {
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

export async function askMilo(history: ChatMessage[]): Promise<{ ok: boolean; text: string }> {
  const r = await callClaude({ max_tokens: 600, system: chatPrompt(), messages: history.slice(-20) });
  if (!r.ok) return r;
  const text = r.data
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  return { ok: true, text: text || "Hmm, I blanked on that one. Try again?" };
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

const ACT_TOOL = {
  name: "computer_action",
  description: "Do exactly one action on the student's Mac.",
  input_schema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["open_app", "open_url", "click", "double_click", "type", "key", "scroll", "wait", "ask", "done"],
      },
      x: { type: "number", description: "For click/double_click: pixel x in the screenshot." },
      y: { type: "number", description: "For click/double_click: pixel y in the screenshot." },
      text: {
        type: "string",
        description: "For type: the exact text to type. For ask: the question to ask the student. For done: a one-sentence summary of what you did.",
      },
      keys: { type: "string", description: 'For key: a combo like "cmd+a", "cmd+t", "enter", "tab", "escape", "cmd+l".' },
      app: { type: "string", description: 'For open_app: exact macOS app name, e.g. "Claude", "Google Chrome", "Notes", "Safari".' },
      url: { type: "string", description: "For open_url: a full https:// URL." },
      direction: { type: "string", enum: ["up", "down"], description: "For scroll." },
      say: { type: "string", description: "What Milo says while doing this. Under 8 words, playful. E.g. 'Opening Claude!', 'Clicking the message box'." },
    },
    required: ["action", "say"],
  },
};

export async function nextAction(
  jpegBase64: string,
  size: { width: number; height: number },
  task: string,
  history: string[]
): Promise<ApiOk<Action> | ApiErr> {
  const system = `${persona()}
You are controlling the student's Mac to finish their request. Each turn you get a fresh screenshot (Milo himself is hidden from it) and a log of what you've already done. Choose exactly ONE next action.

How to work:
- Coordinates are pixels in the screenshot. Aim for the center of the thing you click.
- To switch to or launch an app, use open_app with its exact name (e.g. "Claude", "Google Chrome", "Notes", "Microsoft Word").
- To type into something, click the text field first (unless the log shows you just clicked it), then use type.
- For Google Docs or any document: click inside the page where the text should go (usually at the end of the existing text), then type.
- Use key for shortcuts and Enter. Use scroll if what you need is off screen.
- After an action, check the new screenshot to confirm it worked before moving on. If something didn't work, try a different way.
- Clicking a text box often changes nothing visible. If the log shows you just clicked a text box, assume it worked and type next. Never click the same spot twice in a row.
- Do exactly what was asked, nothing extra. If asked to type something, type it but don't press Enter or send it unless they asked.
- NEVER do anything that sends, submits, posts, publishes, buys, pays, deletes, or changes account settings without asking first: use action "ask" with the question instead.
- Never type passwords or payment details. If a login is needed, use "ask".
- When the request is complete, use "done" with a one-sentence summary in text.
- If it's impossible, use "done" and explain in text.`;

  const log = history.length ? history.map((h, i) => `${i + 1}. ${h}`).join("\n") : "(nothing yet)";
  return callTool<Action>(
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
              text: `Request: "${task}"\nScreenshot size: ${size.width}x${size.height} pixels.\nWhat you've done so far:\n${log}\n\nWhat's the next action?`,
            },
          ],
        },
      ],
    },
    ACT_TOOL.name
  );
}

// ---------------------------------------------------------------------------
// Router: when keywords don't settle it, decide what the student wants.
export type Route = { kind: "chat" | "look" | "task" | "research"; mode?: Mode };

const ROUTE_TOOL = {
  name: "route",
  description: "Decide what Milo should do with this request.",
  input_schema: {
    type: "object",
    properties: {
      kind: {
        type: "string",
        enum: ["chat", "look", "task", "research"],
        description:
          "look = help with a homework question/problem that is (or will be) on screen. task = do something on the computer (open files/apps/sites, click, type, navigate). research = look up current or real-world facts on the web (people, weather, news, scores, prices, events, anything that may have changed). chat = just talk or explain a general concept.",
      },
      mode: { type: "string", enum: ["teach", "help", "do"], description: "For look: teach (explain), help (hint), do (solve/complete it)." },
    },
    required: ["kind"],
  },
};

export async function classify(text: string): Promise<Route> {
  const r = await callTool<Route>(
    {
      max_tokens: 300,
      system:
        "You route requests for Milo, a desktop study companion that can see the screen, teach homework on screen, and control the computer.",
      tools: [ROUTE_TOOL],
      tool_choice: { type: "auto" },
      messages: [{ role: "user", content: `Request: "${text}"` }],
    },
    ROUTE_TOOL.name
  );
  return r.ok ? r.data : { kind: "chat" };
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
  items: { title: string; course: string; due: string; urgent: boolean }[];
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
        description: "Upcoming assignments, quizzes and exams visible on the page, soonest first (max 6).",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            course: { type: "string", description: "Short course name or code." },
            due: { type: "string", description: "Short human due date, e.g. 'Tomorrow 11:59 PM' or 'Fri, Nov 21'." },
            urgent: { type: "boolean", description: "Due within about 48 hours." },
          },
          required: ["title", "course", "due", "urgent"],
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

export async function readBrief(jpegBase64: string, today: string): Promise<ApiOk<Brief> | ApiErr> {
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
            { type: "text", text: "What's coming up?" },
          ],
        },
      ],
    },
    BRIEF_TOOL.name
  );
}
