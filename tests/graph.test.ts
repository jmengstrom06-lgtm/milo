import { describe, expect, it } from "vitest";
import { compile, normCdf } from "../src/renderer/kit/Graph";

describe("math parser", () => {
  it("expressions", () => {
    expect(compile("x^2-3")!(2)).toBe(1);
    expect(compile("2x+1")!(3)).toBe(7);
    expect(compile("sqrt(x)")!(9)).toBe(3);
    expect(compile("a*(x-h)^2+k", { a: 2, h: 1, k: 3 })!(2)).toBe(5);
  });
  it("rejects garbage safely", () => expect(compile("alert(1)")).toBeNull());
});
describe("normal areas", () => {
  it("P(Z<1.6)", () => expect(normCdf(1.6, 0, 1)).toBeCloseTo(0.9452, 3));
  it("P(X>78) for N(70,5)", () => expect(1 - normCdf(78, 70, 5)).toBeCloseTo(0.0548, 3));
});
