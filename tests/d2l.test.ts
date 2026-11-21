import { describe, expect, it, vi } from "vitest";
vi.mock("electron", () => ({ session: { fromPartition: () => ({}) } }));
vi.mock("../src/main/blackbox", () => ({ log: () => {} }));
import { matchCourse, shortName, type Course } from "../src/main/d2l";
import { forecast, forecastLine, targetFor } from "../src/main/gradeMath";

const raw = [
  [389255, "Introduction to Criminal Justice 074 (White)", "2026FallREG CRJU20413 074"],
  [389374, "American Writers 055 (Colon)", "2026FallREG ENGL20503 055"],
  [389456, "Understanding the Earth 035 (Donovan)", "2026FallREG GEOL10113 035"],
  [389470, "Understanding the Earth M 6-8 (Lamb)", "2026FallREG GEOL10113 138"],
  [399950, "Statistical Analysis 035/045/065 (Weltman)", "2026FallREG INSC20153 035"],
  [401148, "Organizational Behavior and Strategy 083 (Hirst)", "2026FallREG MANA30253 083"],
] as const;
const cs: Course[] = raw.map(([id, name, code]) => ({ id, name, code, short: shortName(name, code), subject: (code.match(/\b([A-Z]{3,5})\d{4,5}\b/) ?? [])[1] ?? "" }));

describe("D2L courses", () => {
  it("clean names", () => {
    expect(cs.map((c) => c.short)).toEqual(["Introduction to Criminal Justice", "American Writers", "Understanding the Earth", "Understanding the Earth Lab", "Statistical Analysis", "Organizational Behavior and Strategy"]);
  });
  it("matches how students say them", () => {
    const m = (s: string) => matchCourse(s, cs)?.id;
    expect(m("stats")).toBe(399950);
    expect(m("statistics")).toBe(399950);
    expect(m("criminal justice")).toBe(389255);
    expect(m("crim")).toBe(389255);
    expect(m("english")).toBe(389374);
    expect(m("american writers")).toBe(389374);
    expect(m("geology")).toBe(389456);
    expect(m("geology lab")).toBe(389470);
    expect(m("OB")).toBe(401148);
    expect(m("org behavior")).toBe(401148);
    expect(m("management")).toBe(401148);
    expect(m("chemistry")).toBeUndefined();
  });
});

describe("Jake's stats class, from D2L", () => {
  it("what he needs on exam 4 for a B", () => {
    const sheet = { course: "Statistical Analysis", categories: [{ name: "Exam1_adj", weight: 25, percent: 95.5 }, { name: "Exam 2", weight: 25, percent: 100 }, { name: "Exam 3", weight: 25, percent: 90 }, { name: "Exam 4", weight: 25, percent: null }], final: { name: "Exam 4", weight: 25, possible: null } };
    const f = forecast(sheet, targetFor("B").target)!;
    expect(f.needed).toBe(34.5);
    expect(forecastLine(f, "B", "Exam 4")).toBe("You need about 35% on the Exam 4 to get a B.");
    expect(forecast(sheet, targetFor("A").target)!.needed).toBe(74.5);
  });
});
