import { describe, expect, it } from "vitest";
import { backNudge, weekNudge } from "../src/renderer/nudges";
import { sampleWeek } from "../src/renderer/home/weekFix";

const NOON = new Date(2026, 10, 23, 12, 0).getTime();
const H = 3600e3;

describe("week nudge", () => {
  const { items } = sampleWeek(NOON);
  it("speaks up about a pile-up", () => expect(weekNudge(items, NOON, 0)?.text).toMatch(/Heads up: .*Thursday/));
  it("only once a day", () => expect(weekNudge(items, NOON, NOON - 2 * H)).toBeNull());
  it("not late at night", () => expect(weekNudge(items, NOON + 11 * H, 0)).toBeNull());
  it("quiet when the week is fine", () => expect(weekNudge([items[0]], NOON, 0)).toBeNull());
});

describe("welcome back", () => {
  it("says nothing after a short break", () => expect(backNudge(10 * 60e3, NOON, [{ at: NOON - 60e3, title: "x" }], [])).toBeNull());
  it("recaps a class-length absence", () => {
    const n = backNudge(75 * 60e3, NOON, [{ at: NOON - 5 * 60e3, title: "Took notes on a lecture: Enzymes (52 min)" }], [{ title: "Lab 9", course: "Bio", dueAt: NOON + 5 * H, firstSeen: NOON - 30 * H }])!;
    expect(n.text).toMatch(/^While you were in class: I took your notes: Enzymes/);
    expect(n.text).toMatch(/Lab 9 is due in 5 hours/);
    expect(n.actions).toEqual(["did", "start", "dismiss"]);
  });
  it("mentions new posts and ignores undone actions", () => {
    const n = backNudge(6 * H, NOON, [{ at: NOON - H, title: "Added x", undone: NOON }], [{ title: "Quiz 5", course: "Stats", dueAt: NOON + 4 * 24 * H, firstSeen: NOON - H }])!;
    expect(n.text).toBe("While you were away: 1 new thing got posted (Stats).");
  });
  it("nothing to say = no nudge", () => expect(backNudge(3 * H, NOON, [], [])).toBeNull());
});
