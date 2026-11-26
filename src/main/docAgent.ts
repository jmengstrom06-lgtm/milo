// The doc agent: anything a student asks about the Google Doc they have open.
// Reads the whole doc, plans with EVERY action (fix words, rewrite, add sections anywhere, delete, move,
// headings), applies them live, then checks the result against what was asked and finishes anything missing.
// Nothing is forced into one shape: "add a section with your thoughts" adds a section; "what's my thesis?"
// just answers; "fix the grammar" only fixes grammar.
// Every change is recorded so it can be undone exactly, one at a time or all, even if the student typed since.
//
// Docs access is passed in (`io`), so tests run the real logic against a simulated doc.

import { flatten, words, type DocEl } from "./docEdit";

export type Style = "NORMAL_TEXT" | "TITLE" | "SUBTITLE" | "HEADING_1" | "HEADING_2" | "HEADING_3";
const STYLES: Style[] = ["NORMAL_TEXT", "TITLE", "SUBTITLE", "HEADING_1", "HEADING_2", "HEADING_3"];

export type Para = { n: number; text: string; start: number; end: number; style: Style; at: number[] };

/** A change Milo made, in the shape the cards already show (find → replace, why), plus what undo needs. */
export type Change = {
  op: "replace" | "insert" | "delete" | "style";
  find: string; // text before ("" for an insert)
  replace: string; // text after ("" for a delete)
  why: string;
  kind?: string;
  anchor?: string; // insert/delete: the paragraph it sits after ("" = top of the doc)
  styles?: Style[]; // insert/delete: each paragraph's style
  style?: Style; // style change: new
  oldStyle?: Style; // style change: old
};

export type Op = {
  op: "replace_text" | "rewrite_paragraph" | "insert" | "delete" | "move" | "set_style";
  para?: number;
  after?: number;
  find?: string;
  replace?: string;
  text?: string;
  paragraphs?: { text: string; style?: Style }[];
  style?: Style;
  why?: string;
};
export type Plan = { understood: string; answer: string; ops: Op[]; summary: string; cant: string; notes: string[] };

export type DocIO = {
  read: () => Promise<{ title: string; content: DocEl[] }>;
  batch: (requests: unknown[]) => Promise<void>;
};

const norm = (s: string) => s.replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/ /g, " ").replace(/\s+/g, " ").trim();
const asStyle = (s?: string): Style => (STYLES.includes(s as Style) ? (s as Style) : "NORMAL_TEXT");

/** The body as numbered paragraphs (tables show as one read-only line). (pure) */
export function paragraphs(content: DocEl[] = []): Para[] {
  const out: Para[] = [];
  for (const el of content) {
    if (el.paragraph) {
      const f = flatten([el]);
      out.push({
        n: out.length + 1,
        text: f.text.replace(/\n$/, ""),
        start: el.startIndex ?? f.at[0] ?? 1,
        end: el.endIndex ?? (f.at[f.at.length - 1] ?? 0) + 1,
        style: asStyle(el.paragraph.paragraphStyle?.namedStyleType),
        at: f.at,
      });
    } else if (el.table) {
      out.push({ n: out.length + 1, text: "[table: Milo can't edit tables yet]", start: el.startIndex ?? 0, end: el.endIndex ?? 0, style: "NORMAL_TEXT", at: [] });
    }
  }
  return out;
}

/** What the AI sees: numbered paragraphs with their style. (pure) */
export function listing(ps: Para[]): string {
  return ps.map((p) => `P${p.n}${p.style !== "NORMAL_TEXT" ? ` [${p.style}]` : ""}: ${p.text || "(blank line)"}`).join("\n");
}

/** Find a paragraph by its text (the occurrence-th one with that text). (pure) */
export function findPara(ps: Para[], text: string, occurrence = 0): Para | null {
  const t = norm(text);
  const hits = ps.filter((p) => norm(p.text) === t && !p.text.startsWith("[table:"));
  return hits[occurrence] ?? hits[hits.length - 1] ?? null;
}
/** Find a run of consecutive paragraphs with these texts. (pure) */
export function findRun(ps: Para[], texts: string[]): Para[] | null {
  const want = texts.map(norm);
  for (let i = 0; i + want.length <= ps.length; i++) if (want.every((w, k) => norm(ps[i + k].text) === w)) return ps.slice(i, i + want.length);
  return null;
}

const styleReq = (start: number, end: number, style: Style) => ({ updateParagraphStyle: { range: { startIndex: start, endIndex: end }, paragraphStyle: { namedStyleType: style }, fields: "namedStyleType" } });

/** Requests to add paragraphs after `after` (null = top of the doc). Returns the requests. (pure) */
export function insertRequests(ps: Para[], after: Para | null, texts: string[], styles: Style[]): unknown[] {
  const clean = texts.map((t) => t.replace(/\n+/g, " ").trim());
  const reqs: unknown[] = [];
  if (!after) {
    const at = ps[0]?.start ?? 1;
    const block = clean.join("\n") + "\n";
    reqs.push({ insertText: { location: { index: at }, text: block } });
    let s = at;
    clean.forEach((t, i) => {
      reqs.push(styleReq(s, s + t.length + 1, styles[i] ?? "NORMAL_TEXT"));
      s += t.length + 1;
    });
    return reqs;
  }
  const at = after.end - 1; // just before the paragraph's own line break
  reqs.push({ insertText: { location: { index: at }, text: "\n" + clean.join("\n") } });
  let s = at + 1;
  clean.forEach((t, i) => {
    reqs.push(styleReq(s, s + t.length + 1, styles[i] ?? "NORMAL_TEXT"));
    s += t.length + 1;
  });
  return reqs;
}

/** Requests to remove whole paragraphs (the last one in the doc keeps the doc's final line break). (pure) */
export function deleteRequests(ps: Para[], run: Para[]): unknown[] {
  const first = run[0];
  const last = run[run.length - 1];
  const isLast = last.n === ps[ps.length - 1].n;
  if (isLast && first.n === 1) return first.end - 1 > first.start ? [{ deleteContentRange: { range: { startIndex: first.start, endIndex: last.end - 1 } } }] : [];
  if (isLast) return [{ deleteContentRange: { range: { startIndex: first.start - 1, endIndex: last.end - 1 } } }];
  return [{ deleteContentRange: { range: { startIndex: first.start, endIndex: last.end } } }];
}

/** Replace text inside one paragraph (or the whole paragraph's text). (pure) */
export function replaceRequests(p: Para, from: number, to: number, text: string): unknown[] {
  const s = p.at[from] ?? p.start;
  const e = to > from ? (p.at[to - 1] ?? s) + 1 : s;
  const reqs: unknown[] = [];
  if (e > s) reqs.push({ deleteContentRange: { range: { startIndex: s, endIndex: e } } });
  if (text) reqs.push({ insertText: { location: { index: s }, text: text.replace(/\n+/g, " ") } });
  return reqs;
}

/** Where `find` sits inside a paragraph's text, loosely (quotes/dashes). (pure) */
function within(p: Para, find: string): { from: number; to: number } | null {
  const loose = (s: string) => s.replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/ /g, " ");
  const hay = loose(p.text);
  const needle = loose(find);
  if (!needle) return null;
  const i = hay.indexOf(needle);
  if (i < 0) return null;
  return { from: i, to: i + needle.length };
}

/** Apply a plan to the doc, one action at a time (re-reading in between, so positions are always fresh).
 *  Paragraph numbers refer to the doc as it was when planned; we track each one's current text. */
export async function applyPlan(io: DocIO, plan: Plan, live?: (c: Change, i: number, n: number) => void): Promise<{ changes: Change[]; skipped: { op: Op; why: string }[] }> {
  const start = paragraphs((await io.read()).content);
  const cur = new Map<number, string | null>(start.map((p) => [p.n, p.text])); // null = deleted
  const occ = new Map<number, number>(start.map((p) => [p.n, start.filter((q) => q.n < p.n && norm(q.text) === norm(p.text)).length]));
  const tail = new Map<number, string>(); // after paragraph n, the last thing we inserted (so several inserts stay in order)
  const changes: Change[] = [];
  const skipped: { op: Op; why: string }[] = [];
  const total = plan.ops.length;

  const locateOrig = (ps: Para[], n?: number): Para | null => {
    if (!n || !cur.has(n)) return null;
    const t = cur.get(n);
    if (t === null || t === undefined) return null;
    return findPara(ps, t, occ.get(n) ?? 0);
  };
  const anchorFor = (ps: Para[], after: number): { para: Para | null; text: string } | null => {
    if (after <= 0) return { para: null, text: "" };
    const t = tail.get(after);
    if (t) {
      const p = findPara(ps, t);
      if (p) return { para: p, text: p.text };
    }
    // the paragraph itself, or the nearest one above it that still exists
    for (let k = after; k >= 1; k--) {
      const p = locateOrig(ps, k);
      if (p) return { para: p, text: p.text };
    }
    return { para: null, text: "" };
  };

  for (let i = 0; i < plan.ops.length; i++) {
    const op = plan.ops[i];
    const ps = paragraphs((await io.read()).content);
    const why = op.why || "";
    try {
      if (op.op === "replace_text") {
        const p = locateOrig(ps, op.para);
        const loc = p && op.find ? within(p, op.find) : null;
        if (!p || !loc || !op.replace || norm(op.find ?? "") === norm(op.replace)) {
          skipped.push({ op, why: !p ? "paragraph gone" : !loc ? "text not found" : "no change" });
          continue;
        }
        const old = p.text.slice(loc.from, loc.to);
        await io.batch(replaceRequests(p, loc.from, loc.to, op.replace));
        cur.set(op.para!, p.text.slice(0, loc.from) + op.replace.replace(/\n+/g, " ") + p.text.slice(loc.to));
        changes.push({ op: "replace", find: old, replace: op.replace.replace(/\n+/g, " "), why, kind: "edit" });
      } else if (op.op === "rewrite_paragraph") {
        const p = locateOrig(ps, op.para);
        const text = (op.text ?? "").replace(/\n+/g, " ").trim();
        if (!p || !text || norm(text) === norm(p.text)) {
          skipped.push({ op, why: !p ? "paragraph gone" : "no change" });
          continue;
        }
        await io.batch(replaceRequests(p, 0, p.text.length, text));
        if (p.text) changes.push({ op: "replace", find: p.text, replace: text, why, kind: "rewrite" });
        else changes.push({ op: "insert", find: "", replace: text, why, kind: "add", anchor: ps[ps.indexOf(p) - 1]?.text ?? "", styles: [p.style] });
        cur.set(op.para!, text);
      } else if (op.op === "insert") {
        const items = (op.paragraphs ?? (op.text ? [{ text: op.text, style: op.style }] : [])).filter((x) => x.text?.trim());
        if (!items.length) {
          skipped.push({ op, why: "nothing to add" });
          continue;
        }
        const a = anchorFor(ps, op.after ?? ps.length);
        const texts = items.map((x) => x.text.replace(/\n+/g, " ").trim());
        const styles = items.map((x) => asStyle(x.style));
        await io.batch(insertRequests(ps, a?.para ?? null, texts, styles));
        tail.set(op.after ?? ps.length, texts[texts.length - 1]);
        changes.push({ op: "insert", find: "", replace: texts.join("\n"), why, kind: "add", anchor: a?.text ?? "", styles });
      } else if (op.op === "delete") {
        const p = locateOrig(ps, op.para);
        if (!p) {
          skipped.push({ op, why: "paragraph gone" });
          continue;
        }
        const idx = ps.indexOf(p);
        await io.batch(deleteRequests(ps, [p]));
        cur.set(op.para!, null);
        changes.push({ op: "delete", find: p.text, replace: "", why, kind: "cut", anchor: ps[idx - 1]?.text ?? "", styles: [p.style] });
      } else if (op.op === "move") {
        const p = locateOrig(ps, op.para);
        if (!p || op.after === op.para) {
          skipped.push({ op, why: !p ? "paragraph gone" : "no change" });
          continue;
        }
        const idx = ps.indexOf(p);
        await io.batch(deleteRequests(ps, [p]));
        changes.push({ op: "delete", find: p.text, replace: "", why, kind: "move", anchor: ps[idx - 1]?.text ?? "", styles: [p.style] });
        cur.set(op.para!, null);
        const ps2 = paragraphs((await io.read()).content);
        const a = anchorFor(ps2, op.after ?? 0);
        await io.batch(insertRequests(ps2, a?.para ?? null, [p.text], [p.style]));
        changes.push({ op: "insert", find: "", replace: p.text, why, kind: "move", anchor: a?.text ?? "", styles: [p.style] });
        tail.set(op.after ?? 0, p.text);
      } else if (op.op === "set_style") {
        const p = locateOrig(ps, op.para);
        const style = asStyle(op.style);
        if (!p || p.style === style) {
          skipped.push({ op, why: !p ? "paragraph gone" : "no change" });
          continue;
        }
        await io.batch([styleReq(p.start, p.end, style)]);
        changes.push({ op: "style", find: p.text, replace: p.text, why, kind: "format", style, oldStyle: p.style });
      } else skipped.push({ op, why: "unknown action" });
      live?.(changes[changes.length - 1], i, total);
    } catch (e) {
      skipped.push({ op, why: `Docs refused: ${(e as Error).message.slice(0, 80)}` });
      if (!changes.length && /403/.test((e as Error).message)) throw e;
    }
  }
  return { changes, skipped };
}

/** Take changes back, newest first, each found by its text (so it works even if the student typed elsewhere). */
export async function undoChanges(io: DocIO, changes: Change[]): Promise<{ undone: number; missed: number }> {
  let undone = 0;
  let missed = 0;
  for (const c of [...changes].reverse()) {
    const ps = paragraphs((await io.read()).content);
    const op = c.op ?? "replace";
    let ok = false;
    if (op === "replace") {
      // the new text, wherever it is now: the one paragraph that IS it, or the only place it appears
      const hits = ps.map((p) => ({ p, loc: within(p, c.replace) })).filter((h) => h.loc);
      const total = hits.reduce((n, h) => n + (h.p.text.split(c.replace).length - 1 || 1), 0);
      const h = hits.find((x) => norm(x.p.text) === norm(c.replace)) ?? (total === 1 ? hits[0] : undefined);
      if (h?.loc) {
        await io.batch(replaceRequests(h.p, h.loc.from, h.loc.to, c.find));
        ok = true;
      }
    } else if (op === "insert") {
      const run = findRun(ps, c.replace.split("\n"));
      if (run) {
        await io.batch(deleteRequests(ps, run));
        ok = true;
      }
    } else if (op === "delete") {
      const after = c.anchor ? findPara(ps, c.anchor) : null;
      if (!c.anchor || after) {
        await io.batch(insertRequests(ps, after, c.find.split("\n"), c.styles ?? []));
        ok = true;
      }
    } else if (op === "style") {
      const p = findPara(ps, c.find);
      if (p && c.oldStyle) {
        await io.batch([styleReq(p.start, p.end, c.oldStyle)]);
        ok = true;
      }
    }
    if (ok) undone++;
    else missed++;
  }
  return { undone, missed };
}

export const docWords = (content: DocEl[]) => words(paragraphs(content).map((p) => p.text).join("\n"));
