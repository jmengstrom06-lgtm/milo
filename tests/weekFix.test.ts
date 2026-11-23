import { describe, expect, it } from "vitest";
import { estimate, fixWeek, freeSlots, sampleWeek } from "../src/renderer/home/weekFix";

const MON = new Date(2026, 10, 23, 8, 0).getTime(); // Monday 8:00 AM
const H = 3600e3;

describe("estimate", () => {
  it("guesses from the title", () => {
    expect(estimate({ title: "Biology Midterm 2" })).toBe(180);
    expect(estimate({ title: "Discussion post" })).toBe(30);
    expect(estimate({ title: "Essay draft" })).toBe(150);
    expect(estimate({ title: "Thing", minutes: 45 })).toBe(45);
  });
});

describe("freeSlots", () => {
  it("skips busy time with a buffer and stays inside waking hours", () => {
    const s = freeSlots(MON, [{ title: "Class", start: MON + 2 * H, end: MON + 3 * H }], 1);
    expect(s[0]).toEqual({ start: MON + 1 * H, end: MON + 2 * H - 15 * 60e3 });
    expect(s[1].start).toBe(MON + 3 * H + 15 * 60e3);
    expect(s[s.length - 1].end).toBe(MON + 14 * H); // 10 PM
  });
});

describe("fixWeek on the sample week", () => {
  const { items, events } = sampleWeek(MON);
  const r = fixWeek(items, events, MON);
  it("finds the pile-up and the early deadline", () => {
    expect(r.problems.some((p) => p.kind === "crunch" && p.items.includes("s3"))).toBe(true);
    expect(r.problems.some((p) => p.kind === "early" && p.items.includes("s2"))).toBe(true);
  });
  it("never schedules on top of the calendar, past bedtime, or after the deadline", () => {
    for (const b of r.blocks) {
      for (const e of events) expect(b.end <= e.start || b.start >= e.end).toBe(true);
      expect(new Date(b.end).getHours() * 60 + new Date(b.end).getMinutes()).toBeLessThanOrEqual(22 * 60);
      const it = items.find((i) => i.id === b.itemId)!;
      expect(b.end).toBeLessThanOrEqual(it.dueAt);
    }
  });
  it("blocks don't overlap each other", () => {
    const s = [...r.blocks].sort((a, b) => a.start - b.start);
    for (let i = 1; i < s.length; i++) expect(s[i].start).toBeGreaterThanOrEqual(s[i - 1].end);
  });
  it("covers each item's estimated time", () => {
    for (const it of items) {
      const got = r.blocks.filter((b) => b.itemId === it.id).reduce((s, b) => s + (b.end - b.start), 0) / 60e3;
      expect(got).toBeGreaterThanOrEqual(estimate(it));
    }
    expect(r.say).toMatch(/study block/);
  });
  it("exam studying is spread over more than one day", () => {
    const days = new Set(r.blocks.filter((b) => b.itemId === "s3").map((b) => new Date(b.start).getDate()));
    expect(days.size).toBeGreaterThan(1);
  });
});

describe("fixWeek edge cases", () => {
  it("says you're clear when nothing is due", () => {
    expect(fixWeek([], [], MON).say).toMatch(/clear/);
  });
  it("flags when there isn't enough time", () => {
    const r = fixWeek([{ id: "x", title: "Final exam", course: "Bio", dueAt: MON + 14 * H }], [], MON);
    expect(r.problems.some((p) => p.kind === "tight")).toBe(true);
  });
});

import { toItems } from "../src/renderer/home/WeekPanel";
describe("D2L items → week items", () => {
  it("keeps only items with a real due date and marks exams", () => {
    const r = toItems([
      { title: "Midterm", course: "Bio", due: "Thu", due_iso: "2026-11-26T15:00:00Z", kind: "exam" },
      { title: "No date", course: "Bio", due: "?" },
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].kind).toBe("exam");
  });
});
