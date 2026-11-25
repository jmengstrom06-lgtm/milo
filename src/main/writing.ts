// Writing help that works on the student's REAL work:
//  - editPaper: their Google Doc, edited in place while they watch, every change listed and undoable
//  - citations: real sources (scholarly databases + the web, every one checked), MLA/APA, added to the doc
// Pure decisions live in docEdit.ts and citations.ts (tested); this file talks to the AI and Google.

import { callClaude, callTool, persona } from "./brain";
import { log as bb } from "./blackbox";
import { models } from "./gateway";
import { docsBatch, docsFull } from "./google";
import { flatten, locate, plan, requestsFor, undoOf, words, type Edit } from "./docEdit";
import { type Source, citeLine, inText, styleOf, type CiteStyle } from "./citations";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------------------------
// Edit my paper
const EDIT_TOOL = {
  name: "paper_edits",
  description: "Edits to make in the student's document, plus what you changed overall.",
  input_schema: {
    type: "object",
    properties: {
      summary: { type: "string", description: "One or two sentences Milo says out loud: what you improved, in plain words. No praise filler." },
      edits: {
        type: "array",
        description: "Each edit replaces one exact piece of the document. 3 to 25 edits, the most valuable first.",
        items: {
          type: "object",
          properties: {
            find: { type: "string", description: "Text copied EXACTLY from the document (same words, punctuation and capitals), inside ONE paragraph, long enough to appear only once (usually a full sentence)." },
            replace: { type: "string", description: "The new text for exactly that span." },
            why: { type: "string", description: "A few words: 'run-on sentence', 'clearer thesis', 'cut filler', 'subject-verb agreement', 'meets rubric: counterargument'." },
            kind: { type: "string", enum: ["grammar", "clarity", "flow", "concision", "tone", "structure", "argument", "rubric", "citation"] },
          },
          required: ["find", "replace", "why", "kind"],
        },
      },
      notes: {
        type: "array",
        description: "Up to 4 bigger things only the student can fix (a claim that needs a source, a missing section). Short.",
        items: { type: "string" },
      },
    },
    required: ["summary", "edits", "notes"],
  },
};

export type EditResult = {
  ok: true;
  title: string;
  summary: string;
  applied: Edit[];
  skipped: number;
  notes: string[];
  wordsBefore: number;
  wordsAfter: number;
};

/** What the student asked for, turned into editing instructions. (pure) */
export function editBrief(ask: string, rubric = ""): string {
  const a = ask.toLowerCase();
  const target = a.match(/\b(?:cut|shorten|trim|get)\b.*?\b(?:to|by|under)\s+(\d{2,5})\s*words?\b/);
  const scope = /\bintro(duction)?\b/.test(a) ? "Only the introduction (first paragraph or two)." : /\bconclusion\b/.test(a) ? "Only the conclusion (last paragraph or two)." : /\bthesis\b/.test(a) ? "Focus on the thesis sentence and anything that has to change with it." : "The whole document.";
  const focus = [
    /\b(grammar|spelling|typos?|proofread)\b/.test(a) && "Fix only grammar, spelling, punctuation and typos. Don't rewrite style.",
    /\b(flow|transitions?)\b/.test(a) && "Improve flow and transitions between sentences and paragraphs.",
    /\b(shorter|concise|wordy|cut|trim|shorten)\b/.test(a) && (target ? `Cut it to about ${target[1]} words: remove filler and repetition, keep every argument.` : "Make it tighter: cut filler and repetition, keep every argument."),
    /\b(longer|expand|add more|lengthen)\b/.test(a) && "Develop thin points with more explanation of the student's own ideas (no new facts or sources).",
    /\b(formal|academic|professional)\b/.test(a) && "Make the tone more academic.",
    /\b(sound like me|less like ai|more human|natural|casual)\b/.test(a) && "Make it sound like a real student wrote it: plain, varied, specific. Remove stiff or AI-sounding phrasing.",
    /\b(stronger|argument|persuasive)\b/.test(a) && "Strengthen the argument: clearer claims, better topic sentences, tighter reasoning.",
  ].filter(Boolean);
  return [
    `Scope: ${scope}`,
    focus.length ? `Focus: ${focus.join(" ")}` : "Focus: a full edit: grammar, clarity, flow, concision and the strength of the argument.",
    rubric ? `Grade it against this rubric and make edits that close the gaps (kind "rubric"):\n${rubric.slice(0, 4000)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** The AI's edits for a document's text (no Google: the bench calls this directly). */
export async function proposeEdits(title: string, text: string, ask: string, rubric = "") {
  return callTool<{ summary: string; edits: Edit[]; notes: string[] }>(
    {
      model: models.smart(),
      max_tokens: 8000,
      system: `${persona()}
You are editing a college student's own paper, in place, while they watch. Make it clearly better while keeping it THEIRS:
- Keep their voice, their argument, their meaning and their facts. Never add facts, statistics, sources, quotes or page numbers.
- Never change direct quotations, citations, headings, the title, names, or the Works Cited / References list.
- Each edit's "find" must be copied character for character from the document and sit inside one paragraph. Prefer whole sentences.
- Fewer, meaningful edits beat many tiny word swaps. Don't edit the same sentence twice.
${editBrief(ask, rubric)}`,
      tools: [EDIT_TOOL],
      tool_choice: { type: "auto" },
      messages: [{ role: "user", content: `Document title: ${title}\n\n${text}` }],
    },
    EDIT_TOOL.name
  );
}

export async function editPaper(docId: string, ask: string, opts: { rubric?: string; live?: (e: Edit, i: number, n: number) => void } = {}): Promise<EditResult | { ok: false; text: string }> {
  const doc = await docsFull(docId);
  const flat = flatten(doc.content);
  const before = words(flat.text);
  if (before < 30) return { ok: false, text: "That doc is nearly empty. Write a draft (even a rough one) and I'll edit it." };
  if (flat.text.length > 120000) return { ok: false, text: "That doc is really long. Tell me which part to edit, like “edit my intro” or “edit section 2”." };
  const r = await proposeEdits(doc.title, flat.text, ask, opts.rubric);
  if (!r.ok) return { ok: false, text: r.text };
  const { ok: planned, dropped } = plan(flat, r.data.edits ?? []);
  bb("writing", "edit_plan", { asked: r.data.edits?.length ?? 0, placed: planned.length, dropped: dropped.map((d) => d.reason) });
  if (!planned.length) return { ok: false, text: "I read it, but couldn't place my edits safely in the doc. Try again, or tell me which part to work on." };
  // one at a time, bottom to top, so the student sees the doc change (positions above never move)
  const applied: Edit[] = [];
  for (let i = 0; i < planned.length; i++) {
    const p = planned[i];
    try {
      await docsBatch(docId, requestsFor(p));
      applied.push({ find: p.find, replace: p.replace, why: p.why, kind: p.kind });
      opts.live?.(p, i, planned.length);
      await sleep(120);
    } catch (e) {
      bb("writing", "edit_failed", { error: (e as Error).message.slice(0, 120) });
      if (!applied.length) return { ok: false, text: /403/.test((e as Error).message) ? "I can only read that doc, not edit it. Ask the owner for edit access, or make a copy." : "Google wouldn't let me change the doc. Try again in a second." };
      break;
    }
  }
  const after = words(flatten((await docsFull(docId)).content).text);
  // listed top to bottom for the student (applied bottom-up)
  applied.reverse();
  return { ok: true, title: doc.title, summary: r.data.summary || "", applied, skipped: dropped.length, notes: (r.data.notes ?? []).slice(0, 4), wordsBefore: before, wordsAfter: after };
}

/** Take back edits (all, or some). Found by text, so it still works if the student typed elsewhere since. */
export async function undoEdits(docId: string, applied: Edit[]): Promise<{ ok: boolean; undone: number }> {
  const flat = flatten((await docsFull(docId)).content);
  const { ok } = plan(flat, undoOf(applied));
  for (const p of ok) await docsBatch(docId, requestsFor(p));
  bb("writing", "edit_undo", { asked: applied.length, undone: ok.length });
  return { ok: ok.length > 0, undone: ok.length };
}

// ---------------------------------------------------------------------------------------------
// Real sources + citations
type Found = Source & { notes?: string };

/** Scholarly sources that really exist: OpenAlex (250M+ papers, free, no key). Each has a DOI or a landing page. */
export async function scholarly(query: string, n = 6): Promise<Found[]> {
  const url = `https://api.openalex.org/works?search=${encodeURIComponent(query)}&filter=has_doi:true,type:article|review|book-chapter&sort=relevance_score:desc&per_page=${Math.min(n * 2, 20)}&mailto=hello@milo.study`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!r.ok) return [];
    type W = { title?: string; doi?: string; publication_year?: number; publication_date?: string; authorships?: { author?: { display_name?: string } }[]; primary_location?: { source?: { display_name?: string } }; biblio?: { volume?: string; issue?: string; first_page?: string; last_page?: string }; cited_by_count?: number; abstract_inverted_index?: Record<string, number[]> };
    const d = (await r.json()) as { results?: W[] };
    return (d.results ?? [])
      .filter((w) => w.title && w.doi && (w.authorships?.length ?? 0) > 0)
      .slice(0, n)
      .map((w) => ({
        kind: "article" as const,
        title: w.title!.replace(/<[^>]+>/g, ""),
        authors: (w.authorships ?? []).map((a) => a.author?.display_name ?? "").filter(Boolean).slice(0, 20),
        year: w.publication_year,
        date: w.publication_date,
        container: w.primary_location?.source?.display_name ?? "",
        volume: w.biblio?.volume ?? "",
        issue: w.biblio?.issue ?? "",
        pages: w.biblio?.first_page ? `${w.biblio.first_page}${w.biblio.last_page ? `-${w.biblio.last_page}` : ""}` : "",
        doi: w.doi!.replace(/^https?:\/\/doi\.org\//, ""),
        url: w.doi!,
        notes: abstractOf(w.abstract_inverted_index).slice(0, 700),
      }));
  } catch {
    return [];
  }
}
const abstractOf = (inv?: Record<string, number[]>) => {
  if (!inv) return "";
  const at: string[] = [];
  for (const [w, ps] of Object.entries(inv)) for (const p of ps) at[p] = w;
  return at.filter(Boolean).join(" ");
};

const WEB_TOOL = {
  name: "web_sources",
  description: "Sources you actually saw in your searches.",
  input_schema: {
    type: "object",
    properties: {
      sources: {
        type: "array",
        items: {
          type: "object",
          properties: { title: { type: "string" }, author: { type: "string" }, site: { type: "string" }, date: { type: "string" }, url: { type: "string" }, notes: { type: "string", description: "The facts in it that support the paper." } },
          required: ["title", "url", "notes"],
        },
      },
    },
    required: ["sources"],
  },
};
/** Government, news and organization sources from a real web search, each page checked to exist. */
export async function webSources(topic: string, n = 4): Promise<Found[]> {
  const r = await callClaude({
    model: models.smart(),
    max_tokens: 2500,
    system: `Find strong sources for a college paper: government (.gov), reputable organizations, major news, university pages. Search the web (up to 4 searches), then call web_sources with up to ${n} you actually saw. Real URLs exactly as found, never invented.`,
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 4 }, WEB_TOOL],
    messages: [{ role: "user", content: `Topic: ${topic}` }],
  });
  if (!r.ok) return [];
  const use = r.data.find((b) => b.type === "tool_use" && b.name === WEB_TOOL.name) as { input?: { sources?: { title: string; author?: string; site?: string; date?: string; url: string; notes: string }[] } } | undefined;
  const list = (use?.input?.sources ?? []).filter((s) => /^https?:\/\//.test(s.url)).slice(0, n);
  const checked = await Promise.all(
    list.map(async (s) => {
      try {
        const res = await fetch(s.url, { redirect: "follow", signal: AbortSignal.timeout(7000), headers: { "user-agent": "Mozilla/5.0 (Macintosh) Milo" } });
        return res.status === 404 || res.status === 410 || res.status >= 500 ? null : s;
      } catch {
        return null;
      }
    })
  );
  return checked
    .filter((s): s is NonNullable<typeof s> => !!s)
    .map((s) => ({ kind: "web" as const, title: s.title, authors: s.author ? [s.author] : [], site: s.site ?? "", date: s.date ?? "", url: s.url, notes: s.notes }));
}

const PICK_TOOL = {
  name: "pick_sources",
  description: "Which sources fit the paper, and where each supports it.",
  input_schema: {
    type: "object",
    properties: {
      topic: { type: "string", description: "The paper's topic in a few words (for searching)." },
      use: {
        type: "array",
        items: {
          type: "object",
          properties: {
            source: { type: "number", description: "Index in the source list." },
            sentence: { type: "string", description: "A sentence copied EXACTLY from the paper that this source supports, or empty if none fits yet." },
            why: { type: "string", description: "What the source shows, in a few words." },
          },
          required: ["source", "sentence", "why"],
        },
      },
    },
    required: ["topic", "use"],
  },
};

export type CiteResult = { ok: true; style: CiteStyle; sources: (Source & { why: string })[]; placed: number; addedList: boolean; applied: Edit[]; listText: string };

/** "Find 5 sources for my paper": real sources, cited where they support the paper, and a Works Cited / References page. */
export async function citePaper(docId: string, ask: string, n = 5, live?: (t: string) => void): Promise<CiteResult | { ok: false; text: string }> {
  const doc = await docsFull(docId);
  const flat = flatten(doc.content);
  if (words(flat.text) < 40) return { ok: false, text: "Write a little of the paper first, so I know what to find sources for." };
  const style = styleOf(ask, flat.text);
  // 1) what is it about? (a cheap read of the paper), 2) search scholarly + web together
  const topicR = await callClaude({ model: models.fast(), max_tokens: 60, system: "Reply with only a 3 to 8 word search query for scholarly sources on this paper's topic.", messages: [{ role: "user", content: flat.text.slice(0, 6000) }] });
  const topic = topicR.ok ? topicR.data.filter((b) => b.type === "text").map((b) => b.text).join(" ").replace(/["\n]/g, " ").trim().slice(0, 120) : doc.title;
  live?.(`Searching scholarly databases and the web for “${topic}”…`);
  const [sch, web] = await Promise.all([scholarly(topic, n + 3), webSources(topic, 3)]);
  const pool = [...sch, ...web];
  bb("writing", "sources_found", { scholarly: sch.length, web: web.length });
  if (!pool.length) return { ok: false, text: "I couldn't find sources I could verify for this topic. Try telling me the topic in a few words." };
  // 3) match sources to sentences in the paper
  const r = await callTool<{ topic: string; use: { source: number; sentence: string; why: string }[] }>(
    {
      model: models.smart(),
      max_tokens: 3000,
      system: `Pick the ${n} best sources for this student's paper (relevant, credible, recent when it matters) and, for each, the sentence in the paper it supports. Only claim support the source's description really gives. Sentences must be copied exactly from the paper.`,
      tools: [PICK_TOOL],
      tool_choice: { type: "auto" },
      messages: [{ role: "user", content: `Paper:\n${flat.text.slice(0, 40000)}\n\nSources:\n${pool.map((s, i) => `[${i}] ${s.title} (${s.year ?? s.date ?? "n.d."}) ${s.container || s.site || ""}\n    ${(s.notes ?? "").slice(0, 400)}`).join("\n")}` }],
    },
    PICK_TOOL.name
  );
  if (!r.ok) return { ok: false, text: r.text };
  const chosen = (r.data.use ?? []).filter((u) => pool[u.source]).slice(0, n);
  const sources = chosen.map((u) => ({ ...pool[u.source], why: u.why }));
  // 4) in-text citations at the end of the sentences they support (same safe edit engine as "edit my paper")
  const edits: Edit[] = chosen
    .filter((u) => u.sentence && u.sentence.length > 20)
    .map((u) => {
      const s = u.sentence.trim();
      const cite = inText(pool[u.source], style);
      const end = s.match(/[.!?]["”']?$/);
      return { find: s, replace: end ? `${s.slice(0, end.index)} ${cite}${s.slice(end.index)}` : `${s} ${cite}`, why: `cites ${pool[u.source].authors[0] ?? pool[u.source].site ?? "source"}`, kind: "citation" };
    });
  const { ok: planned } = plan(flat, edits);
  const applied: Edit[] = [];
  for (const p of planned) {
    await docsBatch(docId, requestsFor(p));
    applied.push({ find: p.find, replace: p.replace, why: p.why, kind: "citation" });
    await sleep(120);
  }
  // 5) the Works Cited / References page at the very end (added to, if one's already there)
  const heading = style === "APA" ? "References" : "Works Cited";
  const full = flatten((await docsFull(docId)).content);
  const end = Math.max(1, (full.at[full.at.length - 1] ?? 1)); // before the doc's final newline
  const lines = sources.map((s) => citeLine(s, style)).sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
  const has = new RegExp(`\\n\\s*(${heading}|Works Cited|References|Bibliography)\\s*\\n`, "i").test(full.text);
  const block = has ? `\n${lines.join("\n")}` : `\n${heading}\n${lines.join("\n")}`;
  const reqs: unknown[] = [];
  if (!has) reqs.push({ insertPageBreak: { location: { index: end } } });
  const at = has ? end : end + 1;
  reqs.push({ insertText: { location: { index: at }, text: block } });
  if (!has) {
    const hStart = at + 1;
    reqs.push({ updateParagraphStyle: { range: { startIndex: hStart, endIndex: hStart + heading.length }, paragraphStyle: { alignment: "CENTER" }, fields: "alignment" } });
  }
  // hanging indent for the entries (MLA and APA both want it)
  const listStart = has ? at + 1 : at + 1 + heading.length + 1;
  reqs.push({ updateParagraphStyle: { range: { startIndex: listStart, endIndex: listStart + lines.join("\n").length }, paragraphStyle: { indentStart: { magnitude: 36, unit: "PT" }, indentFirstLine: { magnitude: 0, unit: "PT" } }, fields: "indentStart,indentFirstLine" } });
  let addedList = true;
  try {
    await docsBatch(docId, reqs);
  } catch (e) {
    addedList = false;
    bb("writing", "cite_list_failed", { error: (e as Error).message.slice(0, 160) });
  }
  bb("writing", "cited", { style, sources: sources.length, placed: applied.length, list: addedList });
  return { ok: true, style, sources, placed: applied.length, addedList, applied, listText: addedList ? block : "" };
}

/** Remove a block Milo added (the Works Cited list) by its exact text, page break included. */
export async function removeBlock(docId: string, text: string): Promise<boolean> {
  if (!text) return false;
  const flat = flatten((await docsFull(docId)).content);
  const loc = locate(flat, text);
  if (!loc) return false;
  let start = flat.at[loc.from];
  const end = flat.at[loc.to - 1] + 1;
  if (loc.from > 0 && flat.at[loc.from] - flat.at[loc.from - 1] === 2) start -= 1; // the page break Milo put before it (not text, but it takes a spot)
  await docsBatch(docId, [{ deleteContentRange: { range: { startIndex: start, endIndex: end } } }]);
  return true;
}
