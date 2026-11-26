// A tiny stand-in for Google Docs: paragraphs, styles, and the three requests Milo sends.
// Indexes work like Docs: the body starts at 1 and every paragraph ends with "\n".
import type { DocEl } from "../src/main/docEdit";
type Ch = { c: string; style?: string };
export class SimDoc {
  chars: Ch[] = [];
  revisions = 0;
  constructor(paras: (string | [string, string])[]) {
    for (const p of paras) {
      const [t, st] = typeof p === "string" ? [p, "NORMAL_TEXT"] : p;
      for (const c of t) this.chars.push({ c });
      this.chars.push({ c: "\n", style: st });
    }
  }
  styleAt(pos: number) {
    for (let i = pos; i < this.chars.length; i++) if (this.chars[i].c === "\n") return this.chars[i].style ?? "NORMAL_TEXT";
    return "NORMAL_TEXT";
  }
  apply(reqs: unknown[]) {
    for (const r of reqs as Record<string, any>[]) {
      if (r.insertText) {
        const pos = r.insertText.location.index - 1;
        if (pos < 0 || pos > this.chars.length - 1) throw new Error(`insert index ${pos + 1} out of range`);
        const st = this.styleAt(pos);
        const add = [...r.insertText.text].map((c: string) => (c === "\n" ? { c, style: st } : { c }));
        this.chars.splice(pos, 0, ...add);
      } else if (r.deleteContentRange) {
        const s = r.deleteContentRange.range.startIndex - 1;
        const e = r.deleteContentRange.range.endIndex - 1;
        if (s < 0 || e > this.chars.length - 1 || e <= s) throw new Error(`delete ${s + 1}-${e + 1} invalid (doc ends at ${this.chars.length})`);
        this.chars.splice(s, e - s);
      } else if (r.updateParagraphStyle) {
        const s = r.updateParagraphStyle.range.startIndex - 1;
        const e = r.updateParagraphStyle.range.endIndex - 1;
        // every paragraph touching [s, e)
        let i = s;
        while (i > 0 && this.chars[i - 1].c !== "\n") i--;
        for (let k = i; k < this.chars.length; k++) {
          if (this.chars[k].c === "\n") {
            this.chars[k].style = r.updateParagraphStyle.paragraphStyle.namedStyleType;
            if (k >= e - 1) break;
          }
        }
      } else throw new Error(`unknown request ${Object.keys(r)[0]}`);
    }
    this.revisions++;
  }
  paras(): [string, string][] {
    const out: [string, string][] = [];
    let t = "";
    for (const ch of this.chars) {
      if (ch.c === "\n") {
        out.push([t, ch.style ?? "NORMAL_TEXT"]);
        t = "";
      } else t += ch.c;
    }
    return out;
  }
  content(): DocEl[] {
    let idx = 1;
    return this.paras().map(([t, st]) => {
      const s = t + "\n";
      const el: DocEl = { startIndex: idx, endIndex: idx + s.length, paragraph: { elements: [{ startIndex: idx, textRun: { content: s } }], paragraphStyle: { namedStyleType: st } } };
      idx += s.length;
      return el;
    });
  }
  io() {
    return { read: async () => ({ title: "Sim", content: this.content() }), batch: async (r: unknown[]) => this.apply(r) };
  }
}
