// Demo mode: Home base runs on a believable, clearly labeled sample student, so testers without D2L
// (or anyone filming Milo) can see everything working. Nothing real is read or changed: only the
// reads Home base uses are swapped, and actions answer in demo text. Turn it on/off in Settings.
import { fixWeek, sampleWeek } from "./weekFix";

const KEY = "milo.demo";
export const demoOn = (): boolean => {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
};
export const setDemo = (on: boolean) => {
  try {
    if (on) localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  location.reload();
};

const P = <T,>(v: T) => Promise.resolve(v);

/** Wrap the real bridge: same shape, sample data for reads, harmless demo answers for actions. */
export function withDemo(real: Window["milo"]): Window["milo"] {
  const now = Date.now();
  const H = 3600e3;
  const D = 24 * H;
  const week = sampleWeek(now);
  const fix = fixWeek(week.items, week.events, now);
  const items = week.items.map((i) => ({
    title: i.title,
    course: i.course,
    due: new Date(i.dueAt).toLocaleDateString("en-US", { weekday: "short" }),
    due_iso: new Date(i.dueAt).toISOString(),
    kind: i.kind,
  }));
  const classes = [
    { id: "d1", name: "Intro to Statistics", code: "STAT 1100", subject: "math", color: "#8FA3E8" },
    { id: "d2", name: "American Writers", code: "ENGL 2080", subject: "english", color: "#D59AB8" },
    { id: "d3", name: "Cell Biology", code: "BIOL 2210", subject: "science", color: "#7CC7A8" },
  ];
  const acts: MiloActivity[] = [
    { id: "x1", at: now - 25 * 60e3, kind: "calendar", title: `Added ${fix.blocks.length} study blocks to your calendar`, detail: fix.say, canUndo: true, proof: { level: "confirmed", how: "Google Calendar saved each one and gave it an ID." } },
    { id: "x2", at: now - 2 * H, kind: "doc", title: "Took notes on a lecture: Enzyme kinetics (52 min)", detail: "18 flashcards, 3 things the professor flagged", canUndo: true, proof: { level: "confirmed", how: "Saved your notes and flashcards on this Mac." } },
    { id: "x3", at: now - 26 * H, kind: "job", title: "Did: Turn in Discussion post: Week 11", detail: "with your yes", canUndo: false, noUndo: "Sites don't let anyone take back a submission.", proof: { level: "checked", how: "I checked the finished result on screen before calling it done." } },
    { id: "x4", at: now - 27 * H, kind: "email_draft", title: "Wrote an email to your professor: Extension request (in your drafts)", canUndo: true, proof: { level: "confirmed", how: "Gmail saved the draft." } },
  ];
  const steps: ((s: { say: string; action: string }) => void)[] = [];
  const echo: ((e: { kind: string; payload: unknown }) => void)[] = [];
  const answer = (text: string) => {
    const t = text.toLowerCase();
    const plan = /what'?s next|week|plan|behind|on track/.test(t)
      ? { steps: ["Reading everything due this week", "Checking your calendar", "Finding pile-ups", "Placing study blocks"], say: `${fix.say} Want me to add them? (Demo: nothing is really added.)` }
      : /start|problem set|homework/.test(t)
        ? { steps: ["Found Problem Set 7 in Intro to Statistics", "Reading the assignment: 12 questions", "Matching it to your lecture notes", "Building your game plan"], say: "Here's your plan: 4 steps, about 90 minutes. Your notes already cover questions 1 to 8. Want to do question 1 together?" }
        : /quiz|practice|test/.test(t)
          ? { steps: ["Reading your lecture notes", "Writing questions like the real exam"], say: "6 questions ready from Enzyme kinetics. First one: what happens to the reaction rate once every enzyme is busy?" }
          : /grade|final|need/.test(t)
            ? { steps: ["Reading your grades"], say: "You're at 88.4% in Intro to Statistics. To finish with an A- you need about 81% on the final." }
            : { steps: ["Thinking"], say: "This is demo mode, so I'm showing what I'd do. Turn demo mode off in Settings and I'll do it for real." };
    plan.steps.forEach((s, i) => window.setTimeout(() => steps.forEach((c) => c({ say: s, action: "" })), 350 + i * 650));
    window.setTimeout(() => echo.forEach((c) => c({ kind: "said", payload: plan.say })), 350 + plan.steps.length * 650 + 250);
  };
  return {
    ...real,
    d2lDue: () => P({ ok: true as const, items }),
    d2lCheck: () => P({ ok: true, signin: false, text: "", via: "chrome", chrome: true }),
    kit: { ...real.kit, classes: () => P({ classes, active: null }), notes: () => P([{ id: "dn1", title: "Enzyme kinetics", course: "Cell Biology", body: "Enzyme kinetics\n\n⚠️ THE PROFESSOR FLAGGED (likely on the exam)\n• Know Vmax and Km cold\n• One question reads a Lineweaver-Burk plot\n", created: now - 2 * D, updated: now }]) },
    home: { ...real.home, grades: () => P([{ name: "Intro to Statistics", grade: 88.4 }, { name: "American Writers", grade: 92.1 }, { name: "Cell Biology", grade: 84.7 }]), onEcho: (cb: (e: { kind: string; payload: unknown }) => void) => (echo.push(cb), () => {}), route: (t: string) => answer(t), action: (a: { kind: string; item: { title: string } }) => answer(`${a.kind === "do" ? "Do" : "Start"} ${a.item.title}`) },
    activity: { ...real.activity, list: () => P(acts), undo: () => P({ ok: true, text: "Demo: nothing real to undo." }) },
    onTaskStep: (cb: (s: { say: string; action: string }) => void) => (steps.push(cb), () => {}),
    google: { ...real.google, status: () => P({ ready: true, connected: true, email: "sample.student@demo.edu" }) },
    memories: () => P(["Goes by Sam (sample student)", "Finds enzyme graphs hard in Bio", "Wants an A- in Statistics"]),
  } as unknown as Window["milo"];
}
