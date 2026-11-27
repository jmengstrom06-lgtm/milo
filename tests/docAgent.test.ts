import { describe, it, expect } from "vitest";
import { applyPlan, undoChanges, type Plan, type Op } from "../src/main/docAgent";
import { SimDoc } from "../src/main/docSim";

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

describe("formatting, and nothing ever lost", () => {
  const styled = () => {
    const d = new SimDoc(PAPER);
    // the student's own formatting: a centered bold title, an italic word, a bold phrase
    d.apply([
      { updateParagraphStyle: { range: { startIndex: 1, endIndex: 19 }, paragraphStyle: { alignment: "CENTER" }, fields: "alignment" } },
      { updateTextStyle: { range: { startIndex: 1, endIndex: 18 }, textStyle: { bold: true }, fields: "bold" } },
    ]);
    const p3 = d.content()[2];
    const s = (p3.startIndex ?? 0) + "First, ".length;
    d.apply([{ updateTextStyle: { range: { startIndex: s, endIndex: s + 5 }, textStyle: { italic: true }, fields: "italic" } }]);
    return d;
  };
  it("double space + Times New Roman 12 on the whole paper, undone exactly", async () => {
    const d = styled();
    const before = d.full();
    const r = await applyPlan(d.io(), plan([{ op: "format", target: "all", format: { lineSpacing: 200, font: "Times New Roman", size: 12 } }]));
    expect(r.skipped).toEqual([]);
    for (const p of d.full()) {
      expect(p.ps.lineSpacing).toBe(200);
      for (const run of p.runs) expect(run.ts.weightedFontFamily).toMatchObject({ fontFamily: "Times New Roman" });
    }
    expect(d.full()[0].runs[0].ts.bold).toBe(true); // the student's bold title stays bold
    await undoChanges(d.io(), r.changes);
    expect(d.full()).toEqual(before);
  });
  it("bold one phrase, undone exactly", async () => {
    const d = styled();
    const before = d.full();
    const r = await applyPlan(d.io(), plan([{ op: "format", para: 4, find: "not sleeping", format: { bold: true } }]));
    expect(d.full()[3].runs.find((x) => x.text === "not sleeping")?.ts.bold).toBe(true);
    await undoChanges(d.io(), r.changes);
    expect(d.full()).toEqual(before);
  });
  it("delete a formatted paragraph, undo brings back its formatting", async () => {
    const d = styled();
    const before = d.full();
    const r = await applyPlan(d.io(), plan([{ op: "delete", para: 1 }, { op: "delete", para: 3 }]));
    expect(d.full().length).toBe(3);
    await undoChanges(d.io(), r.changes);
    expect(d.full()).toEqual(before);
  });
  it("rewrite a paragraph with an italic word, undo brings the italic back", async () => {
    const d = styled();
    const before = d.full();
    const r = await applyPlan(d.io(), plan([{ op: "rewrite_paragraph", para: 3, text: "First, rest is how students learn best." }]));
    await undoChanges(d.io(), r.changes);
    expect(d.full()).toEqual(before);
  });
  it("move keeps the paragraph's formatting, and undoes exactly", async () => {
    const d = styled();
    const before = d.full();
    const r = await applyPlan(d.io(), plan([{ op: "move", para: 1, after: 5 }]));
    const last = d.full()[4];
    expect(last.text).toBe("Why Sleep Matters");
    expect(last.ps.alignment).toBe("CENTER");
    expect(last.runs[0].ts.bold).toBe(true);
    await undoChanges(d.io(), r.changes);
    expect(d.full()).toEqual(before);
  });
  it("new text after a bold title isn't bold; a Works Cited entry gets a hanging indent", async () => {
    const d = styled();
    await applyPlan(d.io(), plan([
      { op: "insert", after: 1, paragraphs: [{ text: "A new opening line." }] },
      { op: "insert", after: 5, paragraphs: [{ text: "Works Cited", align: "CENTER" }, { text: "Smith, Ann. Sleep. 2020.", hanging: true }] },
    ]));
    const f = d.full();
    expect(f[1].runs[0].ts.bold).toBeUndefined();
    expect(f[f.length - 2].ps.alignment).toBe("CENTER");
    expect(f[f.length - 1].ps.indentStart).toMatchObject({ magnitude: 36 });
  });
  it("a big mixed request undoes to the exact original", async () => {
    const d = styled();
    const before = d.full();
    const r = await applyPlan(d.io(), plan([
      { op: "format", target: "all", format: { lineSpacing: 200, firstLineIndent: 36 } },
      { op: "replace_text", para: 3, find: "learn", replace: "learn and remember" },
      { op: "insert", after: 5, paragraphs: [{ text: "Works Cited", align: "CENTER" }, { text: "Smith, Ann. Sleep. 2020.", hanging: true }] },
      { op: "move", para: 4, after: 2 },
      { op: "format", para: 1, format: { align: "START", bold: false } },
      { op: "set_style", para: 5, style: "HEADING_2" },
    ]));
    expect(r.skipped).toEqual([]);
    const u = await undoChanges(d.io(), r.changes);
    expect(u.missed).toBe(0);
    expect(d.full()).toEqual(before);
  });
});

import { redoChanges } from "../src/main/docAgent";
describe("preview on a copy, then write to the real doc: identical result", () => {
  const styledDoc = () => {
    const d = new SimDoc(PAPER);
    d.apply([
      { updateParagraphStyle: { range: { startIndex: 1, endIndex: 19 }, paragraphStyle: { alignment: "CENTER" }, fields: "alignment" } },
      { updateTextStyle: { range: { startIndex: 1, endIndex: 18 }, textStyle: { bold: true }, fields: "bold" } },
    ]);
    return d;
  };
  const PLANS: Op[][] = [
    [{ op: "insert", after: 5, paragraphs: [{ text: "My Thoughts", style: "HEADING_1" }, { text: "I think sleep is underrated." }] }],
    [{ op: "replace_text", para: 2, find: "Alot", replace: "A lot" }, { op: "rewrite_paragraph", para: 4, text: "Second, a lack of sleep affects a student's mood." }, { op: "move", para: 5, after: 1 }, { op: "delete", para: 3 }, { op: "set_style", para: 1, style: "HEADING_1" }],
    [{ op: "format", target: "all", format: { lineSpacing: 200, font: "Times New Roman", size: 12, firstLineIndent: 36 } }, { op: "format", para: 1, format: { align: "START", bold: false } }],
    [{ op: "insert", after: 5, paragraphs: [{ text: "Works Cited", align: "CENTER" }, { text: "Smith, Ann. Sleep. 2020.", hanging: true }] }, { op: "replace_text", para: 3, find: "learn.", replace: "learn (Smith)." }],
    [{ op: "delete", para: 5 }, { op: "insert", after: 0, paragraphs: [{ text: "Jake Engstrom" }, { text: "Professor Hayes" }] }, { op: "move", para: 1, after: 4 }],
  ];
  PLANS.forEach((ops, i) =>
    it(`plan ${i + 1}`, async () => {
      const a = styledDoc();
      const r = await applyPlan(a.io(), plan(ops));
      const b = styledDoc();
      const before = b.full();
      const w = await redoChanges(b.io(), r.changes);
      expect(w.missed).toEqual([]);
      expect(b.full()).toEqual(a.full());
      await undoChanges(b.io(), w.done);
      expect(b.full()).toEqual(before);
    })
  );
  it("rejecting one change still writes the rest", async () => {
    const a = styledDoc();
    const r = await applyPlan(a.io(), plan([{ op: "replace_text", para: 2, find: "Alot", replace: "A lot" }, { op: "insert", after: 5, paragraphs: [{ text: "Extra." }] }, { op: "set_style", para: 3, style: "HEADING_2" }]));
    const b = styledDoc();
    const keep = r.changes.filter((c) => c.group !== r.changes[0].group);
    const w = await redoChanges(b.io(), keep);
    expect(w.missed).toEqual([]);
    expect(b.paras().map((p) => p[0])).toContain("Extra.");
    expect(b.paras()[1][0]).toContain("Alot");
    expect(b.paras()[2][1]).toBe("HEADING_2");
  });
  it("a copy of a real doc matches it", () => {
    const a = styledDoc();
    expect(SimDoc.fromContent(a.content()).full()).toEqual(a.full());
  });
});

describe("no busywork", () => {
  it("formatting that's already there is skipped, not repeated", async () => {
    const d = new SimDoc(PAPER);
    const r1 = await applyPlan(d.io(), plan([{ op: "format", target: "all", format: { lineSpacing: 200, firstLineIndent: 36 } }]));
    expect(r1.changes.length).toBe(1);
    const r2 = await applyPlan(d.io(), plan([{ op: "format", target: "all", format: { lineSpacing: 200, firstLineIndent: 36 } }, { op: "format", para: 2, format: { lineSpacing: 200 } }]));
    expect(r2.changes.length).toBe(0);
    expect(r2.skipped.map((s) => s.why)).toEqual(["already formatted that way", "already formatted that way"]);
  });
});

describe("bullet and numbered lists", () => {
  const withList = () => {
    const d = new SimDoc(["Tips for better sleep:", "Go to bed at the same time.", "Put the phone away.", "Skip late caffeine.", "That's it."]);
    const c = d.content();
    d.apply([{ createParagraphBullets: { range: { startIndex: c[1].startIndex, endIndex: c[3].endIndex }, bulletPreset: "BULLET_DISC_CIRCLE_SQUARE" } }]);
    return d;
  };
  const bullets = (d: SimDoc) => d.full().map((p) => p.bullet ?? "-");
  it("makes paragraphs a numbered list, and undoes it exactly", async () => {
    const d = new SimDoc(PAPER);
    const before = d.full();
    const r = await applyPlan(d.io(), plan([2, 3, 4].map((n) => ({ op: "format", para: n, format: { list: "numbered" } }) as Op)));
    expect(bullets(d)).toEqual(["-", "numbered", "numbered", "numbered", "-"]);
    await undoChanges(d.io(), r.changes);
    expect(d.full()).toEqual(before);
  });
  it("adds list items in a new section", async () => {
    const d = new SimDoc(PAPER);
    await applyPlan(d.io(), plan([{ op: "insert", after: 5, paragraphs: [{ text: "Key steps", style: "HEADING_2" }, { text: "Sleep 8 hours.", list: "bullet" }, { text: "No screens late.", list: "bullet" }] }]));
    expect(bullets(d).slice(-3)).toEqual(["-", "bullet", "bullet"]);
  });
  it("a line added after a list item is NOT a list item unless asked", async () => {
    const d = withList();
    await applyPlan(d.io(), plan([{ op: "insert", after: 4, paragraphs: [{ text: "Those three habits matter most." }] }]));
    expect(bullets(d)).toEqual(["-", "bullet", "bullet", "bullet", "-", "-"]);
  });
  it("a new item added inside a list joins it", async () => {
    const d = withList();
    await applyPlan(d.io(), plan([{ op: "insert", after: 3, paragraphs: [{ text: "Keep the room cool.", list: "bullet" }] }]));
    expect(bullets(d)).toEqual(["-", "bullet", "bullet", "bullet", "bullet", "-"]);
  });
  it("list back to prose, deleting and moving list items: all undo exactly, and the copy matches the real doc", async () => {
    const a = withList();
    const before = a.full();
    const r = await applyPlan(a.io(), plan([
      { op: "move", para: 4, after: 1 },
      { op: "format", para: 2, format: { list: "none" } },
      { op: "delete", para: 3 },
      { op: "insert", after: 5, paragraphs: [{ text: "Bonus tip.", list: "numbered" }] },
    ]));
    expect(r.skipped).toEqual([]);
    const b = withList();
    const w = await redoChanges(b.io(), r.changes);
    expect(w.missed).toEqual([]);
    expect(b.full()).toEqual(a.full());
    await undoChanges(a.io(), r.changes);
    expect(a.full()).toEqual(before);
  });
  it("deleting a list item at the very end leaves the line above as it was", async () => {
    const d = new SimDoc(["Intro.", "One.", "Two."]);
    const c = d.content();
    d.apply([{ createParagraphBullets: { range: { startIndex: c[2].startIndex, endIndex: c[2].endIndex }, bulletPreset: "BULLET_DISC_CIRCLE_SQUARE" } }]);
    const r = await applyPlan(d.io(), plan([{ op: "delete", para: 3 }]));
    expect(bullets(d)).toEqual(["-", "-"]);
    await undoChanges(d.io(), r.changes);
    expect(bullets(d)).toEqual(["-", "-", "bullet"]);
  });
});
