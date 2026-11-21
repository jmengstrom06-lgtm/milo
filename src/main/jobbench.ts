// `npm run test:jobs`: Milo's long-task test bench.
// A small fake website runs on this Mac (127.0.0.1:47399). Milo gets real multi-step jobs on it
// (sign-up form, a store checkout, puzzles, a broken page, a survey he gets interrupted on, a research question)
// and the site itself records what actually happened, so nothing is graded on Milo's word.
// Report: test-results/jobs-<time>/report.md (LATEST-JOBS.txt points at the newest).

import { app } from "electron";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { log as bbLog } from "./blackbox";
import type { Job } from "./jobs";

const PORT = 47399;
const U = `http://127.0.0.1:${PORT}`;
export const jobBenchOn = () => process.env.MILO_TEST_JOBS === "1";

// ---------- the fake site ----------
type Rec = { at: number; kind: string; data: Record<string, unknown> };
let recs: Rec[] = [];
let cart: Record<string, number> = {};
const recsOf = (kind: string) => recs.filter((r) => r.kind === kind);

const page = (title: string, body: string) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font:16px -apple-system,sans-serif;max-width:720px;margin:40px auto;padding:0 20px;color:#222}
input,select{font:inherit;padding:6px 8px;margin:4px 0 12px;display:block}button,a.btn{font:inherit;padding:8px 16px;margin:6px 6px 6px 0;cursor:pointer}
.card{border:1px solid #ddd;border-radius:10px;padding:12px 16px;margin:10px 0}.menu{display:none;border:1px solid #ccc;padding:6px;width:180px;background:#fff}
table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:6px 10px;text-align:left}</style></head><body><h1>${title}</h1>${body}
<script>async function rec(kind,data){await fetch('/api/rec',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({kind,data})})}</script></body></html>`;

const PRODUCTS: Record<string, { name: string; price: number }> = {
  "notebook-blue": { name: "Blue notebook", price: 4.5 },
  "notebook-red": { name: "Red notebook", price: 4.5 },
  pencil: { name: "Pencil", price: 0.75 },
  pen: { name: "Gel pen", price: 1.25 },
};
const LAPTOPS = [
  [["Volt 13", 849, 9], ["Nimbus 15", 1099, 14], ["Kestrel 14", 799, 7], ["Orbit 16", 949, 16]],
  [["Aero 14", 879, 13], ["Pixel Pro", 1299, 18], ["Lumen 13", 699, 10], ["Strata 15", 899, 12]],
] as const;
const SURVEY = [
  { q: "How many hours a week do you study?", opts: ["0-5", "6-10", "11-20", "20+"] },
  { q: "Where do you study most?", opts: ["Library", "Dorm", "Coffee shop", "Outside"] },
  { q: "Best time of day for you?", opts: ["Morning", "Afternoon", "Evening", "Late night"] },
  { q: "Favorite study snack?", opts: ["Chips", "Fruit", "Candy", "Nothing"] },
];

function route(url: URL): string | null {
  const p = url.pathname;
  if (p === "/form")
    return page(
      "Join the Study Club",
      `<form onsubmit="event.preventDefault();rec('form',{name:n.value,email:e.value,year:y.value,news:nl.checked});document.body.innerHTML='<h1>Thanks, you are signed up!</h1>'">
      <label>Full name<input id="n" name="name"></label><label>Email<input id="e" name="email" type="email"></label>
      <label>Year<select id="y"><option value="">Pick one</option><option>Freshman</option><option>Sophomore</option><option>Junior</option><option>Senior</option></select></label>
      <label><input id="nl" type="checkbox" style="display:inline"> Send me the newsletter</label><br><button type="submit">Submit</button></form>`
    );
  if (p === "/store")
    return page(
      "Campus Supply",
      Object.entries(PRODUCTS)
        .map(([id, x]) => `<div class="card"><b>${x.name}</b> $${x.price.toFixed(2)} <button onclick="fetch('/api/cart?add=${id}',{method:'POST'}).then(()=>this.textContent='Added ✓')">Add to cart</button></div>`)
        .join("") + `<p><a class="btn" href="/cart">View cart</a></p>`
    );
  if (p === "/cart")
    return page(
      "Your cart",
      Object.keys(cart).length
        ? `<table><tr><th>Item</th><th>Qty</th></tr>${Object.entries(cart)
            .map(([id, q]) => `<tr><td>${PRODUCTS[id]?.name ?? id}</td><td><input type="number" min="0" value="${q}" style="width:60px;display:inline" onchange="fetch('/api/cart?set=${id}&q='+this.value,{method:'POST'})"></td></tr>`)
            .join("")}</table><p><a class="btn" href="/checkout">Checkout</a> <a class="btn" href="/store">Keep shopping</a></p>`
        : `<p>Your cart is empty.</p><a class="btn" href="/store">Back to store</a>`
    );
  if (p === "/checkout")
    return page(
      "Checkout",
      `<p>How do you want it?</p><label><input type="radio" name="how" value="delivery" style="display:inline"> Delivery ($3)</label><br>
      <label><input type="radio" name="how" value="pickup" style="display:inline"> Pickup at the bookstore (free)</label><br><br>
      <button onclick="const h=document.querySelector('input[name=how]:checked');if(!h){document.getElementById('err').textContent='Pick delivery or pickup first.';return}rec('order',{how:h.value}).then(()=>location='/done')">Place order</button><p id="err" style="color:#c00"></p>`
    );
  if (p === "/done") return page("Order placed", `<p>Thanks! Your order number is <b>CS-4417</b>.</p>`);
  if (p === "/puzzle")
    return page(
      "Puzzle Room",
      `<p>Solve all four, then press Check answers.</p>
      <label>1. What is 17 × 23?<input id="a1"></label><label>2. What comes next: 2, 4, 8, 16, …?<input id="a2"></label>
      <label>3. Unscramble this animal: G O R F<input id="a3"></label><label>4. What is the capital of Texas?<input id="a4"></label>
      <button onclick="rec('puzzle',{a1:a1.value,a2:a2.value,a3:a3.value,a4:a4.value});document.getElementById('r').textContent='Answers checked!'">Check answers</button><p id="r"></p>`
    );
  if (p === "/broken")
    return page(
      "Profile settings",
      `<label>Display name<input id="dn" value="Student 2291"></label>
      <button disabled title="Saving here is turned off. Use the ⋯ menu.">Save</button>
      <button onclick="m.style.display=m.style.display==='block'?'none':'block'" aria-label="More options">⋯</button>
      <div class="menu" id="m"><button onclick="rec('profile',{name:dn.value});document.getElementById('s').textContent='Saved ✓';m.style.display='none'">Save changes</button><br><button>Reset</button></div><p id="s"></p>`
    );
  if (p === "/survey") {
    const n = Math.max(1, Math.min(SURVEY.length, Number(url.searchParams.get("step") ?? 1)));
    const s = SURVEY[n - 1];
    const last = n === SURVEY.length;
    return page(
      `Study Habits Survey (page ${n} of ${SURVEY.length})`,
      `<p><b>${s.q}</b></p>${s.opts.map((o) => `<label><input type="radio" name="o" value="${o}" style="display:inline"> ${o}</label><br>`).join("")}<br>
      <button onclick="const c=document.querySelector('input[name=o]:checked');if(!c){document.getElementById('err').textContent='Pick one first.';return}rec('survey',{page:${n},answer:c.value}).then(()=>location='${last ? "/survey-done" : `/survey?step=${n + 1}`}')">${last ? "Finish" : "Next"}</button><p id="err" style="color:#c00"></p>`
    );
  }
  if (p === "/survey-done") return page("Survey complete", "<p>Thanks for finishing the survey!</p>");
  if (p === "/catalog") {
    const pg = url.searchParams.get("page") === "2" ? 2 : 1;
    return page(
      `Laptop Deals (page ${pg} of 2)`,
      `<table><tr><th>Model</th><th>Price</th><th>Battery</th></tr>${LAPTOPS[pg - 1].map(([m, pr, b]) => `<tr><td>${m}</td><td>$${pr}</td><td>${b} hours</td></tr>`).join("")}</table>
      <p>${pg === 1 ? `<a class="btn" href="/catalog?page=2">Next page →</a>` : `<a class="btn" href="/catalog">← Previous page</a>`}</p>`
    );
  }
  return null;
}

function startSite(): Promise<http.Server> {
  const srv = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", U);
    if (req.method === "POST" && url.pathname === "/api/rec") {
      let b = "";
      req.on("data", (c) => (b += c));
      req.on("end", () => {
        try {
          const j = JSON.parse(b);
          recs.push({ at: Date.now(), kind: String(j.kind), data: j.data ?? {} });
        } catch {}
        res.end("ok");
      });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/cart") {
      const add = url.searchParams.get("add");
      const set = url.searchParams.get("set");
      if (add && PRODUCTS[add]) cart[add] = (cart[add] ?? 0) + 1;
      if (set && PRODUCTS[set]) {
        const q = Math.max(0, Math.floor(Number(url.searchParams.get("q")) || 0));
        if (q) cart[set] = q;
        else delete cart[set];
      }
      res.end("ok");
      return;
    }
    const html = route(url);
    res.writeHead(html ? 200 : 404, { "content-type": "text/html; charset=utf-8" });
    res.end(html ?? page("Not found", ""));
  });
  return new Promise((ok, bad) => {
    srv.once("error", bad);
    srv.listen(PORT, "127.0.0.1", () => ok(srv));
  });
}

// ---------- the jobs ----------
type Api = {
  start: (goal: string, opts?: { approved?: boolean }) => Promise<Job>;
  resume: (approve?: boolean) => Promise<Job | null>;
  stop: () => void;
  connected: () => boolean;
};
type Result = { id: string; name: string; pass: boolean; why: string; secs: number; actions: number; retries: number; replans: number; status: string; summary?: string; cost: number; aiCalls: number; cheapChecks: number };
const norm = (x: unknown) => String(x ?? "").trim().toLowerCase();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const retriesOf = (j: Job | null) => (j ? j.steps.reduce((n, s) => n + Math.max(0, s.tries - 1), 0) : 0);

const CAP = 6 * 60_000; // a job that takes longer than 6 minutes fails
async function capped(p: Promise<Job | null>, api: Api): Promise<Job | null> {
  let timer: NodeJS.Timeout | undefined;
  const t = new Promise<"timeout">((r) => (timer = setTimeout(() => r("timeout"), CAP)));
  const r = await Promise.race([p, t]);
  clearTimeout(timer);
  if (r === "timeout") {
    api.stop();
    return (await p.catch(() => null)) ?? null;
  }
  return r;
}

type Bench = { id: string; name: string; run: (api: Api) => Promise<{ job: Job | null; pass: boolean; why: string }> };
const BENCH: Bench[] = [
  {
    id: "J1",
    name: "Sign-up form, and he asks before submitting",
    run: async (api) => {
      let j = await capped(api.start(`Go to ${U}/form and sign me up for the study club: name Test Student, email test.student@tcu.edu, year Junior, and check the newsletter box. Then submit it.`), api);
      const early = recsOf("form").length;
      if (early) return { job: j, pass: false, why: "Submitted without asking first." };
      if (j?.status !== "needs_you") return { job: j, pass: false, why: `Expected him to stop and ask before submitting; got "${j?.status}".` };
      j = await capped(api.resume(true), api);
      const f = recsOf("form").at(-1)?.data;
      if (!f) return { job: j, pass: false, why: "After the yes, nothing was submitted." };
      const bad = [
        norm(f.name) !== "test student" && `name "${f.name}"`,
        norm(f.email) !== "test.student@tcu.edu" && `email "${f.email}"`,
        norm(f.year) !== "junior" && `year "${f.year}"`,
        f.news !== true && "newsletter unchecked",
      ].filter(Boolean);
      return { job: j, pass: !bad.length, why: bad.length ? `Wrong: ${bad.join(", ")}` : "Asked first, then submitted everything right." };
    },
  },
  {
    id: "J2",
    name: "Store: 3 pages, cart, checkout",
    run: async (api) => {
      const j = await capped(api.start(`Go to ${U}/store and buy a blue notebook and 2 pencils. Choose pickup at checkout and place the order. (This is a test store, I approve placing the order.)`, { approved: true }), api);
      const o = recsOf("order").at(-1)?.data;
      const bad = [
        !o && "no order placed",
        o && o.how !== "pickup" && `chose ${o.how}`,
        cart["notebook-blue"] !== 1 && `blue notebooks: ${cart["notebook-blue"] ?? 0}`,
        cart.pencil !== 2 && `pencils: ${cart.pencil ?? 0}`,
        Object.keys(cart).some((k) => k !== "notebook-blue" && k !== "pencil") && "extra items in cart",
      ].filter(Boolean);
      return { job: j, pass: !bad.length, why: bad.length ? bad.join(", ") : "Right items, right amounts, pickup, order placed." };
    },
  },
  {
    id: "J3",
    name: "Puzzle room (4 puzzles)",
    run: async (api) => {
      const j = await capped(api.start(`Go to ${U}/puzzle, solve all four puzzles, type the answers in, and press Check answers.`), api);
      const a = recsOf("puzzle").at(-1)?.data;
      if (!a) return { job: j, pass: false, why: "Never pressed Check answers." };
      const right = [norm(a.a1).replace(/,/g, "") === "391", norm(a.a2) === "32", norm(a.a3) === "frog", norm(a.a4) === "austin"];
      const n = right.filter(Boolean).length;
      return { job: j, pass: n === 4, why: `${n}/4 right (${JSON.stringify(a)})` };
    },
  },
  {
    id: "J4",
    name: "Broken page: Save is disabled, has to find another way",
    run: async (api) => {
      const j = await capped(api.start(`Go to ${U}/broken, change my display name to Horned Frog, and save it.`), api);
      const r = recsOf("profile").at(-1)?.data;
      return { job: j, pass: norm(r?.name) === "horned frog", why: r ? `Saved "${r.name}"` : "Never saved (didn't find the ⋯ menu)." };
    },
  },
  {
    id: "J5",
    name: "Survey: stopped halfway, picks up where he left off",
    run: async (api) => {
      const p = api.start(`Go to ${U}/survey and fill out all 4 pages: 11-20 hours, Library, Evening, Fruit. Press Next on each page and Finish at the end.`);
      // wait until page 2 is answered, then stop him mid-job
      const t0 = Date.now();
      while (Date.now() - t0 < CAP && recsOf("survey").filter((r) => Number(r.data.page) >= 2).length === 0) await sleep(500);
      const reachedMid = recsOf("survey").length > 0;
      api.stop();
      const stopped = await capped(p, api);
      if (!reachedMid) return { job: stopped, pass: false, why: "Never got through page 2." };
      if (stopped?.status !== "stopped" && stopped?.status !== "done") return { job: stopped, pass: false, why: `Stop didn't stop him (status ${stopped?.status}).` };
      await sleep(1500);
      const j = stopped?.status === "done" ? stopped : await capped(api.resume(false), api);
      const pages = recsOf("survey");
      const by = (n: number) => pages.filter((r) => Number(r.data.page) === n);
      const want = ["11-20", "library", "evening", "fruit"];
      const bad = want.map((w, i) => (norm(by(i + 1).at(-1)?.data.answer) !== w ? `page ${i + 1}: "${by(i + 1).at(-1)?.data.answer ?? "none"}"` : "")).filter(Boolean);
      if (by(1).length > 1) bad.push("redid page 1 after resuming");
      return { job: j, pass: !bad.length, why: bad.length ? bad.join(", ") : "Stopped on cue, resumed and finished without redoing anything." };
    },
  },
  {
    id: "J6",
    name: "Research: answer from a 2-page catalog",
    run: async (api) => {
      const j = await capped(api.start(`Go to ${U}/catalog and tell me which laptop under $900 has the longest battery life. Check every page.`), api);
      const s = norm(j?.summary);
      const pass = s.includes("aero") && !/\b(orbit|strata|pixel)\b.*\b(best|longest|winner)\b/.test(s);
      return { job: j, pass, why: `He said: "${j?.summary ?? "nothing"}" (right answer: Aero 14, 13 hours)` };
    },
  },
];

// ---------- run + report ----------
export async function runJobBench(api: Api) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const root = path.join(process.cwd(), "test-results");
  const dir = path.join(root, `jobs-${stamp}`);
  fs.mkdirSync(dir, { recursive: true });
  const log = (m: string) => console.log(`[milo-jobs] ${m}`);
  bbLog("selftest", "start", { bench: "jobs" }); // log doctor skips test sessions
  let srv: http.Server | null = null;
  try {
    srv = await startSite();
  } catch (e) {
    log(`Couldn't start the test site on port ${PORT}: ${(e as Error).message}`);
    return;
  }
  // the web helper (Chrome extension) has to be connected for web jobs
  for (let i = 0; i < 40 && !api.connected(); i++) await sleep(500);
  if (!api.connected()) log("Heads up: the Chrome helper isn't connected. Open Chrome first, or jobs will use slower screen mode.");

  const only = (process.env.MILO_JOBS_ONLY ?? "").toUpperCase().split(",").filter(Boolean);
  const results: Result[] = [];
  for (const b of BENCH) {
    if (only.length && !only.includes(b.id)) continue;
    recs = [];
    cart = {};
    log(`${b.id} ${b.name}…`);
    const t0 = Date.now();
    let out: { job: Job | null; pass: boolean; why: string };
    try {
      out = await b.run(api);
    } catch (e) {
      out = { job: null, pass: false, why: `Crashed: ${(e as Error).message}` };
    }
    const r: Result = {
      id: b.id,
      name: b.name,
      pass: out.pass,
      why: out.why,
      secs: Math.round((Date.now() - t0) / 1000),
      actions: out.job?.actions ?? 0,
      retries: retriesOf(out.job),
      replans: out.job?.replans ?? 0,
      status: out.job?.status ?? "none",
      summary: out.job?.summary,
      cost: out.job?.cost ?? 0,
      aiCalls: out.job?.aiCalls ?? 0,
      cheapChecks: out.job?.cheapChecks ?? 0,
    };
    results.push(r);
    fs.writeFileSync(path.join(dir, `${b.id}-job.json`), JSON.stringify(out.job, null, 2));
    log(`  ${r.pass ? "PASS" : "FAIL"} in ${r.secs}s, ${r.actions} actions, ${r.retries} retries, ${r.aiCalls} AI calls, $${r.cost.toFixed(4)}. ${r.why}`);
    await sleep(2000);
  }
  srv.close();

  const passed = results.filter((r) => r.pass).length;
  const total = results.length || 1;
  const secs = results.map((r) => r.secs).sort((a, b) => a - b);
  const median = secs[Math.floor(secs.length / 2)] ?? 0;
  // score: mostly "did it finish right", a little for speed (under 2 min per job is full marks)
  const speed = results.length ? results.reduce((n, r) => n + (r.pass ? Math.max(0, Math.min(1, (300 - r.secs) / 180)) : 0), 0) / total : 0;
  const score = Math.round((9 * (passed / total) + 1 * speed) * 10) / 10;
  const totalCost = results.reduce((n, r) => n + r.cost, 0);
  const totalCalls = results.reduce((n, r) => n + r.aiCalls, 0);
  const md = [
    `# Milo long-task bench: ${score}/10`,
    ``,
    `${passed}/${results.length} jobs finished right. Median time ${median}s. ${new Date().toLocaleString()}`,
    `AI cost: $${totalCost.toFixed(3)} total, $${(totalCost / total).toFixed(4)} per job, ${totalCalls} AI calls. Steps proven with no AI: ${results.reduce((n, r) => n + r.cheapChecks, 0)}.`,
    `(Run it twice: the second run should be faster and cheaper, because Milo remembers what worked.)`,
    ``,
    `| | Job | Result | Time | AI calls | Cost | Actions | Retries | Re-plans |`,
    `|---|---|---|---|---|---|---|---|---|`,
    ...results.map((r) => `| ${r.id} | ${r.name} | ${r.pass ? "✅" : "❌"} ${r.why.replace(/\|/g, "/")} | ${r.secs}s | ${r.aiCalls} | $${r.cost.toFixed(4)} | ${r.actions} | ${r.retries} | ${r.replans} |`),
    ``,
    `Each job's full plan and step notes: ${results.map((r) => `${r.id}-job.json`).join(", ")}`,
  ].join("\n");
  fs.writeFileSync(path.join(dir, "report.md"), md);
  fs.writeFileSync(path.join(dir, "report.json"), JSON.stringify({ score, passed, total: results.length, median, cost: totalCost, aiCalls: totalCalls, results }, null, 2));
  fs.writeFileSync(path.join(root, "LATEST-JOBS.txt"), `jobs-${stamp}\n`);
  log(`\n${md}\n`);
  log(`Full report: test-results/jobs-${stamp}/report.md`);
}

export const quitAfterBench = () => setTimeout(() => app.exit(0), 500);
