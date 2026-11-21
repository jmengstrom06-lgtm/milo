// Grade forecaster math: "what do I need on the final for a B?" Pure and exact (the AI only reads the
// grades page; the numbers are always worked out here). Shared by the main process and tests.

export type GradeCat = { name: string; weight: number | null; earned?: number | null; possible?: number | null; percent?: number | null };
export type GradeSheet = {
  course: string;
  categories: GradeCat[]; // weighted categories (Homework 20%, Exams 50%...), if the class uses them
  earned?: number | null; // points-based classes: total points so far
  possible?: number | null; //   ...out of
  final: { name: string; weight: number | null; possible: number | null } | null; // the final exam (or the exam asked about)
  current_percent?: number | null; // what the grades page says your grade is now
  scheme?: { letter: string; min: number }[]; // from the syllabus/grades page, if shown
  fetchedAt?: number;
};
export type Forecast = { needed: number; already: boolean; impossible: boolean; current: number | null; target: number; basis: "weights" | "points" | "current"; notes: string[] };

const PLUSMINUS: Record<string, number> = { "A+": 97, A: 93, "A-": 90, "B+": 87, B: 83, "B-": 80, "C+": 77, C: 73, "C-": 70, "D+": 67, D: 63, "D-": 60 };
const PLAIN: Record<string, number> = { A: 90, B: 80, C: 70, D: 60 };

/** The lowest percent that earns this letter (from the class's own scale if we have it). */
export function targetFor(letter: string, scheme?: GradeSheet["scheme"]): { target: number; note: string } {
  const L = letter.toUpperCase().replace(/\s+/g, "");
  const own = scheme?.find((s) => s.letter.toUpperCase().replace(/\s+/g, "") === L);
  if (own) return { target: own.min, note: `Your class counts ${L} as ${own.min}% or higher.` };
  const usesPM = scheme?.some((s) => /[+-]/.test(s.letter));
  if (/[+-]/.test(L) || usesPM) {
    const t = PLUSMINUS[L] ?? PLAIN[L[0]] ?? 90;
    return { target: t, note: `Counting ${L} as ${t}% or higher.` };
  }
  const t = PLAIN[L[0]] ?? 90;
  return { target: t, note: `Counting a ${L} as ${t}% or higher.` };
}

const pct = (c: GradeCat) => (c.percent != null ? c.percent : c.earned != null && c.possible ? (100 * c.earned) / c.possible : null);
const r1 = (n: number) => Math.round(n * 10) / 10;

/** The score needed on the final to end with `target` percent. */
export function forecast(sheet: GradeSheet, target: number): Forecast | null {
  const notes: string[] = [];
  const fin = sheet.final;
  const finName = (fin?.name ?? "final").toLowerCase();
  const cats = sheet.categories.filter((c) => c && c.name);
  const finCat = cats.find((c) => fin && c.name.toLowerCase() === finName) ?? null;
  const others = cats.filter((c) => c !== finCat);
  const finW = fin?.weight ?? finCat?.weight ?? null;

  // 1) weighted categories
  const weighted = others.filter((c) => c.weight != null && c.weight > 0);
  if (finW && weighted.length) {
    const graded = weighted.filter((c) => pct(c) != null);
    if (!graded.length) return null;
    const gw = graded.reduce((n, c) => n + c.weight!, 0);
    const avg = graded.reduce((n, c) => n + c.weight! * pct(c)!, 0) / gw;
    const ungraded = weighted.filter((c) => pct(c) == null);
    const uw = ungraded.reduce((n, c) => n + c.weight!, 0);
    if (ungraded.length) notes.push(`I assumed you'll keep your ${r1(avg)}% average on ${ungraded.map((c) => c.name).join(", ")}.`);
    const totalW = gw + uw + finW;
    if (Math.abs(totalW - 100) > 2) notes.push(`The weights add up to ${r1(totalW)}%, so I scaled them.`);
    const sure = graded.reduce((n, c) => n + c.weight! * pct(c)!, 0) + uw * avg; // weighted points without the final
    const needed = (target * totalW - sure) / finW;
    return { needed: r1(needed), already: needed <= 0, impossible: needed > 100, current: r1(avg), target, basis: "weights", notes };
  }

  // 2) points: earned / possible so far, plus the final's points
  if (sheet.earned != null && sheet.possible && fin?.possible) {
    const needed = ((target / 100) * (sheet.possible + fin.possible) - sheet.earned) / fin.possible * 100;
    notes.push(`Based on ${sheet.earned} of ${sheet.possible} points so far, with the ${fin.name} worth ${fin.possible} points.`);
    return { needed: r1(needed), already: needed <= 0, impossible: needed > 100, current: r1((100 * sheet.earned) / sheet.possible), target, basis: "points", notes };
  }

  // 3) only the current grade and the final's weight
  if (sheet.current_percent != null && finW) {
    const needed = (target - sheet.current_percent * (1 - finW / 100)) / (finW / 100);
    notes.push(`Using your current ${r1(sheet.current_percent)}% for everything except the ${fin?.name ?? "final"}.`);
    return { needed: r1(needed), already: needed <= 0, impossible: needed > 100, current: r1(sheet.current_percent), target, basis: "current", notes };
  }
  return null;
}

/** One spoken answer. ("an A", "on Exam 4" but "on the final") */
export function forecastLine(f: Forecast, letter: string, finalName = "final"): string {
  const an = /^[AEF]/i.test(letter) ? "an" : "a";
  const on = /\d/.test(finalName) || /^[A-Z]{2,}/.test(finalName) ? finalName : `the ${finalName}`;
  if (f.already) return `You've already locked in ${an} ${letter}, even with a zero on ${on}. Still, show up!`;
  if (f.impossible) return `${an === "an" ? "An" : "A"} ${letter} would take ${Math.ceil(f.needed)}% on ${on}, so it's out of reach. Want me to check the next grade down?`;
  return `You need about ${Math.ceil(f.needed)}% on ${on} to get ${an} ${letter}.`;
}
