// Worksheet test bench: varied subjects AND layouts, so a sweep fix has to work on worksheets in general,
// not on the one Jake happened to test. Every page grades itself (window.__grade()).
//
// Layouts covered: one long column, two-column grid, form cards (Google Forms style), a table with inputs,
// fill-in-the-blank inside sentences, a reading passage with short answers, dropdowns, checkboxes,
// true/false, a math page with radios at the very bottom. Subjects: stats, algebra, geometry, chemistry,
// biology, English grammar, reading, history, Spanish, economics.

type Q =
  | { t: "text"; q: string; a: (string | number)[]; tol?: number; label?: string }
  | { t: "area"; q: string; keys: string[] } // free response: must mention every key word
  | { t: "radio"; q: string; opts: string[]; a: number }
  | { t: "check"; q: string; opts: string[]; a: number[] }
  | { t: "select"; q: string; opts: string[]; a: number }
  | { t: "blanks"; q: string; a: string[][] } // "___" in q = one box each
  | { t: "table"; q: string; head: string[]; rows: { name: string; a: (string | number)[] }[]; tol?: number };

export type Sheet = { id: string; title: string; subject: string; layout: "column" | "grid" | "cards" | "plain"; name?: boolean; passage?: string; qs: Q[]; ask: string };

export const SHEETS: Sheet[] = [
  {
    id: "stats-basic", title: "Statistics Practice: Center, Spread and Probability", subject: "stats", layout: "column", name: true, ask: "fill in this worksheet and put Jake for the name",
    qs: [
      { t: "text", q: "Find the mean of 4, 6, 8, 10, 12.", a: [8] },
      { t: "text", q: "Find the median of 3, 9, 1, 7, 5.", a: [5] },
      { t: "text", q: "What is the range of 12, 4, 19, 7, 10?", a: [15] },
      { t: "text", q: "A test has a mean of 70 and a standard deviation of 5. What is the z-score for 82?", a: [2.4] },
      { t: "text", q: "A bag has 3 red and 7 blue marbles. What is P(red)? Answer as a decimal.", a: [0.3] },
      { t: "text", q: "You flip a fair coin twice. What is P(two heads)? Answer as a decimal.", a: [0.25] },
      { t: "radio", q: "Which measure of center is least affected by an outlier?", opts: ["Mean", "Median", "Range", "Maximum"], a: 1 },
      { t: "radio", q: "About what percent of normal data is within 1 standard deviation of the mean?", opts: ["50%", "68%", "95%", "99.7%"], a: 1 },
    ],
  },
  {
    id: "algebra-long", title: "Algebra 1: Solving Equations (Homework 7)", subject: "algebra", layout: "column", ask: "complete this worksheet",
    qs: [
      { t: "text", q: "Solve for x: 3x + 7 = 22", a: [5] },
      { t: "text", q: "Solve for x: 5x − 4 = 2x + 11", a: [5] },
      { t: "text", q: "Solve for y: y/4 = 9", a: [36] },
      { t: "text", q: "Solve for n: 2(n + 3) = 20", a: [7] },
      { t: "text", q: "Solve for x: 7 − x = 12", a: [-5] },
      { t: "text", q: "Solve for k: 0.5k + 2 = 6", a: [8] },
      { t: "text", q: "Solve for x: 4x = −28", a: [-7] },
      { t: "text", q: "Solve for a: a − 2.5 = 4", a: [6.5] },
      { t: "text", q: "Solve for x: 9 = 3(x − 1)", a: [4] },
      { t: "text", q: "Solve for t: 6t + 1 = 4t + 9", a: [4] },
      { t: "text", q: "Solve for x: x/3 + 2 = 5", a: [9] },
      { t: "text", q: "Solve for m: 10 − 2m = 0", a: [5] },
      { t: "text", q: "Solve for x: 2x + 3x = 35", a: [7] },
      { t: "text", q: "Solve for p: 3(p − 4) = p", a: [6] },
      { t: "text", q: "Solve for x: 12 = x + x + x", a: [4] },
    ],
  },
  {
    id: "geometry-grid", title: "Geometry Review: Area and Angles", subject: "geometry", layout: "grid", ask: "do all of these",
    qs: [
      { t: "text", q: "Area of a rectangle 8 cm by 5 cm (cm²)?", a: [40] },
      { t: "text", q: "Area of a triangle with base 10 and height 6?", a: [30] },
      { t: "text", q: "Two angles of a triangle are 50° and 60°. The third angle?", a: [70] },
      { t: "text", q: "Perimeter of a square with side 7?", a: [28] },
      { t: "text", q: "Supplement of a 35° angle?", a: [145] },
      { t: "text", q: "Circumference of a circle with diameter 10, using π = 3.14?", a: [31.4], tol: 0.05 },
      { t: "text", q: "Hypotenuse of a right triangle with legs 6 and 8?", a: [10] },
      { t: "text", q: "Each interior angle of a regular hexagon (degrees)?", a: [120] },
    ],
  },
  {
    id: "chem-table", title: "Chemistry Lab Prep: Molar Mass Table", subject: "chemistry", layout: "plain", ask: "fill in the table",
    qs: [
      { t: "table", q: "Fill in the molar mass (g/mol, one decimal) and number of atoms for each compound. Use H = 1.0, C = 12.0, O = 16.0, N = 14.0.", head: ["Compound", "Molar mass (g/mol)", "Atoms per molecule"], rows: [
        { name: "H₂O", a: [18.0, 3] },
        { name: "CO₂", a: [44.0, 3] },
        { name: "CH₄", a: [16.0, 5] },
        { name: "NH₃", a: [17.0, 4] },
      ], tol: 0.11 },
    ],
  },
  {
    id: "bio-cards", title: "Biology Quiz: Cells", subject: "biology", layout: "cards", name: true, ask: "answer this quiz. my name is Jake",
    qs: [
      { t: "radio", q: "Which organelle makes most of the cell's ATP?", opts: ["Ribosome", "Mitochondrion", "Golgi apparatus", "Lysosome"], a: 1 },
      { t: "check", q: "Select ALL structures found in plant cells but not animal cells.", opts: ["Cell wall", "Chloroplast", "Nucleus", "Large central vacuole", "Mitochondria"], a: [0, 1, 3] },
      { t: "select", q: "The process cells use to divide into two identical cells is called:", opts: ["Choose…", "Meiosis", "Mitosis", "Osmosis", "Photosynthesis"], a: 2 },
      { t: "radio", q: "True or false: Prokaryotic cells have a nucleus.", opts: ["True", "False"], a: 1 },
      { t: "text", q: "What molecule carries genetic information? (one word or abbreviation)", a: ["DNA", "deoxyribonucleic acid"] },
    ],
  },
  {
    id: "english-grammar", title: "English: Grammar and Usage", subject: "english", layout: "column", ask: "fill out this worksheet",
    qs: [
      { t: "select", q: "Choose the correct word: ___ going to the game tonight.", opts: ["—", "Their", "There", "They're"], a: 3 },
      { t: "select", q: "Choose the correct word: The dog wagged ___ tail.", opts: ["—", "it's", "its", "its'"], a: 2 },
      { t: "radio", q: "Which sentence is correct?", opts: ["Me and him went to class.", "He and I went to class.", "Him and I went to class."], a: 1 },
      { t: "radio", q: "Which word is an adverb? \"She sang beautifully at the concert.\"", opts: ["She", "sang", "beautifully", "concert"], a: 2 },
      { t: "text", q: "Write the plural of \"child\".", a: ["children"] },
      { t: "text", q: "Write the past tense of \"run\".", a: ["ran"] },
    ],
  },
  {
    id: "history-blanks", title: "U.S. History: Fill in the Blanks", subject: "history", layout: "plain", ask: "fill in the blanks",
    qs: [
      { t: "blanks", q: "The Declaration of Independence was signed in ___ in the city of ___.", a: [["1776"], ["Philadelphia"]] },
      { t: "blanks", q: "The first President of the United States was George ___.", a: [["Washington"]] },
      { t: "blanks", q: "The Civil War ended in the year ___.", a: [["1865"]] },
      { t: "blanks", q: "The first ten amendments to the Constitution are called the Bill of ___.", a: [["Rights"]] },
    ],
  },
  {
    id: "reading-passage", title: "Reading Comprehension: The Water Cycle", subject: "reading", layout: "column", ask: "complete this assignment",
    passage:
      "Water on Earth moves in a continuous cycle. The sun heats water in oceans and lakes, and it rises into the air as vapor. This step is called evaporation. As the vapor rises it cools and turns back into tiny droplets that form clouds, a step called condensation. When the droplets grow heavy, they fall back to the ground as rain, snow or hail. This is precipitation. Some of the water soaks into the ground, and some runs off into rivers that carry it back to the ocean, where the cycle begins again.",
    qs: [
      { t: "text", q: "What is the step called when water rises into the air as vapor?", a: ["evaporation"] },
      { t: "text", q: "What is the step called when vapor forms clouds?", a: ["condensation"] },
      { t: "radio", q: "What provides the energy that drives the water cycle?", opts: ["The moon", "The sun", "Wind", "The ocean"], a: 1 },
      { t: "area", q: "In one or two sentences, explain what precipitation is.", keys: ["fall"] },
    ],
  },
  {
    id: "spanish-vocab", title: "Spanish 1: Vocabulario", subject: "spanish", layout: "grid", ask: "do this worksheet",
    qs: [
      { t: "text", q: "Translate to Spanish: dog", a: ["perro", "el perro"] },
      { t: "text", q: "Translate to Spanish: house", a: ["casa", "la casa"] },
      { t: "text", q: "Translate to English: libro", a: ["book", "a book", "the book"] },
      { t: "text", q: "Translate to English: agua", a: ["water"] },
      { t: "select", q: "\"Yo ___ estudiante.\"", opts: ["—", "soy", "eres", "es"], a: 1 },
      { t: "radio", q: "How do you say \"thank you\"?", opts: ["Hola", "Gracias", "Adiós", "Por favor"], a: 1 },
    ],
  },
  {
    id: "econ-bottom", title: "Economics: Supply and Demand", subject: "economics", layout: "column", ask: "put the answers in the boxes",
    qs: [
      { t: "radio", q: "If the price of a good rises, quantity demanded usually:", opts: ["Rises", "Falls", "Stays the same"], a: 1 },
      { t: "radio", q: "A shortage happens when the price is:", opts: ["Above equilibrium", "Below equilibrium", "At equilibrium"], a: 1 },
      { t: "text", q: "A shirt's price goes from $20 to $25. What is the percent increase? (number only)", a: [25] },
      { t: "radio", q: "Which shifts the demand curve to the right?", opts: ["A rise in consumer income (normal good)", "A rise in the good's own price", "A new tax on producers"], a: 0 },
      { t: "check", q: "Select ALL that are factors of production.", opts: ["Land", "Labor", "Money", "Capital", "Entrepreneurship"], a: [0, 1, 3, 4] },
      { t: "radio", q: "Opportunity cost is:", opts: ["The money price of a good", "The value of the next best alternative given up", "The total cost of production"], a: 1 },
    ],
  },
];

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** One self-grading HTML page per sheet. */
export function renderSheet(s: Sheet): string {
  let n = 0;
  const key: unknown[] = [];
  const body = s.qs
    .map((q, qi) => {
      n++;
      const id = `q${qi}`;
      let inner = "";
      if (q.t === "text") {
        inner = `<p>${esc(q.q)}</p><input type="text" id="${id}" class="ans">`;
        key.push({ id, t: "text", a: q.a, tol: q.tol ?? 0.011 });
      } else if (q.t === "area") {
        inner = `<p>${esc(q.q)}</p><textarea id="${id}" rows="3"></textarea>`;
        key.push({ id, t: "area", keys: q.keys });
      } else if (q.t === "radio" || q.t === "check") {
        const type = q.t === "radio" ? "radio" : "checkbox";
        inner = `<p>${esc(q.q)}</p><div class="opts">${q.opts.map((o, oi) => `<label><input type="${type}" name="${id}" value="${oi}"> ${esc(o)}</label>`).join("")}</div>`;
        key.push({ id, t: q.t, a: q.a });
      } else if (q.t === "select") {
        inner = `<p>${esc(q.q)}</p><select id="${id}">${q.opts.map((o, oi) => `<option value="${oi}">${esc(o)}</option>`).join("")}</select>`;
        key.push({ id, t: "select", a: q.a });
      } else if (q.t === "blanks") {
        let b = 0;
        inner = `<p class="inline">${esc(q.q).replace(/___/g, () => `<input type="text" class="blank" id="${id}_${b++}" size="10">`)}</p>`;
        q.a.forEach((a, bi) => key.push({ id: `${id}_${bi}`, t: "text", a, tol: 0 }));
      } else if (q.t === "table") {
        inner = `<p>${esc(q.q)}</p><table><thead><tr>${q.head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${q.rows
          .map((r, ri) => `<tr><td>${esc(r.name)}</td>${r.a.map((_, ci) => `<td><input type="text" id="${id}_${ri}_${ci}" size="8"></td>`).join("")}</tr>`)
          .join("")}</tbody></table>`;
        q.rows.forEach((r, ri) => r.a.forEach((a, ci) => key.push({ id: `${id}_${ri}_${ci}`, t: "text", a: [a], tol: q.tol ?? 0.011 })));
      }
      return `<li class="q"><span class="num">${n}.</span><div>${inner}</div></li>`;
    })
    .join("");
  if (s.name) key.push({ id: "name", t: "text", a: ["Jake"], tol: 0 });
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(s.title)}</title><style>
body{margin:0;background:#f3f3f1;font:17px/1.55 -apple-system,Segoe UI,Arial,sans-serif;color:#151515}
.sheet{max-width:${s.layout === "grid" ? 1100 : 760}px;margin:28px auto;background:#fff;border:1px solid #ddd;padding:32px 40px}
h1{font-size:30px;margin:0 0 10px}.passage{background:#f7f7f4;border-left:4px solid #999;padding:12px 16px;margin:16px 0}
ol{list-style:none;padding:0;margin:0}${s.layout === "grid" ? "ol{display:grid;grid-template-columns:1fr 1fr;gap:0 32px}" : ""}
li.q{display:grid;grid-template-columns:2.2em 1fr;gap:6px;padding:16px 0;border-top:1px solid #e3e3e3}
${s.layout === "cards" ? "li.q{border:1px solid #dadce0;border-radius:8px;padding:20px;margin:12px 0;background:#fff} body{background:#f0ebf8} .sheet{background:transparent;border:0}" : ""}
.num{font-weight:800}p{margin:0 0 10px}input[type=text],textarea{font:17px inherit;padding:8px 10px;border:1.5px solid #333;border-radius:4px}
input.ans{width:240px}textarea{width:100%}select{font-size:17px;padding:6px}.opts{display:grid;gap:6px}.opts label{display:flex;gap:10px;align-items:center;padding:6px 10px;border:1px solid #ddd;border-radius:4px}
.opts input{width:18px;height:18px}table{border-collapse:collapse}td,th{border:1px solid #bbb;padding:6px 10px;text-align:left}.inline input{margin:0 4px}
.name{margin:12px 0}</style></head><body><main class="sheet"><h1>${esc(s.title)}</h1>
${s.name ? `<div class="name"><label>Name <input type="text" id="name"></label></div>` : ""}
${s.passage ? `<div class="passage">${esc(s.passage)}</div>` : ""}
<ol>${body}</ol><p style="margin-top:28px;color:#666">End of worksheet.</p></main>
<script>
const KEY=${JSON.stringify(key)};
const num=(s)=>{const t=String(s).trim().replace(/[^0-9.\\/-]/g,"");if(t.includes("/")){const[a,b]=t.split("/").map(Number);return b?a/b:NaN}return parseFloat(t)};
window.__grade=()=>{let right=0;const wrong=[],blank=[];for(const k of KEY){let ok=false,empty=false;
if(k.t==="text"){const v=document.getElementById(k.id).value.trim();empty=!v;ok=k.a.some(a=>typeof a==="number"?Math.abs(num(v)-a)<=Math.max(k.tol,1e-9):v.toLowerCase().replace(/[.\\s]+$/,"")===String(a).toLowerCase())}
else if(k.t==="area"){const v=document.getElementById(k.id).value.toLowerCase();empty=!v.trim();ok=k.keys.every(w=>v.includes(w))}
else if(k.t==="radio"){const c=document.querySelector('input[name="'+k.id+'"]:checked');empty=!c;ok=!!c&&+c.value===k.a}
else if(k.t==="check"){const c=[...document.querySelectorAll('input[name="'+k.id+'"]:checked')].map(e=>+e.value).sort();empty=!c.length;ok=JSON.stringify(c)===JSON.stringify([...k.a].sort())}
else if(k.t==="select"){const v=+document.getElementById(k.id).value;empty=v===0;ok=v===k.a}
if(ok)right++;else(empty?blank:wrong).push(k.id)}return{right,total:KEY.length,wrong,blank}};
</script></body></html>`;
}
