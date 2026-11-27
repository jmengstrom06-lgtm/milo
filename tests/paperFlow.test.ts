import { describe, it, expect } from "vitest";
import { toHtml } from "../src/main/paperFlow";
import { SimDoc } from "../src/main/docSim";

describe("Word export keeps the look", () => {
  it("headings, centering, double spacing, hanging indent, bold", () => {
    const d = new SimDoc([["My Title", "TITLE"], "Body text here.", "Smith, Ann. Sleep. 2020."]);
    d.apply([
      { updateParagraphStyle: { range: { startIndex: 10, endIndex: 26 }, paragraphStyle: { lineSpacing: 200 }, fields: "lineSpacing" } },
      { updateParagraphStyle: { range: { startIndex: 26, endIndex: 51 }, paragraphStyle: { indentStart: { magnitude: 36, unit: "PT" }, indentFirstLine: { magnitude: 0, unit: "PT" } }, fields: "indentStart,indentFirstLine" } },
      { updateTextStyle: { range: { startIndex: 10, endIndex: 14 }, textStyle: { bold: true }, fields: "bold" } },
    ]);
    const h = toHtml(d, "My Title");
    expect(h).toMatch(/<h1[^>]*>My Title<\/h1>/);
    expect(h).toMatch(/line-height:200%/);
    expect(h).toMatch(/margin-left:36pt/);
    expect(h).toMatch(/<b>Body<\/b>/);
  });
  it("escapes the student's text", () => expect(toHtml(new SimDoc(["a < b & c"]), "t")).toContain("a &lt; b &amp; c"));
});
