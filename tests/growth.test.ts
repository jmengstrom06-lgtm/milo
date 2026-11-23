import { describe, expect, it } from "vitest";
import { levelOf, longestStreak, streakOf, syncLedger, totalXp, unlocked, XP } from "../src/renderer/home/growth";

describe("Milo growth", () => {
  it("counts real studying only, and never loses XP when plans are pruned", () => {
    const a = syncLedger({}, [{ key: "ps7", done: [0, 1, 2] }], ["2026-11-20", "2026-11-21"]);
    expect(totalXp(a)).toBe(3 * XP.step + 2 * XP.focusDay);
    const b = syncLedger(a, [], []); // the plan was pruned from storage
    expect(totalXp(b)).toBe(totalXp(a));
    const c = syncLedger(b, [{ key: "ps7", done: [0, 1, 2, 3] }], ["2026-11-21"]);
    expect(totalXp(c)).toBe(totalXp(a) + XP.step);
  });

  it("levels up at the thresholds", () => {
    expect(levelOf(0).level).toBe(1);
    expect(levelOf(49).level).toBe(1);
    expect(levelOf(50).level).toBe(2);
    expect(levelOf(340)).toMatchObject({ level: 4, toNext: 160 });
    expect(levelOf(99999).pct).toBe(1);
  });

  it("keeps the streak alive until the day is over", () => {
    const now = new Date("2026-11-22T15:00:00Z");
    expect(streakOf(["2026-11-20", "2026-11-21", "2026-11-22"], now)).toBe(3);
    expect(streakOf(["2026-11-20", "2026-11-21"], now)).toBe(2);
    expect(streakOf(["2026-11-19"], now)).toBe(0);
  });

  it("unlocks outfits by level", () => {
    expect(unlocked(1, "none")).toBe(true);
    expect(unlocked(1, "beanie")).toBe(false);
    expect(unlocked(3, "headphones")).toBe(true);
    expect(unlocked(4, "scarf")).toBe(false);
  });

  it("finds the longest streak anywhere in history", () => {
    expect(longestStreak([])).toBe(0);
    expect(longestStreak(["2026-11-01", "2026-11-02", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-07"])).toBe(3);
    expect(longestStreak(["2026-10-31", "2026-11-01"])).toBe(2);
  });
});
