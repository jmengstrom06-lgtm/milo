import { describe, expect, it } from "vitest";
import { docIdFrom, flatten, locate, plan, requestsFor, undoOf, type DocEl } from "../src/main/docEdit";
import { citeLine, inText, styleOf, type Source } from "../src/main/citations";
import { editBrief } from "../src/main/writing";

// a tiny Google Doc: title paragraph, two body paragraphs (indexes as the Docs API gives them)
const doc = (paras: string[]): DocEl[] => {
  let i = 1;
  return paras.map((p) => {
    const s = p + "\n";
    const el = { startIndex: i, endIndex: i + s.length, paragraph: { elements: [{ startIndex: i, textRun: { content: s } }] } };
    i += s.length;
    return el;
  });
};
const D = doc(["Sleep and Grades", "Students who sleeps less get worse grades. This is a big problem.", "In conclusion, sleep matters alot."]);

describe("editing a doc in place", () => {
  it("maps text to Docs indexes", () => {
    const f = flatten(D);
    expect(f.text.startsWith("Sleep and Grades\n")).toBe(true);
    expect(f.at[0]).toBe(1);
    expect(f.at[f.text.indexOf("Students")]).toBe(18);
  });
  it("finds text once, ignoring curly vs straight quotes", () => {
    const f = flatten(doc(["It’s “fine” here.", "Other text."]));
    expect(locate(f, `It's "fine" here.`)).toEqual({ from: 0, to: 17 });
    expect(locate(flatten(doc(["a cat", "a cat"])), "a cat")).toBeNull(); // twice = ambiguous
  });
  it("plans edits bottom-up and drops unsafe ones", () => {
    const f = flatten(D);
    const { ok, dropped } = plan(f, [
      { find: "Students who sleeps less get worse grades.", replace: "Students who sleep less get worse grades.", why: "agreement" },
      { find: "sleep matters alot.", replace: "sleep matters a lot.", why: "spelling" },
      { find: "not in the doc", replace: "x", why: "?" },
      { find: "This is a big problem.", replace: "This is a big problem.", why: "same" },
      { find: "Grades\nStudents", replace: "x", why: "two paragraphs" },
    ]);
    expect(ok.map((p) => p.why)).toEqual(["spelling", "agreement"]); // bottom first
    expect(dropped.map((d) => d.reason).sort()).toEqual(["no change", "not found once", "spans paragraphs"]);
    const r = requestsFor(ok[1]) as { deleteContentRange?: unknown; insertText?: { location: { index: number }; text: string } }[];
    expect(r[0].deleteContentRange).toEqual({ range: { startIndex: 18, endIndex: 18 + "Students who sleeps less get worse grades.".length } });
    expect(r[1].insertText?.text).toBe("Students who sleep less get worse grades.");
  });
  it("overlapping edits: only the first is kept", () => {
    const { ok, dropped } = plan(flatten(D), [
      { find: "This is a big problem.", replace: "That's a real problem.", why: "a" },
      { find: "a big problem", replace: "an issue", why: "b" },
    ]);
    expect(ok).toHaveLength(1);
    expect(dropped[0].reason).toBe("overlaps another edit");
  });
  it("undo swaps new text back for old", () => {
    expect(undoOf([{ find: "alot", replace: "a lot", why: "x" }])).toEqual([{ find: "a lot", replace: "alot", why: "undo", kind: "undo" }]);
  });
  it("reads the doc id from a Google Docs link", () => {
    expect(docIdFrom("https://docs.google.com/document/d/1AbC_dEf-1234567890abcdefXYZ/edit?tab=t.0")).toBe("1AbC_dEf-1234567890abcdefXYZ");
    expect(docIdFrom("https://docs.google.com/document/u/1/d/1AbC_dEf-1234567890abcdefXYZ/edit")).toBe("1AbC_dEf-1234567890abcdefXYZ");
    expect(docIdFrom("https://google.com")).toBeNull();
  });
  it("turns what the student said into editing instructions", () => {
    expect(editBrief("just fix the grammar")).toMatch(/only grammar/i);
    expect(editBrief("edit my intro")).toMatch(/Only the introduction/);
    expect(editBrief("cut it to 800 words")).toMatch(/about 800 words/);
    expect(editBrief("make it sound less like AI")).toMatch(/real student/);
    expect(editBrief("edit my paper", "Thesis 20pts")).toMatch(/rubric/);
  });
});

const art: Source = { kind: "article", title: "Sleep and academic performance in college students", authors: ["Jane Q. Smith", "Ravi Lee", "Ana Gomez"], year: 2021, container: "Journal of Sleep Research", volume: "30", issue: "4", pages: "e13252", doi: "10.1111/jsr.13252", url: "https://doi.org/10.1111/jsr.13252" };
const web: Source = { kind: "web", title: "Sleep and Sleep Disorders", authors: ["Centers for Disease Control and Prevention"], site: "CDC", date: "2022-09-13", url: "https://www.cdc.gov/sleep/index.html" };

describe("citations", () => {
  it("MLA 9 journal article", () => {
    expect(citeLine(art, "MLA")).toBe('Smith, Jane Q., et al. "Sleep and academic performance in college students." Journal of Sleep Research, vol. 30, no. 4, 2021, pp. e13252, https://doi.org/10.1111/jsr.13252.');
  });
  it("APA 7 journal article", () => {
    expect(citeLine(art, "APA")).toBe("Smith, J. Q., Lee, R., & Gomez, A. (2021). Sleep and academic performance in college students. Journal of Sleep Research, 30(4), e13252. https://doi.org/10.1111/jsr.13252");
  });
  it("web pages with an organization as author", () => {
    expect(citeLine(web, "APA")).toBe("Centers for Disease Control and Prevention. (2022, September 13). Sleep and Sleep Disorders. CDC. https://www.cdc.gov/sleep/index.html");
    expect(citeLine(web, "MLA")).toMatch(/^Centers for Disease Control and Prevention\. "Sleep and Sleep Disorders\." CDC, 13 Sept\. 2022, www\.cdc\.gov/);
  });
  it("in-text citations", () => {
    expect(inText(art, "MLA")).toBe("(Smith et al.)");
    expect(inText(art, "APA")).toBe("(Smith et al., 2021)");
    expect(inText({ ...art, authors: ["Jane Smith", "Ravi Lee"] }, "APA")).toBe("(Smith & Lee, 2021)");
    expect(inText(web, "MLA")).toBe("(Centers for Disease Control and Prevention)");
  });
  it("picks the style: asked, then the paper, then MLA", () => {
    expect(styleOf("cite this in apa")).toBe("APA");
    expect(styleOf("find sources", "Intro...\nReferences\nSmith")).toBe("APA");
    expect(styleOf("find sources", "As shown (Smith, 2020).")).toBe("APA");
    expect(styleOf("find sources", "plain text")).toBe("MLA");
  });
});
