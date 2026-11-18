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
  return raw.replace(/^(?:(?:hey|ok(?:ay)?|so|uh+|um+|cool|alright|all right|yeah|well|and|milo)\b[,.]?\s*)+/i, "").trim() || raw;
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
