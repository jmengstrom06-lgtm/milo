import { describe, expect, it } from "vitest";
import { clampRect, decideTarget, namesATarget, worthFocusing } from "../src/main/areaRules";

describe("which part of the screen", () => {
  it("knows when the student named a thing", () => {
    for (const s of ["help with the stats one", "check my English essay", "do the left one", "the algebra tab", "explain the problem on the right", "quiz me on the bio notes"]) expect(namesATarget(s)).toBe(true);
    for (const s of ["handle this", "check my work", "help me with this", "look at my screen", ""]) expect(namesATarget(s)).toBe(false);
  });
  it("only focuses on a window smaller than the screen", () => {
    const scr = { x: 0, y: 0, width: 1700, height: 1000 };
    expect(worthFocusing({ x: 0, y: 0, width: 850, height: 1000 }, scr)).toBe(true);
    expect(worthFocusing({ x: 0, y: 0, width: 1700, height: 980 }, scr)).toBe(false);
    expect(worthFocusing({ x: 10, y: 10, width: 50, height: 50 }, scr)).toBe(false);
  });
  it("keeps boxes inside the picture", () => {
    expect(clampRect({ x: -20, y: 5, width: 100, height: 2000 }, 800, 600)).toEqual({ x: 0, y: 0, width: 88, height: 600 });
  });
  it("one clear match, a question, or nothing", () => {
    const L = { regions: [{ label: "Stats (left)", box: { x: 0, y: 0, width: 400, height: 500 } }, { label: "Algebra (right)", box: { x: 400, y: 0, width: 400, height: 500 } }], pick: 1 };
    expect(decideTarget(L)).toMatchObject({ kind: "one", label: "Algebra (right)" });
    expect(decideTarget({ ...L, pick: -1 })).toMatchObject({ kind: "ask", options: [{ label: "Stats (left)" }, { label: "Algebra (right)" }] });
    expect(decideTarget({ regions: [L.regions[0]], pick: -1 }).kind).toBe("none");
    expect(decideTarget(null).kind).toBe("none");
  });
});
