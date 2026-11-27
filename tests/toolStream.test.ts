import { describe, it, expect } from "vitest";
import { completedItems } from "../src/main/toolStream";

describe("reading actions while they're still being written", () => {
  const full = JSON.stringify({ understood: "x", answer: "", ops: [{ op: "insert", after: 2, paragraphs: [{ text: 'He said "hi" {and} [left]' }] }, { op: "replace_text", para: 3, find: "a}b", replace: "c]d" }, { op: "delete", para: 4 }], summary: "s" });
  it("each finished action as soon as its brace closes", () => {
    const seen: number[] = [];
    for (let i = 1; i <= full.length; i++) seen.push(completedItems(full.slice(0, i), "ops").length);
    expect(Math.max(...seen)).toBe(3);
    // never goes backwards, and the count only grows one at a time
    for (let i = 1; i < seen.length; i++) expect(seen[i] - seen[i - 1]).toBeGreaterThanOrEqual(0);
    expect(completedItems(full, "ops")).toEqual(JSON.parse(full).ops);
  });
  it("braces and quotes inside text don't confuse it", () => {
    const cut = full.slice(0, full.indexOf('"replace_text"') + 30);
    expect(completedItems(cut, "ops").length).toBe(1);
  });
  it("nothing yet", () => {
    expect(completedItems('{"understood":"x","ops":[', "ops")).toEqual([]);
    expect(completedItems('{"understood":"x"', "ops")).toEqual([]);
  });
});
