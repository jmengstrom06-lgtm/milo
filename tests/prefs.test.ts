import { describe, expect, it, vi } from "vitest";
vi.mock("electron", () => ({ app: { getPath: () => "/tmp" } }));
import { inQuiet, setPrefs } from "../src/main/prefs";

describe("quiet hours", () => {
  it("handles ranges across midnight", () => {
    expect(inQuiet(23, 23, 8)).toBe(true);
    expect(inQuiet(2, 23, 8)).toBe(true);
    expect(inQuiet(8, 23, 8)).toBe(false);
    expect(inQuiet(15, 23, 8)).toBe(false);
  });
  it("handles same-day ranges and off", () => {
    expect(inQuiet(14, 13, 15)).toBe(true);
    expect(inQuiet(15, 13, 15)).toBe(false);
    expect(inQuiet(3, 5, 5)).toBe(false);
  });

  it("keeps a clean never-record list of classes", () => {
    const p = setPrefs({ noRecord: ["stat", "stat", "", 3 as unknown as string, "engl"] });
    expect(p.noRecord).toEqual(["stat", "engl"]);
    expect(setPrefs({ quiet: false }).noRecord).toEqual(["stat", "engl"]);
  });
});

import { recordDecision } from "../src/main/prefs";
describe("lecture recording: whenever the student asks, except classes they switched off", () => {
  const p = { noRecord: ["engl"], okRecord: [] };
  it("records in any class", () => expect(recordDecision("bio", p, false)).toBe("record"));
  it("records when it doesn't know the class", () => expect(recordDecision(null, p, false)).toBe("record"));
  it("never records a class the student turned off", () => expect(recordDecision("engl", p, true)).toBe("never"));
});


describe("worksheet autofill", () => {
  it("can be switched", () => {
    expect(setPrefs({ autofill: true }).autofill).toBe(true);
    expect(setPrefs({ autofill: "yes" as unknown as boolean }).autofill).toBe(true);
    expect(setPrefs({ autofill: false }).autofill).toBe(false);
  });
});

import { looksLikeRubric } from "../src/main/prefs";
describe("rubric detection", () => {
  it("spots a rubric", () => expect(looksLikeRubric("Grading rubric (20 points): Thesis is clear (5 pts). At least 3 sources cited in MLA format (5 pts). Minimum 1000 words.")).toBe(true));
  it("ignores normal copied text", () => expect(looksLikeRubric("Hey are we still meeting at the library at 7 tonight? Let me know")).toBe(false));
});
