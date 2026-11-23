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
describe("lecture recording is off until the student confirms the class allows it", () => {
  const p = { noRecord: ["engl"], okRecord: ["stat"] };
  it("asks first in a class it hasn't been told about", () => expect(recordDecision("bio", p, false)).toBe("ask"));
  it("asks when it doesn't know the class", () => expect(recordDecision(null, p, false)).toBe("ask"));
  it("records in a class the student allowed", () => expect(recordDecision("stat", p, false)).toBe("record"));
  it("never records a class the student turned off, even if confirmed", () => expect(recordDecision("engl", p, true)).toBe("never"));
  it("records once the student just confirmed", () => expect(recordDecision("bio", p, true)).toBe("record"));
  it("allowing a class removes it from the never list, and the reverse", () => {
    setPrefs({ noRecord: ["x"], okRecord: [] });
    expect(setPrefs({ okRecord: ["x"] }).noRecord).not.toContain("x");
    expect(setPrefs({ noRecord: ["x"] }).okRecord).not.toContain("x");
  });
});

describe("worksheet autofill", () => {
  it("is off unless the student turns it on", () => {
    expect(setPrefs({}).autofill).toBe(false);
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
