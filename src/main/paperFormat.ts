// Pure (no Electron, no network): what a paper looks like in Google Docs. Unit-tested.
// Turns paragraphs into Docs "batchUpdate" requests: Times New Roman 12, double spaced, MLA/APA layout.

export type Style = "MLA" | "APA" | "Chicago";
export type Para = { text: string; role: "header" | "title" | "heading" | "body" | "cited_title" | "cited" };

/** "write a 5 page paper", "1500 words", "a short essay": a word target. ~300 words per double-spaced page. */
export function wordsFrom(text: string): number {
  const t = text.toLowerCase().replace(/(\d),(\d{3})/g, "$1$2"); // "2,000 words"
  const w = t.match(/(\d{2,5})\s*(?:-|\s)?\s*words?/);
  if (w) return Math.min(6000, Math.max(150, Number(w[1])));
  const nums: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, ten: 10, twelve: 12, fifteen: 15 };
  const p = t.match(/(\d{1,2}(?:\.5)?|one|two|three|four|five|six|seven|eight|ten|twelve|fifteen)\s*(?:-|\s)?\s*(?:full\s+)?pages?/);
  if (p) return Math.min(6000, Math.round((nums[p[1]] ?? Number(p[1])) * 300));
  if (/\b(short|brief|quick)\b/.test(t)) return 600;
  if (/\b(long|in-?depth|research paper)\b/.test(t)) return 2000;
  return 1200;
}
export function styleFrom(text: string): Style {
  if (/\bapa\b/i.test(text)) return "APA";
  if (/\b(chicago|turabian)\b/i.test(text)) return "Chicago";
  return "MLA";
}
export type PaperAsk = { topic: string; words: number; style: Style; kind: "paper" | "essay" | "report"; mode: "full" | "outline" };
/** "write a 5 page paper on the causes of WW1 in APA" -> the ask. Null if it isn't a request to write a paper. (pure) */
export function parsePaperAsk(raw: string): PaperAsk | null {
  const t = raw.trim().replace(/[.!?]+$/, "");
  const m = t.match(/\b(?:write|draft|make|do|type|create|start)\b.{0,60}?\b(research paper|paper|essay|report)\b(.*)$/i);
  if (!m || /\b(email|message|text|poem|song|story|code|program)\b/i.test(t.slice(0, m.index ?? 0) + m[0].slice(0, 30))) return null;
  const kind = /essay/i.test(m[1]) ? "essay" : /report/i.test(m[1]) ? "report" : "paper";
  let topic = (m[2] || "")
    .replace(/^\s*(?:for me|for my \w+(?: class)?)?\s*/i, "")
    .replace(/^\s*(?:on|about|over|regarding|discussing|explaining|arguing(?: that)?|that)\s+/i, "")
    .replace(/\s+(?:in|using)\s+(?:mla|apa|chicago)(?:\s+(?:format|style))?/i, "")
    .replace(/,?\s*(?:\d+|one|two|three|four|five|six|seven|eight|ten)\s*(?:-|\s)?(?:pages?|words?)\s*(?:long)?/i, "")
    .replace(/\s+(?:in|into|on)\s+(?:a\s+)?(?:my\s+)?google docs?$/i, "")
    .replace(/\s+for me$/i, "")
    .trim();
  if (/^(on|about)$/i.test(topic)) topic = "";
  const outline = /\b(help me|with me|together|outline|start on)\b/i.test(t);
  return { topic, words: wordsFrom(t), style: styleFrom(t), kind, mode: outline ? "outline" : "full" };
}

/** The MLA date: "22 November 2026". */
export const mlaDate = (d = new Date()) => `${d.getDate()} ${d.toLocaleString("en-US", { month: "long" })} ${d.getFullYear()}`;

/** Docs batchUpdate requests that insert `paras` at `start` and style them. Returns the requests and the next index. (pure) */
export function docRequests(paras: Para[], start: number, style: Style): { requests: unknown[]; next: number } {
  const requests: unknown[] = [];
  let i = start;
  const all = paras.filter((p) => p.text.trim()).map((p) => ({ ...p, text: p.text.replace(/\r?\n+/g, " ").trim() + "\n" }));
  const text = all.map((p) => p.text).join("");
  if (!text) return { requests, next: start };
  requests.push({ insertText: { location: { index: start }, text } });
  for (const p of all) {
    const range = { startIndex: i, endIndex: i + p.text.length };
    const center = p.role === "title" || p.role === "cited_title" || (p.role === "heading" && style === "APA");
    const ps: Record<string, unknown> = {
      lineSpacing: 200,
      spaceAbove: { magnitude: 0, unit: "PT" },
      spaceBelow: { magnitude: 0, unit: "PT" },
      alignment: center ? "CENTER" : "START",
      indentFirstLine: { magnitude: p.role === "body" ? 36 : p.role === "cited" ? 0 : 0, unit: "PT" },
      indentStart: { magnitude: p.role === "cited" ? 36 : 0, unit: "PT" },
    };
    if (p.role === "cited_title") ps.pageBreakBefore = true;
    requests.push({ updateParagraphStyle: { range, paragraphStyle: ps, fields: Object.keys(ps).join(",") } });
    requests.push({
      updateTextStyle: {
        range: { startIndex: range.startIndex, endIndex: range.endIndex - 1 },
        textStyle: { weightedFontFamily: { fontFamily: "Times New Roman" }, fontSize: { magnitude: 12, unit: "PT" }, bold: p.role === "heading" || (style === "APA" && p.role === "title") },
        fields: "weightedFontFamily,fontSize,bold",
      },
    });
    i += p.text.length;
  }
  // (a Works Cited hanging indent = indentStart 0.5" with indentFirstLine 0: the first line hangs out to the margin)
  return { requests, next: i };
}

export type CiteSource = { title: string; author?: string; site?: string; date?: string; url: string };
const MONTHS = ["Jan.", "Feb.", "Mar.", "Apr.", "May", "June", "July", "Aug.", "Sept.", "Oct.", "Nov.", "Dec."];
const FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function parts(date?: string): { y?: number; m?: number; d?: number } {
  const m = (date ?? "").match(/(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?/);
  return m ? { y: Number(m[1]), m: m[2] ? Number(m[2]) : undefined, d: m[3] ? Number(m[3]) : undefined } : {};
}
// "Stickgold, R. (Neuron review)" -> "Stickgold, R."; "cdc.gov (Preventing Chronic Disease)" -> "cdc.gov"
const clean = (s?: string) => (s ?? "").replace(/\s*\([^)]*\)/g, "").replace(/\s+/g, " ").trim().replace(/[.,]$/, "");
/** One Works Cited / References entry for a web source. Leaves out what's missing; never a placeholder. (pure) */
export function citeEntry(s: CiteSource, style: Style, accessed = new Date()): string {
  const author = clean(s.author);
  const title = clean(s.title);
  const site = clean(s.site) || (() => { try { return new URL(s.url).hostname.replace(/^www\./, ""); } catch { return ""; } })();
  const p = parts(s.date);
  if (style === "APA") {
    const when = p.y ? `(${p.y}${p.m ? `, ${FULL[p.m - 1]}${p.d ? ` ${p.d}` : ""}` : ""})` : "(n.d.)";
    const who = author || site;
    return `${who}. ${when}. ${title}.${site && site !== who ? ` ${site}.` : ""} ${s.url}`.replace(/\.\./g, ".");
  }
  // MLA 9 (Chicago bibliography is close enough for a draft)
  const when = p.y ? `${p.d ? `${p.d} ` : ""}${p.m ? `${MONTHS[p.m - 1]} ` : ""}${p.y}` : "";
  const acc = `${accessed.getDate()} ${MONTHS[accessed.getMonth()]} ${accessed.getFullYear()}`;
  const bits = [author && author !== site ? `${author}.` : "", `"${title}."`, [site, when, s.url.replace(/^https?:\/\//, "")].filter(Boolean).join(", ") + ".", p.y ? "" : `Accessed ${acc}.`];
  return bits.filter(Boolean).join(" ").replace(/\.\./g, ".");
}
/** All entries, alphabetical, no duplicates. (pure) */
export function citeList(sources: CiteSource[], style: Style, accessed = new Date()): string[] {
  const seen = new Set<string>();
  return sources
    .filter((s) => s.url && !seen.has(s.url) && seen.add(s.url))
    .map((s) => citeEntry(s, style, accessed))
    .sort((a, b) => a.replace(/^["“]/, "").localeCompare(b.replace(/^["“]/, ""), "en", { sensitivity: "base" }));
}

export const countWords = (s: string) => (s.match(/\b[\w'’-]+\b/g) ?? []).length;
