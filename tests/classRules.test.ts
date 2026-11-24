import { describe, expect, it } from "vitest";
import { allowed, cleanPolicy, holdBackLine, ruleFor, rulesPrompt, type Rules } from "../src/main/classRules";

const rules: Rules = {
  c1: { course: "Statistical Analysis", level: "study", quote: "AI may be used for studying, not for graded work.", readAt: 0, source: "Syllabus.pdf" },
  c2: { course: "American Writers", level: "none", quote: "No generative AI in this course.", readAt: 0, source: "Syllabus.docx" },
};

describe("optional syllabus rules", () => {
  it("nothing is limited in classes that aren't followed", () => {
    expect(allowed(undefined, "fill")).toBe(true);
    expect(ruleFor(rules, "do my bio lab worksheet")).toBeNull();
  });
  it("studying-only allows explaining, not filling in or writing", () => {
    expect(allowed("study", "study")).toBe(true);
    expect(allowed("study", "fill")).toBe(false);
    expect(allowed("study", "write")).toBe(false);
  });
  it("no AI = planning only; allowed/credit = everything", () => {
    expect(allowed("none", "study")).toBe(false);
    expect(allowed("none", "plan")).toBe(true);
    expect(allowed("credit", "fill")).toBe(true);
    expect(allowed("allowed", "write")).toBe(true);
  });
  it("finds the class from what was said or the window title", () => {
    expect(ruleFor(rules, "", "Problem Set 7 - Statistical Analysis - D2L")?.course).toBe("Statistical Analysis");
    expect(ruleFor(rules, "write my american writers essay")?.course).toBe("American Writers");
  });
  it("explains itself with the quote", () => {
    expect(holdBackLine(rules.c1, "fill")).toMatch(/Statistical Analysis syllabus says "AI may be used for studying/);
    expect(holdBackLine(rules.c1, "fill")).toMatch(/quiz you instead/);
  });
  it("tells the chat brain only about followed classes", () => {
    expect(rulesPrompt({})).toBe("");
    expect(rulesPrompt(rules)).toMatch(/American Writers: No AI/);
  });
  it("never claims a rule without a quote", () => {
    expect(cleanPolicy({ level: "none", quote: "" })).toEqual({ level: "unclear", quote: "" });
    expect(cleanPolicy({ level: "banana", quote: "x" }).level).toBe("unclear");
    expect(cleanPolicy({ level: "study", quote: " Use AI to study only. " })).toEqual({ level: "study", quote: "Use AI to study only." });
  });
});

import { syllabusScore } from "../src/main/syllabus";
describe("finding the syllabus in D2L", () => {
  it("by its title", () => expect(syllabusScore({ Title: "STAT 20103 Syllabus Fall 2026", Url: "/content/x.pdf" })).toBeGreaterThan(9));
  it("by the folder it's in", () => expect(syllabusScore({ Title: "STAT 20103 Fall 2026.pdf", Url: "/content/a.pdf", path: "Start Here > Syllabus" })).toBeGreaterThan(5));
  it("course info pages count a little", () => expect(syllabusScore({ Title: "Course Information", Url: "/content/i.html" })).toBeGreaterThan(0));
  it("random lecture files don't", () => expect(syllabusScore({ Title: "Lecture 4 slides", Url: "/content/l4.pdf", path: "Week 2" })).toBe(0));
  it("a title match beats a folder match", () =>
    expect(syllabusScore({ Title: "Syllabus", Url: "/s.pdf" })).toBeGreaterThan(syllabusScore({ Title: "Doc.pdf", Url: "/d.pdf", path: "Syllabus" })));
});
