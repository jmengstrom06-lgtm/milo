import { describe, expect, it } from "vitest";
import { makeMetrics, type MetricsState } from "../src/main/metrics";

function mk(start = Date.UTC(2026, 10, 23, 15)) {
  let saved: MetricsState | null = null;
  let t = start;
  const events: [string, Record<string, unknown> | undefined][] = [];
  const m = makeMetrics({ load: () => saved, save: (s) => (saved = s) }, (e, p) => events.push([e, p]), () => t);
  return { m, events, tick: (ms: number) => (t += ms) };
}

describe("metrics", () => {
  it("counts each day once, with day numbers for retention", () => {
    const { m, events, tick } = mk();
    expect(m.active()).toBe(true);
    expect(m.active()).toBe(false);
    tick(8 * 86400e3);
    m.active();
    const days = events.filter((e) => e[0] === "active_day").map((e) => e[1]);
    expect(days).toEqual([
      { day_n: 0, week_n: 0, days_used: 1 },
      { day_n: 8, week_n: 1, days_used: 2 },
    ]);
  });
  it("first value fires once, with time since install", () => {
    const { m, events, tick } = mk();
    tick(95e3);
    expect(m.value("calendar")).toBe(true);
    expect(m.value("doc")).toBe(false);
    expect(events.filter((e) => e[0] === "first_value")).toEqual([["first_value", { kind: "calendar", seconds: 95 }]]);
  });
});
