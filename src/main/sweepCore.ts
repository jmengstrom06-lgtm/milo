// The worksheet sweep, as pure steps (no screen, no UI): the Mac app and the worksheet test bench
// (evals/run-sweep.ts, real pages in a headless browser) run this exact same loop, so a fix proven on
// the bench is the fix the app ships.
//
// 1. Start at the top. Plan what's visible, fill it, scroll ~60% of a screen, repeat until the page stops moving.
//    A box too close to the bottom edge waits for the next scroll. Only what was really filled is skipped later.
// 2. Fill mode: back to the top and walk the whole page again looking for anything still blank. Fill it,
//    look once more: still blank = missed. Anything seen but never filled = missed.
// 3. Report only what's true.

export type SweepItemCore = {
  label: string;
  answer: string;
  kind: "type" | "choose" | "select" | "none";
  later?: boolean;
};
export type SweepResult = { label: string; answer: string; filled: boolean };
export type SweepDeps<T extends SweepItemCore> = {
  plan: (skip: string[]) => Promise<{ ok: true; items: T[]; more: boolean } | { ok: false; text: string }>;
  /** put one answer in (or just show it); true = it went in */
  fill: (item: T, items: T[]) => Promise<boolean>;
  /** scroll down a bit more than half a screen; false = the page didn't move (the end) */
  scroll: () => Promise<boolean>;
  top: () => Promise<void>;
  stopped: () => boolean;
  log?: (ev: string, data: Record<string, unknown>) => void;
  onPhase?: (phase: "reading" | "checking") => void;
};
export type SweepOutcome = { results: SweepResult[]; missed: string[]; empty?: boolean; error?: string; stopped?: boolean };

export async function sweepCore<T extends SweepItemCore>(d: SweepDeps<T>, opt: { fill: boolean; maxPages?: number }): Promise<SweepOutcome> {
  const max = opt.maxPages ?? 10;
  const results: SweepResult[] = [];
  const seen = new Set<string>();
  const record = (it: T, filled: boolean) => {
    const i = results.findIndex((r) => r.label === it.label);
    if (i >= 0) results[i] = { label: it.label, answer: it.answer, filled: filled || results[i].filled };
    else results.push({ label: it.label, answer: it.answer, filled });
  };
  const done = () => results.filter((r) => r.filled || !opt.fill).map((r) => r.label);

  d.onPhase?.("reading");
  await d.top();
  for (let page = 0; page < max; page++) {
    const plan = await d.plan(done());
    if (d.stopped()) return { results, missed: [], stopped: true };
    if (!plan.ok) return { results, missed: [], error: plan.text };
    if (!plan.items.length && page === 0) return { results, missed: [], empty: true };
    for (const it of plan.items) {
      seen.add(it.label);
      if (it.later) continue; // half hidden at the bottom: after the scroll
      if (d.stopped()) return { results, missed: [], stopped: true };
      record(it, await d.fill(it, plan.items));
    }
    d.log?.("sweep_page", { page, items: plan.items.map((i) => i.label), later: plan.items.filter((i) => i.later).map((i) => i.label) });
    if (!(await d.scroll())) break; // the page stopped moving: that was the end
  }

  const missed: string[] = [];
  if (opt.fill && !d.stopped()) {
    d.onPhase?.("checking");
    await d.top();
    for (let page = 0; page < max; page++) {
      const plan = await d.plan([]);
      if (d.stopped() || !plan.ok) break;
      const blanks = plan.items.filter((it) => !it.later && it.kind !== "none");
      d.log?.("sweep_verify", { page, blanks: blanks.map((b) => b.label) });
      for (const it of blanks) {
        seen.add(it.label);
        if (d.stopped()) break;
        record(it, await d.fill(it, plan.items));
      }
      if (blanks.length) {
        const again = await d.plan([]);
        if (again.ok) for (const it of again.items) if (!it.later && blanks.some((b) => b.label === it.label) && !missed.includes(it.label)) missed.push(it.label);
      }
      if (!(await d.scroll())) break;
    }
    // seen but never filled (or filled and still blank on the second look)
    for (const label of seen) if (!results.some((r) => r.label === label && r.filled) && !missed.includes(label)) missed.push(label);
    for (const m of missed) {
      const r = results.find((x) => x.label === m);
      if (r) r.filled = false;
      else results.push({ label: m, answer: "", filled: false });
    }
  }
  return { results, missed };
}

/** What Milo says at the end: only what's true. (pure) */
export function sweepSummary(o: SweepOutcome, fill: boolean): string {
  const n = o.results.length;
  const filled = o.results.filter((r) => r.filled).length;
  if (!fill) return `Done. ${n} answer${n === 1 ? "" : "s"} on screen for you to type in.`;
  if (!o.missed.length) return `Done. All ${filled} filled in. Give it a quick look before you submit.`;
  const list = o.missed.length === 1 ? `number ${o.missed[0]}` : `numbers ${o.missed.slice(0, -1).join(", ")} and ${o.missed.at(-1)}`;
  return `Filled ${filled} of ${n}. I couldn't get ${list} to stick. Can you fill ${o.missed.length === 1 ? "that one" : "those"} in? The answers are on the card.`;
}
