// A stand-in for Google Docs: paragraphs with paragraph styles, characters with text styles, and the
// requests Milo sends (insertText, deleteContentRange, updateParagraphStyle, updateTextStyle), including
// Docs' field-mask rule: a field named in `fields` but left out of the style resets it to default.
// Indexes work like Docs: the body starts at 1 and every paragraph ends with "\n".
import type { DocEl } from "../src/main/docEdit";

type TS = Record<string, unknown>;
type PS = Record<string, unknown>;
type Ch = { c: string; ts: TS; ps?: PS };
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

export class SimDoc {
  chars: Ch[] = [];
  revisions = 0;
  constructor(paras: (string | [string, string])[]) {
    for (const p of paras) {
      const [t, st] = typeof p === "string" ? [p, "NORMAL_TEXT"] : p;
      for (const c of t) this.chars.push({ c, ts: {} });
      this.chars.push({ c: "\n", ts: {}, ps: { namedStyleType: st } });
    }
  }
  private paraEnd(pos: number) {
    for (let i = pos; i < this.chars.length; i++) if (this.chars[i].c === "\n") return i;
    return this.chars.length - 1;
  }
  apply(reqs: unknown[]) {
    for (const r of reqs as Record<string, any>[]) {
      if (r.insertText) {
        const pos = r.insertText.location.index - 1;
        if (pos < 0 || pos > this.chars.length - 1) throw new Error(`insert index ${pos + 1} out of range`);
        const ps = clone(this.chars[this.paraEnd(pos)].ps ?? {});
        const ts = clone(pos > 0 && this.chars[pos - 1].c !== "\n" ? this.chars[pos - 1].ts : this.chars[pos].ts ?? {}); // inherits the style around it
        const add: Ch[] = [...r.insertText.text].map((c: string) => (c === "\n" ? { c, ts: clone(ts), ps: clone(ps) } : { c, ts: clone(ts) }));
        this.chars.splice(pos, 0, ...add);
      } else if (r.deleteContentRange) {
        const s = r.deleteContentRange.range.startIndex - 1;
        const e = r.deleteContentRange.range.endIndex - 1;
        if (s < 0 || e > this.chars.length - 1 || e <= s) throw new Error(`delete ${s + 1}-${e + 1} invalid (doc ends at ${this.chars.length})`);
        this.chars.splice(s, e - s);
      } else if (r.updateParagraphStyle) {
        const s = r.updateParagraphStyle.range.startIndex - 1;
        const e = r.updateParagraphStyle.range.endIndex - 1;
        const fields = String(r.updateParagraphStyle.fields).split(",").map((f: string) => f.trim());
        let i = s;
        while (i > 0 && this.chars[i - 1].c !== "\n") i--;
        for (let k = i; k < this.chars.length; k++) {
          if (this.chars[k].c === "\n") {
            const ps = (this.chars[k].ps ??= {});
            for (const f of fields) {
              const v = r.updateParagraphStyle.paragraphStyle[f];
              if (v === undefined) delete ps[f];
              else ps[f] = clone(v);
            }
            if (k >= e - 1) break;
          }
        }
      } else if (r.updateTextStyle) {
        const s = r.updateTextStyle.range.startIndex - 1;
        const e = r.updateTextStyle.range.endIndex - 1;
        if (s < 0 || e > this.chars.length || e <= s) throw new Error(`text style ${s + 1}-${e + 1} invalid`);
        const fields = String(r.updateTextStyle.fields).split(",").map((f: string) => f.trim());
        for (let k = s; k < e; k++) {
          for (const f of fields) {
            const v = r.updateTextStyle.textStyle[f];
            if (v === undefined) delete this.chars[k].ts[f];
            else this.chars[k].ts[f] = clone(v);
          }
        }
      } else throw new Error(`unknown request ${Object.keys(r)[0]}`);
    }
    this.revisions++;
  }
  /** [text, namedStyle] per paragraph (what most tests compare). */
  paras(): [string, string][] {
    return this.full().map((p) => [p.text, String(p.ps.namedStyleType ?? "NORMAL_TEXT")]);
  }
  /** Everything: text, paragraph style, and text-style runs (for exact-undo checks). */
  full(): { text: string; ps: PS; runs: { text: string; ts: TS }[] }[] {
    const out: { text: string; ps: PS; runs: { text: string; ts: TS }[] }[] = [];
    let cur: { text: string; ps: PS; runs: { text: string; ts: TS }[] } = { text: "", ps: {}, runs: [] };
    for (const ch of this.chars) {
      if (ch.c === "\n") {
        cur.ps = clone(ch.ps ?? {});
        if (!cur.ps.namedStyleType) cur.ps.namedStyleType = "NORMAL_TEXT";
        out.push(cur);
        cur = { text: "", ps: {}, runs: [] };
        continue;
      }
      cur.text += ch.c;
      const last = cur.runs[cur.runs.length - 1];
      if (last && JSON.stringify(last.ts) === JSON.stringify(ch.ts)) last.text += ch.c;
      else cur.runs.push({ text: ch.c, ts: clone(ch.ts) });
    }
    return out;
  }
  content(): DocEl[] {
    let idx = 1;
    return this.full().map((p) => {
      const start = idx;
      const elements: { startIndex: number; textRun: { content: string; textStyle: TS } }[] = [];
      for (const r of p.runs) {
        elements.push({ startIndex: idx, textRun: { content: r.text, textStyle: r.ts } });
        idx += r.text.length;
      }
      // the paragraph's line break rides on the last run (or its own run if the paragraph is empty)
      if (elements.length) elements[elements.length - 1].textRun.content += "\n";
      else elements.push({ startIndex: idx, textRun: { content: "\n", textStyle: {} } });
      idx += 1;
      return { startIndex: start, endIndex: idx, paragraph: { elements, paragraphStyle: p.ps } } as DocEl;
    });
  }
  io() {
    return { read: async () => ({ title: "Sim", content: this.content() }), batch: async (r: unknown[]) => this.apply(r) };
  }
}
