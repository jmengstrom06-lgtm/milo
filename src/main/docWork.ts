// The thinking half of the doc agent: read the doc, plan with every action, apply, then CHECK the result
// against what the student asked and finish anything missing (up to two more passes). Honest at the end:
// if something couldn't be done, the reply says so instead of quietly doing something else.

import { callTool, persona } from "./brain";
import { log as bb } from "./blackbox";
import { models } from "./gateway";
import { applyPlan, docWords, listing, paragraphs, type Change, type DocIO, type Plan } from "./docAgent";

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
            op: { type: "string", enum: ["replace_text", "rewrite_paragraph", "insert", "delete", "move", "set_style"] },
            para: { type: "number", description: "The paragraph (P number) this acts on." },
            after: { type: "number", description: "insert/move: the P number it goes after. 0 = the very top. The last P number = the very end." },
            find: { type: "string", description: "replace_text: exact text from that paragraph, copied character for character." },
            replace: { type: "string", description: "replace_text: what it becomes (never empty)." },
            text: { type: "string", description: "rewrite_paragraph: the paragraph's full new text." },
            paragraphs: {
              type: "array",
              description: "insert: the new paragraphs, in order. Use a heading paragraph only if it fits the paper.",
              items: { type: "object", properties: { text: { type: "string" }, style: { type: "string", enum: ["NORMAL_TEXT", "TITLE", "SUBTITLE", "HEADING_1", "HEADING_2", "HEADING_3"] } }, required: ["text"] },
            },
            style: { type: "string", enum: ["NORMAL_TEXT", "TITLE", "SUBTITLE", "HEADING_1", "HEADING_2", "HEADING_3"] },
            why: { type: "string", description: "A few words the student sees: why this change." },
          },
          required: ["op", "why"],
        },
      },
      summary: { type: "string", description: "One plain sentence for the student, past tense: what you did (or the answer, short)." },
      cant: { type: "string", description: "Anything they asked that you can't do in a Google Doc from here (images, tables, comments, fonts/colors, page setup, sharing), else empty." },
      notes: { type: "array", items: { type: "string" }, description: "Up to 3 short tips for things only the student can do (e.g. a claim that needs a source)." },
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
      done: { type: "boolean", description: "true only if EVERY part of the request is done in the doc." },
      missing: { type: "string", description: "If not done: exactly what's still missing or wrong, as an instruction. Else empty." },
      extra: { type: "string", description: "Anything changed that they did NOT ask for, else empty." },
    },
    required: ["done", "missing", "extra"],
  },
};

function system(rubric: string): string {
  // No keyword rules here (they misfire: "move X right after my intro" is not "edit only the intro").
  // The request itself says what to do and where; the agent reads it whole.
  return `${persona()}
Today is ${new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}.
You work on a college student's own Google Doc while they watch. Do EXACTLY what they asked, all of it, and nothing they didn't ask for.
- Read the request literally. "Add a section with your thoughts" = insert new paragraphs (don't also fix grammar). "Fix the grammar" = only grammar. "Edit it" or "make it better" = a real edit of grammar, clarity, flow and wording. A question = answer it with no actions.
- Pick the right action: replace_text for words and phrases; rewrite_paragraph for a heavier rewrite of one paragraph; insert to add anything new (sections, sentences as their own paragraph, a conclusion, a heading); delete; move to reorder; set_style for headings and titles.
- "After the paper" / "at the end" = after the last paragraph. "Before the conclusion" = after the paragraph before the conclusion. A header block (name, professor, class, date) is not the paper's start.
- New writing: match the paper's voice, level and formatting. A new section is usually a short heading paragraph only if the paper already uses headings or they asked for one; otherwise plain paragraphs.
- Keep their argument, facts, direct quotes and numbers unless they asked to change them. Never invent sources, statistics, quotes or citations (if they need sources, say "say 'find sources for my paper'" in notes).
- Word targets ("cut to 500 words") count the body, not the header block.
- A part of the paper named in the request ("my intro", "the CDC paragraph") is WHERE to act or a reference point, not a limit on everything else they asked.
- If part of the request can't be done in a Google Doc from here, still do the rest and say what you couldn't in "cant".
${rubric ? `Grade it against this rubric and make changes that close the gaps:\n${rubric.slice(0, 4000)}` : ""}`;
}

export type DocResult =
  | { ok: true; title: string; summary: string; answer: string; applied: Change[]; skipped: number; skippedWhy: string[]; plans: string[]; notes: string[]; cant: string; missing: string; wordsBefore: number; wordsAfter: number }
  | { ok: false; text: string };

/** Do what they asked to the doc, check it, finish what's missing. */
export async function docWork(io: DocIO, ask: string, opts: { rubric?: string; live?: (c: Change, i: number, n: number) => void; status?: (t: string) => void } = {}): Promise<DocResult> {
  const first = await io.read();
  const ps0 = paragraphs(first.content);
  const wordsBefore = docWords(first.content);
  if (!ps0.length || ps0.every((p) => !p.text.trim())) {
    // an empty doc is fine for "write an intro", not for "edit"
    if (!/\b(write|add|start|draft|make|create|put)\b/i.test(ask)) return { ok: false, text: "That doc is empty. Write a draft (even a rough one), or tell me what to write in it." };
  }
  if (ps0.reduce((n, p) => n + p.text.length, 0) > 150000) return { ok: false, text: "That doc is really long. Tell me which part to work on, like “my intro” or “section 2”." };

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
  for (let round = 0; round < 3; round++) {
    const doc = round === 0 ? first : await io.read();
    const ps = paragraphs(doc.content);
    const msg = round === 0
      ? `The student said: "${ask}"\n\nDocument title: ${doc.title}\n\n${listing(ps)}`
      : `The student said: "${ask}"\n\nYou already made changes, but this is still missing: ${missing}\nDo ONLY what's missing. Paragraph numbers below are the doc as it is now.\n\nDocument title: ${doc.title}\n\n${listing(ps)}`;
    opts.status?.(round === 0 ? `Reading “${doc.title}”…` : "Finishing the rest…");
    const r = await callTool<Plan>({ model: models.smart(), max_tokens: 12000, system: system(opts.rubric ?? ""), tools: [PLAN_TOOL], tool_choice: { type: "auto" }, messages: [{ role: "user", content: msg }] }, PLAN_TOOL.name);
    if (!r.ok) {
      if (!applied.length) return { ok: false, text: r.text };
      break;
    }
    plan = { ...r.data, ops: Array.isArray(r.data.ops) ? r.data.ops : [], notes: r.data.notes ?? [] };
    if (round === 0) {
      summary = plan.summary;
      answer = plan.answer ?? "";
      cant = plan.cant ?? "";
      notes = plan.notes.slice(0, 3);
    }
    plans.push(plan.ops.map((o) => `${o.op}(${o.para ?? ""}${o.after !== undefined ? `→${o.after}` : ""})`).join(" ") || `none${plan.cant ? ` cant: ${plan.cant}` : ""}${plan.answer ? " (answered)" : ""}`);
    bb("docwork", "plan", { round, understood: plan.understood?.slice(0, 120), ops: plan.ops.map((o) => o.op), answer: !!plan.answer, cant: !!plan.cant });
    if (!plan.ops.length) break; // a question, or nothing more it can do
    opts.status?.(`Making ${plan.ops.length} change${plan.ops.length === 1 ? "" : "s"}…`);
    const res = await applyPlan(io, plan, opts.live);
    applied.push(...res.changes);
    skipped += res.skipped.length;
    skippedWhy.push(...res.skipped.map((s) => `${s.op.op}: ${s.why}`));
    if (res.skipped.length) bb("docwork", "skipped", { why: res.skipped.map((s) => s.why) });

    // the check: does the doc now match the request?
    opts.status?.("Checking it's what you asked…");
    const after = paragraphs((await io.read()).content);
    const changeList = applied.map((c) => `- ${c.op}: ${c.find ? `"${c.find.slice(0, 120)}" → ` : ""}${c.replace ? `"${c.replace.slice(0, 200)}"` : "(removed)"}`).join("\n");
    const chk = await callTool<{ done: boolean; missing: string; extra: string }>(
      {
        model: models.fast(),
        max_tokens: 600,
        system: "You check a writing assistant's work on a student's Google Doc. Compare the request with the doc as it is now. Be strict about whether every part of the request was done; don't nitpick quality.",
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
    missing = chk.data.missing || "part of the request";
  }
  const end = await io.read();
  return { ok: true, title: first.title, summary: summary || (applied.length ? "Done." : "I read it."), answer, applied, skipped, skippedWhy, plans, notes, cant, missing, wordsBefore, wordsAfter: docWords(end.content) };
}
