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
  | { kind: "sweep" } // do every question on the page
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
  /^(look up|research|find out|search( the web| online)?( for)?|google|who('s| is| was| are| were)|what('s| is| was) the (weather|temperature|forecast|score|price|news|population|latest)|weather|forecast|news (on|about)|latest (news|on)|how (much|many|old|tall|far|long) (is|are|was|does|did)|when (is|was|did|does|are)|where (is|was|are)|is it going to (rain|snow)|what happened)\b/;
const NOT_RESEARCH = /\b(youtube|amazon|spotify|my (doc|email|gmail|screen|homework)|on (my|the) screen|number \d+|question \d+)\b/;

// Things that mean "use the computer": open apps, click, type into something.
const TASK =
  /\b(type|typing|click|press|open( up)?|launch|paste|search|google|fill (in|out)|enter (my|the|this|it|in)|go (in|on)to|navigate|scroll|select all)\b|\b(write|put|add) .*\b(in|into|on|inside) (my|the|a|this)\b|\b(in|into|on) (my|the) (google doc|doc|document|notes|word|chrome|safari|browser|email|gmail|claude|chatgpt|search bar|spreadsheet|sheet)\b|\b(go to|pull up|bring up|switch to|take me to|new tab|new window|close (this |the )?tab|next tab|previous tab|go back|go forward|refresh|reload|look up|make a new|create a new|new google|play)\b/;

const SWEEP =
  /\b(do|finish|complete|answer|solve|fill (out|in))\b.*\b(whole|entire|all|every|everything)\b.*\b(worksheet|assignment|homework|page|quiz|questions|problems|them|these|it)?|\b(do|finish|complete|fill out) (this|the|my) (worksheet|assignment|homework|problem set)\b|\bworksheet sweep\b/;

export function parse(raw: string, ctx: { inLesson: boolean; awaitingAnswer: boolean; pendingAsk?: boolean }): Intent {
  const text = raw.trim().replace(/[.!?]+$/, "");
  const t = text.toLowerCase();
  if (!t) return { kind: "chat", text };
  if (SWEEP.test(t)) return { kind: "sweep" };

  if (ctx.pendingAsk) {
    if (/^(yes|yeah|yep|yup|sure|go ahead|do it|ok|okay|send it|please do|go for it|confirm)\b/.test(t)) return { kind: "yes" };
    if (/^(no|nope|nah|don'?t|cancel|stop|never ?mind|wait)\b/.test(t)) return { kind: "no" };
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
  const out = text.replace(/[\s,.!-]*\b(okay |ok |alright )?(go|go ahead|go now|go for it|do it|do it now|complete( the)? task|execute|send( it)?|that'?s it|over|thanks)[.!?]*$/i, "").trim();
  return out || text.trim();
}

/** Just "go" / "do it" on its own, with nothing else. */
export const isBareGo = (text: string) => /^(okay |ok )?(go|go ahead|do it|start|begin|complete( the)? task)[.!?]*$/i.test(text.trim());

/** Does this sound like the student stopped mid-sentence? ("go", "open the", "go to chrome and") */
export function soundsUnfinished(text: string): boolean {
  const t = text.trim().toLowerCase().replace(/[.!?,]+$/, "");
  if (!t) return true;
  if (/^(stop|wait|thanks|thank you|yes|yeah|yep|no|nope|refresh|reload|go back|new tab|next tab|close (this )?tab|scroll (up|down)|never ?mind|hint|copy( it)?|skip|repeat)$/.test(t)) return false;
  if (/\d/.test(t) && t.split(/\s+/).length <= 4) return false; // spoken answers like "0.69"
  if (/\b(to|the|a|an|and|or|but|in|on|at|with|for|of|my|your|then|so|open|type|write|search|about|into|onto|from|like|um|uh|is|are|can you|could you|please|go|go to|and then|some)$/.test(t)) return true;
  return t.split(/\s+/).length === 1 && !/^(hi|hello|hey|help|chrome|notes|spotify)$/.test(t);
}
