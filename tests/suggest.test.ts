import { describe, expect, it, vi } from "vitest";
vi.mock("electron", () => ({ app: { getPath: () => "/tmp", isPackaged: false }, safeStorage: { isEncryptionAvailable: () => false } }));
import { cleanOptions } from "../src/main/brain";

describe("handle-this options", () => {
  it("keeps at most 3 real options", () => {
    const r = cleanOptions([
      { label: "Make a game plan", say: "start this" },
      { label: "Quiz me", say: "quiz me on this" },
      { label: "Flashcards", say: "make flashcards on this" },
      { label: "Explain", say: "explain this" },
    ]);
    expect(r).toHaveLength(3);
  });
  it("drops anything that submits, buys or does graded work", () => {
    const r = cleanOptions([
      { label: "Submit it", say: "submit the assignment" },
      { label: "Do the whole worksheet", say: "do this worksheet" },
      { label: "Check my work", say: "check my work" },
    ]);
    expect(r.map((o) => o.say)).toEqual(["check my work"]);
  });
  it("survives junk", () => {
    expect(cleanOptions(null)).toEqual([]);
    expect(cleanOptions([{ label: "", say: "x" }, 3])).toEqual([]);
  });
});

import { honestItems } from "../src/main/brain";
describe("preflight honesty", () => {
  it("a 'confirmed' with no quoted requirement becomes 'possible'", () => {
    const r = honestItems([{ status: "confirmed", text: "Needs more sources", quote: "", source: "rubric" }], true);
    expect(r[0].status).toBe("possible");
    expect(r[0].source).toBe("none");
  });
  it("can't cite a rubric it was never given", () => {
    const r = honestItems([{ status: "confirmed", text: "Only 2 sources", quote: "at least 3 sources", source: "rubric" }], false);
    expect(r[0].source).toBe("screen");
    expect(r[0].status).toBe("confirmed");
  });
  it("orders fixes first, dedupes, caps at 6, drops junk", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ status: i % 2 ? "unknown" : "confirmed", text: `t${i}`, quote: "q", source: "rubric" }));
    const r = honestItems([...many, { status: "confirmed", text: "t0", quote: "q", source: "rubric" }, null, { text: "" }], true);
    expect(r).toHaveLength(6);
    expect(r[0].status).toBe("confirmed");
    expect(new Set(r.map((x) => x.text)).size).toBe(6);
  });
});

describe("options sent as a JSON string", () => {
  it("are still read", () => {
    expect(cleanOptions('[{"label":"Explain this","say":"explain this"}]')).toEqual([{ label: "Explain this", say: "explain this" }]);
    expect(honestItems('[{"status":"possible","text":"Maybe short","quote":"","source":"none"}]', false)).toHaveLength(1);
  });
});
