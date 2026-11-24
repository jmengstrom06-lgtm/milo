import { WEEK_ASK } from "./home/weekFix";
// Turns what the student says into something Milo does. Fast, local, no AI call needed.

export type Intent =
  | { kind: "goto"; request: string; mode?: MiloMode } // "number 3", "this one", "the one about variance"
  | { kind: "mode"; mode: MiloMode } // "do it for me", "teach me", "hint"
  | { kind: "answer"; text: string } // "I got 0.69"
  | { kind: "show" }
  | { kind: "copy" }
  | { kind: "practice" }
  | { kind: "skip" }
  | { kind: "repeat" }
  | { kind: "close" }
  | { kind: "hush" }
  | { kind: "look"; mode: MiloMode; request: string } // start helping with something on screen
  | { kind: "task"; task: string } // do something on the computer: open, click, type…
  | { kind: "research"; question: string } // look something up live (research panel)
  | { kind: "sweep"; show?: boolean; fill?: boolean } // do every question on the page (show = just show me, fill = type them in)
  | { kind: "build"; request: string } // make a small working app
  | { kind: "watch"; on: boolean } // watch me work (spot mistakes as I go)
  | { kind: "checkwork" } // one-time look for mistakes
  | { kind: "quiz"; focus: string } // quiz me on what's on screen
  | { kind: "brief" } // what's due (reads D2L)
  | { kind: "resume" } // pick up where Milo was interrupted
  | { kind: "chain"; steps: Intent[] } // "open chrome, find a worksheet, and complete it": do in order
  | { kind: "activity" } // "what did you do?": open the timeline
  | { kind: "d2lclass"; course: string; page: string } // "open my stats class on D2L", "show my bio grades"
  | { kind: "handle" } // "handle this", "help with this": look at the screen and offer 2-3 things to do
  | { kind: "week" } // "what's next?", "fix my week": the week planner in Home base
  | { kind: "home" } // "open home", "show my home base": open the Home base window
  | { kind: "undo" } // "undo that": take back the newest thing
  | { kind: "feedback"; text: string } // "report a problem", "tell Jake that…"
  | { kind: "paper"; text: string } // "write a 5 page paper on…": written live into a Google Doc
  | { kind: "fill" } // type the lesson's answer into the blank
  | { kind: "yes" }
  | { kind: "no" }
  | { kind: "chat"; text: string };

const WAKE = /^\s*(?:(?:hey|hi|okay|ok|yo|so)\s*,?\s+)?(?:milo|mylo|my low|mila|miilo)\b[\s,.!?:-]*/i;

const WAKE_ANYWHERE = /\b(?:(?:hey|hi|okay|ok|yo)\s*,?\s+)?(?:milo|mylo|my low|mila|miilo)\b[\s,.!?:-]*/i;

/** Does this line start with "Milo"? Returns the rest of the line.
 *  anywhere=true (hands-free in a noisy room): find "Milo" anywhere and keep what comes after it. */
export function stripWake(text: string, anywhere = false): { woke: boolean; rest: string } {
  const m = text.match(WAKE);
  if (m) return { woke: true, rest: text.slice(m[0].length).trim() };
  if (anywhere) {
    const a = WAKE_ANYWHERE.exec(text);
    if (a) return { woke: true, rest: text.slice(a.index + a[0].length).trim() };
  }
  return { woke: false, rest: text.trim() };
}

export function modeFrom(t: string): MiloMode | undefined {
  if (/(do it|for me|just (do|solve|answer|finish)|\b(solve|complete|finish|answer|do) (it|this|that|the|my|all|number|question|problem)|work it out)/.test(t)) return "do";
  if (/(hint|nudge|i'?m stuck|little help)/.test(t)) return "help";
  if (/(teach|explain|walk me|show me how|how do (i|you)|step by step|break it down)/.test(t)) return "teach";
  return undefined;
}

const GOTO =
  /(\b(number|question|problem|part|exercise|#|q)\s*(\d+|[a-z]\b|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b)|(\b(this|that|the other|the next|the previous|the last|the first|the second|the third|the bottom|the top) (one|question|problem)\b)|(\bthe one (about|with|on|at|where|that)\b)|(\b(go|jump|move|switch|skip) to (number|question|problem|part|#|the next|the other|the last|the first)\b)|(\bnext (question|problem)\b)|(\bthis one\b|\bthat one\b|\bover here\b|\bright here\b)/;

// Things that mean "look it up": people, weather, news, prices, facts that change.
const RESEARCH =
  /^(look up|research|find out|tell me (more |some )?(about|info|information|more|the (news|story|details))|(find|get|give) me (some )?(info|information|details|the latest)|what about|how about|why (is|was|did|does)|who did|search( the web| online)?( for)?|google|who('s| is| was| are| were)|what('s| is| was) the (weather|temperature|forecast|score|price|news|population|latest)|weather|forecast|news (on|about)|latest (news|on)|how (much|many|old|tall|far|long) (is|are|was|does|did)|when (is|was|did|does|are)|where (is|was|are)|is it going to (rain|snow)|what happened)\b/;
const NOT_RESEARCH = /\b(youtube|amazon|spotify|my (doc|email|gmail|screen|homework)|on (my|the) screen|number \d+|question \d+)\b/;

// Things that mean "use the computer": open apps, click, type into something.
const TASK =
  /\b(type|typing|click|press|open( up)?|launch|paste|search|google|fill (in|out)|enter (my|the|this|it|in)|go (in|on)to|navigate|scroll|select all)\b|\b(write|put|add) .*\b(in|into|on|inside) (my|the|a|this)\b|\b(in|into|on) (my|the) (google doc|doc|document|notes|word|chrome|safari|browser|email|gmail|claude|chatgpt|search bar|spreadsheet|sheet)\b|\b(go to|pull up|bring up|switch to|take me to|new tab|new window|close (this |the )?tab|next tab|previous tab|go back|go forward|refresh|reload|look up|make a new|create a new|new google|play)\b/;

/** "open my statistical analysis class on d2l", "pull up my stats assignments", "show me my bio grades in d2l". (pure) */
export function parseD2lClass(t: string): { kind: "d2lclass"; course: string; page: string } | null {
  const m = t
    .replace(/^(?:milo,?\s*)?(?:can you |please )?/, "")
    .match(/^(?:open|go to|pull up|bring up|take me to|show me|show)\s+(?:my\s+|the\s+)?(.+?)\s+(class|course|grades|assignments|dropbox|quizzes|discussions?|announcements|content|calendar)(?:\s+page)?(?:\s+(?:on|in)\s+d2l)?[\s.!?]*$/);
  if (!m) return null;
  const course = m[1].replace(/\s+(class|course)$/, "").trim();
  if (!course || /^(chrome|google|safari|the|a|my)$/.test(course) || course.split(" ").length > 6) return null;
  const word = m[2];
  const page = word === "class" || word === "course" ? "home" : word === "dropbox" ? "assignments" : word === "discussion" ? "discussions" : word;
  // only when it's clearly about school: "on d2l", or a class word
  if (!/\b(on|in) d2l\b/.test(t) && !/\b(class|course|grades|assignments|quizzes|discussions?|announcements)\b/.test(word)) return null;
  return { kind: "d2lclass", course, page };
}

/** Vague "do something with this" asks: Milo looks and offers choices instead of guessing. */
export const HANDLE = /^(?:milo,?\s*)?(handle (this|that|it)|help( me)? (with )?(this|that)|what can you do (here|with (this|that))|do something with (this|that)|deal with (this|that)|take care of (this|that)|help me (here|out here)|what (do|should) i do (here|with (this|that)))[\s.!?]*$/;

/** Worksheet, but the student wants to type the answers themselves. */
export const SHOW_ONLY =
  /\b(show me (the|all the|each) answers?|tell me (the|all the) answers?|just show me|walk me through (this|the|my) (worksheet|assignment|homework|page|problems)|i'?ll type (them|it|the answers)( in)?|don'?t (fill|type) (it|them|anything)( in)?)\b/;
/** Worksheet, and type the answers in (overrides a show-only default). */
export const FILL_IN = /\b(fill (it|them|this|everything) in|type (them|it|the answers) in|put the answers in)\b/;

const SWEEP =
  /\b(do|finish|complete|answer|solve|fill (out|in))\b.*\b(whole|entire|all|every|everything)\b.*\b(worksheet|assignment|homework|page|quiz|questions|problems|them|these|it)?|\b(do|finish|complete|fill out) (this|the|my) (worksheet|assignment|homework|problem set)\b|\bworksheet sweep\b/;

const BUILD =
  /^(?:can you |could you |please )?(make|build|create|code|design|whip up|throw together) (me )?(a|an|my|some)?\s*.*\b(calculator|tool|app|tracker|timer|planner|converter|generator|flash ?cards?|game|dashboard|widget|checklist|budget|countdown|stopwatch|scheduler|organizer|randomizer|visualizer|simulator|grapher|graphing)\b/;

type Ctx = { inLesson: boolean; awaitingAnswer: boolean; pendingAsk?: boolean };

const SCREEN_KINDS = new Set(["sweep", "quiz", "look", "checkwork", "watch"]);
const COMPUTER =
  /\b(open|launch|find|search|google|go to|go on|pull up|bring up|navigate|download|look up|get me|browse|visit|chrome|safari|youtube|website|online|on the internet|tab)\b/;

/**
 * Multi-step commands: "open chrome and find a simple math worksheet and complete the whole thing".
 * Everything before the screen job (find/open stuff) becomes one computer task; the screen job runs after it.
 */
function splitChain(text: string, ctx: Ctx): Intent | null {
  if (ctx.inLesson || ctx.pendingAsk) return null;
  const clauses = text
    .split(/\s*,?\s*\b(?:and then|after that|then|and)\b\s*/i)
    .map((c) => c.trim())
    .filter(Boolean);
  if (clauses.length < 2) return null;
  let j = -1;
  for (let k = clauses.length - 1; k > 0; k--) {
    if (SCREEN_KINDS.has(parseSingle(clauses[k], ctx).kind)) {
      j = k;
      break;
    }
  }
  if (j < 1) return null;
  const before = clauses.slice(0, j).join(" and ");
  if (!COMPUTER.test(before.toLowerCase())) return null;
  const screenJob = parseSingle(clauses.slice(j).join(" and "), ctx);
  return {
    kind: "chain",
    steps: [{ kind: "task", task: `${before}. Stop as soon as it's open on screen; the next step happens after.` }, screenJob],
  };
}

export function parse(raw: string, ctx: Ctx): Intent {
  const text = raw.trim().replace(/[.!?]+$/, "");
  if (!text) return { kind: "chat", text };
  return splitChain(text, ctx) ?? parseSingle(text, ctx);
}

function parseSingle(raw: string, ctx: Ctx): Intent {
  const text = raw.trim().replace(/[.!?]+$/, "");
  const t = text.toLowerCase();
  if (!t) return { kind: "chat", text };
  if (/^(keep going|continue|go on|resume|carry on|where were we|pick up where you left off|finish what you were (doing|saying)|ok(ay)? continue)$/.test(t))
    return { kind: "resume" };
  // "write (me) a 5 page paper on…", "draft an essay about…", "help me write a research paper on…"
  if (/^(?:can you |could you |please |help me |i need (?:you )?to |i have to )?(?:write|draft|type up|start)\b(?! (?:an? |the |my )?(?:email|message|text|poem|song|story|code|program))[^.?!]{0,60}?\b(?:research paper|paper|essay|report)\b/.test(t) && !/\b(read|grade|check|proofread|edit|fix)\b.{0,20}\b(paper|essay)\b/.test(t))
    return { kind: "paper", text };
  {
    const fb = t.match(/^(send feedback|give feedback|report (a |this )?(bug|problem|issue)|tell jake|that'?s a bug|feedback)\b[\s:,-]*(that )?/);
    if (fb) return { kind: "feedback", text: text.slice(fb[0].length).trim() };
  }
  if (/^(undo( that| it| this| the last (thing|one))?|take (that|it) back|reverse that|cancel what you (just )?did)$/.test(t)) return { kind: "undo" };
  if (/^(?:(?:can you |please )?(?:open|show|pull up|bring up|go to)(?: me)? (?:my |the )?(?:home|home base|homebase|dashboard|milo app)|(?:take me )?home base)\b/.test(t)) return { kind: "home" };
  if (/^(what (did|have) you (do|done)|what('?d| did) you (just )?do|show me what you (did|done)|what milo did|what you did|your (activity|history)|what happened while i was (gone|away|out))\b/.test(t)) return { kind: "activity" };
  if (/^(stop watching|stop checking|you can stop watching|quit watching)\b/.test(t)) return { kind: "watch", on: false };
  if (/^(watch me|watch my (work|screen)|keep an eye on (me|my work|this)|watch me work|check my work as i go|watch while i work)\b/.test(t))
    return { kind: "watch", on: true };
  const dc = parseD2lClass(t);
  if (dc) return dc;
  if (WEEK_ASK.test(t)) return { kind: "week" };
  if (HANDLE.test(t)) return { kind: "handle" };
  if (/^(check (my|this) work|is (this|my work) right|did i (do this|get this) right|any mistakes)\b/.test(t)) return { kind: "checkwork" };
  if (/^(?:milo,?\s*)?(check (this|it)( (before|so) i (submit|turn (it|this) in))?|check (this|it|my work|my paper|my essay) against the rubric|preflight( this)?|does this meet the rubric)$/.test(t)) return { kind: "checkwork" };
  if (/^(what'?s due|what is due|what do i have (due|to do|today|tomorrow|this week)|daily brief|morning brief|my brief|brief me|what'?s on my plate|anything due)\b/.test(t)) return { kind: "brief" };
  if (/^(quiz me|test me|give me a (quiz|test|practice test)|make (me )?a (quiz|practice test)|study mode|quiz mode)\b/.test(t)) return { kind: "quiz", focus: text };
  if (!ctx.inLesson && SHOW_ONLY.test(t)) return { kind: "sweep", show: true };
  if (SWEEP.test(t)) return { kind: "sweep", ...(FILL_IN.test(t) ? { fill: true } : {}) };
  if (BUILD.test(t) && !/\b(google (doc|sheet|slide)s?|new (tab|window|doc|sheet)|folder|spreadsheet in|document)\b/.test(t)) return { kind: "build", request: text };

  if (ctx.pendingAsk) {
    // A bare yes/no answers his question. "No, close the whole thing" is a NEW command, not a "no".
    const short = t.replace(/[^a-z' ]+/g, " ").trim().split(/\s+/).length <= 4;
    if (short && /^(yes|yeah|yep|yup|sure|go ahead|do it|ok|okay|send it|please do|go for it|confirm)\b/.test(t)) return { kind: "yes" };
    if (short && /^(no|nope|nah|don'?t|cancel|stop|never ?mind|wait)\b/.test(t)) return { kind: "no" };
  }

  if (/^(stop|shh+|quiet|be quiet|pause|hold on|wait)\b/.test(t) && t.split(/\s+/).length <= 3) return { kind: "hush" };

  if (ctx.inLesson) {
    if (/^(close|done|that'?s (all|it)|thanks|thank you|go away|bye|never ?mind|i'?m good|all good|got it)\b/.test(t))
      return { kind: "close" };

    if (/(type it|type the answer|fill (it|that|the blank) in|fill in the (blank|answer)|fill it out|put (it|that|the answer) in|enter (it|that|the answer)|write it in)/.test(t))
      return { kind: "fill" };
    if (GOTO.test(t) && !/\b(type|click|open|launch)\b/.test(t)) return { kind: "goto", request: text, mode: modeFrom(t) };
    if (/^(look up|research|find out|google|search( the web| online)? for)\b/.test(t) && !NOT_RESEARCH.test(t)) return { kind: "research", question: text };
    if (TASK.test(t)) return { kind: "task", task: text };

    if (/(more like (this|that)|practice|another one like|more problems|quiz me|give me (some )?more)/.test(t)) return { kind: "practice" };
    if (/\bcopy\b/.test(t)) return { kind: "copy" };
    if (/((show|tell|give) me the answer|what'?s the answer|reveal|just the answer)/.test(t)) return { kind: "show" };
    if (/(repeat|say (that|it) again|come again|what did you say|one more time)/.test(t)) return { kind: "repeat" };
    if (/(^skip|next step|go faster|hurry|speed (it )?up|keep going)/.test(t)) return { kind: "skip" };

    const mode = modeFrom(t);
    if (mode) return { kind: "mode", mode };

    if (ctx.awaitingAnswer) {
      const m = t.match(/(?:the answer is|answer is|i got|i get|is it|it'?s|it is|i think it'?s|my answer is|equals|that'?s)\s+(.+)/);
      if (m) return { kind: "answer", text: m[1] };
      if (/\d/.test(t) && t.split(/\s+/).length <= 7) return { kind: "answer", text };
    }
    return { kind: "chat", text };
  }

  // Not in a lesson: live research, then computer actions, then anything about the screen / homework starts a lesson.
  if (RESEARCH.test(t) && !NOT_RESEARCH.test(t)) return { kind: "research", question: text };
  if (TASK.test(t)) return { kind: "task", task: text };
  const mode = modeFrom(t);
  if (mode || GOTO.test(t) || /\b(this|screen|homework|question|problem|help me|help with|look at|what'?s (this|on))\b/.test(t))
    return { kind: "look", mode: mode ?? "teach", request: text };

  return { kind: "chat", text };
}

/** Drop a trailing "go" / "do it" / "complete task" the student says to send the command. */
export function stripGo(text: string): string {
  // "class is over", "lecture's over", "game over": "over" is the meaning there, not the radio-style end word
  if (/\b(is|'s|are|was|game|all)\s+over[.!?]*$/i.test(text.trim())) return text.trim();
  const out = text.replace(/[\s,.!-]*\b(okay |ok |alright )?(go|go ahead|go now|go for it|do it|do it now|complete( the)? task|execute|send( it)?|that'?s it|over|thanks)[.!?]*$/i, "").trim();
  return out || text.trim();
}

/** Just "go" / "do it" on its own, with nothing else. */
export const isBareGo = (text: string) =>
  /^((okay|ok|yeah|yes|yep|alright|all right|sure|cool) )?(go|go ahead|go for it|do it|start|begin|run it|send it|lets go|let's go|you can go|complete( the)? task)( now| please)?$/i.test(
    text.toLowerCase().replace(/[^a-z' ]+/g, " ").replace(/\s+/g, " ").trim()
  );

/** Does this sound like the student stopped mid-sentence? ("go", "open the", "go to chrome and") */
export function soundsUnfinished(text: string): boolean {
  const t = text.trim().toLowerCase().replace(/[.!?,]+$/, "");
  if (!t) return true;
  if (/^(stop|wait|thanks|thank you|yes|yeah|yep|no|nope|refresh|reload|go back|new tab|next tab|close (this )?tab|scroll (up|down)|never ?mind|hint|copy( it)?|skip|repeat)$/.test(t)) return false;
  if (/\d/.test(t) && t.split(/\s+/).length <= 4) return false; // spoken answers like "0.69"
  if (/\b(to|the|a|an|and|or|but|in|on|at|with|for|of|my|your|then|so|open|type|write|search|about|into|onto|from|like|um|uh|is|are|can you|could you|please|go|go to|and then|some)$/.test(t)) return true;
  return t.split(/\s+/).length === 1 && !/^(hi|hello|hey|help|chrome|notes|spotify)$/.test(t);
}
