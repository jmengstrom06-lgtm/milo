// Milo's self-test: `npm run test:milo`.
// Drives the real app the way a student does (the same path your voice takes once it becomes text),
// watches what actually happens on screen, times it, and grades the "holy shit" factor out of 10.
// Results land in ~/milo/test-results/<time>/ (report.md, report.json, screenshots of every failure).

import { app, type BrowserWindow } from "electron";
import fs from "node:fs";
import { execFile } from "node:child_process";
import path from "node:path";
import { calendarFeedUrl, courses as d2lCourses, d2lCheck, gradeSheet as d2lSheet, lastChromeAnswer, resetChromeWait } from "./d2l";
import { bridgeConnected } from "./bridge";
import { log as bbLog, onLog } from "./blackbox";
import { loadClasses, saveClasses } from "./classes";
import { deleteItem, listItems } from "./library";
import { frontApp, isRunning, openApp, quitApp } from "./hands";
import { calendarAdd, docsCreate, docsText, gmailDraft, googleStatus } from "./google";
import { citePaper, editPaper, removeBlock, undoEdits } from "./writing";
import { draftDiscussion, pickTopic, requirementsOf } from "./discussions";
import { discussionTopics, myUserId, topicPosts, type DPost } from "./d2l";
import { readThis } from "./reading";
import { removeNote } from "./kitipc";
import { lastPaper } from "./paper";
import { addChunk, fileLecture, finishLecture, forgetLectureNote, removeLecture, startLecture } from "./lecture";
import { macSpeak } from "./macvoice";
import { activity, did } from "./activityLog";
import { memories, remember } from "./memory";
import { sendFeedback } from "./telemetry";
import { homeWin, openHome } from "./home";

type Cat = "Trust" | "Speed" | "Control" | "Polish" | "Organization" | "Study power" | "Personal" | "Focus" | "Research" | "Computer" | "School" | "Google" | "Home" | "Writing";
const WEIGHT: Record<Cat, number> = { Trust: 20, Speed: 20, Control: 20, Polish: 20, Organization: 15, "Study power": 10, Personal: 5, Focus: 5, Research: 5, Computer: 20, School: 15, Google: 15, Home: 15, Writing: 20 };
const WHY: Record<Cat, string> = {
  Trust: "You can see everything Milo did and take it back. Problems reach Jake in one tap.",
  Speed: "Feels instant. Slow = 'just another chatbot'.",
  Control: "Does exactly what you say, the moment you say it (stop, close, cancel).",
  Polish: "Nothing overlaps, nothing off screen, always readable.",
  Organization: "Every class has its own folder and tab; work is never lost.",
  "Study power": "Flashcards, sheets and plans made in seconds, filed to the right class.",
  Personal: "Knows you.",
  Focus: "Lock-in works first try.",
  Research: "Real answers with sources, fast.",
  Computer: "Opens, quits and switches apps however you say it (only in npm run test:computer).",
  School: "Reads D2L directly: signed in, your grades, what's due, what you need on the final.",
  Google: "Calendar and Gmail, direct and fast; asks before adding or sending; a plain yes/no works after the ding.",
  Writing: "Edits your real paper in place (undoable), real sources, discussion drafts from your real D2L, long readings into notes + quiz.",
  Home: "Home base: opens fast, shows your classes, typing reaches the same Milo, Undo right there.",
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
  bbLog("selftest", "start", {}); // marks this session as a test, so the log doctor skips it

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
    // MILO_TEST_ONLY=W  -> just the Google tests; MILO_TEST_ONLY=W1,W4 -> just those
    const only = (process.env.MILO_TEST_ONLY || "").split(",").map((x) => x.trim()).filter(Boolean);
    if (only.length && !only.some((o) => id === o || (o.length === 1 && id.startsWith(o)))) return;
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
    try { writeReport(false); } catch { /* keep testing */ }
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
  // A stuck test must never leave a muted test copy of Milo running: write what we have and quit.
  setTimeout(() => {
    log("Stopped: the test ran over its time limit. The report has everything that finished.");
    try { writeReport(true); } catch { /* ignore */ }
    quitAfterTest();
  }, Number(process.env.MILO_TEST_MINUTES || (process.env.MILO_TEST_ONLY ? 12 : 60)) * 60e3);
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

  // ======================= STUDENT WRITING (Q): your real Google + D2L, checked for real =======================
  // MILO_TEST_ONLY=Q runs just these. Makes one test Google Doc ("Milo test – safe to delete"), never posts to D2L.
  {
    const gsT = (() => { try { return googleStatus(); } catch { return { connected: false }; } })();
    const ESSAY = [
      "Social Media and Teen Sleep",
      "Social media have changed how teenagers spend there nights. Many students scrolls on their phones until well past midnight, and this effects how much they sleep.",
      "According to the CDC, about 72% of high school students do not get enough sleep on school nights. This is a big problem because sleep is important for learning and it is also important for mood and it is also important for health in general.",
      "One reason is the blue light from screens. Blue light makes it harder for the brain to release melatonin, which is the hormone that tells your body its time to sleep.",
      'As one researcher put it, "the bedroom has become a 24-hour entertainment center." Schools and parents should encourage students to put phones away an hour before bed.',
    ].join("\n");
    const clean = (s: string) => s.replace(/\s+/g, " ").trim();
    let docId = "";
    let original = "";
    let firstEdits: Parameters<typeof undoEdits>[1] = [];
    if (!gsT.connected) {
      results.push({ id: "Q0", cat: "Writing", name: "Google connected (for the paper tests)", score: 0, pass: false, detail: "Google isn't connected. Connect it in Milo, then run again." });
    } else {
      await test("Q1", "Writing", "Edit my paper: fixes real mistakes inside a real Google Doc", async () => {
        const d = await docsCreate(`Milo test – safe to delete ${new Date().toLocaleString()}`, ESSAY);
        docId = d.id;
        original = await docsText(docId);
        const t0 = Date.now();
        const r = await editPaper(docId, "edit my paper");
        if (!r.ok) return { score: 0, detail: `no edits: ${r.text}` };
        firstEdits = r.applied;
        const now = await docsText(docId);
        const fixed = [/their nights/.test(now), !/students scrolls/.test(now), !/this effects/.test(now), /it['’]s time|it is time/.test(now)].filter(Boolean).length;
        const quote = now.includes("the bedroom has become a 24-hour entertainment center.");
        return { ms: Date.now() - t0, score: (fixed / 4) * (quote ? 1 : 0.5), detail: `${r.applied.length} edits landed in ${((Date.now() - t0) / 1000).toFixed(0)}s, ${fixed}/4 planted mistakes fixed, quote ${quote ? "kept" : "CHANGED"}` };
      });
      await test("Q2", "Writing", "Undo all puts the doc back exactly", async () => {
        if (!docId) return { score: 0, detail: "no test doc (Q1 failed)" };
        if (!firstEdits.length) return { score: 0, detail: "nothing to undo (Q1 made no changes)" };
        const t0 = Date.now();
        const u = await undoEdits(docId, firstEdits);
        const back = await docsText(docId);
        const same = clean(back) === clean(original);
        if (same) return { ms: Date.now() - t0, score: 1, detail: `all ${u.undone} edits undone, doc matches the original exactly` };
        const a = clean(original).split(" "), b = clean(back).split(" ");
        const i = a.findIndex((w, k) => w !== b[k]);
        return { score: 0, detail: `${u.undone}/${firstEdits.length} undone; first difference: "${a.slice(Math.max(0, i - 3), i + 4).join(" ")}" vs "${b.slice(Math.max(0, i - 3), i + 4).join(" ")}"` };
      });
      await test("Q3", "Writing", "Edit my intro: only the intro changes", async () => {
        if (!docId) return { score: 0, detail: "no test doc" };
        const before = (await docsText(docId)).split("\n");
        const r = await editPaper(docId, "make my intro stronger");
        if (!r.ok) return { score: 0.5, detail: `no edits: ${r.text}` };
        const after = (await docsText(docId)).split("\n");
        const changedRows = before.map((l, i) => (clean(l) !== clean(after[i] ?? "") ? i : -1)).filter((i) => i >= 0);
        await undoEdits(docId, r.applied);
        const ok = changedRows.length > 0 && changedRows.every((i) => i <= 1);
        return { score: ok ? 1 : 0, detail: ok ? `${r.applied.length} edits, all in the intro, undone after` : `changed lines ${changedRows.join(",")}` };
      });
      await test("Q4", "Writing", "Sources: real citations + Works Cited page, then removed cleanly", async () => {
        if (!docId) return { score: 0, detail: "no test doc" };
        const before = await docsText(docId);
        const t0 = Date.now();
        const r = await citePaper(docId, "find 3 sources for my paper", 3);
        if (!r.ok) return { score: 0, detail: `no sources: ${r.text}` };
        const ms = Date.now() - t0;
        const now = await docsText(docId);
        const hasList = /Works Cited|References/.test(now) && r.addedList;
        const dois = r.sources.filter((s) => s.doi || s.url).length;
        const inText = r.placed;
        // take it all back
        if (r.listText) await removeBlock(docId, r.listText);
        if (r.applied.length) await undoEdits(docId, r.applied);
        const back = await docsText(docId);
        const clean2 = clean(back) === clean(before);
        const score = (hasList ? 0.35 : 0) + (inText > 0 ? 0.25 : 0) + (dois === r.sources.length ? 0.2 : 0) + (clean2 ? 0.2 : 0);
        return { ms, score, detail: `${r.sources.length} sources (${r.style}), ${inText} in-text citations, list ${hasList ? "added" : "MISSING"}, ${clean2 ? "removed cleanly" : "doc NOT back to before after removing"} (${(ms / 1000).toFixed(0)}s)` };
      });
    }

    // ---- The way a student really does it: doc open in a browser, request said out loud ----
    if (gsT.connected) {
      for (const [id, browser, phrase] of [
        ["Q9", "Safari", "Hey Milo, I have a Google Doc paper open, it's the Milo test paper. Um, look through it, find the grammar mistakes and make it sound better."],
        ["QA", "Google Chrome", "look through my essay and fix the spelling and grammar"],
      ] as const) {
        await test(id, "Writing", `Said out loud, doc open in ${browser}: finds it and edits it`, async () => {
          const d = await docsCreate(`Milo test – safe to delete ${new Date().toLocaleString()}`, ESSAY);
          await new Promise<void>((res) => execFile("open", ["-a", browser, d.url], () => res()));
          await sleep(6000); // the doc loads in the browser
          const before = await docsText(d.id);
          const t0 = Date.now();
          await reset();
          await hear(phrase);
          // the paper panel shows the changes; nothing is written until they say "accept"
          let panelMs = -1;
          let accepted = false;
          let after = before;
          while (Date.now() - t0 < 120000) {
            await sleep(700);
            if (!accepted) {
              const ready = await js<boolean>("!!document.querySelector('.pp .wc__go:not([disabled])')").catch(() => false);
              if (ready) {
                panelMs = Date.now() - t0;
                const untouched = clean(await docsText(d.id)) === clean(before);
                if (!untouched) return { score: 0, detail: "the doc changed BEFORE accepting" };
                await hear("accept it");
                accepted = true;
              }
              continue;
            }
            after = await docsText(d.id);
            if (clean(after) !== clean(before)) break;
          }
          const look = events.find((e) => e.line.startsWith("writing/doc_lookup"))?.line ?? "no lookup logged";
          const route = events.find((e) => e.line.startsWith("ipc/route"))?.line.match(/"kind":"(\w+)"/)?.[1] ?? "?";
          const fixed = clean(after) !== clean(before);
          return { ms: Date.now() - t0, score: fixed ? 1 : 0, detail: fixed ? `routed to ${route}, changes shown in ${(panelMs / 1000).toFixed(0)}s, written after "accept" in ${((Date.now() - t0) / 1000).toFixed(0)}s total` : `doc NOT changed (panel ${panelMs < 0 ? "never showed changes" : `showed changes at ${(panelMs / 1000).toFixed(0)}s`}${accepted ? ", accept said" : ""}). route: ${route}. ${look.slice(0, 200)}` };
        });
      }
    }

    // ---- Discussions: read your real D2L, draft only (never posts) ----
    const portalT = await js<string>("localStorage.getItem('milo.portal') || ''").catch(() => "");
    await test("Q6", "Writing", "Discussion: finds a real D2L discussion and drafts a post + replies (no posting)", async () => {
      if (!portalT) return { score: 0, detail: "no school site set up" };
      for (let i = 0; i < 60 && !bridgeConnected(); i++) await sleep(250); // Chrome's extension reconnects after Milo starts
      const chk = await d2lCheck(portalT);
      if (!chk.ok) return { score: 0, detail: `D2L: ${chk.text} (Chrome extension ${chk.chrome ? "connected" : "NOT connected"})` };
      const all = await d2lCourses(portalT);
      const t0 = Date.now();
      let found: { course: (typeof all)[number]; topics: Awaited<ReturnType<typeof discussionTopics>> } | null = null;
      for (const c of all) {
        const ts = (await discussionTopics(portalT, c).catch(() => [])).filter((t) => !t.locked);
        if (ts.length) { found = { course: c, topics: ts }; break; }
      }
      if (!found) return { score: 0.6, detail: `none of your ${all.length} classes has an open discussion right now (nothing to test)` };
      const me = await myUserId(portalT).catch(() => null);
      const topic = pickTopic(found.topics, new Set(), "")!;
      const posts = await topicPosts(portalT, found.course, topic).catch(() => [] as DPost[]);
      const voice = posts.filter((p) => me && p.userId === me && p.text.split(/\s+/).length > 40).map((p) => p.text).slice(0, 3);
      const d = await draftDiscussion({ course: found.course.name, topic, posts, me, voice, ask: `do my discussion post for ${found.course.short}` });
      if ("error" in d) return { score: 0, detail: `couldn't draft: ${d.error}` };
      const req = requirementsOf(topic.prompt);
      const n = d.body.split(/\s+/).length;
      const others = posts.filter((p) => !p.parentId && p.userId !== me).length;
      const wantReplies = Math.min(req.replies, others);
      const okWords = !req.minWords || n >= req.minWords;
      const okReplies = d.replies.length >= wantReplies && d.replies.every((r) => posts.some((p) => p.id === r.parentId));
      return { ms: Date.now() - t0, score: (okWords ? 0.5 : 0) + (okReplies ? 0.5 : 0), detail: `${found.course.short} · "${topic.name}" · ${posts.length} posts read · ${n} words (needs ${req.minWords || "any"}) · ${d.replies.length}/${req.replies} replies to real classmates · your voice: ${voice.length ? "yes" : "no past posts"} · NOT posted` };
    });

    // ---- Readings: a long PDF, split and read ----
    await test("Q7", "Writing", "Reading: a 150-page PDF becomes notes, flashcards and a quiz", async () => {
      const { PDFDocument, StandardFonts } = await import("pdf-lib");
      const pdf = await PDFDocument.create();
      const font = await pdf.embedFont(StandardFonts.Helvetica);
      const topics = ["the cell membrane is a phospholipid bilayer with hydrophilic heads and hydrophobic tails", "passive transport needs no ATP and moves substances down their concentration gradient", "active transport uses ATP; the sodium-potassium pump moves 3 sodium out and 2 potassium in", "osmosis is the diffusion of water across a selectively permeable membrane", "in a hypotonic solution water enters the cell and it may lyse", "cholesterol keeps animal cell membranes from becoming too fluid or too rigid"];
      for (let i = 0; i < 150; i++) {
        const p = pdf.addPage([612, 792]);
        p.drawText(`Chapter 4, page ${i + 1}`, { x: 60, y: 730, size: 14, font });
        const t = topics[i % topics.length];
        for (let l = 0; l < 20; l++) p.drawText(`${l === 0 ? "Key idea: " : ""}${t}.`.slice(0, 95), { x: 60, y: 690 - l * 28, size: 11, font });
      }
      const bytes = await pdf.save();
      const t0 = Date.now();
      const r = await readThis({ pdf: bytes, name: "Milo test reading.pdf" }, "make notes and a quiz");
      if (!r.ok) return { score: 0, detail: `failed: ${r.text}` };
      if (r.noteId) removeNote(r.noteId);
      if (r.studyId) deleteItem(r.studyId);
      const ms = Date.now() - t0;
      const good = r.pages === 150 && r.terms >= 4 && r.cards >= 8 && r.quiz.length >= 6;
      return { ms, score: good ? 1 : 0.4, detail: `${r.pages} pages in ${(ms / 1000).toFixed(0)}s: ${r.terms} terms, ${r.cards} flashcards, ${r.quiz.length} quiz questions, ${r.alerts} test alerts` };
    });
    await test("Q8", "Writing", "Reading: your newest real PDF from Downloads", async () => {
      const dl = path.join(app.getPath("home"), "Downloads");
      let files: string[] = [];
      try { files = fs.readdirSync(dl).filter((f) => /\.pdf$/i.test(f)).map((f) => path.join(dl, f)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs); } catch { /* no access */ }
      if (!files.length) return { score: 0.6, detail: "no PDF in Downloads (skipped)" };
      const t0 = Date.now();
      const r = await readThis({ file: files[0] }, "make notes and a quiz");
      if (!r.ok) return { score: 0, detail: `${path.basename(files[0])}: ${r.text}` };
      if (r.noteId) removeNote(r.noteId);
      if (r.studyId) deleteItem(r.studyId);
      return { ms: Date.now() - t0, score: r.cards > 0 && r.quiz.length > 0 ? 1 : 0.4, detail: `${path.basename(files[0])}: ${r.pages || "?"} pages, ${r.terms} terms, ${r.cards} cards, ${r.quiz.length} quiz Qs in ${((Date.now() - t0) / 1000).toFixed(0)}s` };
    });
  }

  // Only the writing checks asked for (npm run test:writing): done, report, close. Nothing else to wait on.
  if ((process.env.MILO_TEST_ONLY || "").trim() === "Q") {
    off();
    writeReport(true);
    return;
  }

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
    if (!process.env.MILO_TEST_ONLY || sketchMs >= 0) results.push({ // skipped O1 (MILO_TEST_ONLY) = no drawing to time
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

  // ======================= SCHOOL: D2L, read directly =======================
  // Real questions, asked out loud the way students ask them; graded on what Milo actually says.
  {
    const portal = await js<string>("localStorage.getItem('milo.portal') || ''").catch(() => "");
    /** Wait for Milo to say something matching `re` (from his black box). Returns ms, or -1. */
    const saidMatch = async (re: RegExp, timeout: number) => {
      const st = Date.now();
      while (Date.now() - st < timeout) {
        if (events.some((e) => e.line.startsWith("app/say") && re.test(e.line))) return Date.now() - st;
        await sleep(150);
      }
      return -1;
    };
    if (!portal) {
      results.push({ id: "G0", cat: "School", name: "D2L connected", score: 0, pass: false, detail: "no school site set up (run setup)" });
    } else {
      resetChromeWait();
      const chk = await d2lCheck(portal);
      const ca = lastChromeAnswer();
      const chromeSaid = ca ? (ca.status === -1 ? ` Chrome extension error: ${ca.where}.` : ` Chrome answered ${ca.status} ${ca.type}${ca.where ? ` at ${ca.where}` : ""}.`) : "";
      await test("G0", "School", "Signed in to D2L (data feed answers)", async () => ({ score: chk.ok ? 1 : 0, detail: chk.ok ? `signed in (via ${chk.via === "chrome" ? "your Chrome" : "Milo's own sign-in"})` : chk.signin ? `NOT signed in, in Chrome or in Milo.${chromeSaid}` : chk.text + chromeSaid }));

      // ---- Sign-in that never gets in the way (L): Chrome's sign-in first, Milo's own second, the calendar link as backup ----
      await test("L1", "School", "Uses your Chrome sign-in (no Milo login)", async () => {
        if (!bridgeConnected()) return { score: 0, detail: "Chrome extension not connected (open Chrome; reload the Milo extension)" };
        resetChromeWait();
        const c = await d2lCheck(portal);
        const a = lastChromeAnswer();
        const why = a ? (a.status === -1 ? `Chrome extension error: ${a.where}` : `Chrome answered ${a.status} ${a.type}${a.where ? ` at ${a.where}` : ""}`) : "Chrome wasn't asked";
        return { score: c.via === "chrome" ? 1 : c.ok ? 0.5 : 0, detail: c.via === "chrome" ? "reading D2L through your Chrome sign-in" : `${c.ok ? "works through Milo's own sign-in" : "not signed in anywhere"}. ${why}` };
      });
      await test("L2", "School", "Finds D2L's calendar link (the backup that never signs out)", async () => {
        const url = await calendarFeedUrl(portal).catch(() => null);
        // optional backup: TCU's D2L doesn't let students make one, so this is information, not a failure
        return { score: 1, detail: url ? "found it (saved by the app, never shown)" : "none (optional: your school's D2L doesn't let students make a calendar link)" };
      });
      {
        const feedOffer = async () => {
          await reset();
          await js("window.__milo.offerFeed()");
          const st = Date.now();
          while (Date.now() - st < 15000 && !events.some((e) => e.line.startsWith("app/answer_window_open"))) await sleep(100);
          await sleep(400);
          return events.some((e) => e.line.startsWith("app/say") && /backup/i.test(e.line));
        };
        void feedOffer; // the calendar-backup offer is off (TCU's D2L doesn't allow the link)
      }
      await test("Y1", "Organization", "Milo's classes match your D2L courses (same folders, real names)", async () => {
        const r = await js<{ ok: boolean; changed: boolean; names?: string[]; text?: string }>(`window.milo.classesSync(${JSON.stringify(portal)})`);
        if (!r.ok) return { score: 0, detail: `couldn't read D2L courses${r.text ? `: ${r.text}` : ""}` };
        const real = (await d2lCourses(portal)).filter((c) => !/ Lab$/.test(c.short)).map((c) => c.short);
        const mine = loadClasses().classes.map((c) => c.name);
        const missing = real.filter((n) => !mine.includes(n));
        return { score: missing.length ? 0.3 : 1, detail: missing.length ? `missing: ${missing.join(", ")}` : `${r.changed ? "updated" : "already matched"}: ${mine.join(", ")}` };
      });
      await test("L3", "School", '"Brief me" reads D2L directly (fast, no page reading)', async () => {
        await reset();
        const t0 = Date.now();
        await hear("Brief me");
        const st = Date.now();
        while (Date.now() - st < 12000 && !events.some((e) => e.line.startsWith("app/brief_d2l"))) await sleep(150);
        const ok = events.some((e) => e.line.startsWith("app/brief_d2l") && /"ok":true/.test(e.line));
        const ms = await saidMatch(/due this week|all caught up|Nothing due/i, 15000);
        return { ms, score: !ok ? 0 : ms < 0 ? 0.5 : speed(Date.now() - t0, 4000, 9000), detail: !ok ? "fell back to reading the page" : ms < 0 ? "got the data, but didn't say it" : `answered in ${((Date.now() - t0) / 1000).toFixed(1)}s from D2L's data` };
      });
      // a class that posts grades, to ask about by its everyday name
      // a class that posts grades, to ask about by its everyday name; best: one with a clear last exam left
      let graded: { short: string } | null = null;
      if (chk.ok)
        for (const c of await d2lCourses(portal).catch(() => [])) {
          const g = await d2lSheet(portal, c).catch(() => null);
          if (g?.sheet.current_percent == null) continue;
          if (g.examItem) {
            graded = c;
            break;
          }
          graded ??= c;
        }
      const word = graded ? graded.short.split(" ").find((w) => w.length > 3 && !/^(introduction|intro|understanding|survey)$/i.test(w)) ?? graded.short : "";
      await test("G1", "School", `"What's my grade in ${word || "<class>"}" (from D2L)`, async () => {
        if (!graded) return { score: 0, detail: chk.ok ? "no class posts grades in D2L" : "not signed in" };
        await reset();
        events = [];
        const t0 = Date.now();
        await hear(`What's my grade in ${word}?`);
        const ms = await saidMatch(/\d+(\.\d+)?%/, 12000);
        return { ms, score: ms < 0 ? 0 : speed(Date.now() - t0, 4000, 9000), detail: ms < 0 ? "never said a percent" : `answered in ${((Date.now() - t0) / 1000).toFixed(1)}s` };
      });
      await test("G2", "School", `"What do I need on the final for a B in ${word || "<class>"}"`, async () => {
        if (!graded) return { score: 0, detail: "no graded class to ask about" };
        await reset();
        events = [];
        const t0 = Date.now();
        await hear(`What do I need on the final for a B in ${word}?`);
        const ms = await saidMatch(/need about \d+%|already locked in|out of reach|which one do you mean|don't see a final/i, 15000);
        return { ms, score: ms < 0 ? 0 : speed(Date.now() - t0, 5000, 10000), detail: ms < 0 ? "no forecast answer" : `answered in ${((Date.now() - t0) / 1000).toFixed(1)}s` };
      });
      await test("G4", "School", "Uses the class's real grade scale (from its syllabus in D2L)", async () => {
        if (!graded) return { score: 0, detail: "no graded class to ask about" };
        await reset();
        events = [];
        await hear(`What do I need on the final for an A in ${word}?`);
        const ms = await saidMatch(/counts A as \d+|Counting a?n? ?A as \d+/i, 15000);
        const own = events.some((e) => e.line.startsWith("app/say") && /Your class counts/i.test(e.line));
        const read = events.find((e) => e.line.startsWith("syllabus/"))?.line ?? "";
        return { ms, score: ms < 0 ? 0 : own ? 1 : 0.5, detail: ms < 0 ? "no answer" : own ? "used the syllabus's own cutoff" : `fell back to the usual 90 (${read.slice(0, 120) || "no syllabus found in D2L"})` };
      });
      await test("E1", "Study power", `"Make me a practice midterm for ${word || "<class>"}" (exam-proof mode)`, async () => {
        await reset();
        const t0 = Date.now();
        await hear(`Make me a practice midterm for ${word || "stats"}`);
        const ack = await saidMatch(/practice midterm|Writing your practice/i, 3000);
        const ms = await waitFor("s.quiz", 60000);
        const n = ms >= 0 ? await js<number>("document.querySelectorAll('.qz-choice, .quiz button, [data-quiz-choice]').length").catch(() => 0) : 0;
        await js("window.__milo.reset()").catch(() => {});
        return {
          ms,
          score: ms < 0 ? 0 : speed(Date.now() - t0, 25000, 45000),
          detail: ms < 0 ? "no practice test appeared" : `test ready in ${((Date.now() - t0) / 1000).toFixed(1)}s${ack < 0 ? " (no quick 'on it' first)" : ""}${n ? `, ${n} answer buttons` : ""}`,
        };
      });
      await test("G3", "School", `"What's due this week" (instant, from D2L)`, async () => {
        await reset();
        events = [];
        const t0 = Date.now();
        await hear("What's due this week?");
        const ms = await saidMatch(/due|caught up|nothing/i, 10000);
        return { ms, score: ms < 0 ? 0 : speed(Date.now() - t0, 3000, 8000), detail: ms < 0 ? "no answer" : `answered in ${((Date.now() - t0) / 1000).toFixed(1)}s` };
      });
    }
  }

  // ======================= LECTURE LISTENER (V) =======================
  {
    const said = async (re: RegExp, timeout: number, after = 0) => {
      const st = Date.now();
      while (Date.now() - st < timeout) {
        if (events.some((e) => e.t >= after && e.line.startsWith("app/say") && re.test(e.line))) return Date.now() - st;
        await sleep(200);
      }
      return -1;
    };
    await test("V1", "Study power", "\"Listen to my lecture\" starts recording, then stays quiet in class", async () => {
      await reset();
      await hear("Listen to my lecture");
      const rec = await waitFor("s.lecture && s.inClass", 15000);
      if (rec < 0) return { score: 0, detail: "didn't start recording" };
      const t0 = Date.now();
      await hear("What did you do?"); // anything he'd normally say out loud
      await sleep(4000);
      const loud = events.some((e) => e.t >= t0 && e.line.startsWith("voice/play"));
      const quiet = events.some((e) => e.t >= t0 && e.line.startsWith("app/say_quiet"));
      await hear("Class is over");
      const stopped = await waitFor("!s.lecture", 10000);
      if (stopped < 0) await js("window.__milo.stopLecture()").catch(() => {}); // never leave it recording (or quiet) for the next tests
      await said(/barely heard|notes|couldn't/i, 60000, t0); // nothing real was said, so no notes: that's fine
      return { score: loud ? 0.3 : !quiet ? 0.5 : stopped < 0 ? 0.6 : 1, detail: loud ? "TALKED OUT LOUD during class" : !quiet ? "recorded, but didn't answer quietly" : stopped < 0 ? "quiet in class, but 'class is over' didn't stop it" : "recorded, answered on screen only, stopped on 'class is over'" };
    });
    await test("V2", "Study power", "A spoken mini-lecture becomes notes, flashcards and a flagged exam item", async () => {
      const lecture =
        "Okay everyone, today we are covering z scores. A z score tells you how many standard deviations a value is from the mean. " +
        "The formula is z equals x minus the mean, divided by the standard deviation. For example, if the mean test score is 70, " +
        "the standard deviation is 10, and you scored 85, your z score is 1.5. A positive z score means above the mean, and a negative z score means below it. " +
        "About 68 percent of values fall within one standard deviation of the mean, and about 95 percent fall within two. " +
        "This will definitely be on Friday's exam, so make sure you know the formula. Your homework is problems 1 through 10 in chapter 6.";
      const v = await macSpeak(lecture);
      if (!v.ok) return { score: 0, detail: "couldn't make the test audio" };
      const m = await startLecture("stats", true);
      if ("blocked" in m) return { score: 0, detail: `recording is turned off (${m.blocked})` };
      addChunk(m.id, 0, new Uint8Array(Buffer.from(v.audio, "base64")).buffer);
      const t0 = Date.now();
      const r = await finishLecture(m.id);
      if (!r.ok) return { score: 0, detail: `no notes: ${r.text}` };
      if (r.noteId) forgetLectureNote(r.noteId); // don't leave test notes behind
      if (r.studyId) deleteItem(r.studyId);
      removeLecture(m.id);
      const cards = r.flashcards ?? 0;
      const alert = (r.alerts ?? 0) > 0;
      return { ms: Date.now() - t0, score: (cards >= 3 ? 0.5 : cards ? 0.25 : 0) + (alert ? 0.5 : 0), detail: `"${r.title}": ${cards} flashcards, exam flag ${alert ? "caught" : "MISSED"}, notes in ${((Date.now() - t0) / 1000).toFixed(0)}s` };
    });
    await test("V3", "Study power", "No class named: never guesses the selected class; asks, then files it", async () => {
      const v = await macSpeak("Today we are going over the causes of the French Revolution. The first cause was debt from wars. The second cause was a bad harvest that raised bread prices. The third cause was ideas from the Enlightenment about rights. Remember these three causes for the midterm.");
      if (!v.ok) return { score: 0, detail: "couldn't make the test audio" };
      const m = await startLecture("listen to my lecture", true);
      if ("blocked" in m) return { score: 0, detail: `recording is turned off (${m.blocked})` };
      const guessed = m.how === "named";
      addChunk(m.id, 0, new Uint8Array(Buffer.from(v.audio, "base64")).buffer);
      const r = await finishLecture(m.id);
      if (!r.ok) return { score: 0, detail: `no notes: ${r.text}` };
      let filed: string | null = null;
      const anyClass = loadClasses().classes[0]?.name ?? "";
      if (r.needsClass && r.lectureId && anyClass) filed = fileLecture(r.lectureId, anyClass.toLowerCase()); // the way a student says it
      if (r.noteId) forgetLectureNote(r.noteId);
      if (r.studyId) deleteItem(r.studyId);
      removeLecture(m.id);
      if (guessed) return { score: 0, detail: "picked a class from words that didn't name one" };
      if (!r.needsClass) return { score: 1, detail: `knew the class from ${m.how === "calendar" ? "your calendar" : "last week's time slot"}: ${m.course}` };
      return { score: filed ? 1 : anyClass ? 0.5 : 1, detail: filed ? `asked, then filed under ${filed}` : anyClass ? `asked, but "${anyClass}" didn't match a class` : "asked (no classes set up to file it under)" };
    });
  }

  // ======================= PAPERS (X): "write a paper on…", written live into a Google Doc =======================
  {
    const said = async (re: RegExp, timeout: number, after = 0) => {
      const st = Date.now();
      while (Date.now() - st < timeout) {
        if (events.some((e) => e.t >= after && e.line.startsWith("app/say") && re.test(e.line))) return Date.now() - st;
        await sleep(200);
      }
      return -1;
    };
    await test("X1", "Study power", '"Write a paper" with no topic asks what it\'s about (and writes nothing)', async () => {
      await reset();
      await hear("Write a paper");
      const ms = await said(/what'?s it about/i, 8000);
      const wrote = events.some((e) => e.line.startsWith("google/doc_made"));
      return { ms, score: wrote ? 0 : ms < 0 ? 0 : 1, detail: wrote ? "MADE A DOC without a topic" : ms < 0 ? "didn't ask for the topic" : "asked for the topic" };
    });
    const gs = (() => { try { return googleStatus(); } catch { return { connected: false }; } })();
    if (process.env.MILO_TEST_COMPUTER === "1" && gs.connected) {
      await test("X2", "Study power", "Writes a real 1-page paper into Google Docs (sources, MLA, Works Cited)", async () => {
        await reset();
        const t0 = Date.now();
        await hear("Write a one page paper on why sleep matters for college students");
        // done, or a problem (never sit out the whole 5 minutes on an error)
        const end = await said(/is in your Google Docs|hit a problem|took too long|connect your google/i, 300000);
        const ms = end >= 0 && events.some((e) => e.line.startsWith("app/say") && /is in your Google Docs/i.test(e.line)) ? end : -1;
        if (end >= 0 && ms < 0) return { score: 0, detail: `Milo said: ${(events.filter((e) => e.line.startsWith("app/say")).pop()?.line ?? "").slice(9, 200)}` };
        if (ms < 0) return { score: 0, detail: events.some((e) => e.line.startsWith("app/say") && /problem/i.test(e.line)) ? "hit a problem (see log)" : "never finished (5 min)" };
        const p = lastPaper;
        if (!p) return { score: 0, detail: "finished but nothing recorded" };
        const id = p.url.match(/\/d\/([^/]+)/)?.[1] ?? "";
        const text = await docsText(id).catch(() => "");
        const cited = /Works Cited/.test(text);
        const lenOk = p.words >= p.target * 0.75;
        const score = (lenOk ? 0.35 : 0.1) + (p.sources >= 3 ? 0.35 : p.sources >= 1 ? 0.15 : 0) + (cited ? 0.3 : 0);
        return { ms, score, detail: `${p.words}/${p.target} words, ${p.sources} checked sources, Works Cited ${cited ? "yes" : "MISSING"}, ${((Date.now() - t0) / 1000).toFixed(0)}s. Doc left in your Drive: ${p.url}` };
      });
    }
  }

  // ======================= FIRST MINUTE: the offer after setup (N) =======================
  // "Want to start on X? Together, or I can do it myself." N3/N4 really open Chrome / start a job: test:new:computer only.
  {
    const said = async (re: RegExp, timeout: number, after = 0) => {
      const st = Date.now();
      while (Date.now() - st < timeout) {
        if (events.some((e) => e.t >= after && e.line.startsWith("app/say") && re.test(e.line))) return Date.now() - st;
        await sleep(150);
      }
      return -1;
    };
    const has = (prefix: string) => events.some((e) => e.line.startsWith(prefix));
    const item = { title: "Problem Set 7", course: "Statistics", due: "Thursday" };
    /** Make the offer and wait until he's done talking and dinged (that's when a student answers). -1 = never offered. */
    const offer = async () => {
      await reset();
      await js(`window.__milo.offer(${JSON.stringify(item)})`);
      const ms = await said(/work through it with you/i, 15000);
      if (ms < 0) return -1;
      const st = Date.now();
      while (Date.now() - st < 20000 && !has("app/answer_window_open")) await sleep(100);
      await sleep(400); // the ding
      return ms;
    };

    await test("N1", "Trust", "Offers to work through it together AND says he can do it himself", async () => {
      const ms = await offer();
      if (ms < 0) return { score: 0, detail: "never made the offer" };
      const both = events.some((e) => e.line.startsWith("app/say") && /short on time|do it myself/i.test(e.line));
      const ding = has("app/answer_window_open");
      return { ms, score: !both ? 0.4 : ding ? 1 : 0.7, detail: !both ? "offered help, but didn't say he can do it himself" : ding ? "offered both, then dinged for an answer" : "offered both, but no ding / answer window" };
    });

    await test("N2", "Trust", '"Not now" drops it politely, nothing starts', async () => {
      if ((await offer()) < 0) return { score: 0, detail: "never made the offer" };
      const t0 = Date.now();
      await js(`window.__milo.hear("Not now.", false)`);
      const ms = await said(/no problem/i, 6000, t0);
      const started = has("app/offer_do") || has("app/homework_plan_shown") || events.some((e) => e.line.startsWith("ipc/task"));
      return { ms, score: started ? 0 : ms < 0 ? 0 : 1, detail: started ? "STARTED something after 'not now'" : ms < 0 ? "didn't answer the no" : "said no problem, nothing started" };
    });

    await test("N5", "Trust", "Something unrelated after the offer is handled normally (offer dropped)", async () => {
      if ((await offer()) < 0) return { score: 0, detail: "never made the offer" };
      await hear("What did you do?");
      const open = await waitFor("s.activityOpen", 5000);
      const still = await js<boolean>("window.__milo.offerOpen()").catch(() => true);
      return { score: open >= 0 && !still ? 1 : open >= 0 ? 0.6 : 0, detail: open >= 0 ? (still ? "answered, but the offer is still waiting" : "answered it, offer dropped") : "the offer swallowed what you said" };
    });

    if (process.env.MILO_TEST_COMPUTER === "1") {
      await test("N6", "Trust", '"Do it and turn it in" starts a job allowed to submit', async () => {
        if ((await offer()) < 0) return { score: 0, detail: "never made the offer" };
        await js(`window.__milo.hear("Do it and turn it in.", false)`);
        const st = Date.now();
        while (Date.now() - st < 10000 && !has("app/offer_do")) await sleep(150);
        const ok = events.some((e) => e.line.startsWith("app/offer_do") && /"approved":true/.test(e.line));
        await js("window.milo.jobStop()").catch(() => {});
        await sleep(1500);
        return { score: !has("app/offer_do") ? 0 : ok ? 1 : 0.3, detail: !has("app/offer_do") ? "no job started" : ok ? "job started, allowed to submit (stopped it for the test)" : "job started but will still ask" };
      });
      await test("N3", "Trust", '"Do it for me" starts a job that asks before submitting', async () => {
        if ((await offer()) < 0) return { score: 0, detail: "never made the offer" };
        await js(`window.__milo.hear("Do it for me.", false)`);
        const st = Date.now();
        while (Date.now() - st < 10000 && !has("app/offer_do")) await sleep(150);
        const started = has("app/offer_do");
        const safe = events.some((e) => e.line.startsWith("app/offer_do") && /"approved":false/.test(e.line));
        await js("window.milo.jobStop()").catch(() => {});
        await sleep(1500);
        return { score: !started ? 0 : safe ? 1 : 0.3, detail: !started ? "no job started" : safe ? "job started; it will ask before turning it in (stopped it for the test)" : "job started already approved to submit, without being told to" };
      });
      await test("N4", "Trust", '"Yes" starts working through it together (opens it, makes a plan)', async () => {
        if ((await offer()) < 0) return { score: 0, detail: "never made the offer" };
        await js(`window.__milo.hear("Yes.", false)`);
        const ms = await said(/let's go/i, 8000);
        // stop it for real (the same "stop" a student says), and wait until he's actually idle
        await js(`window.__milo.hear("Stop.", true)`).catch(() => {});
        await js("window.milo.stopTask()").catch(() => {});
        await waitFor("!s.working", 15000);
        await js("window.__milo.reset()").catch(() => {});
        return { ms, score: ms < 0 ? 0 : 1, detail: ms < 0 ? "didn't start" : "started the together flow (stopped it for the test)" };
      });
    }
  }

  // ======================= TRUST: "What Milo did" + undo (U), feedback (B) =======================
  // Run just these: npm run test:new   (Google ones need Google connected; app ones need npm run test:new:computer)
  {
    const said = async (re: RegExp, timeout: number, after = 0) => {
      const st = Date.now();
      while (Date.now() - st < timeout) {
        if (events.some((e) => e.t >= after && e.line.startsWith("app/say") && re.test(e.line))) return Date.now() - st;
        await sleep(150);
      }
      return -1;
    };
    const until = async (fn: () => boolean | Promise<boolean>, timeout: number) => {
      const st = Date.now();
      while (Date.now() - st < timeout) {
        if (await fn()) return Date.now() - st;
        await sleep(150);
      }
      return -1;
    };
    const entry = (re: RegExp) => activity.list(50).find((e) => re.test(e.title));
    const g = (() => { try { return googleStatus(); } catch { return { connected: false, email: null as string | null }; } })();

    await test("U1", "Trust", `"What did you do?" opens the timeline and answers`, async () => {
      await reset();
      const t0 = Date.now();
      await hear("What did you do?");
      const open = await waitFor("s.activityOpen", 4000);
      const ms = await said(/did (one thing|\d+ things)|haven't done anything/i, 6000);
      return { ms, score: open < 0 ? 0 : ms < 0 ? 0.5 : speed(Date.now() - t0, 2500, 6000), detail: open < 0 ? "timeline didn't open" : ms < 0 ? "opened, but he didn't say what he did" : "opened and answered" };
    });

    await test("U2", "Trust", "Menu bar 'What Milo did…' opens the timeline", async () => {
      await reset();
      win.webContents.send("milo:open-activity");
      const ms = await waitFor("s.activityOpen", 3000);
      return { ms, score: ms < 0 ? 0 : 1, detail: ms < 0 ? "didn't open" : "opened" };
    });

    await test("U3", "Trust", 'Something he learned shows up, and "undo that" forgets it', async () => {
      await reset();
      const fact = `Self-test fact ${Date.now()}`;
      await remember(fact);
      const e = entry(new RegExp(fact));
      if (!e) return { score: 0, detail: "remembering wasn't logged in the timeline" };
      if (!activity.canUndo(e)) return { score: 0.3, detail: "logged, but no Undo on it" };
      await waitFor("!s.working", 15000); // nothing left over from an earlier test
      await hear("Undo that");
      const gone = await until(() => !memories().includes(fact), 15000);
      const spoke = await said(/undone|done\./i, 4000);
      return { score: gone < 0 ? 0.3 : spoke < 0 ? 0.8 : 1, detail: gone < 0 ? "still remembered after undo" : spoke < 0 ? "forgot it, but didn't say so" : "logged, undone by voice, forgotten" };
    });

    if (g.connected) {
      await test("U4", "Trust", "Calendar event: logged, and Undo deletes it from Google", async () => {
        const t = `Milo undo test ${new Date().toLocaleTimeString()}`;
        const d = new Date(Date.now() + 7 * 86400e3);
        const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        const r = await calendarAdd({ title: t, start: `${day}T09:00` });
        if (!r.id) return { score: 0, detail: "Google didn't return the event id (Undo can't work)" };
        const id = did({ kind: "calendar", title: `Added "${t}" to your calendar`, undo: { type: "calendar_delete", data: { id: r.id } } });
        const u = await activity.undo(id);
        return { score: u.ok ? 1 : 0, detail: u.ok ? "added, then removed from your calendar" : `undo failed: ${u.text} (delete "${t}" by hand)` };
      });
      await test("U5", "Trust", "Email draft: logged, and Undo deletes the draft", async () => {
        if (!g.email) return { score: 0, detail: "don't know your email address" };
        const d = await gmailDraft({ to: g.email, subject: "Milo undo test", body: "Milo's self-test. This draft should delete itself." });
        const id = did({ kind: "email_draft", title: "Wrote an email to you: Milo undo test", undo: { type: "draft_delete", data: { draftId: d.draftId } } });
        const u = await activity.undo(id);
        return { score: u.ok ? 1 : 0, detail: u.ok ? "drafted, then deleted from your drafts" : `undo failed: ${u.text} (delete the "Milo undo test" draft by hand)` };
      });
    } else {
      results.push({ id: "U4", cat: "Trust", name: "Calendar + email undo", score: 0, pass: false, detail: "Google not connected: say 'Milo, connect Google', then rerun" });
    }

    if (process.env.MILO_TEST_COMPUTER === "1") {
      await test("U6", "Trust", "'Open Calculator' then 'undo that' closes it", async () => {
        await quitApp("Calculator").catch(() => {});
        await sleep(800);
        await reset();
        await hear("Open Calculator");
        if ((await until(() => isRunning("Calculator"), 8000)) < 0) return { score: 0, detail: "Calculator never opened" };
        await sleep(800);
        await hear("Undo that");
        const ms = await until(async () => !(await isRunning("Calculator")), 8000);
        return { ms, score: ms < 0 ? 0 : 1, detail: ms < 0 ? "still open after undo" : "opened, then closed by undo" };
      });
    }

    await test("B1", "Trust", '"Report a bug, the frog froze" opens feedback with your words', async () => {
      await reset();
      await hear("Report a bug the frog froze");
      const ms = await waitFor(`s.feedback !== null && s.feedback !== undefined && /frog froze/i.test(s.feedback)`, 4000);
      const open = ms >= 0 || (await waitFor("s.feedback !== null && s.feedback !== undefined", 500)) >= 0;
      return { ms, score: ms >= 0 ? 1 : open ? 0.5 : 0, detail: ms >= 0 ? "opened with your words filled in" : open ? "opened, but your words weren't filled in" : "didn't open" };
    });

    await test("B2", "Trust", "Feedback actually reaches Sentry", async () => {
      const ok = await sendFeedback("Milo self-test: ignore this one.", { kind: "selftest" });
      return { score: ok ? 1 : 0, detail: ok ? "Sentry accepted it (look under User Feedback, tagged selftest)" : "Sentry didn't accept it (offline?)" };
    });
  }

  // ======================= GOOGLE: calendar + Gmail, and the yes/no follow-up =======================
  // Nothing here creates or sends anything: the "add" test answers NO.
  {
    const said = async (re: RegExp, timeout: number, after = 0) => {
      const st = Date.now();
      while (Date.now() - st < timeout) {
        if (events.some((e) => e.t >= after && e.line.startsWith("app/say") && re.test(e.line))) return Date.now() - st;
        await sleep(150);
      }
      return -1;
    };
    const has = (prefix: string) => events.some((e) => e.line.startsWith(prefix));
    const g = (() => { try { return googleStatus(); } catch { return { connected: false, email: null as string | null }; } })();
    await test("W0", "Google", "Google connected", async () => ({ score: g.connected ? 1 : 0, detail: g.connected ? `as ${g.email}` : "not connected: say 'Milo, connect Google'" }));
    if (g.connected) {
      const CAL = /this week|nothing on your calendar|thing(s)? this week|calendar is (clear|empty)|One thing/i;
      const MAIL = /new emails?|inbox is (clear|empty)|no new|unread/i;
      await test("W1", "Google", `"What's on my calendar this week?"`, async () => {
        await reset();
        const t0 = Date.now();
        await hear("What's on my calendar this week?");
        const ms = await said(CAL, 10000);
        return { ms, score: ms < 0 ? 0 : speed(Date.now() - t0, 3000, 7000), detail: ms < 0 ? "no calendar answer" : `answered in ${((Date.now() - t0) / 1000).toFixed(1)}s` };
      });
      await test("W2", "Google", `"Do I have any new emails?"`, async () => {
        await reset();
        const t0 = Date.now();
        await hear("Do I have any new emails?");
        const ms = await said(MAIL, 10000);
        return { ms, score: ms < 0 ? 0 : speed(Date.now() - t0, 3000, 7000), detail: ms < 0 ? "no email answer" : `answered in ${((Date.now() - t0) / 1000).toFixed(1)}s` };
      });
      await test("W3", "Google", "Two questions in one breath: calendar AND emails", async () => {
        await reset();
        const t0 = Date.now();
        await hear("What's on my calendar this week, and do I have any new emails?");
        const c = await said(CAL, 12000);
        const m = await said(MAIL, 35000); // the calendar part is read out first
        const both = c >= 0 && m >= 0;
        return { ms: both ? Date.now() - t0 : -1, score: both ? 1 : c >= 0 || m >= 0 ? 0.3 : 0, detail: both ? `both answered in ${((Date.now() - t0) / 1000).toFixed(1)}s` : c >= 0 ? "only answered the calendar" : m >= 0 ? "only answered the emails" : "answered neither" };
      });
      await test("W4", "Google", "Adding an event ASKS first, then dings for a yes/no", async () => {
        await reset();
        await hear("Add Milo self test Monday at 9 to my calendar");
        const ask = await said(/to your calendar\?/i, 10000);
        if (ask < 0) return { score: 0, detail: "never asked to confirm" };
        await sleep(1500);
        const added = has("google/event_added");
        const win = await (async () => {
          const st = Date.now();
          while (Date.now() - st < 10000) {
            if (has("app/answer_window_open")) return true;
            await sleep(150);
          }
          return false;
        })();
        if (added) return { score: 0, detail: "ADDED WITHOUT ASKING" };
        return { score: win ? 1 : 0.5, detail: win ? "asked, then opened the yes/no window" : "asked, but no ding / answer window" };
      });
      await test("W5", "Google", 'Plain "no" (no "Milo") cancels instantly', async () => {
        await reset();
        await hear("Add Milo self test Monday at 9 to my calendar");
        if ((await said(/to your calendar\?/i, 10000)) < 0) return { score: 0, detail: "never asked to confirm" };
        const st = Date.now();
        while (Date.now() - st < 10000 && !has("app/answer_window_open")) await sleep(100);
        if (!has("app/answer_window_open")) return { score: 0, detail: "no answer window after the question" };
        await sleep(400); // the ding
        const t0 = Date.now();
        await js(`window.__milo.hear("No.", false)`);
        const ms = await said(/won't add it/i, 5000, t0);
        const added = has("google/event_added");
        return { ms, score: added ? 0 : ms < 0 ? 0 : speed(ms, 1500, 4000), detail: added ? "ADDED even though you said no" : ms < 0 ? "didn't hear the no" : `cancelled in ${(ms / 1000).toFixed(1)}s, nothing added` };
      });
    }
  }

  // ======================= HOME BASE (Z): the real app window, same Milo as the frog =======================
  // Run just these: npm run test:home
  {
    const isDev = process.env.MILO_DEV === "1";
    const hjs = <T = unknown>(code: string): Promise<T> => {
      const w = homeWin();
      if (!w) return Promise.reject(new Error("Home base isn't open"));
      return w.webContents.executeJavaScript(code, true) as Promise<T>;
    };
    const hwait = async (cond: string, timeout: number) => {
      const st = Date.now();
      while (Date.now() - st < timeout) {
        if (await hjs<boolean>(`(() => { try { return !!(${cond}); } catch { return false; } })()`).catch(() => false)) return Date.now() - st;
        await sleep(100);
      }
      return -1;
    };
    const hshot = async (id: string) => {
      try {
        const img = await homeWin()!.webContents.capturePage();
        fs.writeFileSync(path.join(dir, "shots", `${id}.png`), img.toPNG());
      } catch {
        /* closed */
      }
    };

    await test("Z1", "Home", "Home base opens fast and draws (sidebar, Today, composer)", async () => {
      const w = homeWin();
      if (w) w.close();
      await sleep(400);
      const t = Date.now();
      openHome(isDev);
      const ms = await hwait("document.querySelector('.hb-side') && document.querySelector('.hb-hello') && document.getElementById('hb-ask')", 8000);
      await sleep(1500); // let D2L and grades fill in
      await hshot("Z1-home-today"); // always saved, so you can look at it
      if (ms < 0) return { score: 0, detail: "the window never drew" };
      const total = Date.now() - t - 1500;
      return { ms: total, score: speed(total, 1500, 4000), detail: `drew in ${(total / 1000).toFixed(1)}s (screenshot: shots/Z1-home-today.png)` };
    });

    await test("Z2", "Home", "Your classes show in the sidebar", async () => {
      if (!homeWin()) openHome(isDev);
      const want = loadClasses().classes?.length ?? 0;
      const ms = await hwait(`document.querySelectorAll('.hb-cls').length >= ${Math.max(1, want)}`, 6000);
      const got = await hjs<number>("document.querySelectorAll('.hb-cls').length").catch(() => 0);
      if (!want) return { score: got === 0 ? 0.6 : 1, detail: "no classes saved yet (connect D2L)" };
      return { ms, score: got === want ? 1 : got ? 0.6 : 0, detail: `${got} of ${want} classes shown` };
    });

    await test("Z3", "Home", "Typing in Home base runs through the same Milo, answer shows in the chat", async () => {
      if (!homeWin()) openHome(isDev);
      await hjs("document.querySelector('.hb-new') && document.querySelector('.hb-new').click()");
      await sleep(300);
      const typed = await hjs<boolean>(`(() => {
        const t = document.getElementById('hb-ask'); if (!t) return false;
        const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
        set.call(t, "What time is it?"); t.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
      if (!typed) return { score: 0, detail: "couldn't find the message box" };
      await sleep(150);
      await hjs("document.getElementById('hb-ask').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))");
      const t = Date.now();
      const you = await hwait("document.querySelector('.hb-you')", 2000);
      const milo = await hwait("document.querySelector('.hb-milo')", 20000);
      const quiet = events.some((e) => e.line.startsWith("app/say_quiet"));
      const loud = events.some((e) => e.line.startsWith("app/say "));
      if (you < 0) return { score: 0, detail: "your message didn't show up" };
      if (milo < 0) return { score: 0.3, detail: "sent, but Milo's answer never showed in Home base" };
      return { ms: Date.now() - t, score: loud && !quiet ? 0.7 : speed(Date.now() - t, 6000, 15000), detail: loud && !quiet ? "answered, but the frog said it out loud (should be quiet when typed)" : "answered in the chat, frog stayed quiet" };
    });

    await test("Z4", "Home", "Talking to the frog after typing gets a spoken answer again", async () => {
      await hear("What time is it?");
      const st = Date.now();
      while (Date.now() - st < 15000 && !events.some((e) => e.line.startsWith("app/say ") || e.line.startsWith("app/say_quiet"))) await sleep(150);
      const loud = events.some((e) => e.line.startsWith("app/say "));
      const quiet = events.some((e) => e.line.startsWith("app/say_quiet"));
      return { score: loud ? 1 : quiet ? 0 : 0.3, detail: loud ? "spoke out loud" : quiet ? "stayed silent (still in Home's quiet mode)" : "didn't answer" };
    });

    await test("Z5", "Home", "Something Milo does pops up in Home base with Undo, and Undo works", async () => {
      if (!homeWin()) openHome(isDev);
      await hjs("document.querySelector('.hb-toast button') && document.querySelector('.hb-toast button').click()").catch(() => {});
      await sleep(300);
      const fact = `Home base test fact ${Date.now()}`;
      await remember(fact);
      const ms = await hwait("document.querySelector('.hb-toast')", 4000);
      if (ms < 0) return { score: 0, detail: "no Undo bar showed up" };
      await hjs("document.querySelector('.hb-toast button').click()");
      const st = Date.now();
      while (Date.now() - st < 8000 && memories().includes(fact)) await sleep(150);
      const gone = !memories().includes(fact);
      return { ms, score: gone ? speed(ms, 1500, 3500) : 0.3, detail: gone ? `Undo bar in ${(ms / 1000).toFixed(1)}s, Undo took it back` : "Undo bar showed, but Undo didn't work" };
    });

    await test("Z6", "Home", "⌘K opens the command bar, Esc closes it", async () => {
      if (!homeWin()) openHome(isDev);
      await hjs("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))");
      const open = await hwait("document.querySelector('.hb-cmd')", 2000);
      await hshot("Z6-command-bar");
      await hjs("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))");
      const closed = await hwait("!document.querySelector('.hb-cmd')", 2000);
      return { ms: open, score: open < 0 ? 0 : closed < 0 ? 0.6 : 1, detail: open < 0 ? "didn't open" : closed < 0 ? "opened, Esc didn't close it" : "opens and closes" };
    });

    await test("Z7", "Home", "Closing Home base leaves Milo running as the frog", async () => {
      homeWin()?.close();
      await sleep(800);
      const alive = await js<boolean>("!!(window.__milo && window.__milo.ready)").catch(() => false);
      return { score: !homeWin() && alive ? 1 : 0, detail: alive ? "closed, frog still here" : "the frog went away too" };
    });
  }

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

  // ---------- score + report (rewritten after every check, so a stuck test still leaves a report) ----------
  function writeReport(final: boolean) {
  // MILO_TEST_ONLY: drop "not set up" rows from sections that weren't asked for
  const only = (process.env.MILO_TEST_ONLY || "").split(",").map((x) => x.trim()).filter(Boolean);
  if (only.length) {
    const keep = results.filter((r) => only.some((o) => r.id === o || (o.length === 1 && r.id.startsWith(o))));
    results.splice(0, results.length, ...keep);
  }
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
  if (!final) return;
  console.log("\n" + md.split("## Failures")[0]);
  console.log(`[milo-test] Full report: test-results/${stamp}/report.md`);
  }
  writeReport(true);
}

export const selfTestOn = () => process.env.MILO_TEST === "1";
export const quitAfterTest = () => setTimeout(() => app.exit(0), 500);
