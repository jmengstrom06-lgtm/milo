import { describe, expect, it } from "vitest";
import { sweepCore, sweepSummary, type SweepItemCore } from "../src/main/sweepCore";

// A fake page: questions at y positions, a viewport that scrolls, fills that may fail.
function fakePage(qs: { label: string; y: number; kind?: SweepItemCore["kind"] }[], opt: { view?: number; step?: number; failOnce?: string[]; neverSticks?: string[]; blindTo?: string[] } = {}) {
  const view = opt.view ?? 800;
  const step = opt.step ?? Math.round(view * 0.6);
  const end = Math.max(...qs.map((q) => q.y)) + 100;
  let top = 0;
  const filled = new Set<string>();
  const tries = new Map<string, number>();
  const visible = () => qs.filter((q) => q.y >= top && q.y < top + view);
  return {
    filled,
    deps: {
      plan: async (skip: string[]) => ({
        ok: true as const,
        items: visible()
          .filter((q) => !filled.has(q.label) && !skip.includes(q.label) && !(opt.blindTo ?? []).includes(q.label))
          .map((q) => ({ label: q.label, answer: "x", kind: q.kind ?? ("type" as const), later: q.y > top + view - 70 })),
        more: top + view < end,
      }),
      fill: async (it: SweepItemCore) => {
        const n = (tries.get(it.label) ?? 0) + 1;
        tries.set(it.label, n);
        if ((opt.neverSticks ?? []).includes(it.label)) return true; // says ok, but nothing lands
        if ((opt.failOnce ?? []).includes(it.label) && n === 1) return true;
        filled.add(it.label);
        return true;
      },
      scroll: async () => {
        const next = Math.min(top + step, Math.max(0, end - view));
        const moved = next !== top;
        top = next;
        return moved;
      },
      top: async () => void (top = 0),
      stopped: () => false,
    },
  };
}
const sheet = (n: number, gap = 140) => Array.from({ length: n }, (_, i) => ({ label: String(i + 1), y: 100 + i * gap }));

describe("worksheet sweep core", () => {
  it("fills a long worksheet top to bottom, including boxes at the screen's bottom edge", async () => {
    const p = fakePage(sheet(20));
    const o = await sweepCore(p.deps, { fill: true });
    expect(p.filled.size).toBe(20);
    expect(o.missed).toEqual([]);
    expect(sweepSummary(o, true)).toMatch(/All 20 filled/);
  });

  it("Jake's case: a box that sat at the bottom edge still gets filled", async () => {
    const p = fakePage([{ label: "Name", y: 400 }, ...[1, 2, 3, 4].map((n) => ({ label: String(n), y: 430 + n * 136 })), ...[5, 6, 7, 8].map((n) => ({ label: String(n), y: 1050 + (n - 5) * 160 }))], { view: 1000 });
    const o = await sweepCore(p.deps, { fill: true });
    expect([...p.filled].sort()).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "Name"]);
    expect(o.missed).toEqual([]);
  });

  it("a fill that didn't take the first time is caught by the double-check", async () => {
    const p = fakePage(sheet(6), { failOnce: ["4"] });
    const o = await sweepCore(p.deps, { fill: true });
    expect(p.filled.has("4")).toBe(true);
    expect(o.missed).toEqual([]);
  });

  it("a box that never takes is reported by number, not counted as filled", async () => {
    const p = fakePage(sheet(6), { neverSticks: ["3"] });
    const o = await sweepCore(p.deps, { fill: true });
    expect(o.missed).toEqual(["3"]);
    expect(sweepSummary(o, true)).toMatch(/Filled 5 of 6.*number 3/);
  });

  it("show mode never types and doesn't double-check", async () => {
    const p = fakePage(sheet(5));
    const o = await sweepCore({ ...p.deps, fill: async () => false }, { fill: false });
    expect(o.results).toHaveLength(5);
    expect(sweepSummary(o, false)).toMatch(/5 answers on screen/);
  });

  it("an empty page says so", async () => {
    const p = fakePage([]);
    const o = await sweepCore({ ...p.deps, plan: async () => ({ ok: true as const, items: [], more: false }) }, { fill: true });
    expect(o.empty).toBe(true);
  });
});

describe("one question per page", () => {
  it("answers each page, presses Next, never past the last", async () => {
    const N = 5;
    let page = 0;
    const filled = new Set<number>();
    let nexts = 0;
    const o = await sweepCore(
      {
        plan: async () => ({
          ok: true as const,
          items: filled.has(page) ? [] : [{ label: String(page + 1), answer: "x", kind: "choose" as const }],
          more: false,
          next: page < N - 1 ? { x: 1, y: 1 } : undefined, // the last page shows Finish, not Next
        }),
        fill: async () => (filled.add(page), true),
        scroll: async () => false,
        top: async () => {},
        next: async () => {
          nexts++;
          page++;
        },
        stopped: () => false,
      },
      { fill: true }
    );
    expect(filled.size).toBe(N);
    expect(nexts).toBe(N - 1);
    expect(o.missed).toEqual([]);
  });
  it("nothing found is never 'all filled'", () => {
    expect(sweepSummary({ results: [], missed: [] }, true)).toMatch(/didn't find any/);
  });
});
