import { describe, expect, it, vi } from "vitest";
vi.mock("electron", () => ({ app: { getPath: () => "/tmp/milo-test-" + process.pid } }));
vi.mock("../src/main/blackbox", () => ({ log: () => {} }));
vi.mock("../src/main/brain", () => ({ callTool: async () => ({ ok: false, text: "x" }), persona: () => "" }));
vi.mock("../src/main/gateway", () => ({ models: { fast: () => "claude-haiku-5-5", smart: () => "claude-sonnet-5-5" } }));
vi.mock("../src/main/profile", () => ({ profileText: () => "" }));
import { detectLms, feedUrl, parseIcs, splitCourse } from "../src/main/school";
import { detectBlocker } from "../src/main/blockers";
import { findEl, fill, generalize, shapeOf } from "../src/main/recipes";
import { forecast, forecastLine, targetFor } from "../src/main/gradeMath";
import { parseProfileFact } from "../src/main/profileFacts";
import { numbersIn, runMath, isQuantitative } from "../src/main/mathcheck";
import { cheapCheck } from "../src/main/jobs";
import { costOf } from "../src/main/usage";
import { parseExam, parseFinalWeight, parseForecast } from "../src/renderer/decide";

describe("school adapter", () => {
  it("knows each LMS", () => {
    expect(detectLms("https://d2l.tcu.edu/d2l/home")).toBe("d2l");
    expect(detectLms("https://utexas.instructure.com")).toBe("canvas");
    expect(detectLms("https://learn.okstate.edu/ultra/course")).toBe("blackboard");
    expect(detectLms("https://moodle.school.edu")).toBe("moodle");
  });
  it("accepts feed links, rejects other links", () => {
    expect(feedUrl("webcal://d2l.tcu.edu/d2l/le/calendar/feed/user/feed.ics?token=abc")).toBe("https://d2l.tcu.edu/d2l/le/calendar/feed/user/feed.ics?token=abc");
    expect(feedUrl("https://canvas.instructure.com/feeds/calendars/user_abc.ics")).toBeTruthy();
    expect(feedUrl("https://www.google.com")).toBeNull();
    expect(feedUrl("hello")).toBeNull();
  });
  it("splits course names out of titles", () => {
    expect(splitCourse("Homework 3 [MATH 10043]")).toEqual({ title: "Homework 3", course: "MATH 10043" });
    expect(splitCourse("ECON 10223: Problem Set 4 - Due")).toEqual({ title: "Problem Set 4", course: "ECON 10223" });
    expect(splitCourse("Essay 2 - Due", "ENGL 20803")).toEqual({ title: "Essay 2", course: "ENGL 20803" });
  });
  it("reads a calendar feed", () => {
    const now = new Date(2026, 10, 21, 9).getTime();
    const ics = ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "SUMMARY:Homework 5 [STAT 2001]", "DTSTART:20261124T055900Z", "URL:https://x.edu/a/5", "END:VEVENT",
      "BEGIN:VEVENT", "SUMMARY:Midterm Exam - Due", "LOCATION:PSYC 10213", "DTSTART;VALUE=DATE:20261201", "END:VEVENT",
      "BEGIN:VEVENT", "SUMMARY:Old thing [X]", "DTSTART:20250101T000000Z", "END:VEVENT",
      "BEGIN:VEVENT", "SUMMARY:Long title that gets", " wrapped [BIO 1]", "DTSTART:20261130T170000", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
    const a = parseIcs(ics, now);
    expect(a.map((x) => x.title)).toEqual(["Homework 5", "Long title that getswrapped", "Midterm Exam"]);
    expect(a[0].course).toBe("STAT 2001");
    expect(a[2]).toMatchObject({ course: "PSYC 10213", kind: "exam", due_iso: "2026-12-01T23:59" });
    expect(a[1].due_iso).toBe("2026-11-30T17:00");
  });
});

describe("logins and blockers", () => {
  it("stops at a password box", () => {
    expect(detectBlocker({ url: "https://login.microsoftonline.com/x", text: "Sign in", elements: [{ tag: "input", type: "password", label: "Password" }] })?.kind).toBe("login");
  });
  it("stops at 2-step codes and captchas", () => {
    expect(detectBlocker({ url: "https://api-1.duosecurity.com/frame", text: "Check your phone. Duo Push sent." })?.kind).toBe("code");
    expect(detectBlocker({ url: "https://site.com", text: "Please verify you are human" })?.kind).toBe("captcha");
  });
  it("leaves normal pages alone", () => {
    expect(detectBlocker({ url: "http://127.0.0.1:47399/form", text: "Join the Study Club Full name Email", elements: [{ tag: "input", type: "email", label: "Email" }] })).toBeNull();
    expect(detectBlocker({ url: "https://d2l.tcu.edu/d2l/home", text: "My courses. Log in history is shown in settings" })).toBeNull();
  });
});

describe("muscle memory", () => {
  it("matches tasks by shape, not values", () => {
    const a = shapeOf('Type "Test Student" into the Name field at http://127.0.0.1:47399/form');
    const b = shapeOf('Type "Jake Engstrom" into the Name field at http://127.0.0.1:47399/form\n(Part of a bigger job)');
    expect(a.key).toBe(b.key);
    expect(b.values[0]).toBe("Jake Engstrom");
  });
  it("swaps values into recorded steps", () => {
    const { values } = shapeOf('Sign up with email "a@tcu.edu" and name "Ann"');
    const g = generalize("a@tcu.edu", values);
    expect(g).toBe("{0}");
    expect(fill(g, ["b@tcu.edu"])).toBe("b@tcu.edu");
  });
  it("finds the same element on a new page, only if it's a clear match", () => {
    const els = [
      { id: "e1", tag: "input", type: "text", label: "Full name" },
      { id: "e2", tag: "input", type: "email", label: "Email" },
      { id: "e3", tag: "button", label: "Submit", inView: false },
    ];
    expect(findEl(els, { tag: "input", type: "email", label: "Email" })?.id).toBe("e2");
    expect(findEl(els, { tag: "button", label: "Save" })).toBeNull();
    expect(findEl([...els, { id: "e4", tag: "button", label: "Submit", inView: true }], { tag: "button", label: "Submit" })?.id).toBe("e4");
  });
});

describe("cheap checks", () => {
  const v = { url: "http://x/done", pageText: "Thanks! Your order number is CS-4417.", fields: [{ label: "Full name", value: "Test Student" }, { label: "Send me the newsletter", checked: true }] };
  it("proves steps from the page", () => {
    expect(cheapCheck({ kind: "url_has", value: "/done" }, v)).toBe(true);
    expect(cheapCheck({ kind: "page_has", value: "order number" }, v)).toBe(true);
    expect(cheapCheck({ kind: "field_is", field: "full name", value: "test student" }, v)).toBe(true);
    expect(cheapCheck({ kind: "field_is", field: "newsletter", value: "checked" }, v)).toBe(true);
  });
  it("hands unclear cases to the AI", () => {
    expect(cheapCheck(undefined, v)).toBeNull();
    expect(cheapCheck({ kind: "page_has", value: "not here" }, v)).toBeNull();
    expect(cheapCheck({ kind: "field_is", field: "full name", value: "someone else" }, v)).toBe(false);
  });
});

describe("cost meter", () => {
  it("prices calls right", () => {
    expect(costOf("claude-sonnet-5-5", { input_tokens: 1e6, output_tokens: 1e5 })).toBeCloseTo(3, 5);
    expect(costOf("claude-haiku-5-5", { input_tokens: 1e6 / 10, output_tokens: 1e6 / 10 })).toBeCloseTo(0.06, 5);
    expect(costOf("claude-haiku-5-5", { input_tokens: 200_000, output_tokens: 0 })).toBeCloseTo(0.1, 5); // long prompt: 5x
    expect(costOf("claude-sonnet-5-5", { cache_read_input_tokens: 1e6 })).toBeCloseTo(0.1, 5);
  });
});

describe("grade forecaster", () => {
  it("weighted classes", () => {
    const f = forecast({ course: "Stats", categories: [{ name: "Homework", weight: 20, percent: 95 }, { name: "Midterm", weight: 30, earned: 78, possible: 100 }, { name: "Quizzes", weight: 20, percent: 85 }], final: { name: "Final", weight: 30, possible: 100 } }, 80)!;
    // 20*95 + 30*78 + 20*85 = 5940; need (8000-5940)/30 = 68.7
    expect(f.needed).toBe(68.7);
    expect(f.basis).toBe("weights");
    expect(forecastLine(f, "B", "Final")).toBe("You need about 69% on the Final to get a B.");
  });
  it("assumes your average on ungraded categories", () => {
    const f = forecast({ course: "X", categories: [{ name: "Homework", weight: 40, percent: 90 }, { name: "Project", weight: 20, percent: null }], final: { name: "Final", weight: 40, possible: null } }, 90)!;
    expect(f.needed).toBe(90);
    expect(f.notes[0]).toMatch(/Project/);
  });
  it("points classes, already safe, and out of reach", () => {
    expect(forecast({ course: "X", categories: [], earned: 580, possible: 600, final: { name: "Final", weight: null, possible: 200 } }, 70)!.already).toBe(true);
    const f = forecast({ course: "X", categories: [], earned: 300, possible: 600, final: { name: "Final", weight: null, possible: 200 } }, 90)!;
    expect(f.impossible).toBe(true);
  });
  it("letters", () => {
    expect(targetFor("B").target).toBe(80);
    expect(targetFor("B+").target).toBe(87);
    expect(targetFor("A", [{ letter: "A", min: 94 }]).target).toBe(94);
  });
  it("voice", () => {
    expect(parseForecast("what do I need on the final for a B in stats")).toEqual({ exam: "final", letter: "B", course: "stats" });
    expect(parseForecast("What do I need to get on my final exam in econ to get an A minus?")).toEqual({ exam: "final", letter: "A-", course: "econ" });
    expect(parseForecast("what do I need on the midterm for a C")?.course).toBe("");
    expect(parseForecast("what do I need for dinner")).toBeNull();
    expect(parseFinalWeight("the final is worth 25 percent of my grade")).toEqual({ exam: "final", weight: 25, course: "" });
    expect(parseFinalWeight("the final in stats is worth 30%")).toEqual({ exam: "final", weight: 30, course: "stats" });
  });
});

describe("math checker", () => {
  it("runs math in a locked box", () => {
    expect(runMath("return 1 - Math.pow(1 - 0.3, 4);")).toMatchObject({ ok: true });
    expect((runMath("return 17*23") as { value: number }).value).toBe(391);
    expect(runMath("return require('fs')").ok).toBe(false);
    expect(runMath("while(true){}").ok).toBe(false);
    expect(runMath("return process.env").ok).toBe(false);
  });
  it("reads numbers out of answers", () => {
    expect(numbersIn("x = 3.5")).toContain(3.5);
    expect(numbersIn("about 12,400 people")).toContain(12400);
    expect(numbersIn("the answer is 1/4")).toContain(0.25);
  });
  it("only checks number problems", () => {
    expect(isQuantitative("Solve 2x + 3 = 11", "x = 4")).toBe(true);
    expect(isQuantitative("Explain the causes of WW1", "Nationalism and alliances")).toBe(false);
  });
});

describe("saved details + exam voice", () => {
  it("my student id is ...", () => {
    expect(parseProfileFact("my student ID is 123 456 789")).toEqual({ key: "student_id", value: "123456789" });
    expect(parseProfileFact("remember my email is jake at tcu dot edu")).toEqual({ key: "email", value: "jake@tcu.edu" });
    expect(parseProfileFact("my major is finance")).toEqual({ key: "major", value: "finance" });
    expect(parseProfileFact("my head hurts")).toBeNull();
  });
  it("practice exams", () => {
    expect(parseExam("make me a practice midterm for stats")).toEqual({ kind: "midterm", course: "stats" });
    expect(parseExam("give me a mock final exam in econ class")).toEqual({ kind: "final", course: "econ" });
    expect(parseExam("make me a sandwich")).toBeNull();
  });
});
