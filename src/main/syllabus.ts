// Syllabi, read straight from D2L: finds each class's syllabus in its Content (Word, PDF or a D2L page),
// pulls the letter-grade scale (A = 94+ in Stats, not the usual 90), and for classes that don't post grades
// in D2L, the grade weights too. Read once per class, then remembered.

import zlib from "node:zlib";
import { log as bb } from "./blackbox";
import { contentTopics, fileBase64, type Course } from "./d2l";
import { findBook, readSyllabus, setScheme } from "./gradebook";

export type Scale = { letter: string; min: number }[];

/** The words in a Word file (no library: a .docx is a zip, the text is word/document.xml). */
export function docxText(buf: Buffer): string {
  for (let i = 0; i < buf.length - 30; i++) {
    if (buf.readUInt32LE(i) !== 0x04034b50) continue;
    const method = buf.readUInt16LE(i + 8);
    const size = buf.readUInt32LE(i + 18);
    const nlen = buf.readUInt16LE(i + 26);
    const xlen = buf.readUInt16LE(i + 28);
    const name = buf.toString("utf8", i + 30, i + 30 + nlen);
    if (name !== "word/document.xml") continue;
    const data = buf.subarray(i + 30 + nlen + xlen, i + 30 + nlen + xlen + size);
    const xml = method === 0 ? data.toString("utf8") : zlib.inflateRawSync(data).toString("utf8");
    return xml
      .replace(/<\/w:tc>/g, " | ")
      .replace(/<\/w:p>/g, "\n")
      .replace(/<w:tab\/>/g, " ")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/[ \t]+/g, " ");
  }
  return "";
}

const LETTERS = ["A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D+", "D", "D-", "F"];
/** "A | 94–100 | A- | 90–93.99 | B+ | 87–89.99 ..." -> [{A,94},{A-,90},{B+,87}...]. No AI. Null if no clear scale. */
export function parseScale(text: string): Scale | null {
  const t = text.replace(/[–—]/g, "-").replace(/\s+/g, " ");
  const found = new Map<string, number>();
  const re = /(?:^|[\s|(:,])([A-DF][+-]?)\s*[|:=(,]?\s*(?:\(?\s*)?(\d{2}(?:\.\d+)?)\s*%?\s*(?:-|to|and above|\+|or (?:higher|above)|%? ?-)\s*(\d{2,3}(?:\.\d+)?)?/g;
  for (const m of t.matchAll(re)) {
    const letter = m[1].toUpperCase();
    const a = +m[2];
    const b = m[3] ? +m[3] : 100;
    if (!LETTERS.includes(letter) || a < 40 || a > 100 || b < a || b > 100.5) continue;
    if (!found.has(letter)) found.set(letter, a);
  }
  // range written high-to-low ("A 100-94")
  if (found.size < 3) {
    for (const m of t.matchAll(/(?:^|[\s|(:,])([A-DF][+-]?)\s*[|:=(,]?\s*(\d{2,3}(?:\.\d+)?)\s*%?\s*-\s*(\d{2}(?:\.\d+)?)/g)) {
      const letter = m[1].toUpperCase();
      const hi = +m[2];
      const lo = +m[3];
      if (LETTERS.includes(letter) && hi > lo && lo >= 40 && hi <= 100.5 && !found.has(letter)) found.set(letter, lo);
    }
  }
  // single cutoffs: "A = 93% and above, A- = 90%, B+ = 87%"
  if (found.size < 3) {
    for (const m of t.matchAll(/(?:^|[\s|(:,])([A-DF][+-]?)\s*(?:=|:|is)\s*(\d{2}(?:\.\d+)?)\s*%/g)) {
      const letter = m[1].toUpperCase();
      if (LETTERS.includes(letter) && !found.has(letter) && +m[2] >= 40 && +m[2] <= 100) found.set(letter, +m[2]);
    }
  }
  if (!found.has("A") || found.size < 3) return null;
  const scale = [...found.entries()].map(([letter, min]) => ({ letter, min }));
  // sanity: better letters need higher scores
  const order = (l: string) => LETTERS.indexOf(l);
  const sorted = [...scale].sort((x, y) => order(x.letter) - order(y.letter));
  for (let i = 1; i < sorted.length; i++) if (sorted[i].min > sorted[i - 1].min) return null;
  return sorted;
}

const tried = new Map<number, number>(); // course id -> when we last looked (don't hammer D2L)

/** Read this class's syllabus from D2L (once), remember its scale (and weights if asked). */
/** Find a class's syllabus in D2L Content and read it: text (Word/page) or the PDF itself. Null if there isn't one. */
export async function syllabusSource(portal: string, c: Course): Promise<{ text: string; pdf?: string; title: string; ext: string } | null> {
  const topics = await contentTopics(portal, c).catch(() => []);
  const pick = topics.find((t) => /syllab/i.test(t.Title)) ?? topics.find((t) => /syllab/i.test(t.Url)) ?? topics.find((t) => /course (info|outline|overview)|grading/i.test(t.Title));
  if (!pick?.Url) return null;
  const ext = (pick.Url.match(/\.(\w+)(?:\?|$)/)?.[1] ?? "").toLowerCase();
  let text = "";
  let pdf: string | undefined;
  const b64 = await fileBase64(portal, pick.Url).catch(() => null);
  if (b64) {
    const buf = Buffer.from(b64, "base64");
    if (ext === "docx") text = docxText(buf);
    else if (ext === "pdf" || buf.subarray(0, 4).toString() === "%PDF") pdf = b64;
    else text = buf.toString("utf8").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
  }
  return { text, pdf, title: pick.Title, ext };
}

export async function learnSyllabus(portal: string, c: Course, wantWeights: boolean): Promise<{ scale: Scale | null; weights: boolean }> {
  const known = findBook(c.short);
  if (known?.scheme?.length && (!wantWeights || known.cats.length)) return { scale: known.scheme, weights: !!known.cats.length };
  if (Date.now() - (tried.get(c.id) ?? 0) < 6 * 3600e3) return { scale: known?.scheme ?? null, weights: !!known?.cats.length };
  tried.set(c.id, Date.now());
  const src = await syllabusSource(portal, c);
  if (!src) {
    bb("syllabus", "none", { course: c.short });
    return { scale: null, weights: false };
  }
  const { text, pdf, title: pickTitle, ext } = src;
  const pick = { Title: pickTitle };
  let scale = text ? parseScale(text) : null;
  if (scale) setScheme(c.short, scale);
  bb("syllabus", "read", { course: c.short, file: pick.Title.slice(0, 60), type: ext || "page", scale: scale ? scale.map((s) => `${s.letter}${s.min}`).join(" ") : null });
  // weights (classes that don't post grades in D2L), or a scale the plain read couldn't find: the AI reads it
  if (wantWeights || (!scale && (text || pdf))) {
    const r = await readSyllabus(c.short, { pageText: text || undefined, pdf }).catch(() => ({ ok: false, text: "" }));
    const b = findBook(c.short);
    if (!scale && b?.scheme?.length) scale = b.scheme;
    return { scale, weights: r.ok && !!b?.cats.length };
  }
  return { scale, weights: !!known?.cats.length };
}
