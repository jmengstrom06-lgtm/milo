import { describe, expect, it } from "vitest";
import { contextPrompt } from "../src/main/studentContext";
describe("what Home base knows, for the brain", () => {
  it("empty = nothing", () => expect(contextPrompt({ portal: "", classes: [] })).toBe(""));
  it("lists school and grades", () => {
    const p = contextPrompt({ portal: "tcu.brightspace.com", classes: [{ name: "Statistical Analysis", grade: 95.2 }, { name: "American Writers", grade: null }] });
    expect(p).toMatch(/never ask which school/);
    expect(p).toMatch(/Statistical Analysis 95.2%; American Writers\./);
  });
});
