import { describe, expect, it, vi } from "vitest";
vi.mock("electron", () => ({ app: { getPath: () => "/tmp" } }));
import { mergeD2l } from "../src/main/classSync";
import { COLORS, SUBJECT_WORDS, type Klass } from "../src/main/classes";

const mine: Klass[] = [
  { id: "e", name: "English", code: "", subject: "english", color: "#a" },
  { id: "m", name: "Math", code: "", subject: "math", color: "#b" },
  { id: "g", name: "Geology", code: "", subject: "science", color: "#c" },
  { id: "b", name: "Business Organization and Behavior Strategies", code: "", subject: "business", color: "#d" },
  { id: "c", name: "Criminal Justice", code: "", subject: "history", color: "#e" },
];
const d2l = [
  { name: "American Writers 055 (Colon)", short: "American Writers", code: "ENGL20803.055", subject: "ENGL" },
  { name: "Introduction to Criminal Justice 074 (White)", short: "Introduction to Criminal Justice", code: "CRJU20213.074", subject: "CRJU" },
  { name: "Organizational Behavior and Strategy 083 (Hirst)", short: "Organizational Behavior and Strategy", code: "MANA30653.083", subject: "MANA" },
  { name: "Statistical Analysis 035/045/065 (Weltman)", short: "Statistical Analysis", code: "STAT20103.035", subject: "STAT" },
  { name: "Understanding the Earth 035 (Donovan)", short: "Understanding the Earth", code: "GEOL10113.035", subject: "GEOL" },
  { name: "Understanding the Earth M 6-8 (Lamb)", short: "Understanding the Earth Lab", code: "GEOL10111.135", subject: "GEOL" },
];

describe("D2L class sync", () => {
  const r = mergeD2l(mine, d2l, SUBJECT_WORDS, COLORS, (i) => `new${i}`);
  const byId = Object.fromEntries(r.classes.map((c) => [c.id, c]));
  it("each of Jake's classes keeps its id (so filed work stays) and takes the real name", () => {
    expect(byId.e.name).toBe("American Writers");
    expect(byId.m.name).toBe("Statistical Analysis");
    expect(byId.m.subject).toBe("stats");
    expect(byId.g.name).toBe("Understanding the Earth");
    expect(byId.b.name).toBe("Organizational Behavior and Strategy");
    expect(byId.c.name).toBe("Introduction to Criminal Justice");
  });
  it("lab folds into its class, nothing duplicated", () => {
    expect(r.classes).toHaveLength(5);
    expect(r.added).toEqual([]);
    expect(r.classes.find((c) => /Lab$/.test(c.name))).toBeUndefined();
  });
  it("codes are short", () => expect(byId.m.code).toBe("STAT 20103"));
  it("new D2L courses get added; my own extra classes stay", () => {
    const x = mergeD2l([{ id: "p", name: "Piano lessons", code: "", subject: "arts", color: "#f" }], d2l.slice(0, 1), SUBJECT_WORDS, COLORS, (i) => `n${i}`);
    expect(x.classes.map((c) => c.name)).toEqual(["American Writers", "Piano lessons"]);
    expect(x.added).toEqual(["American Writers"]);
  });
});
