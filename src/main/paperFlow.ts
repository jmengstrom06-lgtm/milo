// The paper panel's flow. Milo reads the paper (an open Google Doc, a Word file, or pasted text), does the work
// on an in-memory copy (fast, and the real doc isn't touched), and shows the result as tracked changes.
// The student accepts all or some; only then are the accepted changes written, in one go, and undoable.
// Text sources (Word, pasted) come back out as a Google Doc, a Word file, or the clipboard.

import { clipboard, shell } from "electron";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { log as bb } from "./blackbox";
import { SimDoc } from "./docSim";
import { docWords, redoChanges, type Change, type DocIO } from "./docAgent";
import { docWork, type DocResult } from "./docWork";
import { paperRows, type Row } from "./paperDiff";
import type { DocEl } from "./docEdit";

export type Source = { type: "gdoc"; docId: string } | { type: "text"; file?: string };
type Proposal = { id: string; title: string; ask: string; source: Source; orig: DocEl[]; changes: Change[]; at: number };
const proposals = new Map<string, Proposal>();

export type PaperView = {
  id: string;
  title: string;
  source: "gdoc" | "text";
  file?: string;
  summary: string;
  cant: string;
  missing: string;
  notes: string[];
  rows: Row[];
  groups: { id: number; why: string; kind: string }[];
  wordsBefore: number;
  wordsAfter: number;
};

/** The view of the paper before any work (the panel opens with this right away). */
export function firstLook(content: DocEl[]): Row[] {
  const s = SimDoc.fromContent(content).full();
  return paperRows(s, s, []);
}

/** Do the work on a copy and return what the panel shows (or an answer, if they only asked a question). */
export async function propose(
  read: () => Promise<{ title: string; content: DocEl[] }>,
  ask: string,
  source: Source,
  opts: { rubric?: string; status?: (t: string) => void } = {}
): Promise<{ ok: true; view: PaperView | null; answer: string; summary: string; cant: string } | { ok: false; text: string }> {
  const real = await read();
  const copy = SimDoc.fromContent(real.content);
  const before = copy.full();
  const io: DocIO = { read: async () => ({ title: real.title, content: copy.content() }), batch: async (r) => copy.apply(r) };
  const t0 = Date.now();
  const r: DocResult = await docWork(io, ask, { rubric: opts.rubric, status: opts.status });
  if (!r.ok) return r;
  bb("paper", "proposed", { ms: Date.now() - t0, changes: r.applied.length, answer: !!r.answer, missing: !!r.missing, source: source.type });
  if (!r.applied.length) return { ok: true, view: null, answer: r.answer, summary: r.summary, cant: r.cant };
  const id = `p${Date.now().toString(36)}`;
  proposals.set(id, { id, title: real.title, ask, source, orig: real.content, changes: r.applied, at: Date.now() });
  for (const [k, p] of proposals) if (Date.now() - p.at > 6 * 3600e3) proposals.delete(k);
  const groups = [...new Map(r.applied.map((c) => [c.group ?? 0, { id: c.group ?? 0, why: c.why || c.kind || "change", kind: c.kind ?? "edit" }])).values()];
  return {
    ok: true,
    answer: r.answer,
    summary: r.summary,
    cant: r.cant,
    view: {
      id,
      title: real.title,
      source: source.type,
      file: source.type === "text" ? source.file : undefined,
      summary: r.summary,
      cant: r.cant,
      missing: r.missing,
      notes: r.notes,
      rows: paperRows(before, copy.full(), r.applied),
      groups,
      wordsBefore: r.wordsBefore,
      wordsAfter: r.wordsAfter,
    },
  };
}

const accepted = (p: Proposal, rejected: number[]) => p.changes.filter((c) => !rejected.includes(c.group ?? 0));

/** The paper with only the accepted changes (when the student taps a change off and on). */
export async function preview(id: string, rejected: number[]): Promise<{ rows: Row[]; wordsAfter: number } | null> {
  const p = proposals.get(id);
  if (!p) return null;
  const copy = SimDoc.fromContent(p.orig);
  const before = copy.full();
  const keep = accepted(p, rejected);
  await redoChanges(copy.io(), keep);
  return { rows: paperRows(before, copy.full(), keep), wordsAfter: docWords(copy.content()) };
}

/** Write the accepted changes to the real Google Doc. Returns what was written (for undo) and what couldn't be. */
export async function applyToDoc(id: string, rejected: number[], ioFor: (docId: string) => DocIO): Promise<{ ok: boolean; done: Change[]; missed: number; title: string; docId: string } | null> {
  const p = proposals.get(id);
  if (!p || p.source.type !== "gdoc") return null;
  const r = await redoChanges(ioFor(p.source.docId), accepted(p, rejected));
  bb("paper", "applied", { done: r.done.length, missed: r.missed.length });
  if (r.done.length) proposals.delete(id);
  return { ok: r.done.length > 0, done: r.done, missed: r.missed.length, title: p.title, docId: p.source.docId };
}

/** The finished paper (accepted changes only) as an in-memory doc. */
async function finished(p: Proposal, rejected: number[]) {
  const copy = SimDoc.fromContent(p.orig);
  await redoChanges(copy.io(), accepted(p, rejected));
  return copy;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** HTML for a Word file: headings, alignment, spacing, indents, bold/italic/underline, font and size. (pure) */
export function toHtml(doc: SimDoc, title: string): string {
  const css = (o: Record<string, unknown>) => Object.entries(o).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => `${k}:${v}`).join(";");
  const body = doc
    .full()
    .map((p) => {
      const st = String(p.ps.namedStyleType ?? "NORMAL_TEXT");
      const tag = st === "TITLE" ? "h1" : st === "HEADING_1" ? "h1" : st === "HEADING_2" ? "h2" : st === "HEADING_3" ? "h3" : st === "SUBTITLE" ? "h2" : "p";
      const al = String(p.ps.alignment ?? "START");
      const pStyle = css({
        "text-align": al === "CENTER" ? "center" : al === "END" ? "right" : al === "JUSTIFIED" ? "justify" : "",
        "line-height": p.ps.lineSpacing ? `${Number(p.ps.lineSpacing)}%` : "",
        "text-indent": (p.ps.indentStart as { magnitude?: number })?.magnitude ? `-${(p.ps.indentStart as { magnitude: number }).magnitude}pt` : (p.ps.indentFirstLine as { magnitude?: number })?.magnitude ? `${(p.ps.indentFirstLine as { magnitude: number }).magnitude}pt` : "",
        "margin-left": (p.ps.indentStart as { magnitude?: number })?.magnitude ? `${(p.ps.indentStart as { magnitude: number }).magnitude}pt` : "",
        margin: "0",
      });
      const runs = p.runs
        .map((r) => {
          const s = css({
            "font-family": (r.ts.weightedFontFamily as { fontFamily?: string })?.fontFamily ? `'${(r.ts.weightedFontFamily as { fontFamily: string }).fontFamily}'` : "",
            "font-size": (r.ts.fontSize as { magnitude?: number })?.magnitude ? `${(r.ts.fontSize as { magnitude: number }).magnitude}pt` : "",
          });
          let h = esc(r.text);
          if (r.ts.bold) h = `<b>${h}</b>`;
          if (r.ts.italic) h = `<i>${h}</i>`;
          if (r.ts.underline) h = `<u>${h}</u>`;
          return s ? `<span style="${s}">${h}</span>` : h;
        })
        .join("");
      return `<${tag}${pStyle ? ` style="${pStyle}"` : ""}>${runs || "&nbsp;"}</${tag}>`;
    })
    .join("\n");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title)}</title></head><body>\n${body}\n</body></html>`;
}

const run = (cmd: string, args: string[]) => new Promise<void>((res, rej) => execFile(cmd, args, (e) => (e ? rej(e) : res())));

/** A text source (Word, pasted) goes back out: a new Google Doc, a Word file next to the original, or the clipboard. */
export async function exportText(
  id: string,
  rejected: number[],
  to: "google" | "word" | "copy",
  google: { create: (title: string) => Promise<{ id: string; url: string }>; io: (docId: string) => DocIO }
): Promise<{ ok: boolean; text: string; url?: string; file?: string }> {
  const p = proposals.get(id);
  if (!p) return { ok: false, text: "That one expired. Ask me again." };
  const doc = await finished(p, rejected);
  const name = (p.title || "Paper").replace(/\.(docx?|rtf|odt|txt|md|html?)$/i, "").slice(0, 80);
  if (to === "copy") {
    clipboard.writeText(doc.full().map((x) => x.text).join("\n"));
    return { ok: true, text: "Copied. Paste it wherever you need it." };
  }
  if (to === "word") {
    const dir = p.source.type === "text" && p.source.file ? path.dirname(p.source.file) : path.join(os.homedir(), "Documents");
    const out = path.join(dir, `${name} (Milo).docx`);
    const tmp = path.join(os.tmpdir(), `milo-paper-${Date.now()}.html`);
    fs.writeFileSync(tmp, toHtml(doc, name));
    await run("/usr/bin/textutil", ["-convert", "docx", "-output", out, tmp]);
    fs.rmSync(tmp, { force: true });
    shell.showItemInFolder(out);
    return { ok: true, text: `Saved “${path.basename(out)}” next to your file.`, file: out };
  }
  // a Google Doc with the original text, then the accepted changes replayed on it (formatting comes along)
  const g = await google.create(name);
  const gio = google.io(g.id);
  const orig = SimDoc.fromContent(p.orig);
  const lines = orig.full().map((x) => x.text);
  if (lines.join("").trim()) await gio.batch([{ insertText: { location: { index: 1 }, text: lines.join("\n") } }]);
  await redoChanges(gio, accepted(p, rejected));
  void shell.openExternal(g.url);
  return { ok: true, text: "It's in a new Google Doc. I opened it for you.", url: g.url };
}
