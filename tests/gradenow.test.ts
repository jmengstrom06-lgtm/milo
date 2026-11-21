import { describe, expect, it } from "vitest";
import { parseGradeNow, parseForecast } from "../src/renderer/decide";
describe("asking for your grade, every way", () => {
  it("understands", () => {
    const c = (t: string) => parseGradeNow(t)?.course;
    expect(c("What's my grade in stats?")).toBe("stats");
    expect(c("What's my graded stats right now?")).toBe("stats");
    expect(c("I want you to check what my grade is in stats.")).toBe("stats");
    expect(c("Hey Milo, what's my stats grade")).toBe("stats");
    expect(c("how am I doing in econ")).toBe("econ");
    expect(c("tell me my grade for criminal justice")).toBe("criminal justice");
    expect(c("What is my current grade in my stats class right now")).toBe("stats");
    // real mishearings from the logs
    expect(c("Milo, what is My GradenStat?")).toBe("stat");
    expect(c("Milo, what's my grade and stats?")).toBe("stats");
    expect(c("No, Milo. What is my grade in my stats class?")).toBe("stats");
    expect(c("what's my great in econ")).toBe("econ");
  });
  it("leaves other things alone", () => {
    expect(parseGradeNow("what do I need on exam 4 for an A in stats")).toBeNull();
    expect(parseGradeNow("grade my essay")).toBeNull();
    expect(parseForecast("what do I need on exam 4 for an A in stats")).toEqual({ exam: "exam 4", letter: "A", course: "stats" });
  });
});
