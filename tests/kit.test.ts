// Kit voice: filler never changes the meaning; the right Study mode every time.
import { describe, expect, it } from "vitest";
import { clean, studyModeFor } from "../src/renderer/kit/KitHost";

describe("clean", () => {
  it("strips spoken filler", () => {
    expect(clean("Uh, can you close that now?")).toBe("close that now");
    expect(clean("Okay, so, um, make it a box plot.")).toBe("make it a box plot");
    expect(clean("Cool, Milo, next")).toBe("next");
  });
});

describe("study modes", () => {
  it.each([
    ["teach me z-scores", "learn"],
    ["make a stats problem and solve it", "worked"],
    ["give me 5 practice problems", "practice"],
    ["flashcards for bio", "cards"],
    ["practice test on chapter 4", "test"],
  ])("%s -> %s", (t, mode) => expect(studyModeFor(t).mode).toBe(mode));
});
