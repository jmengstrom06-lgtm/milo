// Pure (unit-tested): line Milo's class list up with the student's real D2L courses.
// Matched classes keep their id and color (so everything filed under them stays put) and take D2L's name.
// Classes the student added that aren't in D2L are kept. Lab sections fold into their class.

import type { Klass, Subject } from "./classes";

const CODE_SUBJECT: [RegExp, Subject][] = [
  [/^(STAT|STA|BIOS)$/, "stats"],
  [/^(MATH|MTH|CALC)$/, "math"],
  [/^(GEOL|BIOL|BIO|CHEM|PHYS|ASTR|ENSC|ENVS|NTDT|KINE|NEUR|PSYC)$/, "science"],
  [/^(ENGL|ENG|WRIT|COMM|JOUR)$/, "english"],
  [/^(HIST|POSC|PSCI|GOVT|RELI|PHIL|CRJU|CRJ|SOCI|ANTH|GEOG)$/, "history"],
  [/^(SPAN|FREN|GERM|ITAL|CHIN|JAPN|LATN|ARAB|PORT|LANG)$/, "language"],
  [/^(COSC|CS|CSCI|COMP|INFO)$/, "cs"],
  [/^(MANA|MGMT|ACCT|FINA|ECON|MARK|BUSI|SCMS|ENTR|BUS)$/, "business"],
  [/^(ARTH|ART|MUSI|MUS|THEA|FTDM|DANC|DSGN)$/, "arts"],
];
export function subjectOf(code: string, name: string, words: Record<Subject, RegExp>): Subject {
  for (const [re, s] of CODE_SUBJECT) if (re.test(code)) return s;
  for (const s of Object.keys(words) as Subject[]) if (s !== "other" && words[s].test(name)) return s;
  return "other";
}

export type D2lCourse = { name: string; short: string; code: string; subject: string };
const stems = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !["intro", "introduction", "principles", "understanding", "foundations", "topics", "and", "with"].includes(w))
    .map((w) => w.slice(0, 5));
const COMPATIBLE: Partial<Record<Subject, Subject[]>> = { math: ["stats"], stats: ["math"] };

/** One-to-one match of Milo's classes to D2L courses, then the merged list (D2L first, max 8). */
export function mergeD2l(
  existing: Klass[],
  courses: D2lCourse[],
  words: Record<Subject, RegExp>,
  colors: string[],
  newId: (i: number) => string
): { classes: Klass[]; added: string[]; renamed: { from: string; to: string }[] } {
  const real = courses.filter((c) => !/ Lab$/.test(c.short) && !/tutorial|orientation|training/i.test(c.name));
  const pairs: { e: number; c: number; score: number }[] = [];
  real.forEach((c, ci) => {
    const subj = subjectOf(c.subject, c.short, words);
    const cs = stems(c.short);
    existing.forEach((e, ei) => {
      let score = 0;
      const es = stems(e.name);
      score += es.filter((w) => cs.includes(w)).length * 10;
      if (e.subject === subj && subj !== "other") score += 6;
      else if (COMPATIBLE[e.subject]?.includes(subj)) score += 3;
      if (e.code && c.code.toUpperCase().includes(e.code.replace(/\s+/g, "").toUpperCase())) score += 20;
      if (score >= 3) pairs.push({ e: ei, c: ci, score });
    });
  });
  pairs.sort((a, b) => b.score - a.score);
  const usedE = new Set<number>();
  const usedC = new Set<number>();
  const match = new Map<number, number>(); // course -> existing
  for (const p of pairs) if (!usedE.has(p.e) && !usedC.has(p.c)) (usedE.add(p.e), usedC.add(p.c), match.set(p.c, p.e));

  const added: string[] = [];
  const renamed: { from: string; to: string }[] = [];
  const out: Klass[] = real.map((c, ci) => {
    const code = (c.code.match(/([A-Z]{3,5})\s*(\d{4,5})/) ?? []).slice(1).join(" ");
    const subj = subjectOf(c.subject, c.short, words);
    const ei = match.get(ci);
    if (ei !== undefined) {
      const e = existing[ei];
      if (e.name !== c.short) renamed.push({ from: e.name, to: c.short });
      return { ...e, name: c.short, code: code || e.code, subject: subj === "other" ? e.subject : subj };
    }
    added.push(c.short);
    return { id: newId(ci), name: c.short, code, subject: subj, color: colors[(existing.length + added.length - 1) % colors.length] };
  });
  // the student's own extra classes stay, after the D2L ones
  existing.forEach((e, ei) => !usedE.has(ei) && out.push(e));
  return { classes: out.slice(0, 8), added, renamed };
}
