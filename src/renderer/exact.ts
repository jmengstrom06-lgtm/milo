// Exact handling for the things students ask most. Pure, and mirrors the order of the instant checks in
// App.tsx's command chain (nothing open, no lesson, no lock-in). tests/top30.test.ts pins ~100 real phrasings
// of the top 30 requests to the exact handler they must hit, so a new regex can't quietly steal one.
import { parse, type Intent } from "./commands";
import { fastDecide, parseExam, parseFinalWeight, parseForecast, parseGoogle, parseGoogleMulti, parseGradeNow, parseHomework, parseRadar, parseRemember, parseScore, parseSyllabus, type DecideState } from "./decide";
import { parseProfileFact } from "../main/profileFacts";
import { lectureCommand } from "../main/lectureNotes";
import { plan as quickPlan } from "../main/quick";

/** Start a lock-in focus session. */
export const LOCKIN_START =
  /^(let'?s |time to |i (need|want) to |help me )?(lock (me )?in|start (a |the )?(lock[- ]?in|focus (session|mode)|study session|pomodoro)|focus mode|pomodoro|help me focus|study session)\b/;

/** Commands that run right away without asking the AI router. Everything else, the router decides. */
const SURE = new Set(["hush", "yes", "no", "resume", "undo", "activity", "feedback", "paper", "week", "home", "handle", "d2lclass", "checkwork"]);
const LESSON_SURE = new Set(["close", "goto", "mode", "answer", "show", "copy", "practice", "skip", "repeat", "fill"]);
const WEB = /\b(chrome|safari|browser|website|web ?site|web ?page|https?:|[a-z0-9-]+\.(com|edu|org|net|gov|io))\b/i;

/** Is this keyword intent certain enough to skip the router? (pure) */
export function isSure(intent: Intent, text: string, inLesson: boolean): boolean {
  if (SURE.has(intent.kind)) return true;
  if (inLesson && LESSON_SURE.has(intent.kind)) return true;
  if (intent.kind === "sweep" && (!!intent.show || !!intent.fill)) return true; // "show me the answers" / "fill it in"
  if (intent.kind === "task" && WEB.test(text)) return true; // names a browser or website: a web task, not one of Milo's apps
  // "quiz me on chapter 5": a quiz. "quiz me on my notes" / "flashcards" belong to Milo's apps: the router picks which.
  if (intent.kind === "quiz" && !/\b(notes?|flash ?cards?|sheet|deck)\b/i.test(text)) return true;
  return false;
}

const DEFAULT_STATE: DecideState = { kitOpen: null, researchOpen: false, toolOpen: false, lessonOpen: false, hasLastAnswer: false };

/** Where a fresh request goes, by name ("radar", "grade", "google:event", "instant:handle", "router"…). (pure) */
export function whereGoes(raw: string): string {
  const text = raw.trim();
  const lower = text.toLowerCase().replace(/[.!?]+$/, "").trim();
  if (lectureCommand(text)?.do === "start") return "lecture";
  if (/^(undo what you (just )?did|take (that|it) back|cancel what you (just )?did|undo( that| it| this| the last (thing|one))?)$/.test(lower)) return "undo";
  if (/^(open|show|go to|pull up)( my| the)? (home|home ?base|dashboard)$/.test(lower)) return "home";
  if (LOCKIN_START.test(lower)) return "lockin";
  if (parseGoogleMulti(text)) return "google:multi";
  const g = parseGoogle(text);
  if (g) return `google:${g.do}`;
  if (parseForecast(text)) return "forecast";
  if (parseScore(text)) return "score";
  if (parseSyllabus(text)) return "syllabus";
  if (parseGradeNow(text)) return "grade";
  if (parseFinalWeight(text)) return "finalweight";
  if (parseExam(text)) return "exam";
  if (parseProfileFact(text)) return "profile";
  if (parseRemember(text)) return "remember";
  const rv = parseRadar(text, false);
  if (rv) return `radar:${rv.do}`;
  const hw = parseHomework(text);
  if (hw) return `homework:${hw.kind}`;
  if (/^(?:call me|my name is|my name's|i'?m called)\s+[a-z]/i.test(text)) return "name";
  const mine = fastDecide(text, DEFAULT_STATE);
  const qp = quickPlan(text);
  const own = /^(sketch|sheet|planner|study|pocket|notebook|research|chat|milo|lock ?in|plan|radar)$/i;
  if ((!mine || mine.do === "shortcut") && qp.steps.length && !qp.rest && qp.steps.every((s) => (s.kind === "quit" || s.kind === "app") && !own.test(s.app))) return "app";
  if (mine) return `fast:${mine.do}`;
  const intent = parse(text, { inLesson: false, awaitingAnswer: false, pendingAsk: false });
  return isSure(intent, text, false) ? `instant:${intent.kind}` : "router";
}

const ORD: Record<string, number> = { first: 0, "1": 0, one: 0, top: 0, second: 1, "2": 1, two: 1, middle: 1, third: 2, "3": 2, three: 2, last: -1 };
/** Picking one of Milo's buttons out loud: "the first one", "second", "quiz me", "the bio homework one". -1 = not a pick. (pure) */
export function pickSpoken(raw: string, options: { label: string; say: string }[]): number {
  const t = raw.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim().replace(/^(um|uh|okay|ok|yeah|let'?s do|let'?s go with|do|go with|i want|i'?ll take|the) /, "").replace(/^the /, "");
  if (!t || !options.length) return -1;
  const o = t.match(/^(first|second|third|last|top|middle|one|two|three|[123])( one| option| choice)?$/);
  if (o) {
    const i = ORD[o[1]];
    const idx = i === -1 ? options.length - 1 : i;
    return idx < options.length ? idx : -1;
  }
  if (t.split(" ").length > 8) return -1;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  const exact = options.findIndex((op) => norm(op.label) === t || norm(op.say) === t);
  if (exact >= 0) return exact;
  // "the quiz one" / "homework": a word that's in exactly one label
  const words = t.replace(/\b(one|option|choice|please|that)\b/g, " ").split(" ").filter((w) => w.length > 3);
  const hits = options.map((op, i) => ({ i, n: words.filter((w) => norm(op.label).split(" ").includes(w)).length })).filter((h) => h.n > 0);
  return hits.length === 1 ? hits[0].i : -1;
}
