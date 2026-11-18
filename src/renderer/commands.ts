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
  | { kind: "chat"; text: string };

const WAKE = /^\s*(?:(?:hey|hi|okay|ok|yo|so)\s*,?\s+)?(?:milo|mylo|my low|mila|miilo)\b[\s,.!?:-]*/i;

/** Does this line start with "Milo"? Returns the rest of the line. */
export function stripWake(text: string): { woke: boolean; rest: string } {
  const m = text.match(WAKE);
  return m ? { woke: true, rest: text.slice(m[0].length).trim() } : { woke: false, rest: text.trim() };
}

export function modeFrom(t: string): MiloMode | undefined {
  if (/(do it|for me|just (do|solve|answer|finish)|solve (it|this|that)|finish (it|this)|answer (it|this))/.test(t)) return "do";
  if (/(hint|nudge|i'?m stuck|little help)/.test(t)) return "help";
  if (/(teach|explain|walk me|show me how|how do (i|you)|step by step|break it down)/.test(t)) return "teach";
  return undefined;
}

const GOTO =
  /(\b(number|question|problem|part|exercise|#|q)\s*(\d+|[a-z]\b|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b)|(\b(this|that|the other|the next|the previous|the last|the first|the second|the third|the bottom|the top) (one|question|problem)\b)|(\bthe one (about|with|on|at|where|that)\b)|(\b(go|jump|move|switch|skip) to\b)|(\bnext (question|problem)\b)|(\bthis one\b|\bthat one\b|\bover here\b|\bright here\b)/;

export function parse(raw: string, ctx: { inLesson: boolean; awaitingAnswer: boolean }): Intent {
  const text = raw.trim().replace(/[.!?]+$/, "");
  const t = text.toLowerCase();
  if (!t) return { kind: "chat", text };

  if (/^(stop|shh+|quiet|be quiet|pause|hold on|wait)\b/.test(t) && t.split(/\s+/).length <= 3) return { kind: "hush" };

  if (ctx.inLesson) {
    if (/^(close|done|that'?s (all|it)|thanks|thank you|go away|bye|never ?mind|i'?m good|all good|got it)\b/.test(t))
      return { kind: "close" };

    if (GOTO.test(t)) return { kind: "goto", request: text, mode: modeFrom(t) };

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

  // Not in a lesson: anything about the screen / homework starts one.
  const mode = modeFrom(t);
  if (mode || GOTO.test(t) || /\b(this|screen|homework|question|problem|help me|help with|look at|what'?s (this|on))\b/.test(t))
    return { kind: "look", mode: mode ?? "teach", request: text };

  return { kind: "chat", text };
}
