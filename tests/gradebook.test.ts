import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
const dir = "/tmp/milo-gb-" + process.pid;
fs.mkdirSync(dir, { recursive: true });
vi.mock("electron", () => ({ app: { getPath: () => "/tmp/milo-gb-" + process.pid } }));
vi.mock("../src/main/blackbox", () => ({ log: () => {} }));
vi.mock("../src/main/brain", () => ({ callTool: async () => ({ ok: false, text: "x" }), persona: () => "" }));
import { addScore, bookSheet, catFor, gradeNow, setWeight } from "../src/main/gradebook";
import { forecast, targetFor } from "../src/main/gradeMath";
import { parseGradeNow, parseScore, parseSyllabus } from "../src/renderer/decide";

describe("gradebook voice", () => {
  it("scores", () => {
    expect(parseScore("I got an 85 on the midterm in stats")).toEqual({ name: "midterm", earned: 85, possible: 100, course: "stats" });
    expect(parseScore("I got 18 out of 20 on quiz 3 in econ")).toEqual({ name: "quiz 3", earned: 18, possible: 20, course: "econ" });
    expect(parseScore("I got a B plus on my essay in English class")).toEqual({ name: "essay", earned: 88, possible: 100, course: "English" });
    expect(parseScore("I got 92 percent on homework 4")?.course).toBe("");
    expect(parseScore("I got a new phone")).toBeNull();
  });
  it("syllabus + grade now", () => {
    expect(parseSyllabus("read my syllabus")).toEqual({ course: "" });
    expect(parseSyllabus("read my stats syllabus")).toEqual({ course: "stats" });
    expect(parseSyllabus("this is my syllabus for econ")).toEqual({ course: "econ" });
    expect(parseGradeNow("what's my grade in stats")).toEqual({ course: "stats" });
  });
});

describe("gradebook math", () => {
  it("files scores under the right part", () => {
    const cats = [{ name: "Homework" }, { name: "Quizzes" }, { name: "Midterm Exams" }, { name: "Final Exam" }];
    expect(catFor("quiz 3", cats)).toBe("Quizzes");
    expect(catFor("hw 4", cats)).toBe("Homework");
    expect(catFor("midterm", cats)).toBe("Midterm Exams");
    expect(catFor("final", cats)).toBe("Final Exam");
  });
  it("syllabus weights + told scores -> what you need on the final", () => {
    addScore("Stats", "midterm", 80);
    for (const w of [["Homework", 20], ["Quizzes", 20], ["Midterm", 30], ["Final", 30]] as const) setWeight("Stats", w[0], w[1]);
    addScore("stats", "quiz 1", 18, 20);
    addScore("stats", "homework 1", 95);
    const sheet = bookSheet("stats")!;
    expect(sheet.final?.name).toBe("Final");
    const f = forecast(sheet, targetFor("B").target)!;
    // 20*95 + 20*90 + 30*80 = 6100 -> (8000-6100)/30 = 63.3
    expect(f.needed).toBe(63.3);
    expect(gradeNow("stats").text).toMatch(/about 87%/);
  });
});
