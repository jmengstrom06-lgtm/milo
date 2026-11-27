// What the paper panel shows: the paper with Milo's changes marked like tracked changes.
// Paragraphs are lined up (kept / changed / added / removed / restyled), and changed ones get a word-level diff.
// Each row knows which change groups it came from, so tapping a row accepts or rejects those changes. (pure)

export type Seg = { t: string; op: "=" | "+" | "-" };
export type Row = {
  kind: "same" | "changed" | "added" | "removed" | "restyled";
  text: string;
  segs?: Seg[];
  style: string; // TITLE / HEADING_1 / NORMAL_TEXT ...
  align?: string;
  bold?: boolean;
  bullet?: string; // "bullet" | "numbered"
  tags: string[]; // "centered", "double spaced", "heading"...
  groups: number[];
};
type P = { text: string; ps: Record<string, unknown>; runs: { text: string; ts: Record<string, unknown> }[]; bullet?: string };
type C = { op: string; find: string; replace: string; group?: number; before?: { text: string }[] };

const norm = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim().toLowerCase();
const words = (s: string) => norm(s).split(/[^\w']+/).filter(Boolean);

/** Longest-common-subsequence pairs of indexes. */
function lcs<T>(a: T[], b: T[], eq: (x: T, y: T) => boolean): [number, number][] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = eq(a[i], b[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (eq(a[i], b[j])) {
      out.push([i, j]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return out;
}

/** Word-level diff of two versions of a paragraph. */
export function wordDiff(a: string, b: string): Seg[] {
  // words with their trailing space, so "Alot" → "A lot" reads as one swap
  const ta = a.match(/\S+\s*|\s+/g) ?? [];
  const tb = b.match(/\S+\s*|\s+/g) ?? [];
  if (ta.length * tb.length > 250000) return [{ t: a, op: "-" }, { t: b, op: "+" }];
  const pairs = lcs(ta, tb, (x, y) => x.trim() === y.trim());
  const out: Seg[] = [];
  const push = (t: string, op: Seg["op"]) => {
    const last = out[out.length - 1];
    if (last && last.op === op) last.t += t;
    else out.push({ t, op });
  };
  let i = 0;
  let j = 0;
  for (const [pi, pj] of [...pairs, [ta.length, tb.length] as [number, number]]) {
    // removed before added, so it reads "old → new"
    while (i < pi) push(ta[i++], "-");
    while (j < pj) push(tb[j++], "+");
    if (pi < ta.length) push(ta[pi], "=");
    i = pi + 1;
    j = pj + 1;
  }
  return out;
}

const similar = (a: string, b: string) => {
  const A = new Set(words(a));
  const B = new Set(words(b));
  if (!A.size || !B.size) return 0;
  let both = 0;
  for (const w of A) if (B.has(w)) both++;
  return both / Math.min(A.size, B.size);
};

function look(p: P) {
  const sp = p.ps.lineSpacing as number | undefined;
  return {
    style: String(p.ps.namedStyleType ?? "NORMAL_TEXT"),
    align: p.ps.alignment as string | undefined,
    bold: p.runs.length > 0 && p.runs.every((r) => r.ts.bold === true),
    spacing: sp,
    font: (p.runs[0]?.ts.weightedFontFamily as { fontFamily?: string } | undefined)?.fontFamily,
    size: (p.runs[0]?.ts.fontSize as { magnitude?: number } | undefined)?.magnitude,
    hanging: !!(p.ps.indentStart as { magnitude?: number } | undefined)?.magnitude,
    indent: (p.ps.indentFirstLine as { magnitude?: number } | undefined)?.magnitude,
    bullet: p.bullet ?? "",
  };
}
function lookTags(a: P | null, b: P): string[] {
  const x = a ? look(a) : null;
  const y = look(b);
  const tags: string[] = [];
  if (x && x.style !== y.style) tags.push(y.style === "NORMAL_TEXT" ? "normal text" : y.style.replace("_", " ").toLowerCase());
  if (x && (x.align ?? "START") !== (y.align ?? "START")) tags.push(y.align === "CENTER" ? "centered" : y.align === "END" ? "right-aligned" : y.align === "JUSTIFIED" ? "justified" : "left-aligned");
  if (x && x.bold !== y.bold) tags.push(y.bold ? "bold" : "not bold");
  if (x && x.spacing !== y.spacing && y.spacing) tags.push(y.spacing >= 200 ? "double spaced" : y.spacing >= 150 ? "1.5 spaced" : "single spaced");
  if (x && x.font !== y.font && y.font) tags.push(y.font);
  if (x && x.size !== y.size && y.size) tags.push(`${y.size} pt`);
  if (x && x.hanging !== y.hanging && y.hanging) tags.push("hanging indent");
  if (x && x.indent !== y.indent && y.indent) tags.push("indented");
  if (x && x.bullet !== y.bullet) tags.push(y.bullet === "numbered" ? "numbered list" : y.bullet ? "bulleted list" : "not a list");
  return tags;
}

/** The panel's rows: the original paper vs Milo's version, with the change groups behind each row. */
export function paperRows(orig: P[], fin: P[], changes: C[] = []): Row[] {
  const pairs = lcs(orig, fin, (x, y) => norm(x.text) === norm(y.text));
  const rows: Row[] = [];
  let i = 0;
  let j = 0;
  const mk = (kind: Row["kind"], p: P, extra: Partial<Row> = {}): Row => {
    const l = look(p);
    return { kind, text: p.text, style: l.style, align: l.align, bold: l.bold, bullet: p.bullet, tags: [], groups: [], ...extra };
  };
  const flush = (ri: number, rj: number) => {
    const removed = orig.slice(i, ri);
    const added = fin.slice(j, rj);
    // a removed + an added paragraph that share most words = the same paragraph, rewritten
    const usedAdded = new Set<number>();
    const pairOf = new Map<number, number>();
    removed.forEach((r, a) => {
      let best = -1;
      let score = 0.45;
      added.forEach((d, b) => {
        if (usedAdded.has(b)) return;
        const s = similar(r.text, d.text);
        if (s > score) {
          score = s;
          best = b;
        }
      });
      if (best >= 0) {
        usedAdded.add(best);
        pairOf.set(a, best);
      }
    });
    // one paragraph out and one in, in the same spot = that paragraph, rewritten (even if few words survived)
    const loneR = removed.map((_, k) => k).filter((k) => !pairOf.has(k));
    const loneA = added.map((_, k) => k).filter((k) => !usedAdded.has(k));
    if (loneR.length === 1 && loneA.length === 1 && similar(removed[loneR[0]].text, added[loneA[0]].text) > 0.15) {
      pairOf.set(loneR[0], loneA[0]);
      usedAdded.add(loneA[0]);
    }
    // keep the new paper's order: walk the added list, slotting removed ones where they were
    let a = 0;
    for (let b = 0; b < added.length; b++) {
      const rewrittenFrom = [...pairOf.entries()].find(([, v]) => v === b)?.[0];
      while (a < removed.length && !pairOf.has(a) && (rewrittenFrom === undefined || a < rewrittenFrom)) rows.push(mk("removed", removed[a++]));
      if (rewrittenFrom !== undefined) {
        while (a < rewrittenFrom) {
          if (!pairOf.has(a)) rows.push(mk("removed", removed[a]));
          a++;
        }
        rows.push(mk("changed", added[b], { segs: wordDiff(removed[rewrittenFrom].text, added[b].text), tags: lookTags(removed[rewrittenFrom], added[b]) }));
        a = rewrittenFrom + 1;
      } else rows.push(mk("added", added[b]));
    }
    while (a < removed.length) {
      if (!pairOf.has(a)) rows.push(mk("removed", removed[a]));
      a++;
    }
  };
  for (const [pi, pj] of pairs) {
    flush(pi, pj);
    const tags = lookTags(orig[pi], fin[pj]);
    rows.push(mk(tags.length ? "restyled" : "same", fin[pj], { tags }));
    i = pi + 1;
    j = pj + 1;
  }
  flush(orig.length, fin.length);

  // which changes made each row
  for (const c of changes) {
    if (c.group === undefined) continue;
    const g = c.group;
    const hit = (r: Row) => !r.groups.includes(g) && r.groups.push(g);
    if (c.op === "replace") rows.filter((r) => r.kind !== "removed" && r.kind !== "same" && norm(r.text).includes(norm(c.replace))).forEach(hit);
    else if (c.op === "insert") {
      const t = c.replace.split("\n").map(norm);
      rows.filter((r) => (r.kind === "added" || r.kind === "changed" || r.kind === "restyled") && t.includes(norm(r.text))).forEach(hit);
    } else if (c.op === "delete") rows.filter((r) => r.kind === "removed" && norm(r.text) === norm(c.find)).forEach(hit);
    else if (c.op === "style" || c.op === "format") {
      const texts = (c.before?.map((b) => b.text) ?? [c.find]).map(norm);
      rows.filter((r) => r.kind !== "same" && r.kind !== "removed" && (texts.includes(norm(r.text)) || c.find === "(the whole paper)")).forEach(hit);
    }
  }
  return rows;
}
