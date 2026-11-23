import {
  app,
  BrowserWindow,
  session,
  clipboard,
  desktopCapturer,
  nativeImage,
  globalShortcut,
  ipcMain,
  screen,
  systemPreferences,
  shell,
  Notification,
} from "electron";
import path from "node:path";
import fs from "node:fs";
import { execFile } from "node:child_process";
import dotenv from "dotenv";
import { speak } from "./voice";
import { log as bb, saveClip, timer, LOG_DIR, LOG_FILE } from "./blackbox";
import { closeFlux, fluxAvailable, forceEndTurn, onFlux, openFlux, sendAudio } from "./flux";
import { macSpeak } from "./macvoice";
import { bridgeConnected, call as ext, registerNativeHost, startBridge } from "./bridge";
import { runWebTask } from "./webagent";
import { registerKit } from "./kitipc";
import { registerLibrary } from "./library";
import { quitAfterTest, runSelfTest, selfTestOn } from "./selftest";
import { jobBenchOn, quitAfterBench, runJobBench } from "./jobbench";
import { makeGamePlan } from "./homework";
import { startSync } from "./sync";
import { isJob, lastJob, resumable, resumeJob, startJob, type JobDeps } from "./jobs";
import { getProfile, setProfile, type Profile } from "./profile";
import { usageToday } from "./usage";
import { awayWatch } from "./away";
import { calendarAdd, calendarDelete, calendarUpcoming, docsCreate, GoogleNotConnected, googleConnect, googleDisconnect, googleStatus, gmailDeleteDraft, gmailDraft, gmailSendDraft, gmailUnread } from "./google";
import { activity, did, registerActivity } from "./activityLog";
import { writePaper } from "./paper";
import { homeWin, openHome, toHome } from "./home";
import { addChunk, discardLecture, fileLecture, finishLecture, finishLeftovers, forgetLectureNote, lectureNow, startLecture } from "./lecture";
import { classFor, COLORS, loadClasses, saveClasses, SUBJECT_WORDS, type Klass } from "./classes";
import { mergeD2l } from "./classSync";
import { parsePaperAsk } from "./paperFormat";
import { composeEmail, parseEvent, sayCalendar, sayMail } from "./googleai";
import { feedUrl } from "./school";
import { checkMath, isQuantitative, type MathVerdict } from "./mathcheck";
import { askForecast, setFinalWeight } from "./grades";
import { addScore, gradeNow, readSyllabus } from "./gradebook";
import { calendarFeedUrl, subscribePageUrl, d2lCheck, keepSignedIn, courses as d2lCourses, dueSoon as d2lDue, gradeSheet as d2lSheet, matchCourse as d2lMatch, SignInNeeded } from "./d2l";
import { makeExam } from "./exam";
import { transcribe } from "./ears";
import { binaryPath, stopNative } from "./native";
import { account, onAccountChange, sendCode, signOut, startCallbackServer, userId, verifyCode } from "./account";
import { forget, forgetAll, memories, onRemember, remember, syncMemories } from "./memory";
import { captureError, identify, recentEvents, sendFeedback, startTelemetry, track } from "./telemetry";
import { allowForSession, backToWork, startFocus, stopFocus } from "./focus";
import { planBlocks } from "./focusRules";
import { rest } from "./account";
import { activateApp, click, ensureBrowser, resolveApp, frontApp, isRunning, openApp, openFolder, openLatestDownload, openUrl, pressKeys, quitApp, typeText } from "./hands";
import { plan } from "./quick";
import { research } from "./research";
import { buildTool } from "./builder";
import { askScreen } from "./brain";
import { createTray, extensionDirs, firstRunDefaults, loadKeys } from "./appshell";
import { isPaused, PAUSED_TEXT, pauseState, setPause } from "./pause";
import { prefs, setPrefs, type Prefs } from "./prefs";
import { checkForUpdate, installUpdate, startUpdater, startUpdates, updateReady } from "./updater";
import { Action, askMilo, classify, RouteCtx, makeQuiz, readBrief, setUserName, sweepPlan, watchCheck, ChatMessage, checkAnswer, locateInCrop, nextActions, setCharacter, makePractice, Mode, teachFromScreen, TeachResult } from "./brain";

if (!app.isPackaged) dotenv.config({ path: path.join(app.getAppPath(), ".env") }); // dev keys only; installed Milo uses the student's account
startTelemetry();
// One Milo at a time (login item + opening the app = still one frog).
if (!app.requestSingleInstanceLock()) app.quit();

// ---------- black-box log: every request Milo handles, how long it took, what came back ----------
const QUIET = new Set(["milo:watch-check", "milo:mic-access", "milo:hands-access", "milo:log-flag"]);
const brief = (v: unknown): unknown => {
  if (v instanceof ArrayBuffer) return { bytes: v.byteLength };
  if (ArrayBuffer.isView(v)) return { bytes: v.byteLength };
  if (typeof v === "string") return v.length > 400 ? v.slice(0, 400) + "…" : v;
  if (Array.isArray(v)) return v.length > 8 ? [...v.slice(-8).map(brief), `(+${v.length - 8} more)`] : v.map(brief);
  if (v && typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) o[k] = brief(x);
    return o;
  }
  return v;
};
{
  const orig = ipcMain.handle.bind(ipcMain);
  (ipcMain as unknown as { handle: typeof ipcMain.handle }).handle = (channel, fn) =>
    orig(channel, async (e, ...args) => {
      const done = timer();
      try {
        const out = await fn(e, ...args);
        if (!QUIET.has(channel)) bb("ipc", channel.replace("milo:", ""), { ms: done(), args: brief(args), out: brief(out) });
        return out;
      } catch (err) {
        bb("ipc", channel.replace("milo:", "") + "_crash", { ms: done(), args: brief(args), error: String((err as Error)?.stack ?? err) });
        throw err;
      }
    });
}
process.on("uncaughtException", (err) => bb("main", "uncaught", { error: String(err?.stack ?? err) }));
process.on("unhandledRejection", (err) => bb("main", "unhandled_rejection", { error: String((err as Error)?.stack ?? err) }));

const isDev = process.env.MILO_DEV === "1";
let overlay: BrowserWindow | null = null;

function createOverlay() {
  // One transparent window covering the whole work area. Milo lives inside it.
  const { workArea } = screen.getPrimaryDisplay();

  overlay = new BrowserWindow({
    x: workArea.x,
    y: workArea.y,
    width: workArea.width,
    height: workArea.height,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    hasShadow: false,
    skipTaskbar: true,
    focusable: true,
    alwaysOnTop: true,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true, // live web pages inside the research panel
      // Milo's overlay is see-through, so Chromium thinks it's "in the background" and slows its timers
      // (the "Got it" countdown froze, lock-in timers drift). He's always on screen: never throttle him.
      backgroundThrottling: false,
    },
  });

  overlay.setAlwaysOnTop(true, "floating");
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // Keep Milo out of his own screenshots (and out of screen shares).
  overlay.setContentProtection(true);
  // Clicks pass through to the apps underneath, except where Milo or his UI is.
  overlay.setIgnoreMouseEvents(true, { forward: true });

  if (isDev) {
    overlay.loadURL("http://127.0.0.1:5173");
  } else {
    overlay.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  overlay.on("closed", () => (overlay = null));
}

// ---------- screen capture ---------------------------------------------------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const SCREEN_PERMISSION_HELP =
  "I can't see your screen yet! Open System Settings > Privacy & Security > Screen & System Audio Recording, turn on Terminal (and Electron if it is listed), then quit me and start me again.";

type Shot = {
  full: Electron.NativeImage; // full-resolution screenshot
  pxPerPt: number; // full-image pixels per screen point
  bounds: Electron.Rectangle;
  workArea: Electron.Rectangle;
};
let lastShot: Shot | null = null;

async function captureScreen(): Promise<{ ok: true; shot: Shot } | { ok: false; text: string }> {
  if (isPaused()) return { ok: false, text: PAUSED_TEXT };
  const display = screen.getPrimaryDisplay();
  const { bounds, workArea, scaleFactor } = display;

  if (process.platform === "darwin") {
    const status = systemPreferences.getMediaAccessStatus("screen");
    if (status === "denied" || status === "restricted") return { ok: false, text: SCREEN_PERMISSION_HELP };
  }

  // Content protection should hide Milo already; fade him out for the shot as a backup.
  overlay?.setOpacity(0);
  await sleep(70);
  try {
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width: Math.round(bounds.width * scaleFactor), height: Math.round(bounds.height * scaleFactor) },
    });
    const src = sources.find((s) => s.display_id === String(display.id)) ?? sources[0];
    if (!src || src.thumbnail.isEmpty()) return { ok: false, text: SCREEN_PERMISSION_HELP };
    if (process.platform === "darwin" && systemPreferences.getMediaAccessStatus("screen") !== "granted") {
      return { ok: false, text: SCREEN_PERMISSION_HELP };
    }
    const full = src.thumbnail;
    const shot: Shot = { full, pxPerPt: full.getSize().width / bounds.width, bounds, workArea };
    lastShot = shot;
    return { ok: true, shot };
  } catch (err) {
    return { ok: false, text: `I couldn't see your screen: ${(err as Error).message}` };
  } finally {
    overlay?.setOpacity(1);
  }
}

/** Downscale so the long edge is at most `max` pixels. Returns the jpeg and its size. */
function toJpeg(img: Electron.NativeImage, max: number) {
  const { width, height } = img.getSize();
  const k = Math.min(1, max / Math.max(width, height));
  const out = k < 1 ? img.resize({ width: Math.round(width * k), height: Math.round(height * k), quality: "best" }) : img;
  const size = out.getSize();
  return { b64: out.toJPEG(85).toString("base64"), size, k };
}

// ---------- IPC -------------------------------------------------------------

ipcMain.on("milo:set-clickable", (_e, clickable: boolean) => {
  if (!overlay) return;
  if (clickable) overlay.setIgnoreMouseEvents(false);
  else overlay.setIgnoreMouseEvents(true, { forward: true });
});

ipcMain.handle("milo:ask", (_e, history: ChatMessage[]) => askMilo(history));
ipcMain.handle("milo:route", (_e, text: string, ctx?: RouteCtx) => classify(String(text ?? ""), ctx && typeof ctx === "object" ? ctx : {}));

type Box = { x: number; y: number; width: number; height: number };

ipcMain.handle("milo:look", async (_e, mode: Mode, request: string, focus: Box | null) => {
  // Where the mouse is right now (so "this one" means the question you're hovering).
  const cursor = screen.getCursorScreenPoint();
  const cap = await captureScreen();
  if (!cap.ok) return cap;
  const { shot } = cap;
  const small = toJpeg(shot.full, 1568);
  const pxPerPtSmall = small.k * shot.pxPerPt;
  const { bounds, workArea } = shot;

  // overlay points <-> screenshot pixels
  const toPx = (b: Box) => ({
    x: (b.x + workArea.x - bounds.x) * pxPerPtSmall,
    y: (b.y + workArea.y - bounds.y) * pxPerPtSmall,
    width: b.width * pxPerPtSmall,
    height: b.height * pxPerPtSmall,
  });
  const toPt = (b: Box) => ({
    x: bounds.x + b.x / pxPerPtSmall - workArea.x,
    y: bounds.y + b.y / pxPerPtSmall - workArea.y,
    width: b.width / pxPerPtSmall,
    height: b.height / pxPerPtSmall,
  });

  const onScreen =
    cursor.x >= bounds.x && cursor.x <= bounds.x + bounds.width && cursor.y >= bounds.y && cursor.y <= bounds.y + bounds.height;
  const pointer = onScreen ? { x: (cursor.x - bounds.x) * pxPerPtSmall, y: (cursor.y - bounds.y) * pxPerPtSmall } : undefined;

  let lesson = await teachFromScreen(small.b64, small.size, mode, request, {
    pointer,
    focus: focus ? toPx(focus) : undefined,
  });
  if (!lesson.ok) return lesson;
  // Math and science checker: work the answer out in code before saying it. Wrong? Redo it with the computed value.
  const L = lesson.data;
  if (L.found && L.answer && isQuantitative(`${L.topic} ${L.steps.map((s) => s.write).join(" ")}`, L.answer)) {
    const v = await checkMath(`${L.topic}. ${L.steps.map((s) => `${s.say} ${s.write}`).join(" ")}`, L.answer, small.b64).catch(() => ({ checked: false, agree: true }) as MathVerdict);
    if (v.checked && !v.agree && v.computed) {
      const redo = await teachFromScreen(small.b64, small.size, mode, `${request}\n(A calculator check of this problem computed ${v.computed.join(", ")} for the final answer, which doesn't match "${L.answer}". Re-work it carefully. If the calculator is right, fix your steps and answer.)`, {
        pointer,
        focus: focus ? toPx(focus) : undefined,
      });
      if (redo.ok && redo.data.found) lesson = redo;
    }
  }

  const t = lesson.data.target;
  const box = lesson.data.found && t ? toPt(t) : null;
  const others = (lesson.data.others ?? [])
    .filter((o) => o && o.width > 4 && o.height > 4)
    .slice(0, 6)
    .map((o) => ({ label: String(o.label).slice(0, 12), box: toPt(o) }));
  return { ok: true, lesson: lesson.data, box, others };
});

// Lock-on: zoom into a sharp crop around the first guess and find the exact edges.
ipcMain.handle("milo:refine", async (_e, box: { x: number; y: number; width: number; height: number }, topic: string) => {
  const shot = lastShot;
  if (!shot) return { ok: false, text: "no-shot" };
  const { full, pxPerPt, bounds, workArea } = shot;
  const img = full.getSize();

  // Box in full-image pixels, padded generously so the real edges are inside the crop.
  const bx = (box.x + workArea.x - bounds.x) * pxPerPt;
  const by = (box.y + workArea.y - bounds.y) * pxPerPt;
  const bw = box.width * pxPerPt;
  const bh = box.height * pxPerPt;
  const padX = Math.max(80 * pxPerPt, bw * 0.35);
  const padY = Math.max(60 * pxPerPt, bh * 0.5);
  const cx = Math.max(0, Math.floor(bx - padX));
  const cy = Math.max(0, Math.floor(by - padY));
  const cw = Math.min(img.width - cx, Math.ceil(bw + padX * 2));
  const ch = Math.min(img.height - cy, Math.ceil(bh + padY * 2));
  if (cw < 20 || ch < 20) return { ok: false, text: "tiny" };

  const crop = toJpeg(full.crop({ x: cx, y: cy, width: cw, height: ch }), 1400);
  const r = await locateInCrop(crop.b64, crop.size, topic);
  if (!r.ok) return r;
  const L = r.data;
  if (!L.found || L.width <= 4 || L.height <= 4) return { ok: false, text: "not-found" };

  // Crop pixels -> full pixels -> overlay points.
  const toFull = 1 / crop.k;
  const fx = cx + L.x * toFull;
  const fy = cy + L.y * toFull;
  return {
    ok: true,
    box: {
      x: bounds.x + fx / pxPerPt - workArea.x,
      y: bounds.y + fy / pxPerPt - workArea.y,
      width: (L.width * toFull) / pxPerPt,
      height: (L.height * toFull) / pxPerPt,
    },
  };
});


// ---------- computer control (Milo's hands) ---------------------------------------
let taskRunning = false;
let taskAbort = false;

function sendStep(step: { say: string; action: string; point?: { x: number; y: number } | null; status?: string }) {
  bb("task", "step", step);
  overlay?.webContents.send("milo:task-step", step);
  toHome("milo:task-step", step);
}

ipcMain.on("milo:task-stop", () => {
  taskAbort = true;
});

ipcMain.handle("milo:task", (_e, task: string) => doTask(String(task ?? "")));

// ---------- jobs: long tasks that finish (jobs.ts) ----------
let jobAbort = false;
const jobDeps: JobDeps = {
  doTask: (t) => doTask(t),
  // What's on screen now. shot:false = just read the page (fast, free); shot:true = also a screenshot.
  look: async (opts = {}) => {
    const front = await frontApp().catch(() => "");
    type El = { label?: string; value?: string; checked?: boolean; tag?: string };
    let page: { text?: string; url?: string; title?: string; canvasHeavy?: boolean; elements?: El[] } | null = null;
    if (bridgeConnected() && /Google Chrome/i.test(front)) page = await ext("snapshot", {}, 8000).catch(() => null);
    const readable = page && !page.canvasHeavy && page.text;
    let jpeg: string | undefined;
    if (opts.shot || !readable) {
      const cap = await captureScreen();
      jpeg = cap.ok ? toJpeg(cap.shot.full, 1400).b64 : undefined;
    }
    const fields = (page?.elements ?? []).filter((e) => e.label && (e.value !== undefined || e.checked !== undefined)).map((e) => ({ label: e.label!, value: e.value, checked: e.checked }));
    return { jpeg, pageText: readable ? page!.text : undefined, url: page?.url, title: page?.title, fields };
  },
  emit: (job) => {
    overlay?.webContents.send("milo:job", job);
    toHome("milo:job", job);
    logJob(job);
    // away mode: Mac stays awake while working; a notification when it's done or needs you
    awayWatch(job, () => {
      overlay?.showInactive();
      overlay?.webContents.send("milo:job", job);
    });
  },
  aborted: () => jobAbort || taskAbort,
  // starting or resuming a job clears BOTH stop flags (a leftover "stop" froze the next job)
  resetAbort: () => {
    jobAbort = false;
    taskAbort = false;
  },
};
/** Jobs land in the timeline once, when they finish or stop for the student. Web steps can't be auto-undone. */
const jobLogged = new Map<string, string>();
function logJob(job: { id: string; goal: string; status: string; summary?: string; question?: string; steps: { do: string; status: string }[] }) {
  const end = { done: "Did", needs_you: "Started (needs you)", stuck: "Got stuck on", stopped: "Stopped", failed: "Couldn't finish" }[job.status as "done"];
  if (!end) return;
  const steps = job.steps.filter((s) => s.status === "done").map((s) => `✓ ${s.do}`).join("\n");
  const e = { kind: "job" as const, title: `${end}: ${job.goal}`, detail: [job.summary || job.question, steps].filter(Boolean).join("\n\n"), noUndo: "This happened on websites, so open them to change it." };
  const prev = jobLogged.get(job.id);
  if (prev) activity.update(prev, e);
  else jobLogged.set(job.id, did(e));
}
/** Wait for a stopped action to really finish (its last click can still be landing) before starting again. */
async function waitIdle(ms = 15000) {
  const t0 = Date.now();
  while (taskRunning && Date.now() - t0 < ms) await sleep(100);
}
export const jobs = {
  start: async (goal: string, opts: { approved?: boolean } = {}) => {
    await waitIdle();
    return startJob(goal, jobDeps, opts);
  },
  resume: async (approve = false) => {
    await waitIdle();
    return resumeJob(null, jobDeps, { approve });
  },
  stop: () => {
    jobAbort = true;
    taskAbort = true;
  },
};
ipcMain.handle("milo:job-start", (_e, goal: string, opts?: { approved?: boolean }) => jobs.start(String(goal ?? ""), { approved: !!opts?.approved }));
ipcMain.handle("milo:job-resume", (_e, approve?: boolean) => jobs.resume(!!approve));
ipcMain.handle("milo:job-stop", () => jobs.stop());
// Pause Milo: really stops him (no screen, no listening, nothing running) until it's turned back on.
ipcMain.handle("milo:pause-get", () => pauseState());
ipcMain.handle("milo:pause-set", (_e, on: boolean, minutes?: number) =>
  setPause(!!on, Number(minutes) || 0, () => {
    jobs.stop();
    paperStop = true;
  })
);
ipcMain.handle("milo:job-last", () => resumable() ?? lastJob());
ipcMain.handle("milo:job-is", (_e, text: string) => isJob(String(text ?? "")));
// The student's saved details (filled into forms for them) and today's AI spend.
ipcMain.handle("milo:profile-get", () => getProfile());
ipcMain.handle("milo:profile-set", (_e, patch: Profile) => setProfile(patch ?? {}));
ipcMain.handle("milo:usage", () => usageToday());
// ---------- Google: Gmail, Calendar, Docs (sending and adding always wait for the student's yes) ----------
const gerr = (e: unknown) =>
  e instanceof GoogleNotConnected
    ? { ok: false as const, connect: true, text: googleStatus().ready ? "Connect your Google account first. Say connect Google." : "Google isn't set up in Milo yet." }
    : { ok: false as const, text: `Google had a problem: ${(e as Error).message.slice(0, 120)}` };
ipcMain.handle("milo:google-status", () => googleStatus());
ipcMain.handle("milo:google-connect", () => googleConnect());
ipcMain.handle("milo:google-disconnect", () => {
  googleDisconnect();
  return googleStatus();
});
ipcMain.handle("milo:prefs-get", () => prefs());
ipcMain.handle("milo:prefs-set", (_e, p: Partial<Prefs>) => setPrefs(p ?? {}));
ipcMain.handle("milo:google-calendar", async (_e, days: number, range: string) => {
  try {
    return { ok: true, text: sayCalendar(await calendarUpcoming(Number(days) || 7), String(range || "this week")) };
  } catch (e) {
    return gerr(e);
  }
});
ipcMain.handle("milo:google-mail", async () => {
  try {
    return { ok: true, text: sayMail(await gmailUnread(8)) };
  } catch (e) {
    return gerr(e);
  }
});
ipcMain.handle("milo:google-doc", async (_e, title: string, text?: string) => {
  try {
    const d = await docsCreate(String(title || "Untitled"), String(text ?? ""));
    void shell.openExternal(d.url);
    did({ kind: "doc", title: `Made a Google Doc: ${String(title || "Untitled")}`, link: d.url, noUndo: "Milo can't delete Google Docs. Open it and move it to the trash if you don't want it." });
    return { ok: true, text: `Made your Google Doc "${title}" and opened it.`, url: d.url, link: d.url, linkLabel: "Open doc" };
  } catch (e) {
    return gerr(e);
  }
});
/** Draft only. Sending is a separate call, after the student's yes. */
ipcMain.handle("milo:google-draft", async (_e, request: string) => {
  try {
    const r = await composeEmail(String(request));
    if (!r.ok) return { ok: false, text: r.text };
    if (!r.data.found) return { ok: false, needAddress: r.data.to, text: `I couldn't find ${r.data.to}'s email. What's their address?` };
    const d = await gmailDraft(r.data);
    draftEntries.set(d.draftId, did({ kind: "email_draft", title: `Wrote an email to ${r.data.to}: "${r.data.subject}" (in your drafts)`, link: d.link, undo: { type: "draft_delete", data: { draftId: d.draftId } } }));
    return { ok: true, draftId: d.draftId, link: d.link, linkLabel: "Open draft", to: r.data.to, subject: r.data.subject, body: r.data.body, text: `I wrote an email to ${r.data.to}, subject "${r.data.subject}". It's in your drafts. Want me to send it?` };
  } catch (e) {
    return gerr(e);
  }
});
const draftEntries = new Map<string, string>(); // draft id -> timeline entry (sending it makes it un-undoable)
// ---------- Papers: plan, real sources, written live into a Google Doc ----------
let paperRunning = false;
let paperStop = false;
ipcMain.handle("milo:paper-stop", () => (paperStop = true));
ipcMain.handle("milo:paper", async (_e, request: string, studentName?: string) => {
  const ask = parsePaperAsk(String(request ?? ""));
  if (!ask) return { ok: false, text: "Tell me what to write, like “write a 3 page paper on the causes of World War 1.”" };
  if (!ask.topic) return { ok: false, needTopic: true, text: "Sure. What's it about?" };
  if (paperRunning) return { ok: false, text: "I'm already writing one. Give me a minute." };
  if (!googleStatus().connected) return { ok: false, connect: true, text: "Connect your Google account first so I can write it in Google Docs. Say connect Google." };
  paperRunning = true;
  paperStop = false;
  let opened = false;
  const send = (p: unknown) => {
    overlay?.webContents.send("milo:paper-progress", p);
    toHome("milo:paper-progress", p);
  };
  try {
    // the class goes in the MLA header only if they named it (classFor falls back to the active class otherwise)
    const named = classFor(String(request));
    const cls = named && [named.name, named.code].some((w) => w && String(request).toLowerCase().includes(w.toLowerCase().split(/\s+/)[0])) ? named : null;
    const r = await writePaper(ask, {
      course: cls?.name,
      name: studentName ? String(studentName).slice(0, 60) : undefined,
      aborted: () => paperStop,
      emit: (p) => {
        send(p);
        if (p.url && !opened) {
          opened = true;
          void ext("new_tab", { url: p.url }, 15000).catch(() => shell.openExternal(p.url!));
        }
      },
    });
    did({ kind: "doc", title: `${r.outline ? "Outlined" : "Wrote"} a ${ask.kind}: ${r.title}`, detail: `${r.words ? `${r.words} words, ` : ""}${r.sources} sources, ${ask.style}`, link: r.url, noUndo: "Milo can't delete Google Docs. Move it to the trash in Google Docs if you don't want it." });
    track("paper_done", { words: r.words, target: ask.words, sources: r.sources, style: ask.style, outline: r.outline });
    const short = r.words && r.words < ask.words * 0.8;
    return {
      ok: true,
      url: r.url,
      link: r.url,
      linkLabel: "Open paper",
      text: r.outline
        ? `Your outline for "${r.title}" is in Google Docs, with ${r.sources} sources. Want to start the intro together?`
        : `Done. "${r.title}" is in your Google Docs: about ${r.words} words, ${r.sources} real sources, ${ask.style} format${short ? ". It came out a little short, so say make it longer if you need more" : ""}. Read it over and make it yours.`,
    };
  } catch (e) {
    send({ stage: "error", text: (e as Error).message });
    if (e instanceof GoogleNotConnected) return gerr(e);
    captureError(e, "paper");
    return { ok: false, text: `I hit a problem writing it: ${(e as Error).message.slice(0, 120)}` };
  } finally {
    paperRunning = false;
  }
});
ipcMain.handle("milo:google-send", async (_e, draftId: string) => {
  try {
    await gmailSendDraft(String(draftId));
    const entry = draftEntries.get(String(draftId));
    if (entry) activity.update(entry, { kind: "email_sent", title: activity.list(300).find((x) => x.id === entry)?.title.replace(/^Wrote an email/, "Sent an email").replace(/ \(in your drafts\)$/, "") ?? "Sent an email", undo: undefined, noUndo: "Sent emails can't be unsent.", link: "https://mail.google.com/mail/u/0/#sent" });
    else did({ kind: "email_sent", title: "Sent an email", noUndo: "Sent emails can't be unsent.", link: "https://mail.google.com/mail/u/0/#sent" });
    return { ok: true, text: "Sent!", link: "https://mail.google.com/mail/u/0/#sent", linkLabel: "View in Gmail" };
  } catch (e) {
    return gerr(e);
  }
});
ipcMain.handle("milo:google-event-parse", async (_e, request: string) => {
  const r = await parseEvent(String(request)).catch((e) => ({ ok: false as const, text: (e as Error).message }));
  if (!r.ok) return { ok: false, text: r.text };
  const ev = { title: r.data.title, start: r.data.start, end: r.data.end || undefined, where: r.data.where || undefined };
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(ev.start) ? `${ev.start}T12:00` : ev.start);
  const when = isNaN(d.getTime()) ? ev.start : /^\d{4}-\d{2}-\d{2}$/.test(ev.start) ? d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" }) : d.toLocaleString("en-US", { weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return { ok: true, ev, text: `Add "${ev.title}" on ${when}${ev.where ? ` at ${ev.where}` : ""} to your calendar?` };
});
ipcMain.handle("milo:google-event-add", async (_e, ev: { title: string; start: string; end?: string; where?: string }) => {
  try {
    const r = await calendarAdd(ev);
    did({ kind: "calendar", title: `Added "${ev.title}" to your calendar`, detail: ev.start, link: r.link || undefined, undo: r.id ? { type: "calendar_delete", data: { id: r.id } } : undefined });
    return { ok: true, text: "Added to your calendar.", link: r.link || "https://calendar.google.com/calendar/r", linkLabel: "View in Calendar" };
  } catch (e) {
    return gerr(e);
  }
});
// Calendar feeds (any LMS): fetched here, not in the page, so no browser blocks it.
async function fetchFeed(url: string) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { accept: "text/calendar, */*" } });
    const text = await res.text();
    if (!res.ok || !/BEGIN:VCALENDAR/.test(text)) return { ok: false as const, text: res.ok ? "That link isn't a calendar feed." : `The feed said ${res.status}.` };
    return { ok: true as const, text };
  } catch (e) {
    return { ok: false as const, text: (e as Error).message };
  }
}
ipcMain.handle("milo:feed-fetch", (_e, url: string) => fetchFeed(String(url ?? "")));
// Grade forecaster: "what do I need on the final for a B in stats?"
ipcMain.handle("milo:forecast", (_e, q: { course: string; letter: string; exam?: string; portal?: string; fresh?: boolean }) =>
  askForecast(q, {
    doTask: (t) => doTask(t),
    pageText: async () => (bridgeConnected() ? ((await ext("snapshot", {}, 8000).catch(() => null)) as { text?: string } | null)?.text ?? null : null),
  })
);
ipcMain.handle("milo:final-weight", (_e, course: string, weight: number) => setFinalWeight(String(course), Number(weight)));
// Milo's own gradebook (for classes where D2L doesn't post grades)
ipcMain.handle("milo:grade-score", (_e, q: { course: string; name: string; earned: number; possible?: number }) => addScore(String(q.course), String(q.name), Number(q.earned), Number(q.possible) || 100));
ipcMain.handle("milo:grade-now", async (_e, course: string, portal?: string) => {
  // D2L's own number first (exact), then Milo's gradebook
  if (portal) {
    try {
      const c = d2lMatch(String(course), await d2lCourses(portal));
      const d = c ? await d2lSheet(portal, c) : null;
      bb("d2l", "grade_now", { course, matched: c?.short ?? null, current: d?.sheet.current_percent ?? null });
      if (d?.sheet.current_percent != null) return { ok: true, text: `You've got a ${d.sheet.current_percent}% in ${d.sheet.course} right now.` };
    } catch (e) {
      bb("d2l", "grade_now_failed", { error: (e as Error).message, signin: e instanceof SignInNeeded });
      if (e instanceof SignInNeeded) return { ok: false, signin: true, text: "Your D2L sign-in ran out." };
    }
  }
  return gradeNow(String(course));
});
// D2L's calendar, read directly: everything due, every class, in about a second (no AI)
// D2L sign-in: Chrome's first (no Milo login), Milo's own second. The renderer uses these to fix a signed-out state.
ipcMain.handle("milo:d2l-check", (_e, portal: string) => d2lCheck(String(portal ?? "")));
ipcMain.handle("milo:d2l-feed-url", (_e, portal: string) => calendarFeedUrl(String(portal ?? "")).catch(() => null));
ipcMain.handle("milo:d2l-subscribe-url", (_e, portal: string) => subscribePageUrl(String(portal ?? "")).catch(() => null));
ipcMain.handle("milo:d2l-open-chrome", async (_e, url: string) => {
  const u = /^https?:\/\//.test(String(url)) ? String(url) : `https://${url}`;
  try {
    await ext("new_tab", { url: u }, 15000);
    return true;
  } catch {
    await openUrl(u).catch(() => {});
    return false;
  }
});
ipcMain.handle("milo:d2l-due", async (_e, portal: string) => {
  try {
    return { ok: true as const, items: await d2lDue(String(portal)) };
  } catch (e) {
    return { ok: false as const, signin: e instanceof SignInNeeded, text: (e as Error).message };
  }
});
ipcMain.handle("milo:syllabus", async (_e, course: string) => {
  // whatever's on screen: a syllabus page in Chrome (text) and/or a PDF (screenshot)
  const front = await frontApp().catch(() => "");
  const page = bridgeConnected() && /Google Chrome/i.test(front) ? ((await ext("snapshot", {}, 8000).catch(() => null)) as { text?: string } | null) : null;
  const cap = await captureScreen();
  return readSyllabus(String(course ?? ""), { pageText: page?.text && page.text.length > 200 ? page.text : undefined, jpeg: cap.ok ? toJpeg(cap.shot.full, 1568).b64 : undefined });
});
// Exam-proof mode: a practice test like the real one, from what this class covered.
ipcMain.handle("milo:exam", async (_e, q: { course: string; kind?: string; extra?: string }) => {
  const r = await makeExam(String(q?.course ?? ""), String(q?.kind ?? "exam"), String(q?.extra ?? ""));
  if (!r.ok) return { ok: false, text: r.text };
  return { ok: true, topic: r.data.topic, questions: (r.data.questions ?? []).filter((x) => x?.q && Array.isArray(x.choices) && x.choices.length === 4) };
});
/** "Connect my calendar": take the feed link the student just copied. */
ipcMain.handle("milo:feed-connect", async (_e, given?: string) => {
  const raw = String(given || clipboard.readText() || "").trim();
  const url = feedUrl(raw);
  if (!url) return { ok: false as const, reason: "no_link" as const };
  const r = await fetchFeed(url);
  return r.ok ? { ok: true as const, url, text: r.text } : { ok: false as const, reason: "bad_feed" as const, text: r.text };
});
/** One computer task, start to finish (instant commands, then the web helper, then screen mode).
 *  The job engine (jobs.ts) calls this for each step of a long task. */
async function doTask(task: string) {
  if (taskRunning) {
    // A new command replaces the old one (like a person would): stop it, then do this.
    taskAbort = true;
    bb("task", "replaced", { task });
    for (let i = 0; i < 40 && taskRunning; i++) await new Promise((r) => setTimeout(r, 100));
    if (taskRunning) return { ok: false, text: "I'm still finishing the last thing. Try again in a second." };
  }
  taskRunning = true;
  taskAbort = false;
  // Milo must never hold the keyboard while he works, or his typing lands in his own window.
  overlay?.setFocusable(false);
  overlay?.blur();
  globalShortcut.register("Escape", () => (taskAbort = true));
  const history: string[] = [];

  // 1) Instant commands (no AI round trip): open apps, sites, tabs, searches.
  const quick = plan(task);
  let newTabJustOpened = false;
  try {
    for (const q of quick.steps) {
      if (taskAbort) return { ok: true, status: "stopped", text: "Stopped!" };
      sendStep({ say: q.say, action: q.kind === "app" || q.kind === "download" || q.kind === "folder" ? "open_app" : q.kind === "url" ? "open_url" : "key", point: null });
      if (q.kind === "folder") {
        await openFolder(q.folder);
        history.push(`Opened the ${q.folder} folder in Finder`);
        newTabJustOpened = false;
      } else if (q.kind === "download") {
        const name = await openLatestDownload();
        history.push(`Opened the newest download: ${name}`);
        newTabJustOpened = false;
      } else if (q.kind === "app") {
        const wasOpen = await isRunning(resolveApp(q.app)).catch(() => true); // already open = Undo must not quit it
        const real = await openApp(q.app);
        // Check it actually came to the front; if not, bring it forward once more.
        const same = (f: string) => f.toLowerCase().includes(real.toLowerCase().replace(/^(microsoft|google) /, "").split(" ")[0]);
        let front = await frontApp().catch(() => "");
        if (!same(front)) {
          await activateApp(real);
          front = await frontApp().catch(() => "");
        }
        bb("task", "verify", { kind: "open", app: real, ok: same(front), front });
        did({ kind: "app", title: `Opened ${real}`, ...(wasOpen ? { noUndo: `${real} was already open.` } : { undo: { type: "app_quit", data: { app: real } } }) });
        history.push(`Opened the ${q.app} app`);
        newTabJustOpened = false;
      } else if (q.kind === "url") {
        if (newTabJustOpened) {
          // Use the empty tab we just made instead of opening another one.
          await pressKeys("cmd+l");
          await typeText(q.url);
          await pressKeys("enter");
          await sleep(1300);
        } else {
          await openUrl(q.url);
        }
        history.push(`Opened ${q.url} in the browser`);
        newTabJustOpened = false;
      } else if (q.kind === "type") {
        await sleep(250);
        await typeText(q.text);
        history.push(`Typed "${q.text.slice(0, 80)}"`);
        newTabJustOpened = false;
      } else if (q.kind === "quit") {
        const real = await quitApp(q.app);
        const still = await isRunning(real);
        bb("task", "verify", { kind: "quit", app: real, ok: !still });
        // Never claim it closed when it didn't (usually a "save changes?" box is holding it open).
        if (still) throw new Error(`${real.replace(/^Google |^Microsoft /, "")} is still open. It might be asking you to save something.`);
        history.push(`Closed the ${q.app} app`);
        newTabJustOpened = false;
      } else {
        if (q.browser) await ensureBrowser();
        // Keys go to the app you mean: make the browser the active app first (not just its window).
        const fr = await frontApp().catch(() => "");
        if (q.browser && fr) await activateApp(fr);
        await pressKeys(q.keys);
        history.push(`Pressed ${q.keys} (${q.say})`);
        newTabJustOpened = q.keys === "cmd+t";
        await sleep(q.keys === "cmd+n" ? 450 : 150);
      }
    }
  } catch (err) {
    taskRunning = false;
    overlay?.setFocusable(true);
    globalShortcut.unregister("Escape");
    return { ok: false, text: (err as Error).message };
  }
  if (quick.steps.length) {
    // Hand the rest back to the renderer: it decides if it's homework ("…and solve the problem")
    // or more computer work ("…and write a poem").
    taskRunning = false;
    overlay?.setFocusable(true);
    globalShortcut.unregister("Escape");
    return { ok: true, status: "quick", text: "", rest: quick.rest, did: history };
  }

  let lastClick: { x: number; y: number } | null = null; // screen point of the previous action if it was a click
  let typeTarget: { x: number; y: number } | null = null; // last place he clicked (to refocus before typing)
  let lastSig = ""; // the previous action, to catch loops ("open Chrome", "open Chrome", "open Chrome"...)
  let stuck = 0;
  try {
    // 2) Web tasks with the Chrome extension: read the page and use real elements (fast, no screenshots).
    const front = await frontApp().catch(() => "");
    const webby = /\b(chrome|browser|website|site|tab|search|google|youtube|chatgpt|chat gpt|gmail|amazon|reddit|wikipedia|online|web|internet|d2l|canvas|quizlet|espn)\b|\.(com|org|edu|net|io|ai)\b/i.test(task);
    if (bridgeConnected() && (/Google Chrome/i.test(front) || webby)) {
      if (!/Google Chrome/i.test(front)) {
        await openApp("Google Chrome");
        history.push("Opened Google Chrome");
      }
      const wa = screen.getPrimaryDisplay().workArea;
      bb("task", "web_mode", { task });
      const w = await runWebTask(
        task,
        history,
        (st) => sendStep({ say: st.say, action: st.action, point: st.screenPt ? { x: st.screenPt.x - wa.x, y: st.screenPt.y - wa.y } : null }),
        () => taskAbort,
        pressKeys
      );
      if (w.status === "done" || w.status === "ask" || w.status === "stopped") return { ok: true, status: w.status, text: w.text, replayed: "replayed" in w ? !!w.replayed : false };
      // a sign-in, 2-step code or "are you human" check: the student's part
      if (w.status === "blocked") return { ok: true, status: "blocked", text: w.text };
      if (w.status === "error") return { ok: false, text: w.text };
      bb("task", "web_mode_handoff_to_screen", { why: w.text });
    }

    // 3) Screen mode: look at a screenshot, plan several steps, do them back to back, look again.
    for (let round = 0; round < 10; round++) {
      if (taskAbort) return { ok: true, status: "stopped", text: "Stopped!" };
      const cap = await captureScreen();
      if (!cap.ok) return cap;
      const { shot } = cap;
      const small = toJpeg(shot.full, 1568);
      const k = small.k * shot.pxPerPt; // screenshot px per screen point
      const r = await nextActions(small.b64, small.size, task, history);
      if (taskAbort) return { ok: true, status: "stopped", text: "Stopped!" };
      if (!r.ok) return r;
      bb("task", "plan", { round, steps: r.data.map((a) => `${a.action}${a.keys ? " " + a.keys : ""}${a.app ? " " + a.app : ""}${a.text && a.action === "type" ? " \"" + a.text.slice(0, 30) + "\"" : ""}`) });

      for (let si = 0; si < r.data.length; si++) {
        const a = r.data[si];
        if (taskAbort) return { ok: true, status: "stopped", text: "Stopped!" };
        // Screen point (for the click) and overlay point (for Milo to hop to).
        const screenPt =
          a.x !== undefined && a.y !== undefined ? { x: shot.bounds.x + a.x / k, y: shot.bounds.y + a.y / k } : null;
        const overlayPt = screenPt ? { x: screenPt.x - shot.workArea.x, y: screenPt.y - shot.workArea.y } : null;

        if (a.action === "done") return { ok: true, status: "done", text: a.text || a.say || "Done." };
        if (a.action === "ask") return { ok: true, status: "ask", text: a.text || a.say || "Should I go ahead?" };

        // Don't repeat the exact same non-click action from the last round: it already happened.
        const sig = `${a.action}|${a.app ?? ""}|${a.url ?? ""}|${a.keys ?? ""}|${a.text ?? ""}`;
        if (a.action !== "click" && a.action !== "double_click" && a.action !== "wait" && a.action !== "key" && sig === lastSig) {
          stuck++;
          history.push(`(You just did "${a.action}${a.app ? " " + a.app : ""}" already and it worked. Don't repeat it; do the next step or a different approach.)`);
          if (stuck >= 3) return { ok: false, text: "I got stuck repeating myself, so I stopped. Can you say it a bit differently?" };
          break;
        }
        lastSig = sig;

        // Don't click the same spot twice in a row: the first click already worked.
        if ((a.action === "click" || a.action === "double_click") && screenPt && lastClick &&
            Math.hypot(screenPt.x - lastClick.x, screenPt.y - lastClick.y) < 25) {
          history.push("(Skipped a repeat click on the same spot: it's already selected. Do the next thing, e.g. type.)");
          lastClick = null;
          continue;
        }

        sendStep({ say: a.say, action: a.action, point: overlayPt });
        if (overlayPt) await sleep(260); // a quick hop so you can see where he's about to click
        if (taskAbort) return { ok: true, status: "stopped", text: "Stopped!" };

        overlay?.setIgnoreMouseEvents(true, { forward: true }); // never click on Milo himself
        lastClick = a.action === "click" || a.action === "double_click" ? screenPt : null;
        let changesScreen = false;
        switch (a.action) {
          case "open_app":
            if (!a.app) throw new Error("No app name");
            history.push(`Opened ${await openApp(a.app)} (it's now in front with a window)`);
            changesScreen = true;
            break;
          case "open_url":
            if (!a.url || !/^https?:\/\//.test(a.url)) throw new Error("Bad URL");
            await openUrl(a.url);
            history.push(`Opened ${a.url}`);
            changesScreen = true;
            break;
          case "click":
          case "double_click":
            if (!screenPt) throw new Error("Click without a point");
            await click(screenPt.x, screenPt.y, a.action === "double_click" ? 2 : 1);
            typeTarget = screenPt;
            history.push(`${a.action === "click" ? "Clicked" : "Double-clicked"} at (${a.x}, ${a.y}): ${a.say}`);
            await sleep(180);
            break;
          case "type": {
            sendStep({ say: a.say, action: "typing", point: null });
            // If Milo's own window somehow has the keyboard, click the box again before typing.
            const front = await frontApp();
            if (/^(Electron|Milo)$/i.test(front) && typeTarget) {
              await click(typeTarget.x, typeTarget.y);
              await sleep(200);
            }
            await typeText(a.text ?? "");
            history.push(`Typed "${(a.text ?? "").slice(0, 80)}"`);
            break;
          }
          case "key":
            await pressKeys(a.keys ?? "");
            history.push(`Pressed ${a.keys}`);
            changesScreen = /^(enter|return|cmd\+(t|n|w|l|tab)|cmd\+shift\+t|ctrl\+tab)$/i.test((a.keys ?? "").trim());
            await sleep(changesScreen ? 500 : 120);
            break;
          case "scroll":
            await pressKeys(a.direction === "up" ? "pageup" : "pagedown");
            history.push(`Scrolled ${a.direction ?? "down"}`);
            changesScreen = true;
            break;
          case "wait":
            await sleep(1000);
            history.push("Waited");
            break;
        }
        if (changesScreen) {
          // Keyboard-only steps after it (type the URL, press enter, cmd+n...) don't depend on where things
          // are on screen, so keep going. Anything that clicks a spot needs a fresh look first.
          const rest = r.data.slice(si + 1);
          if (rest.length && rest.every((x) => ["type", "key", "wait", "done", "ask"].includes(x.action))) {
            await sleep(a.action === "open_app" || a.action === "open_url" ? 900 : 450);
            continue;
          }
          break; // the rest of the plan was made for the old screen: look again
        }
      }
      await sleep(300); // let the screen settle before the next look
    }
    return { ok: true, status: "done", text: "I took a bunch of steps. Check if that's what you wanted!" };
  } catch (err) {
    return { ok: false, text: (err as Error).message };
  } finally {
    taskRunning = false;
    overlay?.setFocusable(true);
    globalShortcut.unregister("Escape");
  }
}

// ---------- worksheet sweep -------------------------------------------------------------
ipcMain.handle("milo:sweep-plan", async (_e, skip: string[]) => {
  const cap = await captureScreen();
  if (!cap.ok) return cap;
  const { shot } = cap;
  const small = toJpeg(shot.full, 1568);
  const k = small.k * shot.pxPerPt;
  const r = await sweepPlan(small.b64, small.size, skip ?? []);
  if (!r.ok) return r;
  const { bounds, workArea } = shot;
  const toOverlay = (x: number, y: number) => ({ x: bounds.x + x / k - workArea.x, y: bounds.y + y / k - workArea.y });
  const items = (r.data.questions ?? [])
    .filter((q) => q && q.box && q.answer)
    .map((q) => {
      const tl = toOverlay(q.box.x, q.box.y);
      const hasPt = q.input?.kind !== "none" && q.input?.x !== undefined && q.input?.y !== undefined;
      const inOverlay = hasPt ? toOverlay(q.input.x!, q.input.y!) : null;
      return {
        label: String(q.label ?? "").slice(0, 8),
        work: q.work ?? "",
        answer: q.answer,
        box: { x: tl.x, y: tl.y, width: q.box.width / k, height: q.box.height / k },
        kind: hasPt ? q.input.kind : "none",
        point: inOverlay, // overlay coords (for Milo to hop to)
        screen: hasPt ? { x: bounds.x + q.input.x! / k, y: bounds.y + q.input.y! / k } : null, // for the click
      };
    });
  return { ok: true, items, more: !!r.data.more_below };
});

ipcMain.handle(
  "milo:sweep-fill",
  async (_e, item: { kind: string; screen: { x: number; y: number } | null; answer: string }) => {
    if (!item.screen) return { ok: true };
    overlay?.setFocusable(false);
    overlay?.blur();
    overlay?.setIgnoreMouseEvents(true, { forward: true });
    try {
      await click(item.screen.x, item.screen.y);
      if (item.kind === "type") {
        await sleep(150);
        await pressKeys("cmd+a"); // replace anything already in the box
        await typeText(item.answer);
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, text: (err as Error).message };
    } finally {
      overlay?.setFocusable(true);
    }
  }
);

ipcMain.handle("milo:scroll-page", async () => {
  overlay?.setFocusable(false);
  overlay?.blur();
  try {
    await pressKeys("escape"); // leave any text box so the page itself scrolls
    await pressKeys("pagedown");
    await sleep(700);
    return { ok: true };
  } catch (err) {
    return { ok: false, text: (err as Error).message };
  } finally {
    overlay?.setFocusable(true);
  }
});

// ---------- watch me work ------------------------------------------------------------------
let lastThumb: Buffer | null = null;

/** Tiny grayscale fingerprint of the screen, to skip checks when nothing changed. */
function thumb(img: Electron.NativeImage) {
  return img.resize({ width: 64, height: 40, quality: "good" }).toBitmap();
}
function changed(a: Buffer | null, b: Buffer) {
  if (!a || a.length !== b.length) return true;
  let diff = 0;
  for (let i = 0; i < b.length; i += 4) diff += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
  return diff / (b.length / 4) > 2.5; // average change per pixel
}

ipcMain.handle("milo:watch-check", async (_e, force: boolean) => {
  const cap = await captureScreen();
  if (!cap.ok) return cap;
  const { shot } = cap;
  const t = thumb(shot.full);
  if (!force && !changed(lastThumb, t)) return { ok: true, changed: false };
  lastThumb = t;
  const small = toJpeg(shot.full, 1568);
  const r = await watchCheck(small.b64, small.size);
  if (!r.ok) return r;
  const k = small.k * shot.pxPerPt;
  const b = r.data.box;
  const box =
    r.data.found_mistake && b
      ? {
          x: shot.bounds.x + b.x / k - shot.workArea.x,
          y: shot.bounds.y + b.y / k - shot.workArea.y,
          width: b.width / k,
          height: b.height / k,
        }
      : null;
  return { ok: true, changed: true, mistake: r.data.found_mistake && (r.data.confidence ?? 0) >= 0.75 && !!box, box, hint: r.data.hint };
});
ipcMain.on("milo:watch-reset", () => (lastThumb = null));

// ---------- quiz -----------------------------------------------------------------------------
ipcMain.handle("milo:quiz", async (_e, focus: string) => {
  const cap = await captureScreen();
  if (!cap.ok) return cap;
  const small = toJpeg(cap.shot.full, 1568);
  const r = await makeQuiz(small.b64, small.size, 6, focus || "");
  if (!r.ok) return r;
  const questions = (r.data.questions ?? [])
    .filter((q) => q && Array.isArray(q.choices) && q.choices.length >= 2)
    .map((q) => ({ ...q, choices: q.choices.slice(0, 4), correct: Math.max(0, Math.min(3, Math.round(q.correct))) }));
  return { ok: true, topic: r.data.topic || "Quiz", questions };
});

// ---------- daily brief ------------------------------------------------------------------------
ipcMain.handle("milo:brief", async (_e, dataUrl: string, pageText?: string) => {
  // The portal snapshot arrives as a big PNG: shrink it to a JPEG the model reads well.
  const img = nativeImage.createFromDataURL(String(dataUrl));
  const b64 = img.isEmpty() ? String(dataUrl).replace(/^data:image\/\w+;base64,/, "") : toJpeg(img, 1800).b64;
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  return readBrief(b64, today, typeof pageText === "string" ? pageText.slice(0, 20000) : "");
});

// ---------- research ----------------------------------------------------------------
let researchAbort: AbortController | null = null;
ipcMain.handle("milo:research", async (_e, question: string, history?: { q: string; a: string }[]) => {
  researchAbort?.abort();
  researchAbort = new AbortController();
  const h = Array.isArray(history) ? history.filter((t) => t && typeof t.q === "string").map((t) => ({ q: String(t.q).slice(0, 2000), a: String(t.a ?? "").slice(0, 4000) })) : [];
  await research(question, (ev) => overlay?.webContents.send("milo:research-event", ev), researchAbort.signal, h);
  return true;
});
ipcMain.on("milo:research-stop", () => researchAbort?.abort());

let buildAbort: AbortController | null = null;
ipcMain.handle("milo:build", async (_e, request: string) => {
  buildAbort?.abort();
  buildAbort = new AbortController();
  await buildTool(request, (ev) => overlay?.webContents.send("milo:build-event", ev), buildAbort.signal);
  return true;
});
ipcMain.on("milo:build-stop", () => buildAbort?.abort());
ipcMain.on("milo:open-url", (_e, url: string) => {
  if (/^https?:\/\//.test(url)) openUrl(url);
});

ipcMain.handle("milo:check", (_e, lesson: TeachResult, answer: string) => checkAnswer(lesson, answer));
ipcMain.handle("milo:practice", (_e, lesson: TeachResult) => makePractice(lesson));
ipcMain.handle("milo:stt", async (_e, audio: ArrayBuffer) => {
  const clip = saveClip(audio); // so we can hear exactly what Milo heard
  const r = await transcribe(audio);
  bb("ears", "transcript", { clip, ok: r.ok, text: r.text });
  return r;
});

// Logs from the overlay (what the mic did, what Milo decided, when he spoke).
ipcMain.on("milo:log", (_e, src: string, ev: string, data: Record<string, unknown>) => {
  if (typeof src === "string" && typeof ev === "string") bb(src.slice(0, 20), ev.slice(0, 60), data && typeof data === "object" ? data : {});
});
// "Milo, that was wrong" / Cmd+Shift+B: mark the moment so it's easy to find.
ipcMain.handle("milo:log-flag", (_e, note?: string) => {
  bb("user", "FLAG", { note: typeof note === "string" ? note : "" });
  return { file: LOG_FILE, dir: LOG_DIR };
});
ipcMain.on("milo:open-logs", () => shell.showItemInFolder(LOG_FILE));

// ---------- smart ears (Deepgram Flux) + free voice rendered to audio ----------
onFlux((ev) => overlay?.webContents.send("milo:flux-event", ev));
ipcMain.handle("milo:flux-available", () => fluxAvailable());
ipcMain.handle("milo:flux-open", () => openFlux());
ipcMain.on("milo:flux-audio", (_e, pcm: ArrayBuffer) => {
  if (pcm instanceof ArrayBuffer || ArrayBuffer.isView(pcm)) sendAudio(pcm instanceof ArrayBuffer ? pcm : (pcm as Uint8Array).buffer as ArrayBuffer);
});
ipcMain.on("milo:flux-force", () => forceEndTurn());
ipcMain.on("milo:flux-close", () => closeFlux());
ipcMain.on("milo:save-clip", (_e, wav: ArrayBuffer, note?: string) => {
  if (wav instanceof ArrayBuffer) bb("ears", "clip", { clip: saveClip(wav), note: typeof note === "string" ? note.slice(0, 200) : "" });
});
ipcMain.handle("milo:bridge-status", () => bridgeConnected());

registerLibrary();
// ---------- "What Milo did": the timeline, and how each kind of thing gets undone ----------
registerActivity();
// ---------- Home base: the same agent as the frog, in a real window ----------
ipcMain.handle("milo:open-home", () => void openHome(isDev));
// typed in Home base -> the frog's command router (one agent); Milo's words come back as echoes
ipcMain.on("milo:home-route", (_e, text: string) => overlay?.webContents.send("milo:route-text", String(text ?? "").slice(0, 4000)));
ipcMain.on("milo:home-action", (_e, a: unknown) => overlay?.webContents.send("milo:home-action", a));
ipcMain.on("milo:home-talk", () => !isPaused() && overlay?.webContents.send("milo:talk"));
ipcMain.on("milo:echo", (_e, kind: string, payload: unknown) => toHome("milo:echo", { kind: String(kind), payload }));
let gradeCache: { at: number; portal: string; list: { name: string; grade: number | null }[] } | null = null;
ipcMain.handle("milo:home-grades", async (_e, portal: string, fresh?: boolean) => {
  const p = String(portal ?? "");
  if (!p) return [];
  if (!fresh && gradeCache && gradeCache.portal === p && Date.now() - gradeCache.at < 30 * 60e3) return gradeCache.list;
  try {
    const list = await Promise.all(
      (await d2lCourses(p))
        .filter((c) => !/ Lab$/.test(c.short))
        .map(async (c) => ({ name: c.short, grade: (await d2lSheet(p, c).catch(() => null))?.sheet.current_percent ?? null }))
    );
    gradeCache = { at: Date.now(), portal: p, list };
    bb("home", "grades", { n: list.length, known: list.filter((x) => x.grade != null).length });
    return list;
  } catch (e) {
    bb("home", "grades_failed", { error: (e as Error).message.slice(0, 100) });
    return gradeCache?.list ?? [];
  }
});
// Tester feedback: one tap, their words + the last few event names (never what they said or saw).
ipcMain.handle("milo:feedback", async (_e, message: string, kind?: string) => {
  const ok = await sendFeedback(String(message ?? ""), { email: account().email || undefined, kind: kind ? String(kind) : "feedback", recent: recentEvents() });
  bb("feedback", "sent", { ok, kind });
  return { ok, text: ok ? "Thanks! Jake will see that." : "I couldn't send that. Check your internet and try again." };
});
activity.onUndo("calendar_delete", async (d) => calendarDelete(String(d.id)));
activity.onUndo("draft_delete", async (d) => gmailDeleteDraft(String(d.draftId)));
activity.onUndo("memory_forget", async (d) => forget(String(d.fact)));
activity.onUndo("note_delete", async (d) => forgetLectureNote(String(d.noteId)));
activity.onUndo("classes_restore", async (d) => {
  const s = loadClasses();
  saveClasses({ classes: d.classes as Klass[], active: s.active });
});
// ---------- Classes follow D2L: same ids and colors (filed work stays put), D2L's real names ----------
ipcMain.handle("milo:classes-sync", async (_e, portal: string) => {
  try {
    const list = await d2lCourses(String(portal));
    if (!list.length) return { ok: false, changed: false };
    const before = loadClasses();
    const r = mergeD2l(before.classes, list, SUBJECT_WORDS, COLORS, (i) => `d2l${Date.now().toString(36)}${i}`);
    const changed = JSON.stringify(r.classes) !== JSON.stringify(before.classes);
    if (!changed) return { ok: true, changed: false, added: [], renamed: [] };
    saveClasses({ classes: r.classes, active: before.active });
    did({ kind: "classes", title: `Matched your classes to D2L${r.added.length ? ` (added ${r.added.join(", ")})` : ""}`, detail: r.renamed.map((x) => `${x.from} → ${x.to}`).join("\n"), undo: { type: "classes_restore", data: { classes: before.classes } } });
    bb("classes", "d2l_sync", { added: r.added.length, renamed: r.renamed.length });
    return { ok: true, changed: true, added: r.added, renamed: r.renamed, names: r.classes.map((c) => c.name) };
  } catch (e) {
    return { ok: false, changed: false, text: (e as Error).message };
  }
});
// ---------- Lecture listener: saved to disk every 2 minutes, transcribed with retries, notes after class ----------
ipcMain.handle("milo:lecture-file", (_e, lectureId: string, said: string) => fileLecture(String(lectureId), String(said ?? "")));
ipcMain.handle("milo:lecture-start", async (_e, said: string) => {
  const m = await startLecture(String(said ?? ""));
  if ("blocked" in m) {
    track("lecture_blocked", { why: m.blocked });
    return { id: "", course: m.course, startedAt: 0, blocked: m.blocked };
  }
  track("lecture_start", { course: !!m.course });
  return { id: m.id, course: m.course, startedAt: m.startedAt };
});
ipcMain.handle("milo:lecture-discard", () => {
  const r = discardLecture();
  if (r.ok) track("lecture_discarded", { remembered: r.remembered });
  return r;
});
ipcMain.handle("milo:lecture-chunk", (_e, id: string, n: number, wav: ArrayBuffer) => addChunk(String(id), Number(n), wav));
ipcMain.handle("milo:lecture-now", () => lectureNow());
ipcMain.handle("milo:lecture-stop", async () => {
  const r = await finishLecture();
  if (r.ok && r.noteId) {
    did({ kind: "doc", title: `Took notes on a lecture: ${r.title} (${r.minutes})`, detail: `${r.flashcards} flashcards${r.alerts ? `, ${r.alerts} things the professor flagged` : ""}`, undo: { type: "note_delete", data: { noteId: r.noteId } } });
    track("lecture_done", { cards: r.flashcards, alerts: r.alerts });
  } else track("lecture_failed", {});
  return r;
});
setTimeout(() => void finishLeftovers().catch(() => {}), 60e3); // a class that ended while Milo was closed or offline
activity.onUndo("app_quit", async (d) => {
  await quitApp(String(d.app));
});
onRemember((fact, how) =>
  did({ kind: "memory", title: how === "asked" ? `Remembered: ${fact}` : `Learned about you: ${fact}`, undo: { type: "memory_forget", data: { fact } } })
);
registerKit({
  captureJpeg: async () => {
    const cap = await captureScreen();
    return cap.ok ? toJpeg(cap.shot.full, 1568).b64 : null;
  },
  frontApp: () => frontApp(),
  pressKeys: (k) => pressKeys(k),
  setOverlayFocusable: (on) => overlay?.setFocusable(on),
});

// "Milo, look at my screen and find out when my next exam is": answer from the page text (Chrome) + a screenshot.
ipcMain.handle("milo:screen-ask", async (_e, question: string) => {
  const q = String(question ?? "").slice(0, 500);
  const front = await frontApp().catch(() => "");
  let page: { text?: string; url?: string; title?: string; canvasHeavy?: boolean } | null = null;
  if (bridgeConnected() && /Google Chrome|Electron|Milo/i.test(front)) {
    page = await ext("snapshot", { max: 20 }, 8000).catch(() => null);
  }
  const cap = await captureScreen();
  const jpeg = cap.ok ? toJpeg(cap.shot.full, 1568).b64 : undefined;
  if (!jpeg && !page?.text) return { ok: false, text: cap.ok ? "I couldn't see your screen." : cap.text };
  bb("screen", "ask", { q, front, usedPage: !!page?.text, url: page?.url });
  return askScreen(q, { jpeg, pageText: page?.canvasHeavy ? undefined : page?.text, url: page?.url, title: page?.title });
});
// "Start my homework": read the assignment that's open (page text + screenshot) and make a game plan.
ipcMain.handle("milo:gameplan", async (_e, hint: string) => {
  const front = await frontApp().catch(() => "");
  let page: { text?: string; url?: string; title?: string; canvasHeavy?: boolean } | null = null;
  if (bridgeConnected() && /Google Chrome/i.test(front)) page = await ext("snapshot", { max: 30 }, 8000).catch(() => null);
  const cap = await captureScreen();
  const jpeg = cap.ok ? toJpeg(cap.shot.full, 1568).b64 : undefined;
  if (!jpeg && !page?.text) return { ok: false, text: cap.ok ? "I couldn't see your screen." : cap.text };
  bb("homework", "plan_start", { front, usedPage: !!page?.text, url: page?.url });
  const r = await makeGamePlan({ hint: String(hint ?? "").slice(0, 300), jpeg, pageText: page?.canvasHeavy ? undefined : page?.text, url: page?.url, title: page?.title });
  if (r.ok) bb("homework", "plan", { found: r.data.found, title: r.data.title, steps: r.data.steps.length, minutes: r.data.total_minutes });
  return r;
});
ipcMain.handle("milo:mac-say", (_e, text: string) => macSpeak(String(text ?? "")));
ipcMain.handle("milo:hands-access", () =>
  process.platform === "darwin" ? systemPreferences.isTrustedAccessibilityClient(true) : true
);
// ---------- first-run setup: permissions ----------
const PANE: Record<string, string> = {
  mic: "Privacy_Microphone",
  screen: "Privacy_ScreenCapture",
  hands: "Privacy_Accessibility",
  automation: "Privacy_Automation",
};
const openPane = (kind: string) => shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${PANE[kind] ?? "Privacy"}`);
/** Which of the permissions Milo needs are on. */
ipcMain.handle("milo:perms", () => {
  if (process.platform !== "darwin") return { mic: true, screen: true, hands: true };
  return {
    mic: systemPreferences.getMediaAccessStatus("microphone") === "granted",
    screen: systemPreferences.getMediaAccessStatus("screen") === "granted",
    hands: systemPreferences.isTrustedAccessibilityClient(false),
  };
});
/** At startup: is everything Milo needs actually working? Problems are said up front, not mid-question. */
ipcMain.handle("milo:startup-check", async (_e, portal?: string) => {
  if (selfTestOn() || jobBenchOn()) return { problems: [] };
  const problems: { kind: string; text: string }[] = [];
  if (process.platform === "darwin") {
    const who = app.isPackaged ? "Milo" : "Terminal";
    if (systemPreferences.getMediaAccessStatus("screen") !== "granted") problems.push({ kind: "screen", text: `I can't see your screen. In System Settings, Privacy and Security, Screen Recording, turn on ${who}, then restart me.` });
    if (!systemPreferences.isTrustedAccessibilityClient(false)) problems.push({ kind: "hands", text: `I can't click or type for you. In System Settings, Privacy and Security, Accessibility, turn on ${who}.` });
    if (systemPreferences.getMediaAccessStatus("microphone") !== "granted") problems.push({ kind: "mic", text: `I can't hear you. In System Settings, Privacy and Security, Microphone, turn on ${who}.` });
  }
  if (portal) {
    const c = await d2lCheck(String(portal)).catch(() => ({ ok: false, signin: false, text: "" }));
    if (!c.ok && c.signin) problems.push({ kind: "d2l", text: "" }); // the renderer walks them through it (Chrome first)
  }
  bb("startup", "check", { problems: problems.map((p) => p.kind) });
  return { problems };
});
/** Turn one on: the system prompt if macOS still allows asking, otherwise the exact Settings page. */
ipcMain.handle("milo:perm-ask", async (_e, kind: string) => {
  if (process.platform !== "darwin") return true;
  bb("setup", "perm_ask", { kind });
  if (kind === "mic") {
    if (systemPreferences.getMediaAccessStatus("microphone") === "not-determined") return systemPreferences.askForMediaAccess("microphone");
    await openPane("mic");
  } else if (kind === "screen") {
    // asking for one tiny capture puts Milo in the Screen Recording list, so the student just flips the switch
    await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 16, height: 16 } }).catch(() => []);
    await openPane("screen");
  } else if (kind === "hands") {
    if (!systemPreferences.isTrustedAccessibilityClient(true)) await openPane("hands");
  } else if (kind === "automation") {
    // a harmless question to System Events triggers the "Milo wants to control…" prompt once
    await new Promise((r) => execFile("osascript", ["-e", 'tell application "System Events" to get name of first process'], () => r(null)));
  }
  return true;
});
/** Screen Recording only takes effect after a restart. */
ipcMain.handle("milo:relaunch", () => {
  bb("setup", "relaunch", {});
  app.relaunch();
  app.exit(0);
});

ipcMain.handle("milo:mic-access", async () => {
  if (process.platform !== "darwin") return true;
  if (systemPreferences.getMediaAccessStatus("microphone") === "granted") return true;
  return systemPreferences.askForMediaAccess("microphone");
});
ipcMain.handle("milo:tts", (_e, text: string, urgent?: boolean, around?: { previous?: string; next?: string }) => speak(text, !!urgent, around ?? {}));

// ---------- account + memory ----------
ipcMain.handle("milo:account", () => account());
ipcMain.handle("milo:account-send", (_e, email: string) => sendCode(email));
ipcMain.handle("milo:account-verify", async (_e, email: string, code: string) => {
  const r = await verifyCode(email, code);
  if (r.ok) {
    const id = userId();
    if (id) identify(id, account().email);
    await syncMemories();
  }
  return r;
});
ipcMain.handle("milo:account-signout", () => {
  signOut();
  track("sign_out");
  return account();
});
// Signed in from the browser link: catch up and tell the window.
onAccountChange(async () => {
  const id = userId();
  if (id) identify(id, account().email);
  await syncMemories();
  overlay?.webContents.send("milo:account-changed");
});
// ---------- lock-in mode ----------
ipcMain.handle("milo:focus-start", (_e, minutes: number) => {
  startFocus((st) => overlay?.webContents.send("milo:focus-state", st));
  const m = Math.max(5, Math.min(240, Math.round(Number(minutes) || 25)));
  track("lockin_start", { minutes: m });
  return planBlocks(m);
});
ipcMain.handle("milo:focus-stop", () => {
  stopFocus();
  return true;
});
ipcMain.handle("milo:focus-allow", (_e, label: string) => {
  allowForSession(String(label || "").slice(0, 40));
  return true;
});
ipcMain.handle("milo:focus-back", () => backToWork());
ipcMain.handle(
  "milo:focus-save",
  async (_e, s: { topic?: string; plannedMinutes: number; focusedSeconds: number; slips: number; longestStreakSeconds: number; completed: boolean; startedAt: string }) => {
    track("lockin_done", { minutes: Math.round(s.focusedSeconds / 60), slips: s.slips, completed: s.completed });
    if (!userId()) return false;
    const r = await rest("focus_sessions", {
      method: "POST",
      prefer: "return=minimal",
      body: {
        topic: s.topic?.slice(0, 60) || null,
        planned_minutes: Math.max(1, Math.min(600, Math.round(s.plannedMinutes))),
        focused_seconds: Math.max(0, Math.round(s.focusedSeconds)),
        slips: Math.max(0, Math.round(s.slips)),
        longest_streak_seconds: Math.max(0, Math.round(s.longestStreakSeconds)),
        completed: !!s.completed,
        started_at: s.startedAt,
      },
    });
    return !!r;
  }
);
ipcMain.handle("milo:memories", () => memories());
ipcMain.handle("milo:remember", async (_e, fact: string) => {
  await remember(String(fact ?? ""));
  bb("memory", "saved", { chars: String(fact ?? "").length });
  return true;
});
ipcMain.handle("milo:forget-all", async () => {
  await forgetAll();
  return true;
});
// Errors from Milo's window, so they reach crash reports too.
ipcMain.on("milo:renderer-error", (_e, err: { name?: string; message?: string; stack?: string }) => {
  const e = new Error(err?.message || "renderer error");
  e.name = err?.name || "Error";
  e.stack = err?.stack || e.stack;
  captureError(e, "renderer", { process: "renderer" });
});
ipcMain.on("milo:copy", (_e, text: string) => clipboard.writeText(text));
ipcMain.on("milo:set-character", (_e, desc: string) => setCharacter(desc));
ipcMain.on("milo:set-name", (_e, name: string) => setUserName(name));
ipcMain.on("milo:quit", () => app.quit());

// ---------- app lifecycle -----------------------------------------------------

/** Where the Chrome extension lives. Installed app: a writable copy in Milo's own folder (the app bundle is read-only). */
function extensionFolder() {
  if (!app.isPackaged) return path.join(app.getAppPath(), "extension");
  const src = path.join(process.resourcesPath, "extension");
  const dst = path.join(app.getPath("userData"), "Chrome Extension");
  try {
    fs.mkdirSync(dst, { recursive: true });
    for (const f of fs.readdirSync(src)) if (f !== "config.json") fs.copyFileSync(path.join(src, f), path.join(dst, f));
  } catch (e) {
    bb("bridge", "extension_copy_failed", { error: (e as Error).message });
  }
  return dst;
}
ipcMain.handle("milo:extension-folder", () => extensionFolder());

// Web pages shown in the research panel get no access to Milo's internals; links open in Chrome.
app.on("web-contents-created", (_e, contents) => {
  contents.on("will-attach-webview", (_ev, prefs) => {
    delete (prefs as { preload?: string }).preload;
    prefs.nodeIntegration = false;
    prefs.contextIsolation = true;
    prefs.sandbox = true;
  });
  if (contents.getType() === "webview") {
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//.test(url)) openUrl(url);
      return { action: "deny" };
    });
  }
});

app.whenReady().then(() => {
  startBridge(extensionFolder());
  registerNativeHost(binaryPath()); // so the Chrome Web Store version of the extension can find Milo
  if (process.platform === "darwin") app.dock?.hide();
  firstRunDefaults();
  // Let Milo's window use the microphone.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === "media"));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === "media");
  createOverlay();
  if (overlay) startSync(overlay); // class folders, classes and game plans follow you to any Mac you sign in on
  keepSignedIn(); // D2L / school login survives restarts
  if (overlay) startUpdates(overlay); // every fix reaches students on its own (installed app only)
  // `npm run test:milo`: drive Milo through his self-test, write the report, quit. (Sound muted so it runs quietly.)
  if (selfTestOn() && overlay) {
    const win = overlay;
    win.webContents.setAudioMuted(true);
    win.webContents.once("did-finish-load", () => void runSelfTest(win).finally(quitAfterTest));
  }
  // `npm run test:jobs`: the long-task bench (fake site, real jobs, scored).
  if (jobBenchOn() && overlay) {
    const win = overlay;
    win.webContents.setAudioMuted(true);
    win.webContents.once("did-finish-load", () =>
      void runJobBench({ start: jobs.start, resume: jobs.resume, stop: jobs.stop, connected: bridgeConnected }).finally(quitAfterBench)
    );
  }
  // Ready for an emailed sign-in link even if Milo restarted after sending it.
  void startCallbackServer();
  // Pick up where we left off: account, memories.
  const uid = userId();
  if (uid) identify(uid, account().email);
  void syncMemories();

  // Open Milo's chat from anywhere.
  globalShortcut.register("CommandOrControl+Shift+B", () => overlay?.webContents.send("milo:flag"));
  globalShortcut.register("CommandOrControl+Shift+M", () => {
    overlay?.webContents.send("milo:summon");
    overlay?.focus();
  });
  // Talk to Milo from anywhere.
  globalShortcut.register("CommandOrControl+Shift+H", () => void openHome(isDev));
  globalShortcut.register("CommandOrControl+Shift+Space", () => {
    if (isPaused()) return void openHome(isDev);
    overlay?.webContents.send("milo:talk");
  });
  // The magic button: Milo looks at your screen and teaches whatever you're stuck on.
  globalShortcut.register("CommandOrControl+Shift+Y", () => {
    overlay?.webContents.send("milo:teach-screen");
  });

  // The frog in the menu bar: show/hide, keys, logs, start at login, updates, quit.
  const notify = (body: string) => body && new Notification({ title: "Milo", body }).show();
  const tray = createTray({
    overlay: () => overlay,
    talk: () => overlay?.webContents.send("milo:talk"),
    home: () => void openHome(isDev),
    feedback: () => {
      overlay?.showInactive();
      overlay?.webContents.send("milo:open-feedback");
    },
    activity: () => {
      overlay?.showInactive();
      overlay?.webContents.send("milo:open-activity");
    },
    say: notify,
    checkUpdates: () => checkForUpdate(true).then(notify),
    updateReady,
    installUpdate,
  });
  startUpdater(() => tray.refresh());
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  stopFocus();
  stopNative();
});
app.on("window-all-closed", () => app.quit());
