// Exam night: tonight's plan worked back from the exam time, and the professor's exam hints pulled
// out of lecture notes. Pure, so it's tested.

export type TonightBlock = { at: number; minutes: number; label: string; detail: string; kind: "learn" | "test" | "review" | "cards" };

/** Sleep 8 hours before the exam (never later than 1:30 AM), rounded down to the half hour. */
export function sleepBy(examAt: number): number {
  const d = new Date(examAt - 8 * 3600e3);
  const cap = new Date(examAt);
  cap.setHours(1, 30, 0, 0);
  if (cap.getTime() > examAt) cap.setDate(cap.getDate() - 1);
  const t = Math.min(d.getTime(), cap.getTime());
  const r = new Date(t);
  r.setMinutes(r.getMinutes() < 30 ? 0 : 30, 0, 0);
  return r.getTime();
}

/** Split the time between now and bedtime into learn / test / review / flashcards. */
export function planTonight(now: number, examAt: number, weakTopic?: string): { blocks: TonightBlock[]; sleep: number; minutes: number } {
  const sleep = sleepBy(examAt);
  const total = Math.floor((sleep - now) / 60e3);
  if (total < 20) return { blocks: [{ at: now, minutes: Math.max(10, total), label: "Flashcards, then sleep", detail: "Sleep beats cramming now", kind: "cards" }], sleep, minutes: Math.max(10, total) };
  const use = Math.min(total, 4 * 60); // past 4 hours it stops helping
  const parts: [number, string, string, TonightBlock["kind"]][] =
    use < 75
      ? [
          [0.6, "Practice test", "Timed, like the real thing", "test"],
          [0.4, "Review what you missed", "Only the ones you got wrong", "review"],
        ]
      : [
          [0.35, weakTopic ? `Learn ${weakTopic}` : "Lesson on your weakest topic", "With practice problems", "learn"],
          [0.3, "Practice test", "Timed, like the real thing", "test"],
          [0.2, "Review what you missed", "Only the ones you got wrong", "review"],
          [0.15, "Flashcards, then sleep", "Light review, no new stuff", "cards"],
        ];
  let at = now;
  const blocks = parts.map(([share, label, detail, kind]) => {
    const minutes = Math.max(5, Math.round((use * share) / 5) * 5);
    const b = { at, minutes, label, detail, kind };
    at += minutes * 60e3;
    return b;
  });
  return { blocks, sleep, minutes: blocks.reduce((a, b) => a + b.minutes, 0) };
}

/** "⚠️ THE PROFESSOR FLAGGED" lines from a lecture note's text. */
export function examFlags(body: string): string[] {
  const lines = body.split("\n");
  const i = lines.findIndex((l) => /THE PROFESSOR FLAGGED/i.test(l));
  if (i < 0) return [];
  const out: string[] = [];
  for (const l of lines.slice(i + 1)) {
    const m = l.match(/^\s*[•\-*]\s+(.*\S)/);
    if (m) out.push(m[1]);
    else if (l.trim() && out.length) break;
  }
  return out;
}
