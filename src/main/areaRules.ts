// Which part of the screen Milo should look at. Pure (tested): main.ts does the capturing.
// Order: a box the student dragged > the thing they named ("the stats one") > the window they're working in.

export type Rect = { x: number; y: number; width: number; height: number };

const SUBJECTS =
  "stats|statistics|algebra|calc|calculus|geometry|trig|trigonometry|precalc|math|bio|biology|chem|chemistry|physics|econ|economics|accounting|finance|english|essay|writing|history|spanish|french|psych|psychology|sociology|geology|geol|criminal justice|crju|management|marketing|coding|code|lab|reading|discussion|quiz|worksheet|assignment|homework|email|syllabus|notes";
const NAMED = new RegExp(
  `\\b(left|right|top|bottom|upper|lower|middle|other|first|second)\\b|\\bthe [a-z0-9' -]{2,30} (one|tab|window|page|doc|document|problem|question|side)\\b|\\b(${SUBJECTS})\\b`,
  "i"
);
/** Did the student name WHICH thing on screen ("the stats one", "the left one", "my English essay")? */
export function namesATarget(said: string): boolean {
  const t = said.toLowerCase().replace(/[^a-z0-9' -]+/g, " ");
  if (!t.trim() || /^(handle|help( me)?( with)?|check|look at|do|explain|teach me|quiz me( on)?) (this|that|it|my work|this one|my screen)?$/.test(t.trim())) return false;
  return NAMED.test(t);
}

/** A window that fills most of the screen tells Milo nothing new: look at everything then. */
export function worthFocusing(win: Rect, screen: Rect): boolean {
  if (win.width < 120 || win.height < 90) return false;
  const a = Math.max(0, Math.min(win.x + win.width, screen.x + screen.width) - Math.max(win.x, screen.x)) * Math.max(0, Math.min(win.y + win.height, screen.y + screen.height) - Math.max(win.y, screen.y));
  return a > 0 && a / (screen.width * screen.height) < 0.85;
}

/** Keep a box inside the image and at least a little padding around what they picked. */
export function clampRect(r: Rect, w: number, h: number, pad = 8): Rect {
  const x0 = Math.max(0, Math.round(r.x - pad));
  const y0 = Math.max(0, Math.round(r.y - pad));
  const x1 = Math.min(w, Math.round(r.x + r.width + pad));
  const y1 = Math.min(h, Math.round(r.y + r.height + pad));
  return { x: x0, y: y0, width: Math.max(1, x1 - x0), height: Math.max(1, y1 - y0) };
}

export type Located = { regions: { label: string; box: Rect }[]; pick: number };
/** The AI's answer to "which one did they mean?" → one box, a question, or nothing useful. (pure) */
export function decideTarget(l: Located | null): { kind: "one"; label: string; box: Rect } | { kind: "ask"; options: { label: string; box: Rect }[] } | { kind: "none" } {
  const regions = (l?.regions ?? []).filter((r) => r && r.label && r.box && r.box.width > 20 && r.box.height > 20).slice(0, 4);
  if (!regions.length) return { kind: "none" };
  const i = typeof l?.pick === "number" ? Math.round(l.pick) : -1;
  if (i >= 0 && i < regions.length) return { kind: "one", label: regions[i].label, box: regions[i].box };
  return regions.length >= 2 ? { kind: "ask", options: regions.slice(0, 3).map((r) => ({ label: r.label.slice(0, 28), box: r.box })) } : { kind: "none" };
}
