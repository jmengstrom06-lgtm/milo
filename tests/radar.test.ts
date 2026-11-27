import { describe, it, expect } from "vitest";
import { alertLine, sameCourse, chipText, emptyRadar, markWarned, mergeScan, parseDue, pendingAlerts, upcoming, whenText, daysUntil } from "../src/renderer/radar";

const at = (y: number, mo: number, d: number, h = 9, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
const MON = at(2026, 11, 16, 9); // Monday 9am
const hw = (title: string, iso: string, course = "STAT 2023") => ({ title, course, due: iso, due_iso: iso });

describe("radar", () => {
  it("parses due dates (local) and defaults to 11:59 PM", () => {
    expect(new Date(parseDue("2026-11-21T14:30")!).getHours()).toBe(14);
    const d = new Date(parseDue("2026-11-21")!);
    expect([d.getHours(), d.getMinutes()]).toEqual([23, 59]);
    expect(parseDue("")).toBeNull();
    expect(parseDue("Friday")).toBeNull();
  });

  it("first scan is quiet about 'new', later scans flag new things", () => {
    let r = mergeScan(emptyRadar(), [hw("HW 7", "2026-11-30T23:59")], MON);
    expect(pendingAlerts(r, MON)).toEqual([]);
    r = mergeScan(r, [hw("HW 7", "2026-11-30T23:59"), hw("Essay 3", "2026-11-28T23:59", "ENGL 1301")], MON + 3 * 3600e3);
    const a = pendingAlerts(r, MON + 3 * 3600e3);
    expect(a.map((x) => [x.item.title, x.why])).toEqual([["Essay 3", ["new"]]]);
  });

  it("catches a moved due date and remembers the old one", () => {
    let r = mergeScan(emptyRadar(), [hw("Lab 4", "2026-11-25T23:59", "BIOL")], MON);
    r = mergeScan(r, [hw("Lab 4", "2026-11-27T23:59", "BIOL")], MON + 3600e3);
    const a = pendingAlerts(r, MON + 3600e3);
    expect(a[0].why).toEqual(["moved"]);
    expect(a[0].item.prevDue).toBe("2026-11-25T23:59");
    expect(alertLine(a, MON + 3600e3)).toMatch(/moved to/);
  });

  it("matches the same assignment even if D2L renames it a bit", () => {
    let r = mergeScan(emptyRadar(), [hw("Homework 7 Hypothesis Tests", "2026-11-30")], MON);
    r = mergeScan(r, [hw("Homework 7: Hypothesis Tests (Submission)", "2026-11-30")], MON + 3600e3);
    expect(r.items.length).toBe(1);
    expect(pendingAlerts(r, MON + 3600e3)).toEqual([]);
  });

  it("countdown: 3 days, day before, morning of, each once", () => {
    let r = mergeScan(emptyRadar(), [hw("HW 7", "2026-11-20T23:59")], MON); // due Friday
    expect(pendingAlerts(r, MON)).toEqual([]); // 4 days out: nothing
    const tue = at(2026, 11, 17, 10);
    expect(pendingAlerts(r, tue)[0].why).toEqual(["d3"]);
    r = markWarned(r, pendingAlerts(r, tue), tue);
    expect(pendingAlerts(r, tue + 3600e3)).toEqual([]);
    const thu = at(2026, 11, 19, 18);
    expect(pendingAlerts(r, thu)[0].why).toEqual(["d1"]);
    r = markWarned(r, pendingAlerts(r, thu), thu);
    const fri7 = at(2026, 11, 20, 7);
    expect(pendingAlerts(r, fri7)).toEqual([]); // not before 8am
    const fri9 = at(2026, 11, 20, 9);
    expect(pendingAlerts(r, fri9)[0].why).toEqual(["today"]);
    r = markWarned(r, pendingAlerts(r, fri9), fri9);
    expect(pendingAlerts(r, fri9 + 3600e3)).toEqual([]);
  });

  it("a 'new' alert for something due tomorrow doesn't repeat as 'due tomorrow'", () => {
    let r = mergeScan(emptyRadar(), [], MON);
    r = mergeScan(r, [hw("Quiz 5", "2026-11-17T23:59")], MON);
    const a = pendingAlerts(r, MON);
    expect(a[0].why).toEqual(["new", "d1"]);
    r = markWarned(r, a, MON);
    expect(pendingAlerts(r, MON + 3600e3)).toEqual([]);
  });

  it("forgets things past due, lists what's coming up soonest first", () => {
    let r = mergeScan(emptyRadar(), [hw("Old", "2026-11-10"), hw("B", "2026-11-25"), hw("A", "2026-11-18")], MON);
    expect(r.items.map((x) => x.title)).toEqual(["B", "A"]);
    expect(upcoming(r, MON).map((x) => x.title)).toEqual(["A", "B"]);
    expect(upcoming(r, MON, 3).map((x) => x.title)).toEqual(["A"]);
  });

  it("talks like a person", () => {
    expect(whenText(at(2026, 11, 16, 23, 59), MON)).toBe("today at 11:59 PM");
    expect(whenText(at(2026, 11, 17, 23, 59), MON)).toBe("tomorrow at 11:59 PM");
    expect(whenText(at(2026, 11, 20, 23, 59), MON)).toBe("Friday");
    expect(chipText(at(2026, 11, 17, 12), MON)).toBe("Tomorrow");
    expect(chipText(at(2026, 11, 19, 12), MON)).toBe("3 days");
    expect(daysUntil(at(2026, 11, 17, 1), at(2026, 11, 16, 23))).toBe(1);
  });
});

describe("one assignment, never listed twice", () => {
  const NOW = new Date(2026, 10, 27, 13, 0).getTime();
  const due = { due: "Fri, Dec 4, 11:59 PM", due_iso: "2026-12-04T23:59" };
  it("the class written two ways (Jake's Nov 27 log) = one item, with D2L's name", () => {
    let r = mergeScan(emptyRadar(), [{ title: "Journaling/Research Assignment", course: "Org Behavior & Strategy", ...due }], NOW - 86400e3);
    r = mergeScan(r, [{ title: "Journaling/Research Assignment", course: "Organizational Behavior and Strategy", ...due }], NOW);
    const u = upcoming(r, NOW);
    expect(u.length).toBe(1);
    expect(u[0].course).toBe("Organizational Behavior and Strategy");
  });
  it("a list that already has the copy saved cleans itself up", () => {
    const item = (course: string, lastSeen: number) => ({ id: course, title: "Journaling/Research Assignment", course, due: due.due, dueAt: parseDue(due.due_iso), kind: "assignment", firstSeen: 1, lastSeen, warned: {} });
    expect(upcoming({ items: [item("Org Behavior & Strategy", 1), item("Organizational Behavior and Strategy", 2)], scans: 2, lastScan: 2 }, NOW).map((x) => x.course)).toEqual(["Organizational Behavior and Strategy"]);
  });
  it("the class as a code, same title, same minute = one", () => {
    let r = mergeScan(emptyRadar(), [{ title: "Lab Report 4", course: "BIOL 10003", ...due }], NOW - 1000);
    r = mergeScan(r, [{ title: "Lab Report 4", course: "Contemporary Issues in Biology", ...due }], NOW);
    expect(upcoming(r, NOW).length).toBe(1);
  });
  it("different classes with the same assignment name stay two", () => {
    const r = mergeScan(emptyRadar(), [
      { title: "Homework 5", course: "Statistical Analysis", ...due },
      { title: "Homework 5", course: "Understanding the Earth", ...due, due_iso: "2026-12-04T17:00" },
    ], NOW);
    expect(upcoming(r, NOW).length).toBe(2);
  });
  it.each([
    ["Org Behavior & Strategy", "Organizational Behavior and Strategy", true],
    ["Stats", "Statistical Analysis", true],
    ["Bio", "Contemporary Issues in Biology", true],
    ["Statistical Analysis", "Understanding the Earth", false],
    ["American Writers", "Composition: Intro to Writing", false],
  ])("sameCourse(%s, %s) = %s", (a, b, want) => expect(sameCourse(a, b)).toBe(want));
});
