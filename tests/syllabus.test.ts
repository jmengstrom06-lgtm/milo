import { describe, expect, it, vi } from "vitest";
import zlib from "node:zlib";
vi.mock("electron", () => ({ app: { getPath: () => "/tmp", on: () => {} }, session: { fromPartition: () => ({}) }, BrowserWindow: class {} }));
vi.mock("../src/main/blackbox", () => ({ log: () => {} }));
vi.mock("../src/main/brain", () => ({ callTool: async () => ({ ok: false, text: "x" }), persona: () => "" }));
import { docxText, parseScale } from "../src/main/syllabus";

describe("grade scale from a syllabus", () => {
  it("Jake's stats syllabus (table)", () => {
    const t = "Grading Scale | This course uses plus/minus grading. | Grade | Undergraduate | A | 94–100 | A- | 90–93.99 | B+ | 87–89.99 | B | 84–86.99 | B- | 80–83.99 | C+ | 77–79.99 | C | 74–76.99 | C- | 70–73.99 | D | 60–69.99 | F | 0–59.99";
    const s = parseScale(t)!;
    expect(s.find((x) => x.letter === "A")!.min).toBe(94);
    expect(s.find((x) => x.letter === "A-")!.min).toBe(90);
    expect(s.find((x) => x.letter === "B")!.min).toBe(84);
  });
  it("other common ways", () => {
    expect(parseScale("A: 90-100%\nB: 80-89%\nC: 70-79%\nD: 60-69%")!.map((x) => x.min)).toEqual([90, 80, 70, 60]);
    expect(parseScale("A = 93% and above, A- = 90%, B+ = 87%")).toBeTruthy();
    expect(parseScale("A 100-93 A- 92-90 B+ 89-87 B 86-83")!.find((x) => x.letter === "A")!.min).toBe(93);
    expect(parseScale("Exam 1 25 Exam 2 25 Homework 20")).toBeNull();
  });
  it("reads a Word file", () => {
    const xml = '<w:document><w:body><w:p><w:r><w:t>Grading Scale</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:t>A</w:t></w:p></w:tc><w:tc><w:p><w:t>94–100</w:t></w:p></w:tc></w:tr></w:tbl></w:body></w:document>';
    const data = zlib.deflateRawSync(Buffer.from(xml));
    const name = Buffer.from("word/document.xml");
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(8, 8); h.writeUInt32LE(data.length, 18); h.writeUInt16LE(name.length, 26); h.writeUInt16LE(0, 28);
    const text = docxText(Buffer.concat([h, name, data]));
    expect(text).toContain("Grading Scale");
    expect(text.replace(/\s+/g, " ")).toMatch(/A \| 94–100/);
  });
});
