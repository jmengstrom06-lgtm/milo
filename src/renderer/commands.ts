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

// Things that mean "use the computer": open apps, click, type into something.
const TASK =
  /\b(type|typing|click|press|open( up)?|launch|paste|search|google|fill (in|out)|enter (my|the|this|it|in)|go (in|on)to|navigate|scroll|select all)\b|\b(write|put|add) .*\b(in|into|on|inside) (my|the|a|this)\b|\b(in|into|on) (my|the) (google doc|doc|document|notes|word|chrome|safari|browser|email|gmail|claude|chatgpt|search bar|spreadsheet|sheet)\b|\b(go to|pull up|bring up|switch to|take me to|new tab|new window|close (this |the )?tab|next tab|previous tab|go back|go forward|refresh|reload|look up|make a new|create a new|new google|play)\b/;

export function parse(raw: string, ctx: { inLesson: boolean; awaitingAnswer: boolean; pendingAsk?: boolean }): Intent {
  const text = raw.trim().replace(/[.!?]+$/, "");
  const t = text.toLowerCase();
  if (!t) return { kind: "chat", text };

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

  // Not in a lesson: computer actions first, then anything about the screen / homework starts a lesson.
  if (TASK.test(t)) return { kind: "task", task: text };
  const mode = modeFrom(t);
  if (mode || GOTO.test(t) || /\b(this|screen|homework|question|problem|help me|help with|look at|what'?s (this|on))\b/.test(t))
    return { kind: "look", mode: mode ?? "teach", request: text };

  return { kind: "chat", text };
}
