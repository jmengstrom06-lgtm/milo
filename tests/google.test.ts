import { describe, expect, it } from "vitest";
import { looksLikeBackground, parseGoogle, parseRadar, parseGradeNow } from "../src/renderer/decide";
const d = (t: string) => parseGoogle(t)?.do ?? null;
describe("Google voice", () => {
  it("understands", () => {
    expect(d("connect my Google account")).toBe("connect");
    expect(d("Hey Milo, connect Gmail")).toBe("connect");
    expect(parseGoogle("what's on my calendar today")).toEqual({ do: "calendar", days: 1, range: "today" });
    expect(d("what's my schedule this week")).toBe("calendar");
    expect(d("do I have any new emails")).toBe("mail");
    expect(d("check my inbox")).toBe("mail");
    expect(parseGoogle("make a google doc called Econ notes")).toEqual({ do: "doc", title: "Econ notes" });
    expect(d("draft an email to Professor Weltman saying I'll miss Friday")).toBe("draft");
    expect(d("email professor white that my paper will be late")).toBe("draft");
    expect(d("add study group Tuesday at 7 to my calendar")).toBe("event");
    expect(d("put my dentist appointment on my calendar for Friday at 2")).toBe("event");
    // real phrasings from Jake's log
    expect(d("open up my Gmail and draft an email to Mike Armstrong saying hi")).toBe("draft");
    expect(parseGoogle("open up my Gmail and draft an email to Mike Armstrong saying hi")).toMatchObject({ request: "draft an email to Mike Armstrong saying hi" });
    expect(d("adds study group Tuesday at seven to my calendar")).toBe("event");
    expect(d("Hey Milo, connect my Google")).toBe("connect");
  });
  it("leaves other commands alone", () => {
    for (const t of ["what's due this week", "what's my grade in stats", "open chrome", "make me a practice midterm for stats", "what do I have to do today"]) expect(d(t), t).toBeNull();
    expect(parseRadar("what's due this week", false)).toBeTruthy();
    expect(parseGradeNow("what's my grade in stats")).toBeTruthy();
  });
});

describe("room talk in the follow-up window", () => {
  it("ignores scraps, keeps short real answers", () => {
    expect(looksLikeBackground("Those procedure")).toBe(true);
    for (const t of ["Yeah.", "No. No.", "Yes do it", "Thanks", "Open it", "Next"]) expect(looksLikeBackground(t), t).toBe(false);
  });
});
