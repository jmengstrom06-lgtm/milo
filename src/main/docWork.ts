// The thinking half of the doc agent: read the doc, plan with every action, apply, then CHECK the result
// against what the student asked and finish anything missing (up to two more passes). Honest at the end:
// if something couldn't be done, the reply says so instead of quietly doing something else.

import { callClaude, callTool, persona } from "./brain";
import { scholarly, webSources } from "./writing";
import { citeLine, inText, styleOf, type Source } from "./citations";
import { log as bb } from "./blackbox";
import { models } from "./gateway";
import { docWords, listing, opApplier, paragraphs, type Change, type DocIO, type Op, type Plan } from "./docAgent";
import { completedItems, streamTool } from "./toolStream";

const PLAN_TOOL = {
  name: "doc_plan",
  description: "Everything to do to the student's Google Doc for this request, as actions on its numbered paragraphs.",
  input_schema: {
    type: "object",
    properties: {
      understood: { type: "string", description: "One short line: what the student wants, in your words." },
      answer: { type: "string", description: "If they asked a QUESTION about the doc (what's my thesis, is this good, how long is it), the answer. Otherwise empty." },
      ops: {
        type: "array",
        description: "The actions, in order. Empty if they only asked a question.",
        items: {
          type: "object",
          properties: {
            op: { type: "string", enum: ["replace_text", "rewrite_paragraph", "insert", "delete", "move", "set_style", "format"] },
            para: { type: "number", description: "The paragraph (P number) this acts on." },
            after: { type: "number", description: "insert/move: the P number it goes after. 0 = the very top. The last P number = the very end." },
            find: { type: "string", description: "replace_text: exact text from that paragraph, copied character for character." },
            replace: { type: "string", description: "replace_text: what it becomes (never empty)." },
            text: { type: "string", description: "rewrite_paragraph: the paragraph's full new text." },
            paragraphs: {
              type: "array",
              description: "insert: the new paragraphs, in order. Use a heading paragraph only if it fits the paper.",
              items: {
                type: "object",
                properties: {
                  text: { type: "string" },
                  style: { type: "string", enum: ["NORMAL_TEXT", "TITLE", "SUBTITLE", "HEADING_1", "HEADING_2", "HEADING_3"] },
                  align: { type: "string", enum: ["START", "CENTER", "END", "JUSTIFIED"] },
                  bold: { type: "boolean" },
                  hanging: { type: "boolean", description: "Hanging indent (Works Cited / References entries)." },
                },
                required: ["text"],
              },
            },
            style: { type: "string", enum: ["NORMAL_TEXT", "TITLE", "SUBTITLE", "HEADING_1", "HEADING_2", "HEADING_3"] },
            target: { type: "string", enum: ["para", "all"], description: "format: one paragraph (para, optionally just the `find` text in it) or the whole paper (all)." },
            format: {
              type: "object",
              description: "format: only the things to change.",
              properties: {
                bold: { type: "boolean" },
                italic: { type: "boolean" },
                underline: { type: "boolean" },
                font: { type: "string", description: "e.g. Times New Roman, Arial" },
                size: { type: "number", description: "points, e.g. 12" },
                align: { type: "string", enum: ["START", "CENTER", "END", "JUSTIFIED"] },
                lineSpacing: { type: "number", description: "100 = single, 150, 200 = double" },
                firstLineIndent: { type: "number", description: "points; 36 = half an inch" },
                hanging: { type: "boolean" },
                noSpacing: { type: "boolean", description: "remove extra space above/below paragraphs" },
              },
            },
            why: { type: "string", description: "A few words the student sees: why this change." },
          },
          required: ["op", "why"],
        },
      },
      summary: { type: "string", description: "One plain sentence for the student, past tense: what you did (or the answer, short)." },
      cant: { type: "string", description: "Anything they asked that you can't do in a Google Doc from here (images, tables, comments, fonts/colors, page setup, sharing), else empty." },
      notes: { type: "array", items: { type: "string" }, description: "Up to 3 short tips for things only the student can do (e.g. a claim that needs a source)." },
      requirements: {
        type: "array",
        description: "Only when THE ASSIGNMENT is given: each concrete requirement and whether the paper meets it AFTER your changes.",
        items: { type: "object", properties: { req: { type: "string", description: "A few words, e.g. '1,000–1,200 words' or '3 scholarly sources, MLA'." }, met: { type: "boolean" }, note: { type: "string", description: "A few words: why, or what's left." } }, required: ["req", "met"] },
      },
    },
    required: ["understood", "answer", "ops", "summary", "cant", "notes"],
  },
};

const CHECK_TOOL = {
  name: "check_result",
  description: "Did the doc end up the way the student asked?",
  input_schema: {
    type: "object",
    properties: {
      done: { type: "boolean", description: "true if every PART of the request was carried out in the doc, even if it could be done better. false only if a concrete part was not done at all (nothing added where they asked for an addition, a named paragraph not moved/removed, a word target clearly missed, a question unanswered)." },
      missing: { type: "string", description: "If not done: exactly what's still missing or wrong, as an instruction. Else empty." },
      extra: { type: "string", description: "Anything changed that they did NOT ask for, else empty." },
    },
    required: ["done", "missing", "extra"],
  },
};

function system(rubric: string, assignment?: { label: string; brief: string }): string {
  // No keyword rules here (they misfire: "move X right after my intro" is not "edit only the intro").
  // The request itself says what to do and where; the agent reads it whole.
  return `${persona()}
Today is ${new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}.
You work on a college student's own Google Doc while they watch. Do EXACTLY what they asked, all of it, and nothing they didn't ask for.
- Read the request literally. "Add a section with your thoughts" = insert new paragraphs (don't also fix grammar). "Fix the grammar" = only grammar. "Edit it" or "make it better" = a real edit of grammar, clarity, flow and wording. A question = answer it with no actions.
- Pick the right action: replace_text for words and phrases; rewrite_paragraph for a heavier rewrite of one paragraph; insert to add anything new (sections, a conclusion, a heading, a header line); delete; move to reorder; set_style for headings and titles; format for bold/italic/underline, font, size, alignment, line spacing and indents (target "all" for the whole paper).
- MLA format = Times New Roman 12, double spaced (200), no extra paragraph spacing, half-inch first-line indents on body paragraphs, a left-aligned header block (name, professor, class, date), the title centered and not bold. APA 7 = double spaced, 12 pt, a bold centered title, and a References list.
- "My intro" = the first body paragraph after the title; "my conclusion" = the last body paragraph (unless the paper labels its sections otherwise). "The second paragraph" counts body paragraphs, not the header or title.
- "After the paper" / "at the end" = after the last paragraph. "Before the conclusion" = after the paragraph before the conclusion. A header block (name, professor, class, date) is not the paper's start.
- New writing: match the paper's voice, level and formatting. A new section is usually a short heading paragraph only if the paper already uses headings or they asked for one; otherwise plain paragraphs.
- Keep their argument, facts, direct quotes and numbers unless they asked to change them. Never invent sources, statistics, quotes or citations (if they need sources, say "say 'find sources for my paper'" in notes).
- Word targets ("cut to 500 words") count the body, not the header block.
- A part of the paper named in the request ("my intro", "the CDC paragraph") is WHERE to act or a reference point, not a limit on everything else they asked.
- Can't be done from here: tables, images, comments, page numbers or headers/footers, page setup. Do the rest and say so in "cant".
${rubric ? `Grade it against this rubric and make changes that close the gaps:\n${rubric.slice(0, 4000)}` : ""}${
    assignment
      ? `

THE ASSIGNMENT this paper is for (from the student's D2L):
${assignment.brief}

- Use it to do what they asked the way the professor wants it (length, sections, sources, citation style, format, focus).
- If they asked for a general edit, to improve it, or to make it meet the assignment: also close the gaps you can (missing sections, format, length). If they asked for something specific, do only that.
- Never invent requirements, and never write things only the student can supply (their own interview, data, or experience): put those in notes.
- Always fill "requirements" from it. If they asked whether the paper meets the assignment, answer from that checklist.`
      : ""
  }`;
}

const WANTS_SOURCES = /\b(sources?|cite|citing|citations?|works cited|references|bibliography|scholarly|peer.?reviewed|research to back|evidence from)\b/i;
const NUM: Record<string, number> = { one: 1, a: 1, an: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 };

/** Real sources for this paper, found BEFORE planning, each with its exact in-text citation and list entry.
 *  The agent may only cite from this list, so nothing is ever made up. */
let lastTopic = "";
export async function gatherSources(ask: string, docText: string, title: string): Promise<{ style: "MLA" | "APA"; list: { s: Source; inText: string; entry: string; notes: string }[] }> {
  const style = styleOf(ask, docText);
  const m = ask.toLowerCase().match(/\b(\d+|one|a|an|two|three|four|five|six|seven|eight)\s+(?:more\s+)?(?:scholarly\s+|peer.?reviewed\s+|credible\s+|academic\s+|real\s+)?(?:sources?|citations?|references|articles)\b/);
  const n = Math.min(8, Math.max(1, m ? (NUM[m[1]] ?? Number(m[1])) : 3));
  const basis = docText.trim().length > 200 ? docText.slice(0, 6000) : `${title}\n${ask}`;
  const q = await callClaude({ model: models.fast(), max_tokens: 60, system: "Reply with only a 3 to 8 word search query for scholarly sources on this paper's topic.", messages: [{ role: "user", content: basis }] });
  let topic = q.ok ? q.data.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join(" ").replace(/["\n]/g, " ").trim().slice(0, 120) : "";
  if (topic.split(/\s+/).length < 2) topic = title; // an empty or one-word answer: use the paper's own title
  let [sch, web] = await Promise.all([scholarly(topic, n + 4).catch(() => []), webSources(topic, 2).catch(() => [])]);
  let used = topic;
  if (sch.length + web.length < n) {
    // too narrow or a hiccup: search again, broader (the paper's title, or the first few words of the query)
    const broader = (title && !/^untitled/i.test(title) ? title : topic.split(/\s+/).slice(0, 3).join(" ")).replace(/[^\w\s'-]/g, " ").trim();
    const [s2, w2] = await Promise.all([scholarly(broader, n + 4).catch(() => []), web.length ? Promise.resolve([]) : webSources(broader, 2).catch(() => [])]);
    const seen = new Set([...sch, ...web].map((x) => x.doi || x.url));
    sch = [...sch, ...s2.filter((x) => !seen.has(x.doi || x.url))];
    web = [...web, ...w2.filter((x) => !seen.has(x.doi || x.url))];
    used = `${topic} | ${broader}`;
  }
  const pool = [...sch, ...web].slice(0, n + 6);
  bb("docwork", "sources", { topic: used, scholarly: sch.length, web: web.length, style });
  lastTopic = `${used} (${sch.length} scholarly, ${web.length} web)`;
  return { style, list: pool.map((s) => ({ s, inText: inText(s, style), entry: citeLine(s, style), notes: ((s as Source & { notes?: string }).notes ?? "").slice(0, 300) })) };
}

export type DocResult =
  | { ok: true; title: string; summary: string; answer: string; applied: Change[]; skipped: number; skippedWhy: string[]; plans: string[]; notes: string[]; cant: string; missing: string; wordsBefore: number; wordsAfter: number; offered: string[]; offeredCites: string[]; sourceSearch: string; requirements: { req: string; met: boolean; note?: string }[]; assignment: string }
  | { ok: false; text: string };

/** Do what they asked to the doc, check it, finish what's missing. */
export async function docWork(
  io: DocIO,
  ask: string,
  opts: { rubric?: string; assignment?: { label: string; brief: string }; live?: (c: Change, i: number, n: number) => void; status?: (t: string) => void; progress?: (changes: Change[]) => void; stream?: boolean } = {}
): Promise<DocResult> {
  const first = await io.read();
  const ps0 = paragraphs(first.content);
  const wordsBefore = docWords(first.content);
  if (!ps0.length || ps0.every((p) => !p.text.trim())) {
    // an empty doc is fine for "write an intro", not for "edit"
    if (!/\b(write|add|start|draft|make|create|put)\b/i.test(ask)) return { ok: false, text: "That doc is empty. Write a draft (even a rough one), or tell me what to write in it." };
  }
  if (ps0.reduce((n, p) => n + p.text.length, 0) > 150000) return { ok: false, text: "That doc is really long. Tell me which part to work on, like “my intro” or “section 2”." };

  // sources first (only when asked): real ones, each with its exact citation, so the plan can't invent any
  let sourceBlock = "";
  let offered: string[] = [];
  let offeredCites: string[] = [];
  if (WANTS_SOURCES.test(ask)) {
    opts.status?.("Finding real sources…");
    // the paper's real title (its Title/Heading line) beats the file name
    const paperTitle = ps0.find((p) => p.style === "TITLE" || p.style === "HEADING_1")?.text || ps0.find((p) => p.props.alignment === "CENTER" && p.text.split(/\s+/).length <= 12)?.text || first.title;
    const src = await gatherSources(ask, ps0.map((p) => p.text).join("\n"), paperTitle);
    offered = src.list.map((x) => x.entry);
    offeredCites = src.list.map((x) => x.inText);
    sourceBlock = src.list.length
      ? `\n\nREAL SOURCES you may cite (${src.style}). Use ONLY these. Copy the in-text citation and the list entry EXACTLY as written:\n${src.list
          .map((x, i) => `[S${i + 1}] ${x.s.title} (${x.s.year ?? x.s.date ?? "n.d."})${x.notes ? ` — ${x.notes}` : ""}\n   in-text: ${x.inText}\n   entry: ${x.entry}`)
          .join("\n")}\nCiting: put the in-text citation just before the final period of the sentence it supports (replace_text on that sentence's ending), only where the source really supports it. Then the list: if the paper has no ${src.style === "APA" ? "References" : "Works Cited"} list, insert at the very end a heading paragraph "${src.style === "APA" ? "References" : "Works Cited"}" (align CENTER${src.style === "APA" ? ", bold" : ""}) followed by one paragraph per source you cited (hanging: true), alphabetical. If a list exists, insert the new entries into it in alphabetical order. Cite as many sources as they asked for (default 3).`
      : "\n\nThey asked for sources, but none could be found and verified right now. Don't cite anything; say so in cant.";
  }

  const applied: Change[] = [];
  let skipped = 0;
  const skippedWhy: string[] = [];
  const plans: string[] = [];
  let plan: Plan | null = null;
  let missing = "";
  let summary = "";
  let answer = "";
  let cant = "";
  let notes: string[] = [];
  let requirements: { req: string; met: boolean; note?: string }[] = [];
  for (let round = 0; round < 3; round++) {
    const doc = round === 0 ? first : await io.read();
    const ps = paragraphs(doc.content);
    const msg = round === 0
      ? `The student said: "${ask}"\n\nDocument title: ${doc.title}\n\n${listing(ps)}${sourceBlock}`
      : `The student said: "${ask}"\n\nYou already made changes, but this is still missing: ${missing}\nDo ONLY what's missing, and don't touch any paragraph the request doesn't involve. If nothing concrete is missing, return no actions. Paragraph numbers below are the doc as it is now.\n\nDocument title: ${doc.title}\n\n${listing(ps)}${sourceBlock}`;
    opts.status?.(round === 0 ? `Reading “${doc.title}”…` : "Finishing the rest…");
    // stream the plan: each action is applied to the doc (Milo's copy) the moment it's written
    const applier = opApplier(io, opts.live, { groupBase: round * 1000 });
    const body = { model: models.smart(), max_tokens: 12000, system: system(opts.rubric ?? "", opts.assignment), tools: [PLAN_TOOL], messages: [{ role: "user", content: msg }] };
    let sent = 0;
    let chain = Promise.resolve();
    const feed = (ops: Op[]) => {
      for (; sent < ops.length; sent++) {
        const op = ops[sent];
        const k = sent;
        chain = chain.then(async () => {
          await applier.apply(op, k);
          opts.progress?.([...applied, ...applier.changes]);
        });
      }
    };
    let r = opts.stream === false ? null : await streamTool<Plan>(body, PLAN_TOOL.name, (json) => feed(completedItems<Op>(json, "ops")));
    await chain;
    if (!r || (!r.ok && sent === 0)) {
      // no streaming (or it failed before any action): the plain call
      if (r && !r.ok) bb("docwork", "stream_fallback", { why: r.text.slice(0, 120) });
      r = await callTool<Plan>({ ...body, tool_choice: { type: "auto" } }, PLAN_TOOL.name);
    }
    if (!r.ok) {
      if (!applied.length && !applier.changes.length) return { ok: false, text: r.text };
      applied.push(...applier.changes);
      break;
    }
    plan = { ...r.data, ops: Array.isArray(r.data.ops) ? r.data.ops : [], notes: r.data.notes ?? [] };
    feed(plan.ops); // anything the stream didn't hand over yet
    await chain;
    if (round === 0) {
      summary = plan.summary;
      answer = plan.answer ?? "";
      cant = plan.cant ?? "";
      notes = plan.notes.slice(0, 3);
    }
    if (Array.isArray(plan.requirements) && plan.requirements.length) requirements = plan.requirements.slice(0, 12);
    plans.push(plan.ops.map((o) => `${o.op}(${o.para ?? ""}${o.after !== undefined ? `→${o.after}` : ""})`).join(" ") || `none${plan.cant ? ` cant: ${plan.cant}` : ""}${plan.answer ? " (answered)" : ""}`);
    bb("docwork", "plan", { round, understood: plan.understood?.slice(0, 120), ops: plan.ops.map((o) => o.op), answer: !!plan.answer, cant: !!plan.cant, streamed: opts.stream !== false });
    applied.push(...applier.changes);
    skipped += applier.skipped.length;
    skippedWhy.push(...applier.skipped.map((x) => `${x.op.op}: ${x.why}`));
    if (applier.skipped.length) bb("docwork", "skipped", { why: applier.skipped.map((x) => x.why) });
    if (!plan.ops.length) break; // a question, or nothing more it can do

    // the check: does the doc now match the request?
    opts.status?.("Checking it's what you asked…");
    const after = paragraphs((await io.read()).content);
    const changeList = applied
      .map((c) =>
        c.op === "format"
          ? `- format ${c.find === "(the whole paper)" ? "the whole paper" : `"${c.find.slice(0, 80)}"`}: ${JSON.stringify({ ...c.after?.ps, ...c.after?.ts })}`
          : c.op === "style"
            ? `- "${c.find.slice(0, 80)}" is now ${c.style}`
            : `- ${c.op}: ${c.find ? `"${c.find.slice(0, 120)}" → ` : ""}${c.replace ? `"${c.replace.slice(0, 200)}"` : "(removed)"}`
      )
      .join("\n");
    const chk = await callTool<{ done: boolean; missing: string; extra: string }>(
      {
        model: models.fast(),
        max_tokens: 600,
        system: "You check a writing assistant's work on a student's Google Doc. List the parts of the request, then check each one was carried out in the doc as it is now. Formatting shows in [brackets] after each paragraph number (e.g. double spaced, indent 36pt, centered, Times New Roman, 12pt); a changes list entry 'format' also means it was applied. Judge whether it was DONE, not how well: improving, rewriting, shortening or strengthening something counts as done once that thing was changed in that direction. Never ask for more polish. If something is missing, say exactly what, in a few words.",
        tools: [CHECK_TOOL],
        tool_choice: { type: "auto" },
        messages: [{ role: "user", content: `Request: "${ask}"\n\nChanges made:\n${changeList || "(none)"}\n\nThe doc now:\n${listing(after)}` }],
      },
      CHECK_TOOL.name
    );
    if (!chk.ok) break;
    bb("docwork", "check", { round, done: chk.data.done, missing: chk.data.missing?.slice(0, 160), extra: chk.data.extra?.slice(0, 120) });
    if (chk.data.done) {
      missing = "";
      break;
    }
    missing = (chk.data.missing || "").trim();
    if (!missing || /^part of the request$/i.test(missing)) {
      // the checker couldn't say what's missing: nothing concrete to do, so stop here
      missing = "";
      break;
    }
  }
  const end = await io.read();
  return { ok: true, title: first.title, summary: summary || (applied.length ? "Done." : "I read it."), answer, applied, skipped, skippedWhy, plans, notes, requirements, assignment: opts.assignment?.label ?? "", offered, offeredCites, sourceSearch: offered.length || WANTS_SOURCES.test(ask) ? lastTopic : "", cant, missing, wordsBefore, wordsAfter: docWords(end.content) };
}
