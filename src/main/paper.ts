// Milo writes a paper: plan it, find real sources (checked), open a Google Doc and write it in section by
// section while the student watches, then the Works Cited / References page. Formatting lives in paperFormat.ts.

import { callClaude, callTool, persona } from "./brain";
import { log as bb } from "./blackbox";
import { models } from "./gateway";
import { docsBatch, docsNew } from "./google";
import { getProfile } from "./profile";
import { citeList, countWords, docRequests, mlaDate, type PaperAsk, type Para } from "./paperFormat";

export type PaperProgress = { stage: "planning" | "sources" | "writing" | "citing" | "done" | "error"; text: string; url?: string; step?: number; of?: number };
export type Source = { title: string; author?: string; site?: string; date?: string; url: string };
type Plan = { title: string; thesis: string; sections: { heading: string; goal: string; words: number }[]; searches: string[] };

const PLAN_TOOL = {
  name: "paper_plan",
  description: "The plan for the paper.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "A real, specific title (not 'Paper on X')." },
      thesis: { type: "string", description: "One clear, arguable thesis sentence." },
      sections: {
        type: "array",
        description: "Introduction, 2 to 6 body sections, conclusion, in order. Words should add up to the target.",
        items: { type: "object", properties: { heading: { type: "string" }, goal: { type: "string", description: "What this section argues or covers, in one sentence." }, words: { type: "number" } }, required: ["heading", "goal", "words"] },
      },
      searches: { type: "array", items: { type: "string" }, description: "3 to 5 web searches that would find strong sources (scholarly, government, major news, reputable orgs)." },
    },
    required: ["title", "thesis", "sections", "searches"],
  },
};
const SOURCES_TOOL = {
  name: "paper_sources",
  description: "The sources you found and actually read in your searches.",
  input_schema: {
    type: "object",
    properties: {
      sources: {
        type: "array",
        items: {
          type: "object",
          properties: { title: { type: "string" }, author: { type: "string", description: "Person or organization; empty if none." }, site: { type: "string" }, date: { type: "string", description: "Publication date as shown, e.g. 2023-05-14; empty if none." }, url: { type: "string" }, notes: { type: "string", description: "Key facts from it you can cite." } },
          required: ["title", "url", "notes"],
        },
      },
    },
    required: ["sources"],
  },
};

async function plan(ask: PaperAsk, course: string): Promise<Plan> {
  const r = await callTool<Plan>(
    {
      model: models.smart(),
      max_tokens: 1500,
      system: `${persona()}\nYou plan college ${ask.kind}s. Target length: about ${ask.words} words. Citation style: ${ask.style}.${course ? ` Class: ${course}.` : ""}`,
      tools: [PLAN_TOOL],
      tool_choice: { type: "auto" }, // "tool"/"any" are refused by the newest models; callTool insists and retries
      messages: [{ role: "user", content: `Plan a ${ask.kind} on: ${ask.topic}` }],
    },
    PLAN_TOOL.name
  );
  if (!r.ok) throw new Error(r.text);
  const p = r.data;
  // short papers: intro, body, conclusion (5 sections of 80+ words made a 1-page paper run 50% long)
  const maxSections = ask.words <= 450 ? 3 : ask.words <= 900 ? 4 : ask.words <= 1500 ? 6 : 8;
  if (p.sections.length > maxSections) p.sections = [...p.sections.slice(0, maxSections - 1), p.sections[p.sections.length - 1]];
  // keep the word budget honest
  const total = p.sections.reduce((a, s) => a + (Number(s.words) || 0), 0) || ask.words;
  p.sections = p.sections.map((s) => ({ ...s, words: Math.max(60, Math.round(((Number(s.words) || 0) / total) * ask.words)) }));
  return p;
}

/** Search the web and keep only sources whose pages really exist. */
async function findSources(topic: string, searches: string[]): Promise<(Source & { notes: string })[]> {
  const r = await callClaude({
    model: models.smart(),
    max_tokens: 3000,
    system: `You find sources for a college paper. Search the web (up to 5 searches), then call the paper_sources tool with 4 to 8 strong sources you actually saw in the results: real URLs exactly as found, never invented. Prefer scholarly, government, major news and reputable organizations.`,
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }, SOURCES_TOOL],
    messages: [{ role: "user", content: `Topic: ${topic}\nSuggested searches:\n- ${searches.slice(0, 5).join("\n- ")}` }],
  });
  if (!r.ok) {
    bb("paper", "sources_failed", { error: r.text.slice(0, 120) });
    return [];
  }
  const use = r.data.find((b) => b.type === "tool_use" && b.name === SOURCES_TOOL.name) as { input?: { sources?: (Source & { notes: string })[] } } | undefined;
  const found = (use?.input?.sources ?? []).filter((s) => /^https?:\/\//.test(s.url));
  const checked = await Promise.all(
    found.map(async (s) => {
      try {
        const res = await fetch(s.url, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(7000), headers: { "user-agent": "Mozilla/5.0 (Macintosh) Milo" } });
        return res.status === 404 || res.status === 410 || res.status >= 500 ? null : s; // 403 = a real site that blocks bots: keep
      } catch {
        return null;
      }
    })
  );
  const ok = checked.filter((s): s is Source & { notes: string } => !!s);
  bb("paper", "sources", { found: found.length, real: ok.length });
  return ok;
}

/** One section. Never returns nothing: an empty answer (the model spent its budget thinking) is retried with more room. */
async function writeSection(ask: PaperAsk, p: Plan, i: number, sources: (Source & { notes: string })[], soFar: string): Promise<string> {
  for (const room of [Math.max(3000, Math.round(p.sections[i].words * 3) + 1500), 8000]) {
    const text = await writeSectionOnce(ask, p, i, sources, soFar, room);
    if (text.split(/\s+/).length >= 25) return text;
    bb("paper", "section_empty", { n: i + 1, words: text ? text.split(/\s+/).length : 0, room });
  }
  throw new Error(`Part ${i + 1} came back empty`);
}
async function writeSectionOnce(ask: PaperAsk, p: Plan, i: number, sources: (Source & { notes: string })[], soFar: string, room: number): Promise<string> {
  const s = p.sections[i];
  const cite = ask.style === "APA" ? "(Author, Year)" : ask.style === "Chicago" ? "(Author Year, page)" : "(Author page) or (Author)";
  const src = sources.map((x, n) => `[${n + 1}] ${x.author || x.site || x.title}${x.date ? `, ${x.date}` : ""}: ${x.title}\n    facts: ${x.notes}`).join("\n");
  const r = await callClaude({
    model: models.smart(),
    max_tokens: room,
    system: `You write one section of a college ${ask.kind} at a strong undergraduate level: clear, specific, confident, varied sentences, no filler, no clichés ("in today's world", "delve", "tapestry"), no bullet points, no headings. Write ONLY this section's paragraphs, separated by blank lines. Length: ${Math.round(s.words * 0.9)} to ${Math.round(s.words * 1.1)} words. Stay inside that range.
Use the sources below for facts and cite them in ${ask.style} in-text style ${cite}. Only cite facts that appear in the source notes. Never invent sources, quotes, page numbers or statistics.`,
    messages: [
      {
        role: "user",
        content: `Title: ${p.title}\nThesis: ${p.thesis}\nOutline:\n${p.sections.map((x, n) => `${n + 1}. ${x.heading}: ${x.goal}`).join("\n")}\n\nSources:\n${src || "(none found: write from general knowledge and don't cite)"}\n\nThe paper so far (end):\n${soFar.slice(-2500) || "(nothing yet)"}\n\nNow write section ${i + 1}: ${s.heading} (${s.goal}).${i === 0 ? " It's the introduction: end it with the thesis." : ""}${i === p.sections.length - 1 ? " It's the conclusion." : ""}`,
      },
    ],
  });
  if (!r.ok) throw new Error(r.text);
  return r.data.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
}

/** Every step has a time limit, so the student is never left watching a frog that stopped. */
function limit<T>(p: Promise<T>, secs: number, what: string): Promise<T> {
  return Promise.race([p, new Promise<T>((_, no) => setTimeout(() => no(new Error(`${what} took too long`)), secs * 1000))]);
}

/** The last paper written (the self-test checks it). */
export let lastPaper: { url: string; words: number; sources: number; target: number } | null = null;

/** The whole thing. `emit` tells the app what's happening (and opens the doc as soon as it exists). */
export async function writePaper(ask: PaperAsk, opts: { course?: string; name?: string; emit: (p: PaperProgress) => void; aborted?: () => boolean }) {
  const { emit } = opts;
  const me = getProfile();
  const t0 = Date.now();
  emit({ stage: "planning", text: "Planning it out…" });
  bb("paper", "stage", { stage: "plan" });
  const p = await limit(plan(ask, opts.course ?? ""), 90, "Planning");
  emit({ stage: "sources", text: "Finding real sources…" });
  bb("paper", "stage", { stage: "sources", sections: p.sections.length });
  // sources are worth waiting for, but not forever: without them he writes from what he knows and says so
  const sources = await limit(findSources(ask.topic, p.searches), 150, "Finding sources").catch((e) => {
    bb("paper", "sources_timeout", { error: (e as Error).message });
    return [] as (Source & { notes: string })[];
  });
  bb("paper", "stage", { stage: "doc", sources: sources.length });

  // The doc opens now; the paper appears in it section by section.
  const doc = await docsNew(p.title);
  let at = 1;
  const add = async (paras: Para[]) => {
    const { requests, next } = docRequests(paras, at, ask.style);
    await docsBatch(doc.id, requests);
    at = next;
  };
  const header: Para[] =
    ask.style === "MLA"
      ? [me.name || opts.name, opts.course, mlaDate()].filter(Boolean).map((text) => ({ text: String(text), role: "header" as const }))
      : [];
  await add([...header, { text: p.title, role: "title" }]);
  emit({ stage: "writing", text: "Writing it in your Google Doc…", url: doc.url, step: 0, of: p.sections.length });

  if (ask.mode === "outline") {
    // "Help me write…": the plan, the sources and an empty page to write in together
    await add([
      { text: `Thesis: ${p.thesis}`, role: "body" },
      ...p.sections.flatMap((s) => [
        { text: s.heading, role: "heading" as const },
        { text: s.goal, role: "body" as const },
      ]),
    ]);
    const entries = citeList(sources, ask.style);
    if (entries.length) await add([{ text: ask.style === "APA" ? "References" : "Works Cited", role: "cited_title" }, ...entries.map((text) => ({ text, role: "cited" as const }))]);
    bb("paper", "outline_done", { sections: p.sections.length, sources: sources.length });
    emit({ stage: "done", text: "Done", url: doc.url });
    return { url: doc.url, title: p.title, words: 0, sources: sources.length, thesis: p.thesis, outline: true };
  }

  let body = "";
  const withHeadings = ask.style === "APA" || ask.kind === "report";
  for (let i = 0; i < p.sections.length; i++) {
    if (opts.aborted?.()) break;
    emit({ stage: "writing", text: `Writing part ${i + 1} of ${p.sections.length}: ${p.sections[i].heading}`, url: doc.url, step: i + 1, of: p.sections.length });
    bb("paper", "stage", { stage: "section", n: i + 1 });
    const text = await limit(writeSection(ask, p, i, sources, body), 150, `Writing part ${i + 1}`);
    body += `\n\n${text}`;
    const paras: Para[] = text.split(/\n\s*\n/).map((x) => ({ text: x, role: "body" as const }));
    const skipHeading = i === 0 || /^(introduction|conclusion)$/i.test(p.sections[i].heading);
    await add(withHeadings && !skipHeading ? [{ text: p.sections[i].heading, role: "heading" }, ...paras] : paras);
  }

  emit({ stage: "citing", text: ask.style === "APA" ? "Adding References…" : "Adding Works Cited…", url: doc.url });
  const entries = citeList(sources, ask.style);
  bb("paper", "cited", { entries: entries.length });
  if (entries.length) await add([{ text: ask.style === "APA" ? "References" : ask.style === "Chicago" ? "Bibliography" : "Works Cited", role: "cited_title" }, ...entries.map((text) => ({ text, role: "cited" as const }))]);

  const words = countWords(body);
  bb("paper", "done", { words, target: ask.words, sources: sources.length, sections: p.sections.length, seconds: Math.round((Date.now() - t0) / 1000), style: ask.style });
  lastPaper = { url: doc.url, words, sources: sources.length, target: ask.words };
  emit({ stage: "done", text: "Done", url: doc.url });
  return { url: doc.url, title: p.title, words, sources: sources.length, thesis: p.thesis, outline: false };
}
