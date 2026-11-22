import { describe, expect, it } from "vitest";
import { countWords, docRequests, mlaDate, parsePaperAsk, wordsFrom } from "../src/main/paperFormat";
import { parse } from "../src/renderer/commands";

describe("paper asks", () => {
  it("topic, length, style", () => {
    expect(parsePaperAsk("Write a 5 page paper on the causes of World War 1 in APA")).toEqual({ topic: "the causes of World War 1", words: 1500, style: "APA", kind: "paper", mode: "full" });
    expect(parsePaperAsk("write me an essay about climate change, 1000 words")).toMatchObject({ topic: "climate change", words: 1000, style: "MLA", kind: "essay" });
    expect(parsePaperAsk("help me write a research paper on social media and sleep")).toMatchObject({ topic: "social media and sleep", mode: "outline", words: 2000 });
    expect(parsePaperAsk("write a paper")).toMatchObject({ topic: "" });
    expect(parsePaperAsk("write an email to my professor")).toBeNull();
  });
  it("words", () => {
    expect(wordsFrom("three page essay")).toBe(900);
    expect(wordsFrom("a short essay")).toBe(600);
    expect(wordsFrom("2,000 words")).toBe(2000);
    expect(wordsFrom("1500 word paper")).toBe(1500);
  });
  it("mla date", () => expect(mlaDate(new Date(2026, 10, 22))).toBe("22 November 2026"));
  it("counts words", () => expect(countWords("The economy's growth, in 2020, slowed.")).toBe(6));
});

describe("Google Docs layout", () => {
  it("indexes line up and Works Cited starts a new page", () => {
    const { requests, next } = docRequests(
      [
        { text: "Jake Engstrom", role: "header" },
        { text: "Title", role: "title" },
        { text: "Body one.", role: "body" },
        { text: "Works Cited", role: "cited_title" },
        { text: "Smith, Ann. Book.", role: "cited" },
      ],
      1,
      "MLA"
    ) as { requests: any[]; next: number };
    const text = requests[0].insertText.text as string;
    expect(next).toBe(1 + text.length);
    const styles = requests.filter((r) => r.updateParagraphStyle).map((r) => r.updateParagraphStyle);
    expect(styles[0].range).toEqual({ startIndex: 1, endIndex: 1 + "Jake Engstrom\n".length });
    expect(styles[1].paragraphStyle.alignment).toBe("CENTER");
    expect(styles[2].paragraphStyle.indentFirstLine.magnitude).toBe(36);
    expect(styles[3].paragraphStyle.pageBreakBefore).toBe(true);
    expect(styles[4].paragraphStyle.indentStart.magnitude).toBe(36);
    expect(styles.every((s) => s.paragraphStyle.lineSpacing === 200)).toBe(true);
  });
  it("skips empty paragraphs", () => expect(docRequests([{ text: "  ", role: "body" }], 1, "MLA").requests).toHaveLength(0));
});

describe("voice: paper requests", () => {
  const ctx = { inLesson: false, awaitingAnswer: false, pendingAsk: false };
  it.each(["write a 3 page paper on the french revolution", "Write me an essay about climate change", "help me write a research paper on sleep", "can you write a report on Tesla"])("%s", (t) => expect(parse(t, ctx).kind).toBe("paper"));
  it.each(["write an email to my professor", "proofread my essay", "check my paper"])("not: %s", (t) => expect(parse(t, ctx).kind).not.toBe("paper"));
});

import { citeEntry, citeList } from "../src/main/paperFormat";
describe("Works Cited", () => {
  const acc = new Date(2026, 10, 22);
  const s = { title: "Sleep and Health", author: "Centers for Disease Control and Prevention", site: "CDC", date: "2024-05-15", url: "https://www.cdc.gov/sleep/about/index.html" };
  it("MLA", () => expect(citeEntry(s, "MLA", acc)).toBe('Centers for Disease Control and Prevention. "Sleep and Health." CDC, 15 May 2024, www.cdc.gov/sleep/about/index.html.'));
  it("MLA, no date = accessed", () => expect(citeEntry({ title: "Sleep", url: "https://sleep.org/x" }, "MLA", acc)).toBe('"Sleep." sleep.org, sleep.org/x. Accessed 22 Nov. 2026.'));
  it("APA", () => expect(citeEntry(s, "APA", acc)).toBe("Centers for Disease Control and Prevention. (2024, May 15). Sleep and Health. CDC. https://www.cdc.gov/sleep/about/index.html"));
  it("sorted, no duplicates", () => expect(citeList([s, { title: "Alpha", url: "https://a.org" }, s], "MLA", acc).map((x) => x.slice(0, 7))).toEqual(['"Alpha.', "Centers"]));
});
