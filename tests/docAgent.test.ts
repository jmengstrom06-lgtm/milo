import { describe, it, expect } from "vitest";
import { applyPlan, undoChanges, type Plan, type Op } from "../src/main/docAgent";
import { SimDoc } from "./docSim";

const PAPER: (string | [string, string])[] = [
  ["Why Sleep Matters", "TITLE"],
  "Alot of college students dont get enough sleep.",
  "First, sleep helps students learn.",
  "Second, not sleeping effects a students mood.",
  "In conclusion, sleep is really important.",
];
const plan = (ops: Op[]): Plan => ({ understood: "", answer: "", ops, summary: "", cant: "", notes: [] });
const texts = (d: SimDoc) => d.paras().map((p) => p[0]);

describe("the doc agent's actions, on a simulated Google Doc", () => {
  it("adds a section with a heading after the whole paper", async () => {
    const d = new SimDoc(PAPER);
    const r = await applyPlan(d.io(), plan([{ op: "insert", after: 5, paragraphs: [{ text: "My Thoughts", style: "HEADING_1" }, { text: "I think sleep is underrated." }] }]));
    expect(r.skipped).toEqual([]);
    expect(d.paras().slice(-2)).toEqual([["My Thoughts", "HEADING_1"], ["I think sleep is underrated.", "NORMAL_TEXT"]]);
    expect(texts(d).slice(0, 5)).toEqual(PAPER.map((p) => (typeof p === "string" ? p : p[0])));
  });
  it("adds at the very top", async () => {
    const d = new SimDoc(PAPER);
    await applyPlan(d.io(), plan([{ op: "insert", after: 0, paragraphs: [{ text: "Draft 2" }] }]));
    expect(d.paras()[0]).toEqual(["Draft 2", "NORMAL_TEXT"]);
    expect(d.paras()[1]).toEqual(["Why Sleep Matters", "TITLE"]);
  });
  it("adds in the middle, and two adds after the same spot stay in order", async () => {
    const d = new SimDoc(PAPER);
    await applyPlan(d.io(), plan([
      { op: "insert", after: 3, paragraphs: [{ text: "Also, sleep helps memory." }] },
      { op: "insert", after: 3, paragraphs: [{ text: "And it helps focus." }] },
    ]));
    expect(texts(d).slice(3, 6)).toEqual(["Also, sleep helps memory.", "And it helps focus.", "Second, not sleeping effects a students mood."]);
  });
  it("fixes words, rewrites, deletes, moves and restyles", async () => {
    const d = new SimDoc(PAPER);
    const r = await applyPlan(d.io(), plan([
      { op: "replace_text", para: 2, find: "Alot", replace: "A lot" },
      { op: "replace_text", para: 2, find: "dont", replace: "don't" },
      { op: "rewrite_paragraph", para: 4, text: "Second, a lack of sleep affects a student's mood." },
      { op: "move", para: 5, after: 1 },
      { op: "delete", para: 3 },
      { op: "set_style", para: 1, style: "HEADING_1" },
    ]));
    expect(r.skipped).toEqual([]);
    expect(d.paras()).toEqual([
      ["Why Sleep Matters", "HEADING_1"],
      ["In conclusion, sleep is really important.", "NORMAL_TEXT"],
      ["A lot of college students don't get enough sleep.", "NORMAL_TEXT"],
      ["Second, a lack of sleep affects a student's mood.", "NORMAL_TEXT"],
    ]);
  });
  it("deleting the last paragraph keeps the doc valid", async () => {
    const d = new SimDoc(PAPER);
    await applyPlan(d.io(), plan([{ op: "delete", para: 5 }]));
    expect(texts(d)).toEqual(PAPER.slice(0, 4).map((p) => (typeof p === "string" ? p : p[0])));
  });
  it("undo puts the doc back exactly: text AND styles", async () => {
    const d = new SimDoc(PAPER);
    const before = d.paras();
    const r = await applyPlan(d.io(), plan([
      { op: "replace_text", para: 2, find: "Alot", replace: "A lot" },
      { op: "rewrite_paragraph", para: 4, text: "Second, a lack of sleep affects a student's mood." },
      { op: "insert", after: 5, paragraphs: [{ text: "My Thoughts", style: "HEADING_1" }, { text: "I think sleep is underrated." }] },
      { op: "move", para: 3, after: 5 },
      { op: "delete", para: 2 },
      { op: "set_style", para: 1, style: "HEADING_2" },
    ]));
    expect(d.paras()).not.toEqual(before);
    const u = await undoChanges(d.io(), r.changes);
    expect(u.missed).toBe(0);
    expect(d.paras()).toEqual(before);
  });
  it("undo still works after the student typed somewhere else", async () => {
    const d = new SimDoc(PAPER);
    const r = await applyPlan(d.io(), plan([{ op: "insert", after: 5, paragraphs: [{ text: "My Thoughts" }] }, { op: "replace_text", para: 3, find: "learn", replace: "learn and remember" }]));
    d.apply([{ insertText: { location: { index: 1 }, text: "Jake Engstrom\n" } }]); // the student adds their name on top
    const u = await undoChanges(d.io(), r.changes);
    expect(u.missed).toBe(0);
    expect(texts(d)).toEqual(["Jake Engstrom", ...PAPER.map((p) => (typeof p === "string" ? p : p[0]))]);
  });
  it("undo one change only", async () => {
    const d = new SimDoc(PAPER);
    const r = await applyPlan(d.io(), plan([{ op: "replace_text", para: 2, find: "Alot", replace: "A lot" }, { op: "insert", after: 5, paragraphs: [{ text: "Extra." }] }]));
    await undoChanges(d.io(), [r.changes[1]]);
    expect(texts(d)).toEqual(["Why Sleep Matters", "A lot of college students dont get enough sleep.", "First, sleep helps students learn.", "Second, not sleeping effects a students mood.", "In conclusion, sleep is really important."]);
  });
  it("old-style edits (from before) still undo", async () => {
    const d = new SimDoc(["Their nights are short."]);
    await undoChanges(d.io(), [{ find: "There nights", replace: "Their nights", why: "" } as never]);
    expect(texts(d)).toEqual(["There nights are short."]);
  });
  it("bad actions are skipped, never break the doc", async () => {
    const d = new SimDoc(PAPER);
    const r = await applyPlan(d.io(), plan([{ op: "replace_text", para: 2, find: "not in there", replace: "x" }, { op: "delete", para: 99 }, { op: "insert", after: 5, paragraphs: [] }]));
    expect(r.changes.length).toBe(0);
    expect(r.skipped.length).toBe(3);
    expect(d.paras()).toEqual(new SimDoc(PAPER).paras());
  });
});
