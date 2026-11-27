import { describe, it, expect } from "vitest";
import { paperRows, wordDiff } from "../src/main/paperDiff";
import { applyPlan, type Op } from "../src/main/docAgent";
import { SimDoc } from "../src/main/docSim";

const PAPER: (string | [string, string])[] = [["Why Sleep Matters", "TITLE"], "Alot of students dont sleep.", "First, sleep helps students learn.", "Second, not sleeping effects mood.", "In conclusion, sleep matters."];
async function rows(ops: Op[]) {
  const a = new SimDoc(PAPER);
  const before = a.full();
  const r = await applyPlan(a.io(), { understood: "", answer: "", ops, summary: "", cant: "", notes: [] });
  return paperRows(before, a.full(), r.changes);
}
const kinds = (rs: Awaited<ReturnType<typeof rows>>) => rs.map((r) => r.kind);

describe("the paper panel's view", () => {
  it("word diff reads old then new", () => {
    const d = wordDiff("Alot of students dont sleep.", "A lot of students don't sleep.");
    expect(d.filter((s) => s.op !== "+").map((s) => s.t).join("")).toBe("Alot of students dont sleep.");
    expect(d.filter((s) => s.op !== "-").map((s) => s.t).join("")).toBe("A lot of students don't sleep.");
    expect(d.map((s) => `${s.op}${s.t.trim()}`)).toEqual(["-Alot", "+A lot", "=of students", "-dont", "+don't", "=sleep."]);
  });
  it("no changes = all kept", async () => expect(kinds(await rows([]))).toEqual(["same", "same", "same", "same", "same"]));
  it("fixes show inside the paragraph", async () => {
    const rs = await rows([{ op: "replace_text", para: 2, find: "Alot", replace: "A lot" }]);
    expect(kinds(rs)).toEqual(["same", "changed", "same", "same", "same"]);
    expect(rs[1].segs?.some((s) => s.op === "+" && s.t.trim() === "A lot")).toBe(true);
    expect(rs[1].groups.length).toBe(1);
  });
  it("a new section shows where it goes", async () => {
    const rs = await rows([{ op: "insert", after: 5, paragraphs: [{ text: "My Thoughts", style: "HEADING_1" }, { text: "Sleep is underrated." }] }]);
    expect(kinds(rs)).toEqual(["same", "same", "same", "same", "same", "added", "added"]);
    expect(rs[5].style).toBe("HEADING_1");
    expect(rs[5].groups).toEqual(rs[6].groups);
  });
  it("a deleted paragraph shows crossed out in its old spot", async () => {
    const rs = await rows([{ op: "delete", para: 3 }]);
    expect(kinds(rs)).toEqual(["same", "same", "removed", "same", "same"]);
    expect(rs[2].groups.length).toBe(1);
  });
  it("a moved paragraph: gone from the old spot, added at the new one, one group", async () => {
    const rs = await rows([{ op: "move", para: 5, after: 1 }]);
    const added = rs.find((r) => r.kind === "added");
    const removed = rs.find((r) => r.kind === "removed");
    expect(added?.text).toBe("In conclusion, sleep matters.");
    expect(removed?.text).toBe("In conclusion, sleep matters.");
    expect(rs.indexOf(added!)).toBe(1);
  });
  it("a rewrite pairs old and new", async () => {
    const rs = await rows([{ op: "rewrite_paragraph", para: 4, text: "Second, a lack of sleep affects students' mood." }]);
    expect(kinds(rs)).toEqual(["same", "same", "same", "changed", "same"]);
  });
  it("formatting the whole paper tags every paragraph", async () => {
    const rs = await rows([{ op: "format", target: "all", format: { lineSpacing: 200, align: "JUSTIFIED" } }]);
    expect(rs.every((r) => r.kind === "restyled" && r.tags.includes("double spaced"))).toBe(true);
    expect(new Set(rs.flatMap((r) => r.groups)).size).toBe(1);
  });
  it("several changes, each row knows its own", async () => {
    const rs = await rows([
      { op: "replace_text", para: 2, find: "dont", replace: "don't" },
      { op: "set_style", para: 3, style: "HEADING_2" },
      { op: "insert", after: 5, paragraphs: [{ text: "Works Cited" }] },
    ]);
    const gs = rs.filter((r) => r.kind !== "same").map((r) => r.groups[0]);
    expect(new Set(gs).size).toBe(3);
  });
});
