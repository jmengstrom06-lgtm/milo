// Editing a Google Doc in place, safely. Pure (tested): google.ts fetches the doc, paperEdit.ts asks the AI.
//
// The doc is read as plain text WITH a map from each character to its Docs index, so an edit is
// "replace this exact text" (found once, not a guess at a position). Edits go bottom-up so earlier
// positions never shift, the student's formatting stays (inserted text takes the style around it),
// and every edit can be undone by swapping back.

export type DocEl = {
  startIndex?: number;
  endIndex?: number;
  paragraph?: { elements?: { startIndex?: number; textRun?: { content?: string; textStyle?: Record<string, unknown> } }[]; paragraphStyle?: { namedStyleType?: string } & Record<string, unknown>; bullet?: { listId?: string; nestingLevel?: number; kind?: string } };
  table?: { tableRows?: { tableCells?: { content?: DocEl[] }[] }[] };
};
export type DocText = { text: string; at: number[] }; // at[i] = Docs index of text[i]

/** Flatten a Docs body into text + index map (tables included, cell by cell). */
export function flatten(content: DocEl[] = []): DocText {
  let text = "";
  const at: number[] = [];
  const walk = (els: DocEl[]) => {
    for (const el of els) {
      for (const r of el.paragraph?.elements ?? []) {
        const s = r.textRun?.content ?? "";
        const start = r.startIndex ?? 0;
        for (let i = 0; i < s.length; i++) {
          text += s[i];
          at.push(start + i);
        }
      }
      for (const row of el.table?.tableRows ?? []) for (const cell of row.tableCells ?? []) walk(cell.content ?? []);
    }
  };
  walk(content);
  return { text, at };
}

/** Curly quotes, dashes and spaces differ between what the AI writes and what's in the doc: compare loosely. */
const norm = (s: string) => s.replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/ /g, " ");

/** Where `find` sits in the text: the one place it appears (null if it's missing or appears more than once). */
export function locate(doc: DocText, find: string): { from: number; to: number } | null {
  if (!find || find.length < 3) return null;
  const hay = norm(doc.text);
  const needle = norm(find);
  const i = hay.indexOf(needle);
  if (i < 0 || hay.indexOf(needle, i + 1) >= 0) return null;
  return { from: i, to: i + needle.length };
}

export type Edit = { find: string; replace: string; why: string; kind?: string };
export type Planned = Edit & { start: number; end: number }; // Docs indexes

/** Turn AI edits into exact, non-overlapping Docs ranges. Anything that can't be placed safely is dropped. (pure) */
/** The part of the paper the student asked about ("edit my intro" / "my conclusion"), as a range of the flat text.
 *  Body paragraphs are the real ones (12+ words), so a title, name or date line isn't mistaken for the intro. (pure) */
export function scopeOf(text: string, ask: string): { from: number; to: number; part: string } | null {
  const a = ask.toLowerCase();
  const part = /\bintro(duction)?\b|\bfirst paragraph\b/.test(a) ? "intro" : /\bconclusion\b|\blast paragraph\b/.test(a) ? "conclusion" : "";
  if (!part) return null;
  const paras: { from: number; to: number }[] = [];
  let i = 0;
  for (const line of text.split("\n")) {
    if (words(line) >= 12) paras.push({ from: i, to: i + line.length });
    i += line.length + 1;
  }
  if (paras.length < 2) return null;
  const p = part === "intro" ? paras[0] : paras[paras.length - 1];
  return { ...p, part };
}

export function plan(doc: DocText, edits: Edit[], scope?: { from: number; to: number } | null): { ok: Planned[]; dropped: (Edit & { reason: string })[] } {
  const ok: Planned[] = [];
  const dropped: (Edit & { reason: string })[] = [];
  for (const e of edits) {
    if (!e || typeof e.find !== "string" || typeof e.replace !== "string") continue;
    if (norm(e.find) === norm(e.replace)) {
      dropped.push({ ...e, reason: "no change" });
      continue;
    }
    if (/\n/.test(e.find.trim())) {
      dropped.push({ ...e, reason: "spans paragraphs" }); // keep edits inside one paragraph: structure stays intact
      continue;
    }
    const loc = locate(doc, e.find);
    if (!loc) {
      dropped.push({ ...e, reason: "not found once" });
      continue;
    }
    if (scope && (loc.from < scope.from || loc.to > scope.to)) {
      dropped.push({ ...e, reason: "outside the part you asked for" });
      continue;
    }
    const start = doc.at[loc.from];
    const end = doc.at[loc.to - 1] + 1;
    if (end - start !== loc.to - loc.from) {
      dropped.push({ ...e, reason: "crosses formatting" }); // e.g. a footnote or smart chip inside
      continue;
    }
    if (ok.some((p) => start < p.end && end > p.start)) {
      dropped.push({ ...e, reason: "overlaps another edit" });
      continue;
    }
    ok.push({ ...e, start, end, replace: e.replace.replace(/\n+/g, " ") });
  }
  ok.sort((a, b) => b.start - a.start); // bottom-up
  return { ok, dropped };
}

/** The Docs requests for one edit (delete the old words, insert the new ones in the same spot). */
export function requestsFor(p: Planned): unknown[] {
  const reqs: unknown[] = [{ deleteContentRange: { range: { startIndex: p.start, endIndex: p.end } } }];
  if (p.replace) reqs.push({ insertText: { location: { index: p.start }, text: p.replace } });
  return reqs;
}

/** How to take edits back: swap each new text for the old (found by text, so later typing doesn't break it). */
export const undoOf = (applied: Edit[]): Edit[] => applied.map((e) => ({ find: e.replace, replace: e.find, why: "undo", kind: "undo" }));

/** Word count the way teachers count. */
export const words = (s: string) => (s.match(/\b[\w'’-]+\b/g) ?? []).length;

/** The doc id from a Google Docs link. */
export function docIdFrom(url: string): string | null {
  return url.match(/docs\.google\.com\/document\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]{20,})/)?.[1] ?? null;
}
