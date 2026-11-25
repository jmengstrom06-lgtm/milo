// "Read this chapter": a PDF, Word doc or web page (any length) -> notes in Milo's Notes app, flashcards in Study,
// and a practice quiz ready to go. Long PDFs are read in parts (up to ~90 pages each), then merged.

import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { PDFDocument } from "pdf-lib";
import { callTool, persona } from "./brain";
import { log as bb } from "./blackbox";
import { models } from "./gateway";
import { addNote } from "./kitipc";
import { saveItem } from "./library";
import { classFor } from "./classes";

export type ReadingNotes = {
  title: string;
  summary: string;
  sections: { heading: string; points: string[] }[];
  key_terms: { term: string; definition: string }[];
  exam_alerts: string[];
  flashcards: { q: string; a: string }[];
  quiz: { q: string; choices: string[]; correct: number; why: string }[];
};
const READ_TOOL = {
  name: "reading_notes",
  description: "Study material from a course reading.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "What the reading is, short (e.g. 'Ch. 7: The Cell Cycle')." },
      summary: { type: "string", description: "4 to 6 sentences: the main ideas, like a great TA would explain them." },
      sections: { type: "array", items: { type: "object", properties: { heading: { type: "string" }, points: { type: "array", items: { type: "string" } } }, required: ["heading", "points"] }, description: "The reading in order: clear bullets with definitions, formulas, examples, dates, causes and effects." },
      key_terms: { type: "array", items: { type: "object", properties: { term: { type: "string" }, definition: { type: "string" } }, required: ["term", "definition"] } },
      exam_alerts: { type: "array", items: { type: "string" }, description: "What's most likely on a test: bolded terms, chapter objectives, review-question topics, anything the text stresses. Up to 6." },
      flashcards: { type: "array", items: { type: "object", properties: { q: { type: "string" }, a: { type: "string" } }, required: ["q", "a"] }, description: "10 to 25 flashcards on what the reading actually says." },
      quiz: {
        type: "array",
        description: "8 multiple choice questions like a real exam (apply and understand, not just recall), 4 choices each.",
        items: { type: "object", properties: { q: { type: "string" }, choices: { type: "array", items: { type: "string" } }, correct: { type: "number" }, why: { type: "string" } }, required: ["q", "choices", "correct", "why"] },
      },
    },
    required: ["title", "summary", "sections", "key_terms", "exam_alerts", "flashcards", "quiz"],
  },
};

const PART_PAGES = 90;
type Input = { kind: "pdf"; b64: string; pages?: string } | { kind: "text"; text: string };

/** Split a PDF into parts the AI can read (each under the page limit). */
export async function pdfParts(bytes: Uint8Array, per = PART_PAGES): Promise<{ b64: string; pages: string }[]> {
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const n = src.getPageCount();
  if (n <= per) return [{ b64: Buffer.from(bytes).toString("base64"), pages: `1-${n}` }];
  const out: { b64: string; pages: string }[] = [];
  for (let i = 0; i < n; i += per) {
    const part = await PDFDocument.create();
    const idx = Array.from({ length: Math.min(per, n - i) }, (_, k) => i + k);
    for (const p of await part.copyPages(src, idx)) part.addPage(p);
    out.push({ b64: Buffer.from(await part.save()).toString("base64"), pages: `${i + 1}-${i + idx.length}` });
  }
  return out;
}

/** Word, RTF, HTML, OpenDocument: macOS turns them into text itself (textutil). */
function textOf(file: string): Promise<string> {
  return new Promise((resolve) => execFile("textutil", ["-convert", "txt", "-stdout", file], { maxBuffer: 50e6, timeout: 30000 }, (err, out) => resolve(err ? "" : String(out))));
}

async function notesFrom(input: Input, opts: { course: string; ask: string; part?: string }): Promise<ReadingNotes | { error: string }> {
  const content =
    input.kind === "pdf"
      ? [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: input.b64 } }, { type: "text", text: `Make study material from this reading${opts.part ? ` (pages ${opts.part})` : ""}.${opts.ask ? ` The student said: "${opts.ask}"` : ""}` }]
      : [{ type: "text", text: `Reading:\n\n${input.text.slice(0, 400000)}\n\nMake study material from it.${opts.ask ? ` The student said: "${opts.ask}"` : ""}` }];
  const r = await callTool<ReadingNotes>(
    {
      model: models.smart(),
      max_tokens: 12000,
      system: `${persona()}\nYou turn a course reading into excellent study material for a college student. Be accurate: only what the reading says. Keep numbers, formulas, names and dates exact.${opts.course ? ` The class is ${opts.course}.` : ""}`,
      tools: [READ_TOOL],
      tool_choice: { type: "auto" },
      messages: [{ role: "user", content: content as never }],
    },
    READ_TOOL.name
  );
  if (!r.ok) return { error: r.text };
  const d = r.data;
  return {
    title: d.title || "Reading",
    summary: d.summary || "",
    sections: d.sections ?? [],
    key_terms: d.key_terms ?? [],
    exam_alerts: d.exam_alerts ?? [],
    flashcards: d.flashcards ?? [],
    quiz: (d.quiz ?? []).filter((q) => q && Array.isArray(q.choices) && q.choices.length >= 2).map((q) => ({ ...q, choices: q.choices.slice(0, 4), correct: Math.max(0, Math.min(3, Math.round(q.correct))) })),
  };
}

/** Several parts' notes -> one set (sections in order, no duplicate terms, best cards and questions). (pure) */
export function mergeNotes(parts: ReadingNotes[]): ReadingNotes {
  if (parts.length === 1) return parts[0];
  const seen = new Set<string>();
  return {
    title: parts[0].title.replace(/\s*\((?:part|pages?)[^)]*\)\s*$/i, ""),
    summary: parts.map((p) => p.summary).join(" "),
    sections: parts.flatMap((p) => p.sections),
    key_terms: parts.flatMap((p) => p.key_terms).filter((k) => !seen.has(k.term.toLowerCase()) && seen.add(k.term.toLowerCase())),
    exam_alerts: parts.flatMap((p) => p.exam_alerts).slice(0, 8),
    flashcards: parts.flatMap((p) => p.flashcards).slice(0, 40),
    quiz: parts.flatMap((p) => p.quiz.slice(0, Math.ceil(10 / parts.length))).slice(0, 10),
  };
}

export function readingText(n: ReadingNotes, meta: { course: string; source: string; pages?: number }): string {
  const out: string[] = [`${meta.course ? `${meta.course} · ` : ""}${meta.source}${meta.pages ? ` · ${meta.pages} pages` : ""}`];
  if (n.summary) out.push("", "SUMMARY", n.summary);
  if (n.exam_alerts.length) out.push("", "⚠️ LIKELY ON THE TEST", ...n.exam_alerts.map((x) => `• ${x}`));
  for (const s of n.sections) out.push("", s.heading.toUpperCase(), ...s.points.map((p) => `• ${p}`));
  if (n.key_terms.length) out.push("", "KEY TERMS", ...n.key_terms.map((k) => `• ${k.term}: ${k.definition}`));
  return out.join("\n");
}

export type ReadResult = { ok: true; title: string; course: string; noteId: string; studyId: string | null; pages: number; terms: number; cards: number; alerts: number; quiz: ReadingNotes["quiz"]; summary: string } | { ok: false; text: string };

/** Read a file (PDF, Word, text) or text already pulled from a page. `progress` narrates long ones. */
export async function readThis(src: { file?: string; pdf?: Uint8Array; text?: string; name?: string }, ask: string, progress: (t: string) => void = () => {}): Promise<ReadResult> {
  const k = classFor(ask);
  const course = k?.name ?? "";
  let inputs: { input: Input; pages: string }[] = [];
  let pages = 0;
  const name = src.name ?? (src.file ? path.basename(src.file) : "the reading");
  try {
    if (src.pdf || (src.file && /\.pdf$/i.test(src.file))) {
      const bytes = src.pdf ?? new Uint8Array(fs.readFileSync(src.file!));
      if (bytes.length > 150e6) return { ok: false, text: "That PDF is huge. Send me the chapter you need (or a smaller file)." };
      const parts = await pdfParts(bytes);
      pages = Number(parts[parts.length - 1].pages.split("-")[1]) || 0;
      inputs = parts.map((p) => ({ input: { kind: "pdf", b64: p.b64 }, pages: p.pages }));
    } else if (src.file && /\.(docx?|rtf|odt|html?|txt|md)$/i.test(src.file)) {
      const text = /\.(txt|md)$/i.test(src.file) ? fs.readFileSync(src.file, "utf8") : await textOf(src.file);
      if (text.trim().length < 200) return { ok: false, text: "I couldn't get the text out of that file." };
      inputs = [{ input: { kind: "text", text }, pages: "" }];
    } else if (src.text && src.text.trim().length >= 200) {
      inputs = [{ input: { kind: "text", text: src.text }, pages: "" }];
    } else return { ok: false, text: "I can read PDFs, Word docs and web pages. Drop the file on me, or open it and say “read this.”" };
  } catch (e) {
    bb("reading", "load_failed", { error: (e as Error).message.slice(0, 120) });
    return { ok: false, text: /encrypt|password/i.test((e as Error).message) ? "That PDF is locked with a password. Open it, save an unlocked copy, and drop that on me." : "I couldn't open that file." };
  }
  progress(pages > 40 ? `Reading all ${pages} pages…` : "Reading it…");
  const done: ReadingNotes[] = [];
  for (let i = 0; i < inputs.length; i++) {
    if (inputs.length > 1) progress(`Reading pages ${inputs[i].pages} (${i + 1} of ${inputs.length})…`);
    const n = await notesFrom(inputs[i].input, { course, ask, part: inputs.length > 1 ? inputs[i].pages : undefined });
    if ("error" in n) {
      bb("reading", "part_failed", { part: i, error: n.error.slice(0, 120) });
      if (!done.length && i === inputs.length - 1) return { ok: false, text: /scanned|image|empty/i.test(n.error) ? "I couldn't read the text in that file." : "I couldn't finish reading that. Try again in a minute." };
      continue;
    }
    done.push(n);
  }
  if (!done.length) return { ok: false, text: "I couldn't read that one. Try again in a minute." };
  const n = mergeNotes(done);
  const note = addNote({ title: n.title, course: course || "General", body: readingText(n, { course, source: name, pages }) });
  const study = n.flashcards.length
    ? saveItem({
        app: "study",
        title: `${n.title}: flashcards`,
        classId: k?.id ?? null,
        data: { title: `${n.title}: flashcards`, subject: course, say: "", items: n.flashcards.map((c, i) => ({ id: `${note.id}-${i}`, kind: "card", skill: n.title, prompt: c.q, answer: c.a, hint: "", steps: [], graph: null })) },
      })
    : null;
  bb("reading", "done", { pages, parts: inputs.length, sections: n.sections.length, terms: n.key_terms.length, cards: n.flashcards.length, quiz: n.quiz.length });
  return { ok: true, title: n.title, course, noteId: note.id, studyId: study?.id ?? null, pages, terms: n.key_terms.length, cards: n.flashcards.length, alerts: n.exam_alerts.length, quiz: n.quiz, summary: n.summary };
}
