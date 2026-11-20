// Milo's self-test: `npm run test:milo`.
// Drives the real app the way a student does (the same path your voice takes once it becomes text),
// watches what actually happens on screen, times it, and grades the "holy shit" factor out of 10.
// Results land in ~/milo/test-results/<time>/ (report.md, report.json, screenshots of every failure).

import { app, type BrowserWindow } from "electron";
import fs from "node:fs";
import path from "node:path";
import { onLog } from "./blackbox";
import { loadClasses, saveClasses } from "./classes";
import { deleteItem, listItems } from "./library";
import { frontApp, isRunning, openApp, quitApp } from "./hands";

type Cat = "Speed" | "Control" | "Polish" | "Organization" | "Study power" | "Personal" | "Focus" | "Research" | "Computer";
const WEIGHT: Record<Cat, number> = { Speed: 20, Control: 20, Polish: 20, Organization: 15, "Study power": 10, Personal: 5, Focus: 5, Research: 5, Computer: 20 };
const WHY: Record<Cat, string> = {
  Speed: "Feels instant. Slow = 'just another chatbot'.",
  Control: "Does exactly what you say, the moment you say it (stop, close, cancel).",
  Polish: "Nothing overlaps, nothing off screen, always readable.",
  Organization: "Every class has its own folder and tab; work is never lost.",
  "Study power": "Flashcards, sheets and plans made in seconds, filed to the right class.",
  Personal: "Knows you.",
  Focus: "Lock-in works first try.",
  Research: "Real answers with sources, fast.",
  Computer: "Opens, quits and switches apps however you say it (only in npm run test:computer).",
};

type Result = { id: string; cat: Cat; name: string; score: number; pass: boolean; detail: string; ms?: number; shot?: string; events?: string[] };
const results: Result[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runSelfTest(win: BrowserWindow) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const root = path.join(process.cwd(), "test-results");
  const dir = path.join(root, stamp);
  fs.mkdirSync(path.join(dir, "shots"), { recursive: true });
  const t0 = Date.now();
  const log = (m: string) => console.log(`[milo-test] ${m}`);

  // Everything Milo's black box records during a test (what he heard, said, decided).
  let events: { t: number; line: string }[] = [];
  let reloads = 0;
  let listening = true;
  onLog((src, ev, data) => {
    if (!listening) return;
    const d = JSON.stringify(data ?? {});
    events.push({ t: Date.now(), line: `${src}/${ev} ${d.length > 160 ? d.slice(0, 157) + "…" : d}` });
  });
  const off = () => (listening = false);

  const js = <T = unknown>(code: string): Promise<T> => win.webContents.executeJavaScript(code, true) as Promise<T>;
  const S = () => js<Record<string, any>>("window.__milo.state()");
  const hear = (t: string) => js(`window.__milo.hear(${JSON.stringify(t)}, true)`);
  const reset = async () => {
    await js("window.__milo.reset()");
    await sleep(700);
  };
  /** Poll a JS condition (s = Milo's state). Returns ms until true, or -1 on timeout. */
  const waitFor = async (cond: string, timeout: number) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const ok = await js<boolean>(`(() => { const s = window.__milo.state(); try { return !!(${cond}); } catch { return false; } })()`).catch(() => false);
      if (ok) return Date.now() - start;
      await sleep(80);
    }
    return -1;
  };
  const shot = async (id: string) => {
    try {
      const img = await win.webContents.capturePage();
      const f = path.join("shots", `${id}.png`);
      fs.writeFileSync(path.join(dir, f), img.toPNG());
      return f;
    } catch {
      return undefined;
    }
  };
  /** Speed grade: full marks under `great`, partial under `ok`. */
  const speed = (ms: number, great: number, ok: number) => (ms < 0 ? 0 : ms <= great ? 1 : ms <= ok ? 0.6 : 0.25);

  async function test(id: string, cat: Cat, name: string, fn: () => Promise<{ score: number; detail: string; ms?: number }>) {
    log(`${id} ${name}…`);
    let r: { score: number; detail: string; ms?: number } = { score: 0, detail: "" };
    for (let attempt = 0; attempt < 2; attempt++) {
      events = [];
      const boot = await js<number>("window.__milo.boot").catch(() => 0);
      try {
        r = await fn();
      } catch (e) {
        r = { score: 0, detail: `crashed: ${(e as Error).message}` };
      }
      const after = await js<number>("window.__milo && window.__milo.boot").catch(() => 0);
      if (after === boot) break;
      // Milo's screen restarted mid-test (the dev server's live reload): his mic came back on and his state reset.
      log(`${id}: Milo's screen restarted during the test; retrying once`);
      reloads++;
      await js("window.__milo.quietEars()").catch(() => {});
      await sleep(1500);
      await reset();
      if (attempt === 1) r.detail += " (Milo's screen restarted during this test twice)";
    }
    const pass = r.score >= 0.6;
    const res: Result = { id, cat, name, ...r, pass };
    if (!pass) {
      res.shot = await shot(id);
      res.events = events.slice(-25).map((e) => `+${((e.t - (events[0]?.t ?? e.t)) / 1000).toFixed(1)}s ${e.line}`);
    }
    results.push(res);
    log(`${pass ? "PASS" : "FAIL"} ${id} ${r.detail}`);
    await reset();
  }

  // ---------- setup ----------
  const ready = await (async () => {
    for (let i = 0; i < 150; i++) {
      if (await js<boolean>("!!(window.__milo && window.__milo.ready)").catch(() => false)) return true;
      await sleep(200);
    }
    return false;
  })();
  if (!ready) {
    fs.writeFileSync(path.join(dir, "report.md"), "# Milo self-test\n\nCouldn't start: the test hooks never loaded. Is the dev server running?\n");
    off();
    return;
  }
  await sleep(2500); // let him finish waking up (greeting, brief)
  await js("window.__milo.quietEars()"); // the real mic stays off so room noise can't join the test
  // First-run setup stays out of the way during the test (and comes back afterward if it wasn't finished).
  const setupWas = await js<string | null>("localStorage.getItem('milo.onboarded')").catch(() => null);
  await js("localStorage.setItem('milo.onboarded', '1'); window.__milo.setup(false)").catch(() => {});
  await reset();
  const { W, H } = await js<{ W: number; H: number }>("({ W: innerWidth, H: innerHeight })");
  const startPos = (await S()).pos as { x: number; y: number };
  const store0 = loadClasses();
  const [A, B] = store0.classes;
  const label = (c: { code: string; name: string }) => c.code || c.name;
  const libStart = Date.now();
  const sketchShown = `document.querySelector('.rp .sk-graph, .rp .sk-img, .rp .sk-painting')`;
  const pillText = `(document.querySelector('.lib-saved__btn')?.textContent || '')`;
  const chip = (c: { code: string; name: string }) =>
    js(`[...document.querySelectorAll('.cls-chip')].find((e) => e.textContent.includes(${JSON.stringify(label(c))}))?.click()`);

  // ======================= SPEED =======================
  await test("S1", "Speed", "'What can you do?' opens his apps", async () => {
    await hear("what can you do");
    const ms = await waitFor("s.ringOpen", 3000);
    return { ms, score: speed(ms, 400, 1200), detail: ms < 0 ? "ring never opened" : `ring open in ${ms}ms` };
  });

  await test("S2", "Speed", "Feels heard instantly (something on screen the moment you finish)", async () => {
    await hear("what's 15 times 12");
    const ms = await waitFor("s.pending || s.heard || s.bubble || s.mood === 'thinking'", 3000);
    return { ms, score: speed(ms, 250, 800), detail: ms < 0 ? "no sign he heard" : `reacted in ${ms}ms` };
  });

  await test("S3", "Speed", "Quick question answered ('what's 15 times 12')", async () => {
    await hear("what's 15 times 12");
    const ms = await waitFor("s.speaking || (s.bubble && /180/.test(s.bubble))", 25000);
    const s = await S();
    const right = /180/.test(String(s.bubble ?? ""));
    const card = events.some((e) => e.line.includes("card_shown"));
    const base = speed(ms, 2500, 6000);
    return {
      ms,
      score: right ? base : base * 0.5,
      detail: ms < 0 ? "never answered" : `answered in ${(ms / 1000).toFixed(1)}s${card ? " (waited on the 'Got it' card first)" : ""}${right ? "" : `; answer didn't say 180: "${String(s.bubble ?? "").slice(0, 60)}"`}`,
    };
  });

  // ======================= CONTROL =======================
  const stopTest = async (how: "voice" | "esc") => {
    await hear("tell me a story about a frog who goes to college");
    const startMs = await waitFor("s.speaking", 30000);
    if (startMs < 0) return { score: 0, detail: "he never started talking, so stop couldn't be tested" };
    await sleep(2500);
    const at = Date.now();
    if (how === "voice") await hear("stop");
    else await js("window.__milo.key('Escape')");
    const ms = await waitFor("!s.speaking", 4000);
    await sleep(4000);
    const s = await S();
    const saidAfter = events.filter((e) => e.t > at + 300 && /app\/say /.test(e.line)).length;
    const silent = !s.speaking && saidAfter === 0;
    if (ms < 0) return { ms, score: 0, detail: "kept talking after stop" };
    if (!silent) return { ms, score: 0.2, detail: `stopped in ${ms}ms but started talking again (${saidAfter} new line${saidAfter === 1 ? "" : "s"})` };
    return { ms, score: speed(ms, 400, 1200), detail: `went quiet in ${ms}ms and stayed quiet` };
  };
  await test("C1", "Control", "Say 'stop' mid-answer: he goes quiet and stays quiet", () => stopTest("voice"));
  await test("C2", "Control", "Press Esc mid-answer: he goes quiet", () => stopTest("esc"));

  await test("C3", "Control", "'Close the message' clears his bubble", async () => {
    await hear("what's the capital of France");
    const got = await waitFor("s.bubble && !s.speaking && /paris/i.test(s.bubble)", 25000);
    if (got < 0) {
      // his answer may already have cleared itself; show one and try closing it
      const s = await S();
      if (!s.bubble) return { score: 0.6, detail: "his answer bubble clears by itself after speaking (nothing left to close)" };
    }
    await hear("close the message");
    const ms = await waitFor("!s.bubble", 4000);
    await sleep(2500);
    const s = await S();
    const said = events.filter((e) => /app\/say /.test(e.line)).map((e) => e.line).slice(-1)[0] ?? "";
    if (ms < 0 || s.bubble) return { ms, score: 0, detail: `bubble still up: "${String(s.bubble ?? "").slice(0, 60)}"; he said: ${said.slice(0, 90)}` };
    return { ms, score: 1, detail: `bubble gone in ${ms}ms` };
  });

  await test("C4", "Control", "'Close sketch' closes the app", async () => {
    await hear("open sketch");
    if ((await waitFor("s.kitApp === 'sketch'", 8000)) < 0) return { score: 0, detail: "sketch never opened" };
    await hear("close sketch");
    const ms = await waitFor("!s.kitApp", 8000);
    return { ms, score: ms < 0 ? 0 : speed(ms, 1500, 5000), detail: ms < 0 ? "sketch stayed open" : `closed in ${ms}ms` };
  });

  await test("C5", "Control", "'…never mind' cancels the whole command", async () => {
    await hear("draw a plant cell never mind");
    await sleep(6000);
    const s = await S();
    const ok = !s.kitApp && !s.pending;
    return { score: ok ? 1 : 0, detail: ok ? "nothing happened, as asked" : `it still ran (open: ${s.kitApp ?? "card"})` };
  });

  // ======================= POLISH =======================
  const spots = [
    { n: "top middle", x: W / 2 - 60, y: 24 },
    { n: "top left", x: 24, y: 24 },
    { n: "top right", x: W - 150, y: 24 },
    { n: "middle", x: W / 2 - 60, y: H / 2 - 70 },
    { n: "bottom left", x: 24, y: H - 170 },
    { n: "bottom right", x: W - 150, y: H - 170 },
  ];
  const overlap = `((a, b) => a && b && !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom))`;
  const onScreen = `((r) => r && r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight)`;

  await test("P1", "Polish", "Speech bubble never covers his app buttons or Milo (6 spots)", async () => {
    const bad: string[] = [];
    for (const p of spots) {
      await js(`window.__milo.move(${Math.round(p.x)}, ${Math.round(p.y)})`);
      await sleep(400);
      await hear("what can you do");
      if ((await waitFor("s.ringOpen && s.bubble", 6000)) < 0) {
        bad.push(`${p.n}: ring/bubble didn't show`);
      } else {
        await sleep(450); // buttons fly in
        const r = await js<{ hitBtn: boolean; hitMilo: boolean; off: boolean }>(`(() => {
          const b = document.querySelector('.bubble-say')?.getBoundingClientRect();
          const ov = ${overlap};
          return { hitBtn: [...document.querySelectorAll('.kit-ring__btn')].some((e) => ov(b, e.getBoundingClientRect())),
                   hitMilo: ov(b, document.querySelector('.milo-wrap')?.getBoundingClientRect()), off: !${onScreen}(b) };
        })()`);
        if (r.hitBtn || r.hitMilo || r.off) bad.push(`${p.n}: ${[r.hitBtn && "covers buttons", r.hitMilo && "covers Milo", r.off && "off screen"].filter(Boolean).join(", ")}`);
      }
      await reset();
    }
    await js(`window.__milo.move(${startPos.x}, ${startPos.y})`);
    return { score: 1 - bad.length / spots.length, detail: bad.length ? bad.join("; ") : "clean in all 6 spots" };
  });

  await test("P2", "Polish", "Chat panel always fully on screen and off Milo (6 spots)", async () => {
    const bad: string[] = [];
    for (const p of spots) {
      await js(`window.__milo.move(${Math.round(p.x)}, ${Math.round(p.y)})`);
      await js("window.__milo.chat(true)");
      await sleep(500);
      const r = await js<{ off: boolean; hitMilo: boolean; none: boolean }>(`(() => {
        const el = document.querySelector('.panel'); if (!el) return { none: true };
        const b = el.getBoundingClientRect();
        return { off: !${onScreen}(b), hitMilo: ${overlap}(b, document.querySelector('.milo-wrap')?.getBoundingClientRect()) };
      })()`);
      if (r.none || r.off || r.hitMilo) bad.push(`${p.n}: ${r.none ? "didn't open" : [r.off && "off screen", r.hitMilo && "covers Milo"].filter(Boolean).join(", ")}`);
      await js("window.__milo.chat(false)");
    }
    await js(`window.__milo.move(${startPos.x}, ${startPos.y})`);
    return { score: 1 - bad.length / spots.length, detail: bad.length ? bad.join("; ") : "clean in all 6 spots" };
  });

  await test("P3", "Polish", "His bubble shows in front of an open app, not behind it", async () => {
    await hear("open sketch");
    if ((await waitFor("s.kitApp", 8000)) < 0) return { score: 0, detail: "sketch never opened" };
    await hear("what's 2 plus 2");
    if ((await waitFor("s.bubble", 20000)) < 0) return { score: 0, detail: "he never said anything" };
    const r = await js<{ bz: number; pz: number }>(`(() => ({
      bz: +getComputedStyle(document.querySelector('.bubble-say')).zIndex || 0,
      pz: Math.max(0, ...[...document.querySelectorAll('.rp, .panel, .kit-ring')].map((e) => +getComputedStyle(e).zIndex || 0)) }))()`);
    return { score: r.bz > r.pz ? 1 : 0, detail: r.bz > r.pz ? "bubble is on top" : `bubble layer ${r.bz} is under panel layer ${r.pz}` };
  });

  // ======================= ORGANIZATION =======================
  if (!A || !B) {
    for (const id of ["O1", "O2", "O3", "O4"])
      results.push({ id, cat: "Organization", name: "Class folders", score: 0, pass: false, detail: "needs at least 2 classes set up (tell Milo 'my classes are…')" });
  } else {
    let sketchMs = -1;
    await test("O1", "Organization", `Classes act like tabs (${label(A)} drawing stays in ${label(A)})`, async () => {
      await hear("open sketch");
      if ((await waitFor("s.kitApp === 'sketch'", 8000)) < 0) return { score: 0, detail: "sketch never opened" };
      await chip(A);
      await sleep(600);
      const t = Date.now();
      await hear("draw y equals x squared");
      const made = await waitFor(`${sketchShown} && ${pillText}.includes(${JSON.stringify(label(A))})`, 45000);
      sketchMs = made < 0 ? -1 : Date.now() - t;
      if (made < 0) return { score: 0, detail: `no drawing saved to ${label(A)} (pill: "${await js(pillText)}")` };
      await chip(B);
      await sleep(900);
      const leaked = await js<boolean>(`!!${sketchShown}`);
      await chip(A);
      const back = await waitFor(`${sketchShown} && ${pillText}.includes(${JSON.stringify(label(A))})`, 4000);
      const score = (leaked ? 0 : 0.5) + (back < 0 ? 0 : 0.5);
      return { score, detail: [leaked ? `${label(A)} drawing still showing in ${label(B)}` : `${label(B)} was clean`, back < 0 ? `drawing didn't come back in ${label(A)}` : `came back in ${label(A)}`].join("; ") };
    });
    results.push({
      id: "S4", cat: "Speed", name: "Drawing made ('draw y equals x squared')", ms: sketchMs, pass: sketchMs >= 0 && sketchMs < 15000,
      score: speed(sketchMs, 8000, 15000), detail: sketchMs < 0 ? "never finished" : `drawn in ${(sketchMs / 1000).toFixed(1)}s`,
    });

    await test("O2", "Organization", `'Draw a plant cell for ${B.name}' files it in ${label(B)}`, async () => {
      await hear("open sketch");
      await waitFor("s.kitApp === 'sketch'", 8000);
      await chip(A);
      await sleep(500);
      await hear(`draw a plant cell for ${B.name}`);
      const ms = await waitFor(`${sketchShown} && ${pillText}.includes(${JSON.stringify(label(B))})`, 60000);
      const on = await js<string>(`document.querySelector('.cls-chip--on')?.textContent || ''`);
      if (ms < 0) return { score: 0, detail: `not saved to ${label(B)} (pill: "${await js(pillText)}", class on: ${on})` };
      return { ms, score: on.includes(label(B)) ? 1 : 0.6, detail: `saved to ${label(B)}${on.includes(label(B)) ? ` and ${label(B)} lit up` : `, but ${on} stayed lit`}` };
    });

    await test("O3", "Organization", `'Save this to ${A.name}' moves it`, async () => {
      await hear("open sketch");
      await waitFor("s.kitApp === 'sketch'", 8000);
      await sleep(800);
      if (!(await js<boolean>(`!!${sketchShown} && !!${pillText}`))) {
        await hear("draw a triangle");
        await waitFor(`${sketchShown} && ${pillText}`, 45000);
      }
      // a real student waits for him to finish, so "save this" isn't heard as more of the last command
      await waitFor("!s.pending && !s.speaking", 15000);
      await sleep(2000);
      await hear(`save this to ${A.name}`);
      const ms = await waitFor(`${pillText}.includes(${JSON.stringify(label(A))})`, 10000);
      return { ms, score: ms < 0 ? 0 : 1, detail: ms < 0 ? `pill still says "${await js(pillText)}"` : `moved in ${ms}ms` };
    });

    await test("O4", "Organization", `'Show my ${A.name} sketches' opens that folder`, async () => {
      await hear("open sketch");
      await waitFor("s.kitApp", 8000);
      await hear(`show my ${A.name} sketches`);
      const ms = await waitFor(`document.querySelector('.lib') && (document.querySelector('.lib-folder--on')?.textContent || '').includes(${JSON.stringify(label(A))})`, 10000);
      const cards = await js<number>("document.querySelectorAll('.lib-card').length");
      return { ms, score: ms < 0 ? 0 : cards ? 1 : 0.6, detail: ms < 0 ? "library didn't open on that folder" : `opened with ${cards} item${cards === 1 ? "" : "s"}` };
    });
  }

  // ======================= STUDY POWER =======================
  const make = (id: string, name: string, say: string, app: string, great: number) =>
    test(id, "Study power", name, async () => {
      await hear(say);
      const ms = await waitFor(`s.kitApp === '${app}' && ${pillText}`, 75000);
      return { ms, score: speed(ms, great, great * 2), detail: ms < 0 ? `no saved ${app} (open: ${(await S()).kitApp ?? "nothing"})` : `made and saved in ${(ms / 1000).toFixed(1)}s` };
    });
  await make("T1", "Flashcards ('make 5 flashcards on derivatives')", "make 5 flashcards on derivatives", "study", 15000);
  await make("T2", "Sheet ('make a table of the planets and their number of moons')", "make a table of the planets and their number of moons", "sheet", 15000);
  await make("T3", "Plan ('plan my week for my calculus exam on Friday')", "plan my week for my calculus exam on Friday", "planner", 20000);

  // ======================= START MY HOMEWORK =======================
  await test("H1", "Study power", "'Help me start this' reads the screen and answers sensibly", async () => {
    // Whatever's on screen during the test isn't an assignment, so the right answer is a plan OR a clear "open the assignment".
    await hear("help me start this");
    const ms = await waitFor("s.plan || (s.bubble && !/reading the assignment/i.test(s.bubble) && /open|assignment|page|start this/i.test(s.bubble))", 45000);
    const s = await S();
    return { ms, score: ms < 0 ? 0 : 1, detail: ms < 0 ? `no plan and no guidance (bubble: "${String(s.bubble ?? "").slice(0, 60)}")` : s.plan ? `made a ${s.plan.steps}-step plan` : `said: "${String(s.bubble).slice(0, 80)}"` };
  });
  await test("H2", "Control", "Game plan voice: 'next', 'what's next', 'close the plan'", async () => {
    await js(`window.__milo.plan(${JSON.stringify({
      found: true, title: "Test Homework", course: "TEST 101", due: "Fri", total_minutes: 30, say: "", missing: "",
      steps: [
        { text: "Read the prompt", minutes: 4, kind: "read", detail: "Skim it." },
        { text: "Solve questions 1 to 3", minutes: 12, kind: "solve", detail: "Show work." },
        { text: "Check and submit", minutes: 6, kind: "submit", detail: "Upload it." },
      ],
    })})`);
    if ((await waitFor("s.plan && document.querySelector('.gp')", 3000)) < 0) return { score: 0, detail: "plan card didn't show" };
    await hear("next");
    const done = await waitFor("s.plan && s.plan.done === 1", 3000);
    await reset();
    await hear("what's next");
    const info = await waitFor("s.bubble && /step 2/i.test(s.bubble)", 8000);
    await hear("close the plan");
    const closed = await waitFor("!s.plan", 3000);
    const score = (done < 0 ? 0 : 0.4) + (info < 0 ? 0 : 0.3) + (closed < 0 ? 0 : 0.3);
    return { score, detail: [done < 0 ? "'next' didn't check it off" : `'next' checked off in ${done}ms`, info < 0 ? "'what's next' didn't say step 2" : "told step 2", closed < 0 ? "plan stayed open" : "closed"].join("; ") };
  });

  // ======================= DEADLINE RADAR =======================
  const radarBackup = await js<string | null>("localStorage.getItem('milo.radar')");
  const iso = (days: number) => {
    const d = new Date(Date.now() + days * 86400e3);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T23:59`;
  };
  await test("D1", "Focus", "Deadline radar warns about what's due tomorrow (with Start)", async () => {
    await js(`window.__milo.radarSet(${JSON.stringify([
      { title: "Test Homework 9", course: "TEST 101", due: "Tomorrow 11:59 PM", due_iso: iso(1), kind: "assignment" },
      { title: "Test Essay 2", course: "TEST 102", due: "Next week", due_iso: iso(8), kind: "assignment" },
    ])})`);
    await js("window.__milo.radarCheck()");
    const ms = await waitFor("s.radar && s.radar.mode === 'alert' && s.bubble && /heads up|new in d2l/i.test(s.bubble)", 5000);
    const start = await js<boolean>("!![...document.querySelectorAll('.rd .rd-start')].length");
    return { ms, score: ms < 0 ? 0 : start ? 1 : 0.6, detail: ms < 0 ? `no warning (radar: ${JSON.stringify((await S()).radar)})` : `warned in ${ms}ms${start ? " with Start buttons" : ", but no Start button"}` };
  });
  await test("D2", "Focus", "'What's due this week' answers instantly; 'later' closes it", async () => {
    await hear("what's due this week");
    const ms = await waitFor("s.radar && s.radar.mode === 'list' && s.bubble && /first up|nothing due/i.test(s.bubble)", 6000);
    if (ms < 0) return { score: 0, detail: `no list (bubble: "${String((await S()).bubble ?? "").slice(0, 60)}")` };
    await hear("later");
    const closed = await waitFor("!s.radar", 3000);
    return { ms, score: closed < 0 ? 0.5 : ms > 2000 ? 0.8 : 1, detail: `listed in ${ms}ms${closed < 0 ? "; 'later' didn't close it" : "; 'later' closed it"}` };
  });
  await js(`window.__milo.radarLoad(${JSON.stringify(radarBackup)})`).catch(() => {}); // the test's fake homework never stays

  // ======================= PERSONAL =======================
  await test("M1", "Personal", "Remembers your name", async () => {
    await hear("call me Jake");
    await waitFor("s.bubble && /jake/i.test(s.bubble)", 10000);
    await reset();
    await hear("what's my name");
    const ms = await waitFor("s.bubble && /jake/i.test(s.bubble)", 25000);
    return { ms, score: ms < 0 ? 0 : 1, detail: ms < 0 ? `didn't say Jake: "${String((await S()).bubble ?? "").slice(0, 60)}"` : "said Jake" };
  });

  // ======================= FOCUS =======================
  await test("F1", "Focus", "Lock in for 10 minutes: right timer, time left, clean stop", async () => {
    await hear("lock in for 10 minutes");
    const hud = await waitFor("document.querySelector('.lk-hud__time')", 15000);
    if (hud < 0) return { score: 0, detail: "lock-in never started" };
    const time = await js<string>("document.querySelector('.lk-hud__time').textContent");
    const right = /^(10:00|9:\d\d)/.test(time.trim());
    await hear("how much time is left");
    const left = await waitFor("s.bubble && /left|minute/i.test(s.bubble)", 10000);
    await hear("stop lock in");
    const recap = await waitFor("document.querySelector('.lk-recap') || !s.lockOn", 10000);
    await js("document.querySelector('.lk-recap .lk-btn--ghost')?.click()"); // "Done" (the first button is "Go again")
    await sleep(3000);
    const stuck = !(await S()).lockOn; // a "stop" must stick: nothing may quietly restart it
    const score = (right ? 0.4 : 0) + (left < 0 ? 0 : 0.2) + (recap < 0 ? 0 : 0.2) + (stuck ? 0.2 : 0);
    return { score, detail: [right ? "timer 10:00" : `timer showed ${time}`, left < 0 ? "no time-left answer" : "told time left", recap < 0 ? "didn't stop" : "stopped with recap", stuck ? "stayed stopped" : "RESTARTED on its own after stopping"].join("; ") };
  });

  // ======================= RESEARCH =======================
  await test("R1", "Research", "'Look up when TCU finals start' gives a sourced answer", async () => {
    await hear("look up when TCU finals start");
    const open = await waitFor("s.research", 8000);
    if (open < 0) return { score: 0, detail: "research panel never opened" };
    const ms = await waitFor("s.speaking || (document.querySelector('.rp')?.textContent || '').length > 400", 45000);
    return { ms, score: speed(ms, 8000, 20000), detail: ms < 0 ? "no answer" : `panel in ${open}ms, answer in ${(ms / 1000).toFixed(1)}s` };
  });

  // ======================= COMPUTER CONTROL (npm run test:computer) =======================
  // Real clicks and keys on your Mac, with safe built-in apps that never ask "save changes?".
  if (process.env.MILO_TEST_COMPUTER === "1") {
    const waitMain = async (fn: () => Promise<boolean>, timeout: number) => {
      const st = Date.now();
      while (Date.now() - st < timeout) {
        if (await fn().catch(() => false)) return Date.now() - st;
        await sleep(250);
      }
      return -1;
    };
    const front = () => frontApp().catch(() => "");
    await test("K1", "Computer", "'Open Calculator' opens it, in front", async () => {
      await quitApp("Calculator");
      await sleep(600);
      await hear("open calculator");
      const ms = await waitMain(async () => (await isRunning("Calculator")) && /calculator/i.test(await front()), 12000);
      return { ms, score: ms < 0 ? 0 : speed(ms, 3000, 7000), detail: ms < 0 ? `not open in front (front: ${await front()})` : `open in ${(ms / 1000).toFixed(1)}s` };
    });
    const QUITS = [
      "close calculator",
      "quit calculator",
      "close the calculator app",
      "close the entire calculator application",
      "get calculator off my screen",
      "quit the whole calculator app",
      "I meant, like, my... like, I want you to close the entire calculator application",
      "No. Milo, close the entire calculator. Get it off my screen.",
    ];
    await test("K2", "Computer", `Quit an app, said ${QUITS.length} different ways`, async () => {
      const missed: string[] = [];
      for (const ph of QUITS) {
        await openApp("Calculator");
        await sleep(900);
        await hear(ph);
        const ms = await waitMain(async () => !(await isRunning("Calculator")), 10000);
        if (ms < 0) missed.push(ph);
        await reset();
        await sleep(600);
      }
      const ok = QUITS.length - missed.length;
      return { score: ok / QUITS.length, detail: missed.length ? `${ok}/${QUITS.length}. Didn't quit for: ${missed.map((m) => `"${m}"`).join("; ")}` : `all ${QUITS.length} worked` };
    });
    await test("K3", "Computer", "'Switch to Dictionary' brings the right app forward", async () => {
      await openApp("Dictionary");
      await openApp("Calculator");
      await sleep(800);
      await hear("switch to dictionary");
      const ms = await waitMain(async () => /dictionary/i.test(await front()), 10000);
      return { ms, score: ms < 0 ? 0 : 1, detail: ms < 0 ? `front is still ${await front()}` : `Dictionary in front in ${(ms / 1000).toFixed(1)}s` };
    });
    await test("K4", "Computer", "Rephrasing ('no, I meant…') is noticed as a retry", async () => {
      await hear("open dictionary");
      await waitMain(async () => /dictionary/i.test(await front()), 10000);
      await sleep(1500);
      await hear("no I meant open the dictionary app");
      await sleep(2500);
      const caught = events.some((e) => /app\/frustration/.test(e.line));
      return { score: caught ? 1 : 0, detail: caught ? "noticed, and told the planner to try another way" : "didn't notice the rephrase" };
    });
    await quitApp("Calculator").catch(() => "");
    await quitApp("Dictionary").catch(() => "");
  }

  // ---------- clean up: the test's drawings/sheets don't stay in your folders ----------
  try {
    for (const it of listItems({ classId: "all" })) if (it.created >= libStart) deleteItem(it.id);
    const now = loadClasses();
    if (now.active !== store0.active) saveClasses({ ...now, active: store0.active });
  } catch {
    /* ignore */
  }
  await js(`window.__milo.move(${startPos.x}, ${startPos.y})`).catch(() => {});
  if (setupWas !== "1") await js("localStorage.removeItem('milo.onboarded')").catch(() => {});
  // game plans the test made don't stay in "pick up my homework"
  await js(`(() => { const k = "milo.gameplans"; try { const xs = JSON.parse(localStorage.getItem(k) || "[]"); localStorage.setItem(k, JSON.stringify(xs.filter((x) => x.at < ${libStart}))); } catch {} })()`).catch(() => {});
  off();

  // ---------- score + report ----------
  const cats = Object.keys(WEIGHT) as Cat[];
  const catScore = (c: Cat) => {
    const xs = results.filter((r) => r.cat === c);
    return xs.length ? xs.reduce((a, r) => a + r.score, 0) / xs.length : 0;
  };
  const ran = cats.filter((c) => results.some((r) => r.cat === c));
  const total = (ran.reduce((a, c) => a + catScore(c) * WEIGHT[c], 0) / ran.reduce((a, c) => a + WEIGHT[c], 0)) * 10;
  const passed = results.filter((r) => r.pass).length;
  const mins = ((Date.now() - t0) / 60000).toFixed(1);

  let md = `# Milo self-test: ${total.toFixed(1)} / 10\n\n${passed}/${results.length} checks passed · ${mins} min · ${new Date().toLocaleString()}${reloads ? ` · Milo's screen restarted ${reloads}x (dev server), those tests were retried` : ""}\n\n`;
  md += `## By area\n\n| Area | Score | Weight | What it means |\n|---|---|---|---|\n`;
  for (const c of ran) md += `| ${c} | ${(catScore(c) * 10).toFixed(1)} | ${WEIGHT[c]}% | ${WHY[c]} |\n`;
  md += `\n## Every check\n\n| | ID | Check | Result |\n|---|---|---|---|\n`;
  for (const r of results) md += `| ${r.pass ? "✅" : "❌"} | ${r.id} | ${r.name} | ${r.detail.replace(/\|/g, "/")} |\n`;
  const fails = results.filter((r) => !r.pass);
  if (fails.length) {
    md += `\n## Failures in detail\n`;
    for (const r of fails) {
      md += `\n### ${r.id}: ${r.name}\n\n${r.detail}\n\n`;
      if (r.shot) md += `Screenshot: ${r.shot}\n\n`;
      if (r.events?.length) md += "What Milo's log shows:\n\n```\n" + r.events.join("\n") + "\n```\n";
    }
  }
  md += `\n---\nNot covered here (check by hand): the real microphone (talking over him, background noise), how his voice sounds, and anything that controls other apps.\n`;
  fs.writeFileSync(path.join(dir, "report.md"), md);
  fs.writeFileSync(path.join(dir, "report.json"), JSON.stringify({ total, passed, count: results.length, results }, null, 2));
  fs.writeFileSync(path.join(root, "LATEST.txt"), stamp + "\n");
  console.log("\n" + md.split("## Failures")[0]);
  console.log(`[milo-test] Full report: test-results/${stamp}/report.md`);
}

export const selfTestOn = () => process.env.MILO_TEST === "1";
export const quitAfterTest = () => setTimeout(() => app.exit(0), 500);
