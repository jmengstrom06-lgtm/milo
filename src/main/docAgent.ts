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

type Obj = Record<string, unknown>;
/** A paragraph: text, where it is, its style, and its text-style runs (offsets within the paragraph). */
export type Para = { n: number; text: string; start: number; end: number; style: Style; at: number[]; props: Obj; runs: { from: number; to: number; ts: Obj }[]; bullet: "bullet" | "numbered" | null };
type ListKind = "bullet" | "numbered" | null;
/** Make paragraphs [start, end) a bulleted/numbered list, or not a list. (pure) */
function listReq(start: number, end: number, kind: ListKind): unknown {
  return kind
    ? { createParagraphBullets: { range: { startIndex: start, endIndex: end }, bulletPreset: kind === "numbered" ? "NUMBERED_DECIMAL_ALPHA_ROMAN" : "BULLET_DISC_CIRCLE_SQUARE" } }
    : { deleteParagraphBullets: { range: { startIndex: start, endIndex: end } } };
}
/** Requests to take a paragraph from list state `has` to `want` (nothing if they match). (pure) */
function listFix(start: number, end: number, has: ListKind, want: ListKind): unknown[] {
  if ((has ?? null) === (want ?? null)) return [];
  if (has && want) return [listReq(start, end, null), listReq(start, end, want)];
  return [listReq(start, end, want ?? null)];
}

// Formatting Milo can change, and how each maps to Docs.
const TEXT_FIELDS = ["bold", "italic", "underline", "fontSize", "weightedFontFamily"] as const;
const PARA_FIELDS = ["alignment", "lineSpacing", "indentFirstLine", "indentStart", "spaceAbove", "spaceBelow"] as const;
export type Fmt = { bold?: boolean; italic?: boolean; underline?: boolean; font?: string; size?: number; align?: "START" | "CENTER" | "END" | "JUSTIFIED"; lineSpacing?: number; firstLineIndent?: number; hanging?: boolean; noSpacing?: boolean; list?: "bullet" | "numbered" | "none" };
const wantList = (f?: Fmt): ListKind | undefined => (f?.list === "bullet" || f?.list === "numbered" ? f.list : f?.list === "none" ? null : undefined);
/** A plain format request -> Docs styles + the field masks to send. (pure) */
export function fmtToDocs(f: Fmt): { ts: Obj; tf: string[]; ps: Obj; pf: string[] } {
  const ts: Obj = {};
  const ps: Obj = {};
  if (typeof f.bold === "boolean") ts.bold = f.bold;
  if (typeof f.italic === "boolean") ts.italic = f.italic;
  if (typeof f.underline === "boolean") ts.underline = f.underline;
  if (f.size && f.size >= 6 && f.size <= 72) ts.fontSize = { magnitude: f.size, unit: "PT" };
  if (f.font && f.font.length < 40) ts.weightedFontFamily = { fontFamily: f.font, weight: 400 };
  if (f.align && ["START", "CENTER", "END", "JUSTIFIED"].includes(f.align)) ps.alignment = f.align;
  if (f.lineSpacing && f.lineSpacing >= 100 && f.lineSpacing <= 300) ps.lineSpacing = f.lineSpacing;
  if (f.hanging) {
    ps.indentStart = { magnitude: 36, unit: "PT" };
    ps.indentFirstLine = { magnitude: 0, unit: "PT" };
  } else if (typeof f.firstLineIndent === "number" && f.firstLineIndent >= 0 && f.firstLineIndent <= 72) ps.indentFirstLine = { magnitude: f.firstLineIndent, unit: "PT" };
  if (f.noSpacing) {
    ps.spaceAbove = { magnitude: 0, unit: "PT" };
    ps.spaceBelow = { magnitude: 0, unit: "PT" };
  }
  return { ts, tf: Object.keys(ts), ps, pf: Object.keys(ps) };
}
const pick = (o: Obj, keys: readonly string[] | string[]) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
/** The runs inside [from, to) of a paragraph, made relative to `from`. (pure) */
const runsIn = (p: Para, from: number, to: number) =>
  p.runs.filter((r) => r.to > from && r.from < to).map((r) => ({ from: Math.max(r.from, from) - from, to: Math.min(r.to, to) - from, ts: pick(r.ts, TEXT_FIELDS) }));
/** Put formatting back on text that starts at `offset` in paragraph p (and the paragraph's look). (pure) */
function restoreReqs(p: Para, offset: number, runs: { from: number; to: number; ts: Obj }[] = [], props?: Obj, list?: ListKind): unknown[] {
  const out: unknown[] = [];
  if (list !== undefined) out.push(...listFix(p.start, p.end, p.bullet, list));
  if (props) out.push({ updateParagraphStyle: { range: { startIndex: p.start, endIndex: p.end }, paragraphStyle: pick(props, PARA_FIELDS), fields: PARA_FIELDS.join(",") } });
  for (const r of runs) {
    const a = offset + r.from;
    const b = offset + r.to;
    if (b <= a || a < 0 || b > p.text.length) continue;
    const s = p.at[a] ?? p.start;
    const e = (p.at[b - 1] ?? s) + 1;
    out.push({ updateTextStyle: { range: { startIndex: s, endIndex: e }, textStyle: r.ts, fields: TEXT_FIELDS.join(",") } });
  }
  return out;
}

/** A change Milo made, in the shape the cards already show (find → replace, why), plus what undo needs. */
export type Change = {
  op: "replace" | "insert" | "delete" | "style" | "format";
  find: string; // text before ("" for an insert)
  replace: string; // text after ("" for a delete)
  why: string;
  kind?: string;
  anchor?: string; // insert/delete: the paragraph it sits after ("" = top of the doc)
  styles?: Style[]; // insert/delete: each paragraph's style
  style?: Style; // style change: new
  oldStyle?: Style; // style change: old
  /** format: what each touched paragraph looked like before, and which fields changed */
  before?: { text: string; occ: number; props: Obj; runs: { from: number; to: number; ts: Obj }[]; range?: { from: number; to: number }; list?: ListKind }[];
  fields?: { text: string[]; para: string[] };
  /** format: the new look (so the change can be replayed on the real doc) */
  after?: { ts: Obj; ps: Obj };
  /** insert: each new paragraph's formatting */
  fmts?: (Fmt | undefined)[];
  /** where it sat, as a paragraph number at the time (a fallback when the anchor text has changed) */
  anchorIndex?: number;
  /** accept/reject together (a move is a delete + an insert) */
  group?: number;
  /** replace/delete: the old text's formatting (runs relative to `find`) and paragraph look, restored on undo */
  oldRuns?: { from: number; to: number; ts: Obj }[];
  oldProps?: Obj;
  oldList?: ListKind; // delete/move: was it a list item
  newList?: ListKind; // format: list state after
};

export type Op = {
  op: "replace_text" | "rewrite_paragraph" | "insert" | "delete" | "move" | "set_style" | "format";
  para?: number;
  after?: number;
  find?: string;
  replace?: string;
  text?: string;
  paragraphs?: ({ text: string; style?: Style } & Fmt)[];
  style?: Style;
  /** format: which paragraphs ("all" = the whole doc) and what to change */
  target?: "para" | "all";
  format?: Fmt;
  why?: string;
};
export type Plan = { understood: string; answer: string; ops: Op[]; summary: string; cant: string; notes: string[]; requirements?: { req: string; met: boolean; note?: string }[] };

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
      const start = el.startIndex ?? f.at[0] ?? 1;
      const text = f.text.replace(/\n$/, "");
      const runs: Para["runs"] = [];
      let off = 0;
      for (const r of el.paragraph.elements ?? []) {
        const c = (r.textRun?.content ?? "").replace(/\n$/, "");
        if (c.length) runs.push({ from: off, to: off + c.length, ts: { ...(r.textRun?.textStyle ?? {}) } });
        off += c.length;
      }
      out.push({
        n: out.length + 1,
        text,
        start,
        end: el.endIndex ?? (f.at[f.at.length - 1] ?? 0) + 1,
        style: asStyle(el.paragraph.paragraphStyle?.namedStyleType),
        at: f.at,
        props: { ...(el.paragraph.paragraphStyle ?? {}) },
        runs,
        bullet: el.paragraph.bullet ? (el.paragraph.bullet.kind === "numbered" ? "numbered" : "bullet") : null,
      });
    } else if (el.table) {
      out.push({ n: out.length + 1, text: "[table: Milo can't edit tables yet]", start: el.startIndex ?? 0, end: el.endIndex ?? 0, style: "NORMAL_TEXT", at: [], props: {}, runs: [], bullet: null });
    }
  }
  return out;
}

/** What the AI sees: numbered paragraphs with their style. (pure) */
export function listing(ps: Para[]): string {
  return ps
    .map((p) => {
      const sp = p.props.lineSpacing as number | undefined;
      const ind = (p.props.indentFirstLine as { magnitude?: number } | undefined)?.magnitude;
      const font = (p.runs[0]?.ts.weightedFontFamily as { fontFamily?: string } | undefined)?.fontFamily;
      const size = (p.runs[0]?.ts.fontSize as { magnitude?: number } | undefined)?.magnitude;
      const tags = [
        p.style !== "NORMAL_TEXT" ? p.style : "",
        p.props.alignment && p.props.alignment !== "START" ? String(p.props.alignment).toLowerCase() : "",
        p.runs.length && p.runs.every((r) => r.ts.bold) ? "bold" : "",
        (p.props.indentStart as { magnitude?: number })?.magnitude ? "hanging" : "",
        sp && sp !== 100 ? (sp >= 200 ? "double spaced" : `spacing ${sp}`) : "",
        ind ? `indent ${ind}pt` : "",
        font ? font : "",
        size ? `${size}pt` : "",
        p.bullet === "numbered" ? "numbered list" : p.bullet ? "bulleted list" : "",
      ].filter(Boolean);
      return `P${p.n}${tags.length ? ` [${tags.join(", ")}]` : ""}: ${p.text || "(blank line)"}`;
    })
    .join("\n");
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
export function insertRequests(ps: Para[], after: Para | null, texts: string[], styles: Style[], fmts: (Fmt | undefined)[] = []): unknown[] {
  const clean = texts.map((t) => t.replace(/\n+/g, " ").trim());
  const reqs: unknown[] = [];
  if (!after) {
    const at = ps[0]?.start ?? 1;
    const block = clean.join("\n") + "\n";
    reqs.push({ insertText: { location: { index: at }, text: block } });
    let s = at;
    const inherit = ps[0]?.bullet ?? null;
    clean.forEach((t, i) => {
      reqs.push(styleReq(s, s + t.length + 1, styles[i] ?? "NORMAL_TEXT"));
      reqs.push(...fmtReqs(s, s + t.length, fmts[i]));
      reqs.push(...listFix(s, s + t.length + 1, inherit, wantList(fmts[i]) ?? null));
      s += t.length + 1;
    });
    return reqs;
  }
  const at = after.end - 1; // just before the paragraph's own line break
  reqs.push({ insertText: { location: { index: at }, text: "\n" + clean.join("\n") } });
  let s = at + 1;
  const inherit = after.bullet ?? null; // a line added after a list item starts out as a list item too
  clean.forEach((t, i) => {
    reqs.push(styleReq(s, s + t.length + 1, styles[i] ?? "NORMAL_TEXT"));
    reqs.push(...fmtReqs(s, s + t.length, fmts[i]));
    reqs.push(...listFix(s, s + t.length + 1, inherit, wantList(fmts[i]) ?? null));
    s += t.length + 1;
  });
  return reqs;
}

/** Formatting for a new paragraph [s, e) (its text) plus its line break for paragraph styles. (pure) */
function fmtReqs(s: number, e: number, f?: Fmt): unknown[] {
  const d = fmtToDocs(f ?? {});
  const out: unknown[] = [];
  // new text would inherit bold/italic/underline from the line before it (a bold title, say): start clean
  // unless asked (font and size are kept, so it matches the paper)
  const plain = ["bold", "italic", "underline"].filter((k) => !d.tf.includes(k));
  if (plain.length && e > s) out.push({ updateTextStyle: { range: { startIndex: s, endIndex: e }, textStyle: {}, fields: plain.join(",") } });
  if (d.pf.length) out.push({ updateParagraphStyle: { range: { startIndex: s, endIndex: e + 1 }, paragraphStyle: d.ps, fields: d.pf.join(",") } });
  if (d.tf.length && e > s) out.push({ updateTextStyle: { range: { startIndex: s, endIndex: e }, textStyle: d.ts, fields: d.tf.join(",") } });
  return out;
}

/** Requests to remove whole paragraphs (the last one in the doc keeps the doc's final line break). (pure) */
export function deleteRequests(ps: Para[], run: Para[]): unknown[] {
  const first = run[0];
  const last = run[run.length - 1];
  const isLast = last.n === ps[ps.length - 1].n;
  if (isLast && first.n === 1) return first.end - 1 > first.start ? [{ deleteContentRange: { range: { startIndex: first.start, endIndex: last.end - 1 } } }] : [];
  if (isLast) {
    // removing the last paragraph takes the line break above it, so the paragraph above would inherit the
    // deleted one's style: put its own look back right after
    const prev = ps[first.n - 2];
    const keep = ["namedStyleType", ...PARA_FIELDS];
    return [
      { deleteContentRange: { range: { startIndex: first.start - 1, endIndex: last.end - 1 } } },
      { updateParagraphStyle: { range: { startIndex: prev.start, endIndex: prev.end }, paragraphStyle: pick(prev.props, keep), fields: keep.join(",") } },
      ...listFix(prev.start, prev.end, last.bullet, prev.bullet),
    ];
  }
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
export function opApplier(io: DocIO, live?: (c: Change, i: number, n: number) => void, opts?: { groupBase?: number }) {
  let cur = new Map<number, string | null>(); // the doc's paragraphs as planned, by number: their text now (null = deleted)
  let occ = new Map<number, number>();
  let ready: Promise<void> | null = null;
  const init = () =>
    (ready ??= (async () => {
      const start = paragraphs((await io.read()).content);
      cur = new Map<number, string | null>(start.map((p) => [p.n, p.text]));
      occ = new Map<number, number>(start.map((p) => [p.n, start.filter((q) => q.n < p.n && norm(q.text) === norm(p.text)).length]));
    })());
  const tail = new Map<number, string>(); // after paragraph n, the last thing we inserted (so several inserts stay in order)
  const changes: Change[] = [];
  const skipped: { op: Op; why: string }[] = [];
  let total = -1;
  const gid = (i: number) => (opts?.groupBase ?? 0) + i;

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

  /** Apply one action (they can arrive one at a time while the AI is still writing the rest). */
  async function one(op: Op, i: number) {
      const ps = paragraphs((await io.read()).content);
      const why = op.why || "";
      try {
        if (op.op === "replace_text") {
          const p = locateOrig(ps, op.para);
          const loc = p && op.find ? within(p, op.find) : null;
          if (!p || !loc || !op.replace || norm(op.find ?? "") === norm(op.replace)) {
            skipped.push({ op, why: !p ? "paragraph gone" : !loc ? "text not found" : "no change" });
            return;
          }
          const old = p.text.slice(loc.from, loc.to);
          const oldRuns = runsIn(p, loc.from, loc.to);
          await io.batch(replaceRequests(p, loc.from, loc.to, op.replace));
          cur.set(op.para!, p.text.slice(0, loc.from) + op.replace.replace(/\n+/g, " ") + p.text.slice(loc.to));
          changes.push({ op: "replace", find: old, replace: op.replace.replace(/\n+/g, " "), why, kind: "edit", oldRuns });
        } else if (op.op === "rewrite_paragraph") {
          const p = locateOrig(ps, op.para);
          const text = (op.text ?? "").replace(/\n+/g, " ").trim();
          if (!p || !text || norm(text) === norm(p.text)) {
            skipped.push({ op, why: !p ? "paragraph gone" : "no change" });
            return;
          }
          const oldRuns = runsIn(p, 0, p.text.length);
          await io.batch(replaceRequests(p, 0, p.text.length, text));
          if (p.text) changes.push({ op: "replace", find: p.text, replace: text, why, kind: "rewrite", oldRuns });
          else changes.push({ op: "insert", find: "", replace: text, why, kind: "add", anchor: ps[ps.indexOf(p) - 1]?.text ?? "", styles: [p.style] });
          cur.set(op.para!, text);
        } else if (op.op === "insert") {
          const items = (op.paragraphs ?? (op.text ? [{ text: op.text, style: op.style }] : [])).filter((x) => x.text?.trim());
          if (!items.length) {
            skipped.push({ op, why: "nothing to add" });
            return;
          }
          const a = anchorFor(ps, op.after ?? ps.length);
          const texts = items.map((x) => x.text.replace(/\n+/g, " ").trim());
          const styles = items.map((x) => asStyle(x.style));
          await io.batch(insertRequests(ps, a?.para ?? null, texts, styles, items));
          tail.set(op.after ?? ps.length, texts[texts.length - 1]);
          changes.push({ op: "insert", find: "", replace: texts.join("\n"), why, kind: "add", anchor: a?.text ?? "", styles, fmts: items.map((x) => ({ align: x.align, bold: x.bold, italic: x.italic, underline: x.underline, hanging: x.hanging, list: x.list })), anchorIndex: a?.para ? ps.indexOf(a.para) + 1 : 0, group: gid(i) });
        } else if (op.op === "delete") {
          const p = locateOrig(ps, op.para);
          if (!p) {
            skipped.push({ op, why: "paragraph gone" });
            return;
          }
          const idx = ps.indexOf(p);
          await io.batch(deleteRequests(ps, [p]));
          cur.set(op.para!, null);
          changes.push({ op: "delete", find: p.text, replace: "", why, kind: "cut", anchor: ps[idx - 1]?.text ?? "", styles: [p.style], oldRuns: runsIn(p, 0, p.text.length), oldProps: pick(p.props, PARA_FIELDS), oldList: p.bullet });
        } else if (op.op === "move") {
          const p = locateOrig(ps, op.para);
          if (!p || op.after === op.para) {
            skipped.push({ op, why: !p ? "paragraph gone" : "no change" });
            return;
          }
          const idx = ps.indexOf(p);
          const keepRuns = runsIn(p, 0, p.text.length);
          const keepProps = pick(p.props, PARA_FIELDS);
          const keepList = p.bullet;
          await io.batch(deleteRequests(ps, [p]));
          changes.push({ op: "delete", find: p.text, replace: "", why, kind: "move", anchor: ps[idx - 1]?.text ?? "", styles: [p.style], oldRuns: keepRuns, oldProps: keepProps, oldList: keepList });
          cur.set(op.para!, null);
          const ps2 = paragraphs((await io.read()).content);
          const a = anchorFor(ps2, op.after ?? 0);
          await io.batch(insertRequests(ps2, a?.para ?? null, [p.text], [p.style]));
          {
            const ps3 = paragraphs((await io.read()).content);
            const at = a?.para ? ps3.findIndex((q) => q.start >= (a.para as Para).end - 1 && norm(q.text) === norm(p.text)) : ps3.findIndex((q) => norm(q.text) === norm(p.text));
            if (at >= 0) await io.batch(restoreReqs(ps3[at], 0, keepRuns, keepProps, keepList));
          }
          changes.push({ op: "insert", find: "", replace: p.text, why, kind: "move", anchor: a?.text ?? "", styles: [p.style], oldRuns: keepRuns, oldProps: keepProps, oldList: keepList, anchorIndex: a?.para ? ps2.indexOf(a.para) + 1 : 0 });
          tail.set(op.after ?? 0, p.text);
        } else if (op.op === "format") {
          const d = fmtToDocs(op.format ?? {});
          const wl = wantList(op.format);
          if (!d.tf.length && !d.pf.length && wl === undefined) {
            skipped.push({ op, why: "no formatting given" });
            return;
          }
          const targets: { p: Para; from: number; to: number }[] = [];
          if (op.target === "all") for (const p of ps) { if (!p.text.startsWith("[table:")) targets.push({ p, from: 0, to: p.text.length }); }
          else {
            const p = locateOrig(ps, op.para);
            const loc = p && op.find ? within(p, op.find) : null;
            if (!p || (op.find && !loc)) {
              skipped.push({ op, why: !p ? "paragraph gone" : "text not found" });
              return;
            }
            targets.push({ p, from: loc?.from ?? 0, to: loc?.to ?? p.text.length });
          }
          // only paragraphs that actually look different afterwards
          const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
          const needs = (t: { p: Para; from: number; to: number }) =>
            d.pf.some((k) => !same(t.p.props[k], d.ps[k])) || (d.tf.length > 0 && t.p.runs.some((r) => r.to > t.from && r.from < t.to && d.tf.some((k) => !same(r.ts[k], d.ts[k])))) || (wl !== undefined && (t.p.bullet ?? null) !== (wl ?? null));
          for (let k = targets.length - 1; k >= 0; k--) if (!needs(targets[k])) targets.splice(k, 1);
          if (!targets.length) {
            skipped.push({ op, why: "already formatted that way" });
            return;
          }
          const reqs: unknown[] = [];
          const before: NonNullable<Change["before"]> = [];
          for (const t of targets) {
            const occN = ps.filter((q) => q.n < t.p.n && norm(q.text) === norm(t.p.text)).length;
            before.push({ text: t.p.text, occ: occN, props: pick(t.p.props, d.pf), runs: t.p.runs.filter((r) => r.to > t.from && r.from < t.to).map((r) => ({ from: Math.max(r.from, t.from), to: Math.min(r.to, t.to), ts: pick(r.ts, d.tf) })), range: { from: t.from, to: t.to }, list: t.p.bullet });
            if (d.pf.length) reqs.push({ updateParagraphStyle: { range: { startIndex: t.p.start, endIndex: t.p.end }, paragraphStyle: d.ps, fields: d.pf.join(",") } });
            if (d.tf.length && t.to > t.from) {
              const s = t.p.at[t.from] ?? t.p.start;
              const e = (t.p.at[t.to - 1] ?? s) + 1;
              reqs.push({ updateTextStyle: { range: { startIndex: s, endIndex: e }, textStyle: d.ts, fields: d.tf.join(",") } });
            }
          }
          // a list: consecutive paragraphs become one list (one request over the whole run)
          if (wl !== undefined) {
            const runsOf: Para[][] = [];
            for (const t of [...targets].sort((x, y) => x.p.start - y.p.start)) {
              const last = runsOf[runsOf.length - 1];
              if (last && ps.indexOf(last[last.length - 1]) + 1 === ps.indexOf(t.p)) last.push(t.p);
              else runsOf.push([t.p]);
            }
            for (const run of runsOf) {
              const has = run.every((x) => x.bullet === run[0].bullet) ? run[0].bullet : "bullet";
              reqs.push(...listFix(run[0].start, run[run.length - 1].end, has, wl));
            }
          }
          if (!reqs.length) {
            skipped.push({ op, why: "nothing to format" });
            return;
          }
          await io.batch(reqs);
          changes.push({ op: "format", find: op.target === "all" ? "(the whole paper)" : (targets[0].p.text.slice(targets[0].from, targets[0].to) || targets[0].p.text), replace: "", why, kind: "format", before, fields: { text: d.tf, para: d.pf }, after: { ts: d.ts, ps: d.ps }, newList: wl });
        } else if (op.op === "set_style") {
          const p = locateOrig(ps, op.para);
          const style = asStyle(op.style);
          if (!p || p.style === style) {
            skipped.push({ op, why: !p ? "paragraph gone" : "no change" });
            return;
          }
          await io.batch([styleReq(p.start, p.end, style)]);
          changes.push({ op: "style", find: p.text, replace: p.text, why, kind: "format", style, oldStyle: p.style });
        } else skipped.push({ op, why: "unknown action" });
        for (let k = changes.length - 1; k >= 0 && changes[k].group === undefined; k--) changes[k].group = gid(i);
        live?.(changes[changes.length - 1], i, total);
      } catch (e) {
        skipped.push({ op, why: `Docs refused: ${(e as Error).message.slice(0, 80)}` });
        if (!changes.length && /403/.test((e as Error).message)) throw e;
      }  }
  return {
    changes,
    skipped,
    apply: async (op: Op, i: number, n = -1) => {
      await init();
      total = n;
      await one(op, i);
    },
  };
}

/** Apply a whole plan, action by action (re-reading in between, so positions are always fresh).
 *  Paragraph numbers refer to the doc as it was when planned; each one's current text is tracked. */
export async function applyPlan(io: DocIO, plan: Plan, live?: (c: Change, i: number, n: number) => void, opts?: { groupBase?: number }): Promise<{ changes: Change[]; skipped: { op: Op; why: string }[] }> {
  const a = opApplier(io, live, opts);
  for (let i = 0; i < plan.ops.length; i++) await a.apply(plan.ops[i], i, plan.ops.length);
  return { changes: a.changes, skipped: a.skipped };
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
        if (c.oldRuns?.length) {
          const p2 = paragraphs((await io.read()).content).find((q) => q.start === h.p.start);
          if (p2) await io.batch(restoreReqs(p2, h.loc.from, c.oldRuns));
        }
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
        if (c.oldRuns || c.oldProps) {
          const ps2 = paragraphs((await io.read()).content);
          const back = after ? ps2.find((q) => q.start === after.end) : ps2[0];
          if (back && norm(back.text) === norm(c.find)) await io.batch(restoreReqs(back, 0, c.oldRuns ?? [], c.oldProps, c.oldList ?? null));
        }
        ok = true;
      }
    } else if (op === "format" && c.before && c.fields) {
      const reqs: unknown[] = [];
      for (const b of c.before) {
        const p = findPara(ps, b.text, b.occ);
        if (!p) continue;
        if (c.newList !== undefined) reqs.push(...listFix(p.start, p.end, p.bullet, b.list ?? null));
        // send each changed field with its old value; a field that wasn't set goes back to default
        if (c.fields.para.length) reqs.push({ updateParagraphStyle: { range: { startIndex: p.start, endIndex: p.end }, paragraphStyle: b.props, fields: c.fields.para.join(",") } });
        if (c.fields.text.length) {
          for (const r of b.runs) {
            if (r.to <= r.from) continue;
            const s = p.at[r.from] ?? p.start;
            const e = (p.at[r.to - 1] ?? s) + 1;
            reqs.push({ updateTextStyle: { range: { startIndex: s, endIndex: e }, textStyle: r.ts, fields: c.fields.text.join(",") } });
          }
        }
      }
      if (reqs.length) {
        await io.batch(reqs);
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

/** Replay changes (made on Milo's in-memory copy) onto the real doc, in order, each found by its text.
 *  Skips any whose spot can't be found (the student changed it since) and reports them. */
export async function redoChanges(io: DocIO, changes: Change[]): Promise<{ done: Change[]; missed: Change[] }> {
  const done: Change[] = [];
  const missed: Change[] = [];
  for (const c of changes) {
    const ps = paragraphs((await io.read()).content);
    let ok = false;
    if (c.op === "replace") {
      const hits = ps.map((p) => ({ p, loc: within(p, c.find) })).filter((h) => h.loc);
      const count = hits.reduce((n, h) => n + Math.max(1, h.p.text.split(c.find).length - 1), 0);
      const h = hits.find((x) => norm(x.p.text) === norm(c.find)) ?? (count === 1 ? hits[0] : undefined);
      if (h?.loc) {
        await io.batch(replaceRequests(h.p, h.loc.from, h.loc.to, c.replace));
        ok = true;
      }
    } else if (c.op === "insert") {
      let after: Para | null = null;
      if (c.anchor) after = findPara(ps, c.anchor) ?? (c.anchorIndex && ps[c.anchorIndex - 1] ? ps[c.anchorIndex - 1] : null);
      if (!c.anchor || after) {
        await io.batch(insertRequests(ps, after, c.replace.split("\n"), c.styles ?? [], c.fmts ?? []));
        if (c.oldRuns || c.oldProps) {
          const ps2 = paragraphs((await io.read()).content);
          const back = after ? ps2.find((q) => q.start === after!.end) : ps2[0];
          if (back) await io.batch(restoreReqs(back, 0, c.oldRuns ?? [], c.oldProps, c.oldList ?? null));
        }
        ok = true;
      }
    } else if (c.op === "delete") {
      const p = findPara(ps, c.find);
      if (p) {
        await io.batch(deleteRequests(ps, [p]));
        ok = true;
      }
    } else if (c.op === "style") {
      const p = findPara(ps, c.find);
      if (p && c.style) {
        await io.batch([styleReq(p.start, p.end, c.style)]);
        ok = true;
      }
    } else if (c.op === "format" && c.before && c.after && c.fields) {
      const reqs: unknown[] = [];
      for (const b of c.before) {
        const p = findPara(ps, b.text, b.occ);
        if (!p) continue;
        if (c.fields.para.length) reqs.push({ updateParagraphStyle: { range: { startIndex: p.start, endIndex: p.end }, paragraphStyle: c.after.ps, fields: c.fields.para.join(",") } });
        if (c.newList !== undefined) reqs.push(...listFix(p.start, p.end, p.bullet, c.newList));
        const r = b.range ?? { from: 0, to: p.text.length };
        if (c.fields.text.length && r.to > r.from && r.to <= p.text.length) {
          const s = p.at[r.from] ?? p.start;
          const e = (p.at[r.to - 1] ?? s) + 1;
          reqs.push({ updateTextStyle: { range: { startIndex: s, endIndex: e }, textStyle: c.after.ts, fields: c.fields.text.join(",") } });
        }
      }
      if (reqs.length) {
        await io.batch(reqs);
        ok = true;
      }
    }
    (ok ? done : missed).push(c);
  }
  return { done, missed };
}

export const docWords = (content: DocEl[]) => words(paragraphs(content).map((p) => p.text).join("\n"));
