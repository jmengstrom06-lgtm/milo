// Instant decisions: the few things Milo does WITHOUT asking his brain, because they can't be misread.
// Everything else goes to the AI router, which knows what's open. Every rule here is unit-tested
// (tests/decide.test.ts): a rule may only match a WHOLE short command, never the start of a sentence.

export type KitAppId = "study" | "sketch" | "notes" | "sheet" | "planner" | "pocket";
export type DecideState = {
  kitOpen: KitAppId | null; // one of Milo's apps is open
  researchOpen: boolean; // Milo's research box
  toolOpen: boolean; // a tool Milo built
  lessonOpen: boolean; // a homework lesson in the notebook
  hasLastAnswer: boolean;
};
export type Fast =
  | { do: "flag" }
  | { do: "kit_menu" }
  | { do: "classes"; text?: string }
  | { do: "hold" }
  | { do: "drop"; target?: string }
  | { do: "save_notes" }
  | { do: "open_kit"; app: KitAppId }
  | { do: "close_chrome_then"; rest: string }
  | { do: "close_own"; then?: string }
  | { do: "resize"; size: "full" | "half" | "compact" }
  | { do: "shortcut" };

/** "Uh, cool, okay, so…" -> the actual command. Filler never decides anything. */
export function stripFiller(raw: string): string {
  const t = raw.replace(/^(?:(?:hey|ok(?:ay)?|so|uh+|um+|cool|alright|all right|yeah|well|and|milo)\b[,.]?\s*)+/i, "").trim() || raw;
  // Speech-to-text often hears "Milo, close…" as "Milo closed…". A sentence that starts that way is a command.
  return t.replace(/^(clos|open)ed\b/i, (_m, w: string) => (w.toLowerCase() === "clos" ? "close" : "open"));
}
/** Lowercase, no end punctuation, no politeness ("can you", "would you", "for me"). */
export function plainOf(text: string): string {
  return stripFiller(text)
    .toLowerCase()
    .replace(/[.!?]+$/, "")
    .replace(/^(?:(?:can you|could you|would you|will you|please|just|now|go ahead and)[, ]+)+/, "")
    .replace(/,?\s*(for me|please|real quick|right now)$/, "")
    .trim();
}

const KIT_WORDS: Record<string, KitAppId> = {
  notes: "notes", "study deck": "study", study: "study", sketch: "sketch", "sketch pad": "sketch", sketchpad: "sketch",
  sheet: "sheet", sheets: "sheet", spreadsheet: "sheet", "spread sheet": "sheet", "spreadsheets": "sheet", excel: "sheet", "excel sheet": "sheet",
  planner: "planner", pocket: "pocket",
};

// Close-word + only "pointer" words = Milo's own open thing. ("close that", "close the sheet", "get rid of this tab")
const OWN_THING = /^(\s*(the|this|that|your|my|it|now|research|box|panel|tab|window|page|tool|one|you just opened|up|out|thing|notes|study|deck|sketch|sheet|sheets|planner|pocket|kit|graph|chart|histogram|table|problems?|flashcards?|app)\b)*\s*$/;

// Computer shortcuts: the WHOLE command must be the shortcut. ("close that tab with the histogram" is NOT one.)
const SHORTCUT = new RegExp(
  "^(" +
    [
      "copy( (it|that|this))?",
      "paste( (it|that|this))?",
      "select (all|everything)",
      "undo( (that|it))?",
      "redo( (that|it))?",
      "cut( (it|that|this))?",
      "save( (it|this|the file))?",
      "close (this |the |that )?(chrome |browser )?(tab|window)",
      "(open )?(a )?new (chrome )?(tab|window)",
      "(go to the )?(next|previous|last) tab",
      "reopen( (the )?(last |closed )?tab)?",
      "quit [a-z][a-z ]{1,30}",
      "minimi[sz]e( (this|it|the window))?",
      "zoom (in|out)",
      "refresh( (the )?page)?",
      "reload( (the )?page)?",
      "go back",
      "scroll (up|down)",
    ].join("|") +
    ")$"
);

export function fastDecide(raw: string, s: DecideState): Fast | null {
  const text = stripFiller(raw);
  const t = plainOf(raw);
  const milosThingOpen = !!(s.kitOpen || s.researchOpen || s.toolOpen);

  if (/^(flag (that|this|it)|that was (wrong|bad|weird|a bug|broken)|log (that|this)|report (a |that |this )?bug|bug report|that'?s a bug)\b/.test(t)) return { do: "flag" };
  if (/^(what can you (do|open|make)|what('?s| is) in your (kit|tool ?box)|show me your (tools|kit|apps|tool ?box)|open your (kit|tool ?box|tools|apps))$/.test(t)) return { do: "kit_menu" };
  if (/^(my (\w+ )?classes are|i'?m taking|this (semester|term) i'?m taking)\b/.test(t)) return { do: "classes", text: text.replace(/^.*?\b(are|taking)\b[:,]?\s*/i, "") };
  if (/^((set ?up|add|edit|change|update) (my |your )?classes|(what are )?my classes)$/.test(t)) return { do: "classes" };
  if (/^((hold|grab|keep) (this|that|it|onto (this|that|it))|put (this|that|it) in your pocket)$/.test(t)) return { do: "hold" };
  const drop = t.match(/^(?:drop|paste|put) (?:it|that|what you'?re holding|what you have)(?: (?:in|into|on) (.+))?$/);
  if (drop && (drop[1] || /holding|have|^drop/.test(t))) return { do: "drop", target: drop[1] };
  if (/^(save|add|put) (that|this|it) (to|in|into) (your |my )?notes?$/.test(t) && s.hasLastAnswer) return { do: "save_notes" };

  // "open sheets" / "open the sheet" / "open up notes" = Milo's apps. "Google Sheets", "Apple Notes", "Microsoft Excel" = the products.
  const ko = t.match(/^(?:open|show|pull up|bring up|go to)\s+(?:up\s+)?(?:your\s+|the\s+|my\s+)?(notes|study deck|study|sketch ?pad|sketch|sheets?|spread ?sheets?|excel( sheet)?|planner|pocket)(?: app)?$/);
  if (ko) return { do: "open_kit", app: KIT_WORDS[ko[1].replace(/\s+/g, " ")] ?? KIT_WORDS[ko[1].replace(/\s+/g, "")] ?? "sheet" };

  // "Close that Chrome tab. I meant your sheets…": close the tab, then the rest.
  const cc = text.match(/^close (?:that|the|this) (?:chrome|google|browser)(?: browser| tab| window| page)?[.,;!]+\s*(?:(?:no|sorry)[, ]+)?(.{6,})$/i);
  if (cc) return { do: "close_chrome_then", rest: cc[1] };

  if (milosThingOpen) {
    // "close that", "close the sheet and then open notes": Milo's own thing (it looks like a tab/window to people).
    const m = t.match(/^(?:close|exit|dismiss|hide|get rid of|shut)\b(.*?)(?:,? (?:and then|and|then) (.+))?$/);
    if (m && !/\b(chrome|google|browser|safari)\b/.test(m[1]) && OWN_THING.test(m[1] + " ")) return { do: "close_own", then: m[2] };
    if (/^(close( it| this| that| the box| that box)?|done|i'?m done|thanks|thank you|got it|never ?mind|that'?s all)$/.test(t)) return { do: "close_own" };
    if (/^(make it )?(full ?screen|bigger|big|expand( it)?|maximi[sz]e( it)?)$/.test(t)) return { do: "resize", size: "full" };
    if (/^(make it )?(half|split)( ?screen)?$/.test(t)) return { do: "resize", size: "half" };
    if (/^(make it )?(smaller|shrink( it)?|compact)$/.test(t)) return { do: "resize", size: "compact" };
    // Any other sentence that starts with "close…" while Milo's thing is open: let the brain decide. Never a shortcut.
    if (/^(close|exit|dismiss|hide|get rid of|shut)\b/.test(t)) return null;
  }

  if (!s.lessonOpen && SHORTCUT.test(t)) return { do: "shortcut" };
  return null;
}

// ---- "Start my homework" (the Game Plan) ---------------------------------------------------
const HW_NOUN = "homework|hw|assignment|problem set|pset|lab report|lab|essay|paper|worksheet|reading|project|discussion post|discussion|problems|quiz prep|study guide";
/** "start my stats homework" -> start (target "stats"); "help me start this" -> start here; "pick up my bio lab" -> resume. */
export function parseHomework(raw: string): { kind: "start" | "resume"; target: string; here: boolean } | null {
  const t = plainOf(raw).replace(/[,]/g, "");
  const resume = t.match(new RegExp(`^(?:let'?s )?(?:pick up|resume|continue|get back to|go back to|back to)(?: (?:with|on))? (?:my |the )?(.{0,40}?) ?(?:${HW_NOUN}|game plan|plan)$|^where (?:was i|did i leave off|were we)\\b.*$`));
  if (resume) return { kind: "resume", target: (resume[1] ?? "").trim(), here: false };
  if (/^(?:help me |let'?s |can we )?(?:start|begin|get started on|get going on|tackle|plan|make a (?:game )?plan for|break down|break up) (?:this|it|this one|this assignment|this homework|this page)$/.test(t)) return { kind: "start", target: "", here: true };
  if (/^(?:help me )?(?:get started|break (?:this|it) (?:down|up)(?: for me)?)$/.test(t)) return { kind: "start", target: "", here: true };
  const m = t.match(new RegExp(`^(?:okay |ok )?(?:let'?s |help me |i (?:need|want|have) to |time to |i gotta |i got to )?(?:start|begin|get started on|get started with|get going on|work on|tackle|knock out|jump into|make a (?:game )?plan for|plan out|break down)(?: on| with)? (?:my |the |this |that |our )?(.{0,40}?) ?(?:${HW_NOUN})(?: (?:for|in) (.{1,30}))?$`));
  if (!m) return null;
  const target = `${m[1] ?? ""} ${m[2] ?? ""}`.replace(/\b(next|first|new|due|tonight|today)\b/g, "").replace(/\s+/g, " ").trim();
  return { kind: "start", target, here: /^this\b/.test(t.replace(/^.*?(start|begin|tackle|on|with) /, "")) && !target };
}
/** While a Game Plan is up: "next", "done", "what's next", "do this step with me", "step 3 with me", "skip", "close the plan". */
export function parsePlanVoice(raw: string, lessonOpen: boolean): { do: "done" | "next_info" | "with_me" | "skip" | "close" | "undo"; step?: number } | null {
  const t = plainOf(raw);
  const n = t.match(/\bstep (\d+|one|two|three|four|five|six|seven)\b/);
  const step = n ? ({ one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 } as Record<string, number>)[n[1]] ?? Number(n[1]) : undefined;
  if (/^(close|hide|minimi[sz]e|put away)( the| my)? (game )?plan$/.test(t)) return { do: "close" };
  if (/^(undo|uncheck|wait (that|i) (wasn'?t|didn'?t)( done| finish(ed)?)?|not done)( (that|it|step \w+))?$/.test(t)) return { do: "undo", step };
  if (/^(what'?s next|what now|what'?s the next step|what step am i on|where am i)$/.test(t)) return { do: "next_info" };
  if (/^(skip( it| this| that| this step| step \w+)?|i'?ll do (it|that|this) later)$/.test(t)) return { do: "skip", step };
  if (/(with me|walk me through|help me with|coach me through)/.test(t) && (step || /\b(this|that|the|next|it)\b/.test(t)) && /\b(step|this|that|it|next)\b/.test(t)) return { do: "with_me", step };
  // "next" / "done" belong to the notebook while a lesson is open: there only an explicit "step" or "check it off" counts
  const doneish = /^(done|next|finished|i'?m done|i'?m finished|i finished( (it|that|this|step \w+))?|i did (it|that)|got it done|check (it|that) off|mark (it|that|this) done|that'?s done|step \w+ (is )?done|done with (it|that|this|step \w+)|next step|on to the next( one)?)$/;
  if (doneish.test(t) && (!lessonOpen || /step|check|mark/.test(t))) return { do: "done", step };
  return null;
}

// ---- Deadline radar ---------------------------------------------------------------------
/** "what's due this week", "check D2L", "start the next one"; and while the radar card is up: "start it", "later". */
export function parseRadar(raw: string, cardOpen: boolean): { do: "list"; days: number } | { do: "scan" } | { do: "start_first" } | { do: "later" } | null {
  const t = plainOf(raw).replace(/[?]/g, "");
  if (/^(check|refresh|scan|update|recheck)( on)? (d2l|my deadlines|the radar|my radar|my due dates|for new (assignments|homework|stuff))$/.test(t)) return { do: "scan" };
  if (/^(let'?s )?start (the (next|first) one|what'?s due( first| next)?|the most urgent( one)?|my next assignment|whatever'?s due( first| next)?)$/.test(t)) return { do: "start_first" };
  if (cardOpen) {
    if (/^(yes|yeah|yep|sure|ok(ay)?,? (let'?s )?(do it|start( it)?)|let'?s (do it|go|start( it)?)|start( it| that| that one| this one| the first one)?|do it|open it)$/.test(t)) return { do: "start_first" };
    if (/^(later|not now|remind me later|maybe later|no( thanks| thank you)?|nah|dismiss|close( it| that| this)?|got it|okay|ok|thanks|thank you|cool)$/.test(t)) return { do: "later" };
  }
  const list =
    /^(what'?s|what is|what all is|what do i have) (due|coming up|on my plate)\b/.test(t) ||
    /^what do i have to do\b/.test(t) ||
    /^(is there |do i have |is |have i got )?anything (due|coming up)\b/.test(t) ||
    /^(do i have|have i got) (any )?(homework|assignments|anything) due\b/.test(t) ||
    /^(show|open)( me)? (my )?(deadlines|deadline radar|radar|due dates|upcoming (assignments|homework))$/.test(t) ||
    /^(when'?s|when is) (everything|my stuff) due$/.test(t);
  if (!list) return null;
  const days = /\btoday|tonight\b/.test(t) ? 0 : /\btomorrow\b/.test(t) ? 1 : /\bnext week\b/.test(t) ? 14 : /\b(this week|week)\b/.test(t) ? 7 : Infinity;
  return { do: "list", days };
}

// ---------- grade forecaster + exam-proof mode ----------
const letterize = (t: string) => t.replace(/\b([abcd])\s+plus\b/gi, "$1+").replace(/\b([abcd])\s+minus\b/gi, "$1-");
/** "what do I need on the final for a B in stats" -> { exam: "final", letter: "B", course: "stats" } */
export function parseForecast(text: string): { exam: string; letter: string; course: string } | null {
  const t = letterize(text.trim().replace(/[?.!]+$/, "").replace(/^(hey )?milo,?\s*/i, ""));
  const m = t.match(
    /^what(?:'s| is)?\s+(?:do|would|will|should)?\s*i\s+(?:need|have)\s+(?:to\s+(?:get|score|make)\s+)?(?:on|in)\s+(?:the\s+|my\s+)?(final(?:\s+exam)?|midterm|exam|test)(?:\s+in\s+(?:my\s+)?(.+?))?\s+(?:to\s+(?:get|end\s+(?:up\s+)?with|keep|pass\s+with)|for)\s+(?:an?\s+)?([abcd][+-]?)(?:\s+in\s+(?:my\s+)?(.+?))?(?:\s+class)?$/i
  );
  if (!m) return null;
  return { exam: m[1].toLowerCase().replace(/\s+exam$/, ""), letter: m[3].toUpperCase(), course: (m[4] || m[2] || "").replace(/\s+class$/i, "").trim() };
}
/** "the final is worth 25 percent in stats" */
export function parseFinalWeight(text: string): { exam: string; weight: number; course: string } | null {
  const t = text.trim().replace(/[?.!]+$/, "");
  const m = t.match(/^(?:the |my )?(final|midterm)(?: exam)?(?: in (?:my )?(.+?))? (?:is|'s) (?:worth )?(\d+(?:\.\d+)?)\s*(?:%|percent)(?: (?:of|in) (?:my |the )?(.+?))?(?: grade)?$/i);
  if (!m) return null;
  const course = (m[4] || m[2] || "").replace(/^(the )?(grade|final grade|overall grade)$/i, "").trim();
  return { exam: m[1].toLowerCase(), weight: +m[3], course };
}
/** "make me a practice midterm for stats" -> { kind: "midterm", course: "stats" } */
export function parseExam(text: string): { kind: string; course: string } | null {
  const t = text.trim().replace(/[?.!]+$/, "").replace(/^(hey )?milo,?\s*/i, "");
  const m = t.match(/^(?:can you\s+)?(?:make|give|build|create|write|quiz)(?: me)? (?:a |an )?(?:practice|mock|sample|fake|real looking) (exam|test|midterm|final)(?: exam)?(?: (?:for|in|on|from) (?:my )?(.+?))?(?: class)?$/i);
  if (!m) return null;
  return { kind: m[1].toLowerCase(), course: (m[2] || "").trim() };
}

// ---------- Milo's gradebook (when D2L doesn't post grades) ----------
const LETTER_PCT: Record<string, number> = { "A+": 98, A: 95, "A-": 91, "B+": 88, B: 85, "B-": 81, "C+": 78, C: 75, "C-": 71, "D+": 68, D: 65, "D-": 61, F: 50 };
/** "I got an 85 on the midterm in stats", "I got 18 out of 20 on quiz 3 in econ", "I got a B plus on my essay in English" */
export function parseScore(text: string): { name: string; earned: number; possible: number; course: string } | null {
  const t = letterize(text.trim().replace(/[.!]+$/, "").replace(/^(hey )?milo,?\s*/i, ""));
  const m = t.match(/^(?:i\s+)?(?:just\s+)?(?:got|scored|made|earned|received)\s+(?:an?\s+)?(\d+(?:\.\d+)?|[abcdf][+-]?)(?:\s*(?:%|percent))?(?:\s*(?:\/|out of)\s*(\d+(?:\.\d+)?))?\s+on\s+(?:the\s+|my\s+|a\s+|an\s+)?(.+?)(?:\s+(?:in|for)\s+(?:my\s+)?(.+?))?(?:\s+class)?$/i);
  if (!m) return null;
  const raw = m[1].toUpperCase();
  const letter = /^[ABCDF][+-]?$/.test(raw);
  const earned = letter ? LETTER_PCT[raw] : +m[1];
  const possible = letter ? 100 : m[2] ? +m[2] : 100;
  if (!isFinite(earned) || !possible || earned > possible * 1.5) return null;
  return { name: m[3].trim(), earned, possible, course: (m[4] || "").trim() };
}
/** "read my syllabus", "read my stats syllabus", "this is my syllabus for econ" */
export function parseSyllabus(text: string): { course: string } | null {
  const t = text.trim().replace(/[.!?]+$/, "").replace(/^(hey )?milo,?\s*/i, "");
  const m = t.match(/^(?:(?:read|scan|check|look at|save|learn|grab)\s+(?:my\s+|the\s+|this\s+)?|this is (?:my\s+|the\s+))(?:(.+?)\s+)?syllabus(?:\s+(?:for|in)\s+(?:my\s+)?(.+?))?(?:\s+class)?$/i);
  if (!m) return null;
  return { course: (m[2] || m[1] || "").trim() };
}
/** "what's my grade in stats" */
export function parseGradeNow(text: string): { course: string } | null {
  const t = text.trim().replace(/[.!?]+$/, "").replace(/^(hey )?milo,?\s*/i, "");
  const m = t.match(/^(?:what(?:'s| is)|how(?:'s| is))\s+my\s+(?:current\s+|overall\s+)?grade\s+(?:in|for)\s+(?:my\s+)?(.+?)(?:\s+class)?(?:\s+right now)?$/i);
  return m ? { course: m[1].trim() } : null;
}
