#!/usr/bin/env node
// Milo's log doctor: `npm run doctor` (or `npm run doctor -- 7` for the last 7 days).
// Reads ~/Milo Logs, finds every moment Milo struggled, and writes test-results/doctor-<date>.md
// plus doctor-cases.json (each failure as a ready-made test case: what you said + what went wrong).

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const days = Number(process.argv[2]) || 2;
const LOGS = process.env.MILO_LOGS || path.join(os.homedir(), "Milo Logs");
const OUT = path.join(__dirname, "..", "test-results");
const since = Date.now() - days * 86400e3;

if (!fs.existsSync(LOGS)) {
  console.log(`No logs yet at ${LOGS}. Use Milo for a bit, then run this again.`);
  process.exit(0);
}
const files = fs
  .readdirSync(LOGS)
  .filter((f) => /^session-.*\.jsonl$/.test(f))
  .map((f) => ({ f, t: fs.statSync(path.join(LOGS, f)).mtimeMs }))
  .filter((x) => x.t >= since)
  .sort((a, b) => a.t - b.t);

const issues = [];
const stats = { sessions: files.length, commands: 0, noiseDropped: 0, reloads: 0, selfTests: 0 };
const words = (s) => String(s || "").split(/\s+/).filter(Boolean).length;
const short = (s, n = 140) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
};

for (const { f } of files) {
  const content = fs.readFileSync(path.join(LOGS, f), "utf8");
  // self-test runs fire commands fast on purpose: they'd look like you rephrasing. Skip them.
  if (content.includes('"src":"selftest"') || /"pushToTalk":true,"forced":false[^\n]*\n[^\n]*"card_skipped"/.test(content.slice(0, 4000)) && content.includes('"src":"lockin"')) {
    stats.selfTests++;
    continue;
  }
  const lines = content.split("\n").filter(Boolean);
  let lastHeard = "";
  const boots = new Set(); // dev mode starts everything twice on purpose: count distinct starts, not log lines
  let isTest = false;
  let webSteps = [];
  for (const raw of lines) {
    let e;
    try {
      e = JSON.parse(raw);
    } catch {
      continue;
    }
    const at = `${f.replace(/^session-|\.jsonl$/g, "")} ${e.t ?? ""}`;
    const add = (kind, why, extra = {}) => issues.push({ at, kind, said: lastHeard, why, ...extra });
    const ev = e.ev ?? "";
    if (e.src === "app" && ev === "heard") {
      lastHeard = e.text ?? "";
      stats.commands++;
      webSteps = [];
    }
    if (ev === "app_boot" && !boots.has(e.boot) && boots.add(e.boot).size > 1) {
      stats.reloads++;
      add("reload", "Milo's screen restarted unexpectedly");
    }
    if (e.src === "ipc" && ev === "milo-test") isTest = true;
    if (ev === "frustration") add("frustration", `You rephrased ${e.secondsLater ?? "?"}s later. First try: "${short(e.was, 80)}"`, { said: e.now });
    if (/flag/.test(ev) && e.src !== "ipc") add("flagged", "You pressed Cmd+Shift+B (or said 'flag that') here");
    if (e.src === "task" && ev === "verify" && e.ok === false) add("didnt_work", `Checked after acting: ${e.kind} ${e.app ?? ""} did NOT work (front: ${e.front ?? "?"})`);
    if (e.src === "ipc" && ev === "task") {
      const o = e.out ?? {};
      if (o.ok === false) add("task_failed", short(o.text));
      else if (o.status === "ask") add("task_asked", `He asked instead of doing it: "${short(o.text)}"`);
      else if (o.status === "stopped") add("task_stopped", "The task was stopped");
    }
    if (e.src === "web" && ev === "plan") {
      const sig = JSON.stringify(e.steps ?? []);
      webSteps.push(sig);
      const n = webSteps.filter((x) => x === sig).length;
      if (n === 2) add("retry_loop", `The web helper tried the same thing twice: ${short(sig, 80)}`);
    }
    if (ev === "card_run" && (e.waitedMs ?? 0) > 5000) add("slow_start", `Waited ${(e.waitedMs / 1000).toFixed(1)}s on the "Got it" card before acting`);
    if (ev === "route_instant" && (e.kind === "no" || e.kind === "yes") && words(e.text) > 5) add("misheard_yes_no", `A long sentence was treated as just "${e.kind}"`);
    if (ev === "api_error" || /_crash$/.test(ev) || ev === "renderer-error") add("error", short(e.detail ?? e.error ?? e.message ?? JSON.stringify(e), 160));
    if (ev === "grant_failed") add("listening", `Smart ears couldn't get a listening pass (${e.status})`);
    if (ev === "dropped" && /not_you/.test(e.why ?? "")) stats.noiseDropped++;
    // Misroutes: a question Milo has a fast, exact answer for went to the AI guesser instead.
    if (ev === "route_ai") {
      const t = String(e.text ?? "").toLowerCase();
      const k = e.kind ?? "";
      const want =
        /\bgrade|\bgraded\b|how am i doing in/.test(t) && !/grade my|grade this/.test(t) ? ["grade"] :
        /what do i need on|need to get on/.test(t) ? ["forecast"] :
        /\bsyllabus\b/.test(t) ? ["syllabus"] :
        /\b(due|deadlines?)\b/.test(t) ? ["radar", "brief"] :
        /^(i )?(got|scored|made) (an? )?\d/.test(t) ? ["score"] :
        /^my (student id|email|major|name|phone)/.test(t) ? ["profile"] : null;
      if (want && !want.includes(k)) add("misroute", `Went to the AI ("${k}") instead of the ${want[0]} command`, { said: e.text });
    }
    // He couldn't answer something he should be able to
    if (e.src === "app" && ev === "say" && /I don't have (your|any)|I can't see your screen|I couldn't find anything called|isn't something I can/i.test(e.text ?? "")) add("couldnt_answer", `He said: "${short(e.text, 90)}"`);
  }
  if (isTest) stats.selfTests++;
}

// group repeats ("grant_failed" 40 times = one problem)
const groups = new Map();
for (const i of issues) {
  const key = `${i.kind}|${i.why.replace(/[0-9.]+s/g, "#s")}`;
  const g = groups.get(key) ?? { ...i, count: 0, examples: [] };
  g.count++;
  if (g.examples.length < 3 && i.said) g.examples.push(i.said);
  groups.set(key, g);
}
const order = ["misroute", "couldnt_answer", "didnt_work", "frustration", "flagged", "misheard_yes_no", "task_failed", "retry_loop", "task_asked", "slow_start", "error", "reload", "listening", "task_stopped"];
const NAMES = {
  misroute: "Understood wrong (phrasing to add as a test)",
  couldnt_answer: "Couldn't answer",
  didnt_work: "Said he did it, check says no",
  frustration: "You had to rephrase",
  flagged: "You flagged it",
  misheard_yes_no: "Long sentence heard as yes/no",
  task_failed: "Task failed",
  retry_loop: "Stuck repeating himself",
  task_asked: "Asked instead of doing",
  slow_start: "Slow to start",
  error: "Errors",
  reload: "Surprise restarts",
  listening: "Listening problems",
  task_stopped: "Stopped tasks",
};
const sorted = [...groups.values()].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || b.count - a.count);

const date = new Date().toISOString().slice(0, 10);
let md = `# Milo log doctor (${date})\n\nLast ${days} day${days === 1 ? "" : "s"}: ${stats.sessions} sessions, ${stats.commands} things said to him, ${sorted.length} distinct problems.\n`;
if (stats.noiseDropped) md += `Background voices ignored correctly: ${stats.noiseDropped} times.\n`;
md += "\n";
if (!sorted.length) md += "No problems found. 🎉\n";
for (const k of order) {
  const gs = sorted.filter((g) => g.kind === k);
  if (!gs.length) continue;
  md += `## ${NAMES[k]} (${gs.reduce((a, g) => a + g.count, 0)})\n\n`;
  for (const g of gs.slice(0, 12)) {
    md += `- **${short(g.why, 160)}**${g.count > 1 ? ` (x${g.count})` : ""}\n`;
    for (const ex of g.examples) md += `  - you said: "${short(ex, 120)}"\n`;
    md += `  - first seen: ${g.at}\n`;
  }
  md += "\n";
}
const cases = sorted
  .filter((g) => g.said && ["misroute", "couldnt_answer", "didnt_work", "frustration", "flagged", "misheard_yes_no", "task_failed", "retry_loop", "task_asked"].includes(g.kind))
  .map((g) => ({ said: g.said, problem: g.why, kind: g.kind, seen: g.at }));
md += `---\n${cases.length} of these are saved as test cases in doctor-cases.json (what you said + what went wrong), ready to turn into permanent tests.\n`;

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, `doctor-${date}.md`), md);
fs.writeFileSync(path.join(OUT, "doctor-cases.json"), JSON.stringify(cases, null, 2));
console.log(md);
console.log(`Saved: test-results/doctor-${date}.md and test-results/doctor-cases.json`);
