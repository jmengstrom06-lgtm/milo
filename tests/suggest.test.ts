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
