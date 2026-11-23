import { describe, expect, it } from "vitest";
import { examFlags, planTonight, sleepBy } from "../src/renderer/home/examPlan";

const at = (s: string) => new Date(s).getTime();

describe("exam night", () => {
  it("puts you to bed 8 hours before a morning exam, never after 1:30", () => {
    expect(new Date(sleepBy(at("2026-12-04T09:00:00"))).getHours()).toBe(1);
    const late = new Date(sleepBy(at("2026-12-04T13:00:00")));
    expect([late.getHours(), late.getMinutes()]).toEqual([1, 30]);
  });

  it("plans learn, test, review, flashcards and ends by bedtime", () => {
    const now = at("2026-12-03T20:00:00");
    const p = planTonight(now, at("2026-12-04T09:00:00"), "sampling distributions");
    expect(p.blocks.map((b) => b.kind)).toEqual(["learn", "test", "review", "cards"]);
    expect(p.blocks[0].label).toContain("sampling distributions");
    expect(now + p.minutes * 60e3).toBeLessThanOrEqual(p.sleep + 10 * 60e3);
    expect(p.minutes).toBeLessThanOrEqual(240);
  });

  it("with little time left, just tests and reviews", () => {
    const p = planTonight(at("2026-12-04T00:15:00"), at("2026-12-04T09:00:00"));
    expect(p.blocks.map((b) => b.kind)).toEqual(["test", "review"]);
  });

  it("pulls the professor's exam hints out of lecture notes", () => {
    const body = "Z-scores\n\n⚠️ THE PROFESSOR FLAGGED (likely on the exam)\n• Know the z formula cold\n• One question works backward from a percentile\n\nKey terms\n- mean";
    expect(examFlags(body)).toEqual(["Know the z formula cold", "One question works backward from a percentile"]);
    expect(examFlags("no flags here")).toEqual([]);
  });
});
