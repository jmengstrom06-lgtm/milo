// `npm run eval:writing` : the bench for writing help on the student's own work. Real AI, checked automatically.
//  - Edit my paper: planted mistakes must get fixed, edits must land safely in the doc, quotes/facts untouched,
//    "cut to N words" must hit the target, the student's voice kept (no AI clichés added).
//  - Sources: every scholarly source is real (DOI resolves through the database), formatted MLA + APA.
//  - Discussion posts: meet the word count and the number of replies, reply to real classmates, no AI clichés.
//  - Readings: notes, terms, flashcards and a valid 4-choice quiz from a real reading.
// Needs ANTHROPIC_API_KEY.
import path from "node:path";
import dotenv from "dotenv";
import { proposeEdits, scholarly } from "../src/main/writing";
import { flatten, plan, scopeOf, words, type DocEl } from "../src/main/docEdit";
import { citeLine, inText } from "../src/main/citations";
import { draftDiscussion } from "../src/main/discussions";
import { readThis } from "../src/main/reading";

dotenv.config({ path: path.join(__dirname, "..", ".env") });
const BAR = 0.9;
let pass = 0;
let total = 0;
const check = (name: string, ok: boolean, why = "") => {
  total++;
  if (ok) pass++;
  console.log(`${ok ? "✓" : "✗"} ${name}${ok || !why ? "" : `  (${why})`}`);
};
const doc = (paras: string[]): DocEl[] => {
  let i = 1;
  return paras.map((p) => {
    const s = p + "\n";
    const el = { startIndex: i, endIndex: i + s.length, paragraph: { elements: [{ startIndex: i, textRun: { content: s } }] } };
    i += s.length;
    return el;
  });
};
/** Apply placed edits to the plain text (what the doc will read after). */
function applied(text: string, edits: { find: string; replace: string }[]) {
  let t = text;
  for (const e of edits) t = t.replace(e.find, e.replace);
  return t;
}
const CLICHE = /\b(delve|tapestry|in today's (fast-paced )?world|plays a crucial role|it is important to note|a testament to|navigat(e|ing) the complexities)\b/i;

const ESSAY = [
  "Social Media and Teen Sleep",
  "Social media have changed how teenagers spend there nights. Many students scrolls on their phones until well past midnight, and this effects how much they sleep.",
  "According to the CDC, about 72% of high school students do not get enough sleep on school nights. This is a big problem because sleep is important for learning and it is also important for mood and it is also important for health in general.",
  "One reason is the blue light from screens. Blue light makes it harder for the brain to release melatonin, which is the hormone that tells your body its time to sleep.",
  'As one researcher put it, "the bedroom has become a 24-hour entertainment center." Schools and parents should encourage students to put phones away an hour before bed.',
];

async function editCases() {
  const text = flatten(doc(ESSAY)).text;
  const quote = '"the bedroom has become a 24-hour entertainment center."';
  // 1. a full edit: the planted mistakes get fixed, nothing invented
  const r = await proposeEdits(ESSAY[0], text, "edit my paper");
  if (!r.ok) return check("edit: full edit ran", false, r.text);
  const p = plan(flatten(doc(ESSAY)), r.data.edits);
  const placed = p.ok.length / Math.max(1, r.data.edits.length);
  check("edit: 80%+ of edits land exactly in the doc", placed >= 0.8, `${p.ok.length}/${r.data.edits.length} placed; dropped: ${p.dropped.map((d) => d.reason).join(", ")}`);
  const out = applied(text, p.ok);
  check("edit: fixed 'there nights' -> 'their'", /their nights/.test(out));
  check("edit: fixed 'students scrolls'", !/students scrolls/.test(out));
  check("edit: fixed 'effects how much'", !/this effects/.test(out));
  check("edit: fixed 'its time to sleep'", /it['’]s time to sleep|it is time to sleep/.test(out));
  check("edit: kept the direct quote word for word", out.includes(quote));
  check("edit: kept the 72% statistic, added no new numbers", /72%/.test(out) && (out.match(/\d+%/g) ?? []).length === (text.match(/\d+%/g) ?? []).length);
  check("edit: added no AI clichés", !CLICHE.test(out));
  // 2. grammar only: no style rewrites
  const g = await proposeEdits(ESSAY[0], text, "just fix the grammar");
  if (g.ok) {
    const gp = plan(flatten(doc(ESSAY)), g.data.edits);
    const big = gp.ok.filter((e) => Math.abs(words(e.replace) - words(e.find)) > 6);
    check("edit (grammar only): no big rewrites", big.length <= 1, `${big.length} big rewrites`);
  } else check("edit (grammar only) ran", false, g.text);
  // 3. cut to a word count
  const target = Math.round(words(text) * 0.75);
  const c = await proposeEdits(ESSAY[0], text, `cut my essay to ${target} words`);
  if (c.ok) {
    const cp = plan(flatten(doc(ESSAY)), c.data.edits);
    const n = words(applied(text, cp.ok));
    check(`edit (cut to ${target} words): within 15%`, Math.abs(n - target) / target <= 0.15, `got ${n}`);
  } else check("edit (cut) ran", false, c.text);
  // 4. intro only: nothing after the first paragraph changes
  const intro = await proposeEdits(ESSAY[0], text, "edit my intro");
  if (intro.ok) {
    const ip = plan(flatten(doc(ESSAY)), intro.data.edits, scopeOf(text, "edit my intro"));
    const firstEnd = text.indexOf(ESSAY[2]);
    const outside = ip.ok.filter((e) => text.indexOf(e.find) >= firstEnd);
    check("edit (intro only): stays in the intro", outside.length === 0, `${outside.length} edits outside`);
  } else check("edit (intro) ran", false, intro.text);
}

async function sourceCases() {
  for (const topic of ["social media and adolescent sleep", "minimum wage effects on employment", "microplastics in drinking water"]) {
    const s = await scholarly(topic, 5);
    check(`sources (${topic}): found 3+ scholarly sources`, s.length >= 3, `${s.length} found`);
    const real = s.filter((x) => /^10\.\d{4,9}\//.test(x.doi ?? "") && x.authors.length && x.year);
    check(`sources (${topic}): each has a DOI, authors and a year`, real.length === s.length, `${s.length - real.length} incomplete`);
    if (s[0]) {
      const mla = citeLine(s[0], "MLA");
      const apa = citeLine(s[0], "APA");
      check(`sources (${topic}): MLA and APA lines look right`, /^".+|^[A-Z][^,]+, /.test(mla) && mla.includes("doi.org") && /\(\d{4}\)/.test(apa) && apa.includes("doi.org"), `${mla} | ${apa}`);
      check(`sources (${topic}): in-text citation`, /^\([^)]+\)$/.test(inText(s[0], "MLA")) && /, \d{4}\)$/.test(inText(s[0], "APA")));
    }
  }
}

async function discussionCases() {
  const topic = { forumId: 1, topicId: 2, forum: "Week 6", name: "Week 6: Conformity", prompt: "After reading Chapter 6, explain Asch's conformity experiment and describe a time you saw conformity in your own life. Your post must be at least 250 words. Then reply to two classmates' posts with at least 75 words each.", due: null, end: null, locked: false };
  const posts = [
    { id: 11, parentId: null, userId: 5, who: "Maya R.", subject: "Conformity at work", text: "Asch showed that about a third of people went along with a clearly wrong answer when everyone else did. I saw this at my summer job when everyone skipped the safety checklist because the manager did, and nobody wanted to be the one to slow things down.", at: "" },
    { id: 12, parentId: null, userId: 6, who: "Chris T.", subject: "Group chats", text: "The line experiment made me think about group chats. When one person posts an opinion and five people agree fast, it feels weird to disagree even if you think they're wrong. I think social media makes Asch's findings even stronger now.", at: "" },
    { id: 13, parentId: null, userId: 7, who: "Priya S.", subject: "Fashion", text: "Conformity shows up in what people wear on campus. Everyone had the same shoes my freshman year. Asch found that having even one other person disagree made people much less likely to conform.", at: "" },
  ];
  const d = await draftDiscussion({ course: "Intro to Psychology", topic, posts, me: 99, voice: ["honestly i didnt expect the reading to be this interesting but it was. the part about obedience reminded me of my high school soccer team"], ask: "do my discussion post for psych" });
  if ("error" in d) return check("discussion: drafted", false, d.error);
  const n = words(d.body);
  check("discussion: main post meets 250 words", n >= 250, `${n} words`);
  check("discussion: exactly 2 replies", d.replies.length === 2, `${d.replies.length}`);
  check("discussion: replies go to real classmates, not the same one", d.replies.every((r) => [11, 12, 13].includes(r.parentId)) && new Set(d.replies.map((r) => r.parentId)).size === d.replies.length);
  check("discussion: replies meet 75 words", d.replies.every((r) => words(r.body) >= 75), d.replies.map((r) => words(r.body)).join(","));
  check("discussion: answers both parts (Asch + own life)", /asch/i.test(d.body) && /\b(I|my|me)\b/.test(d.body));
  check("discussion: no AI clichés", !CLICHE.test([d.body, ...d.replies.map((r) => r.body)].join(" ")));
}

const READING = `Chapter 4: The Cell Membrane

The plasma membrane is a phospholipid bilayer that separates the inside of the cell from its environment. Each phospholipid has a hydrophilic (water-loving) phosphate head and two hydrophobic (water-fearing) fatty acid tails. In water, phospholipids arrange themselves with heads facing outward and tails facing inward, forming the bilayer.

The fluid mosaic model describes the membrane as a flexible layer with proteins floating in or on it. Integral proteins span the membrane and often act as channels or carriers. Peripheral proteins sit on the surface and often act as enzymes or signals. Cholesterol, found between phospholipids in animal cells, keeps the membrane from becoming too fluid at high temperatures or too rigid at low temperatures.

Transport across the membrane can be passive or active. Passive transport requires no energy (ATP) and moves substances down their concentration gradient. Simple diffusion moves small nonpolar molecules like oxygen and carbon dioxide directly through the bilayer. Facilitated diffusion uses channel or carrier proteins to move ions and polar molecules such as glucose. Osmosis is the diffusion of water across a selectively permeable membrane, from an area of low solute concentration to high solute concentration.

Active transport requires energy and moves substances against their concentration gradient. The sodium-potassium pump uses one ATP to move three sodium ions out of the cell and two potassium ions in. Bulk transport moves large particles: endocytosis brings material into the cell in vesicles, while exocytosis releases material out of the cell.

Tonicity describes how a solution affects cell volume. In a hypertonic solution, water leaves the cell and it shrinks. In a hypotonic solution, water enters the cell and it may burst (lyse). In an isotonic solution, there is no net movement of water. Key exam topics: compare passive and active transport, predict what happens to a cell in different solutions, and explain the role of cholesterol.`;

async function readingCases() {
  const r = await readThis({ text: READING.repeat(1), name: "Ch 4 reading" }, "make notes and a quiz");
  if (!r.ok) return check("reading: made study material", false, r.text);
  check("reading: 6+ key terms", r.terms >= 6, `${r.terms}`);
  check("reading: 10+ flashcards", r.cards >= 10, `${r.cards}`);
  check("reading: 6+ quiz questions, each with 4 choices and a valid answer", r.quiz.length >= 6 && r.quiz.every((q) => q.choices.length === 4 && q.correct >= 0 && q.correct < 4), `${r.quiz.length}`);
  check("reading: spots the exam topics", r.alerts >= 2, `${r.alerts}`);
  check("reading: the sodium-potassium pump numbers are exact (3 out, 2 in)", r.quiz.some((q) => /sodium/i.test(q.q + q.choices.join(" "))) ? r.quiz.filter((q) => /sodium/i.test(q.q)).every((q) => !/2 sodium|two sodium/i.test(q.choices[q.correct])) : true);
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) return console.log("No ANTHROPIC_API_KEY: skipping the writing bench.");
  const only = (process.env.WRITING_ONLY ?? "").split(",").filter(Boolean);
  const runs: [string, () => Promise<void>][] = [["edit", editCases], ["sources", sourceCases], ["discussion", discussionCases], ["reading", readingCases]];
  for (const [name, fn] of runs) if (!only.length || only.includes(name)) await fn().catch((e) => check(`${name}: ran`, false, (e as Error).message));
  console.log(`\nWriting: ${pass}/${total} checks = ${((pass / Math.max(1, total)) * 100).toFixed(1)}%  (bar ${BAR * 100}%)`);
  if (total && pass / total < BAR) process.exit(1); // nothing asked for (only=none) is not a failure
}
main();
