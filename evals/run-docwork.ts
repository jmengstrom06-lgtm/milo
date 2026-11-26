// `npm run eval:doc` : the doc agent's bench. Real AI, a simulated Google Doc (same requests Docs gets),
// 18 different things students ask about their paper, each graded on ONE question: did the doc end up the
// way they asked (and nothing else changed)? Plus: every run is undone and must match the original exactly.
// Needs ANTHROPIC_API_KEY.
import path from "node:path";
import dotenv from "dotenv";
import { docWork } from "../src/main/docWork";
import { undoChanges } from "../src/main/docAgent";
import { SimDoc } from "../tests/docSim";

dotenv.config({ path: path.join(__dirname, "..", ".env") });
const BAR = 0.9;
const QUOTE = '"the bedroom has become a 24-hour entertainment center."';
const PAPER: (string | [string, string])[] = [
  "Jake Engstrom",
  "Professor Hayes",
  "ENGL 10803",
  ["Social Media and Teen Sleep", "TITLE"],
  "Social media have changed how teenagers spend there nights. Many students scrolls on their phones until well past midnight, and this effects how much they sleep.",
  "According to the CDC, about 72% of high school students do not get enough sleep on school nights. This is a big problem because sleep is important for learning and it is also important for mood and it is also important for health in general.",
  "One reason is the blue light from screens. Blue light makes it harder for the brain to release melatonin, which is the hormone that tells your body its time to sleep.",
  `As one researcher put it, ${QUOTE} Schools and parents should encourage students to put phones away an hour before bed.`,
];
const ORIG = PAPER.map((p) => (typeof p === "string" ? p : p[0]));
type P = [string, string][];
const T = (ps: P) => ps.map((p) => p[0]);
const bodyWords = (ps: P) => T(ps).slice(4).join(" ").split(/\s+/).filter(Boolean).length;
const same = (a: string, b: string) => a.replace(/\s+/g, " ").trim() === b.replace(/\s+/g, " ").trim();
const unchanged = (ps: P, idx: number[]) => idx.every((i) => ps.some((p) => same(p[0], ORIG[i])));

type Case = { ask: string; check: (after: P, r: Awaited<ReturnType<typeof docWork>>) => true | string };
const CASES: Case[] = [
  {
    ask: "Would you look at my paper and add a section after it that explains your thoughts behind this paper?",
    check: (a) => (a.length > ORIG.length && T(a).indexOf(ORIG[7]) < a.length - 1 && unchanged(a, [4, 5, 6, 7]) ? true : `added after the end: ${a.length > ORIG.length}; originals untouched: ${unchanged(a, [4, 5, 6, 7])}`),
  },
  {
    ask: "fix the grammar in my paper",
    check: (a) => {
      const t = T(a).join(" ");
      const fixed = [/their nights/.test(t), !/students scrolls/.test(t), !/this effects/.test(t), /it['’]s time|it is time/.test(t)].filter(Boolean).length;
      return fixed >= 4 && a.length === ORIG.length && t.includes(QUOTE.slice(1, -2)) ? true : `fixed ${fixed}/4, paragraphs ${a.length}/${ORIG.length}`;
    },
  },
  { ask: "add a conclusion to my essay", check: (a) => (a.length > ORIG.length && T(a).indexOf(ORIG[7]) >= 0 && T(a).indexOf(ORIG[7]) < a.length - 1 ? true : "no new paragraph at the end") },
  { ask: "add headings to each section of my paper", check: (a) => (a.filter((p) => /HEADING/.test(p[1])).length >= 2 && unchanged(a, [4, 5, 6, 7]) ? true : `headings: ${a.filter((p) => /HEADING/.test(p[1])).length}`) },
  { ask: "move the paragraph about blue light so it comes right after my intro", check: (a) => { const t = T(a); const blue = t.findIndex((x) => /blue light/i.test(x)); const cdc = t.findIndex((x) => /CDC/.test(x)); return blue >= 0 && cdc >= 0 && blue < cdc ? true : `blue at ${blue}, cdc at ${cdc}`; } },
  { ask: "delete the paragraph about the CDC from my paper", check: (a) => (!T(a).some((x) => /CDC/.test(x)) && unchanged(a, [4, 6, 7]) ? true : "CDC paragraph still there or others changed") },
  { ask: "what's the thesis of my paper?", check: (a, r) => (r.ok && r.applied.length === 0 && r.answer.length > 10 && a.length === ORIG.length ? true : `changes: ${r.ok ? r.applied.length : "?"}, answer: ${r.ok ? r.answer.slice(0, 40) : ""}`) },
  { ask: "cut my essay down to about 90 words", check: (a) => { const n = bodyWords(a); return n >= 70 && n <= 110 ? true : `${n} words`; } },
  { ask: "add a counterargument paragraph right before my conclusion", check: (a) => { const t = T(a); const last = t.findIndex((x) => x.includes("Schools and parents")); return a.length > ORIG.length && last === t.length - 1 && t.length - 2 > 6 ? true : `last para at ${last} of ${t.length}`; } },
  { ask: "make my intro stronger", check: (a) => (!a.some((p) => same(p[0], ORIG[4])) && unchanged(a, [5, 6, 7]) ? true : "intro unchanged or other paragraphs changed") },
  { ask: "rewrite the paragraph about the CDC so it sounds more formal", check: (a) => (!a.some((p) => same(p[0], ORIG[5])) && T(a).some((x) => /CDC/.test(x) && /72/.test(x)) && unchanged(a, [4, 6, 7]) ? true : "wrong paragraph changed or fact lost") },
  { ask: "add today's date under the class name in my header", check: (a) => (a.length === ORIG.length + 1 && /20\d\d|November|Nov/.test(T(a)[3]) ? true : `line 4 is "${T(a)[3]}"`) },
  { ask: "fix the spelling, and also add a sentence about naps at the end of the blue light paragraph", check: (a) => { const t = T(a).join(" "); return /nap/i.test(t) && /their nights/.test(t) ? true : `nap: ${/nap/i.test(t)}, spelling: ${/their nights/.test(t)}`; } },
  { ask: "change the title to Screens and Sleep", check: (a) => (T(a).some((x) => /^Screens and Sleep$/i.test(x.trim())) && !T(a).includes("Social Media and Teen Sleep") ? true : "title not changed") },
  { ask: "put an image of a phone at the top of my paper", check: (a, r) => (r.ok && (r.cant.length > 0 || r.applied.length === 0) ? true : "claimed to add an image") },
  { ask: "make the second paragraph shorter, don't touch anything else", check: (a) => (unchanged(a, [4, 6, 7]) && !a.some((p) => same(p[0], ORIG[5])) ? true : "touched other paragraphs or didn't change it") },
  { ask: "add one more paragraph with another reason teens don't sleep enough, after the blue light one", check: (a) => { const t = T(a); const blue = t.findIndex((x) => /blue light/i.test(x)); return a.length === ORIG.length + 1 && blue >= 0 && !t[blue + 1].includes("Schools and parents") ? true : "not inserted after blue light"; } },
  { ask: "how many words is my paper and is it good enough for a B?", check: (a, r) => (r.ok && r.applied.length === 0 && /\d/.test(r.answer) ? true : "changed the doc or no word count") },
];

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) return console.log("No ANTHROPIC_API_KEY: skipping the doc bench.");
  const only = (process.env.DOC_ONLY ?? "").split(",").map(Number).filter(Boolean);
  let pass = 0;
  let total = 0;
  for (let i = 0; i < CASES.length; i++) {
    if (only.length && !only.includes(i + 1)) continue;
    const c = CASES[i];
    const d = new SimDoc(PAPER);
    const before = d.paras();
    let line = "";
    try {
      const r = await docWork(d.io(), c.ask);
      const after = d.paras();
      const ok = r.ok ? c.check(after, r) : `failed: ${r.text}`;
      // and every change must undo back to the original, exactly
      let undoOk = true;
      if (r.ok && r.applied.length) {
        await undoChanges(d.io(), r.applied);
        undoOk = JSON.stringify(d.paras()) === JSON.stringify(before);
      }
      total += 2;
      if (ok === true) pass++;
      if (undoOk) pass++;
      line = `${ok === true ? "✓" : "✗"} ${c.ask}${ok === true ? "" : `  (${ok})`}${r.ok ? `  [${r.applied.length} changes${r.missing ? `, missing: ${r.missing.slice(0, 60)}` : ""}]` : ""}${undoOk ? "" : "  ✗ UNDO did not restore the original"}`;
    } catch (e) {
      total += 2;
      line = `✗ ${c.ask}  (crashed: ${(e as Error).message.slice(0, 120)})`;
    }
    console.log(line);
  }
  console.log(`\nDoc agent: ${pass}/${total} = ${((pass / Math.max(1, total)) * 100).toFixed(1)}%  (bar ${BAR * 100}%)`);
  if (pass / Math.max(1, total) < BAR) process.exit(1);
}
main();
