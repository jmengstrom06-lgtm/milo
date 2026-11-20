import { describe, it, expect } from "vitest";
import { alertLine, chipText, emptyRadar, markWarned, mergeScan, parseDue, pendingAlerts, upcoming, whenText, daysUntil } from "../src/renderer/radar";

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
