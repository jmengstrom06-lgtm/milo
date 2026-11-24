import { useCallback, useEffect, useRef, useState } from "react";
import Milo, { Character, CHARACTERS, Mood } from "./Milo";
import Notebook, { NotebookHandle } from "./Notebook";
import { Ears, EarState } from "./ears";
import { Intent, isBareGo, parse, soundsUnfinished, stripGo, stripWake, FILL_IN, SHOW_ONLY } from "./commands";
import { Bubble, Confetti, Highlight } from "./Effects";
import * as tts from "./voice";
import ResearchPanel, { PanelSize } from "./ResearchPanel";
import KitHost, { type KitHandle } from "./kit/KitHost";
import KitRing, { bubbleNearRing, ringLayout } from "./kit/KitRing";
import type { KitApp } from "./kit/types";
import { Pin, SweepHUD, SweepState, SweepSummary, WorkCard } from "./Sweep";
import { setSounds, sfx, soundsOn } from "./sfx";
import ToolPanel, { SavedTool, loadTools, saveTools } from "./ToolPanel";
import QuizPanel, { QuizHandle } from "./QuizPanel";
import { BriefCard, BriefLoader, BriefState, SignInPanel } from "./Brief";
import { parseAnswer, parseGoogle, parseGoogleMulti, parseRemember, spokenEmail } from "./decide";
import { fastDecide, looksLikeBackground, parseExam, parseFinalWeight, parseForecast, parseGradeNow, parseScore, parseSyllabus, parseHomework, parsePlanVoice, parseRadar, stripFiller, firstOffer, parseOfferAnswer, type DecideState } from "./decide";
import { alertLine, emptyRadar, markWarned, mergeScan, pendingAlerts, upcoming, whenText, type Radar, type RadarItem, type ScanItem, type Warn } from "./radar";
import RadarCard, { type RadarView } from "./RadarCard";
import { backNudge, weekNudge, type Nudge } from "./nudges";
import { checkupLine, type CheckItem } from "../main/checkup";
import { CLEAR_AREA, isSure, LOCKIN_START, PICK_AREA, pickSpoken } from "./exact";
import AreaPicker, { AreaFlash } from "./AreaPicker";
import Onboarding, { setupDone } from "./Onboarding";
import ActivityPanel from "./ActivityPanel";
import FeedbackPanel from "./FeedbackPanel";
import JobCard from "./JobCard";
import { parseProfileFact, profileLabel } from "../main/profileFacts";
import { detectLms, LMS, parseIcs } from "../main/school";
import GamePlanCard, { findPlan, loadPlans, nextStep, planKey, savePlan, syncPlans, type SavedPlan } from "./GamePlan";
import AccountChip from "./Account";
import LockIn, { type LockInHandle } from "./LockIn";
import { parseLockIn } from "../main/focusRules";
import { lectureCommand, minutesText } from "../main/lectureNotes";
import { LectureRecorder } from "./lectureRecorder";
import { plan as quickPlan } from "../main/quick";
import { stripMath } from "./MathText";

type Msg = { role: "user" | "assistant"; content: string };
type Pos = { x: number; y: number };

const MILO_W = 120;
const MILO_H = 140;
const WALK_SPEED = 220; // px/s when strolling
const MARGIN = 16;
const NB_W = 380;

/** A named spot on screen for Milo ("bottom-left", "top-right", "center"...). */
function spot(where: string): Pos {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const L = 24;
  const R = W - MILO_W - 24;
  const T = 40;
  const B = H - MILO_H - 8;
  const CX = Math.round((W - MILO_W) / 2);
  const CY = Math.round((H - MILO_H) / 2);
  const map: Record<string, Pos> = {
    "top-left": { x: L, y: T }, "top-right": { x: R, y: T }, "bottom-left": { x: L, y: B }, "bottom-right": { x: R, y: B },
    left: { x: L, y: CY }, right: { x: R, y: CY }, top: { x: CX, y: T }, bottom: { x: CX, y: B }, center: { x: CX, y: CY },
  };
  return map[where] ?? map["bottom-right"];
}
/** Where Milo lives when he's not busy. You can move it ("Milo, move to the bottom left"). */
const homeSpot = () => {
  try {
    return localStorage.getItem("milo.home") || "bottom-right";
  } catch {
    return "bottom-right";
  }
};
const home = (): Pos => spot(homeSpot());
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Keep spoken wrap-ups short: first sentence only, and never a paragraph. */
function shortLine(t: string) {
  const all = (t || "").replace(/\s+/g, " ").trim();
  // First sentence, plus the next one if the first is just "Done." / "All set."
  const first = all.match(/^.{0,14}?[.!?]\s+.*?[.!?](?=\s|$)/)?.[0] ?? all.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? all;
  return first.length > 140 ? first.slice(0, 137).replace(/[ ,;:]+\S*$/, "") + "…" : first;
}
/** Black-box log (what Milo decided and why). Lands in ~/Milo Logs on the Mac. */
const bb = (ev: string, data: Record<string, unknown> = {}) => window.milo.log("app", ev, data);
/** Is this transcript just Milo's own line coming back through the mic? */
function isEcho(heard: string, said: string) {
  const words = (t: string) => t.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").split(/\s+/).filter(Boolean);
  const h = words(heard);
  if (!h.length || !said) return false;
  const s = new Set(words(said));
  const hits = h.filter((w) => s.has(w)).length;
  return hits / h.length >= 0.6;
}

// Guess what the student wants from what they typed.
function detectMode(text: string, fallback: MiloMode): MiloMode {
  const t = text.toLowerCase();
  if (/(do it|for me|just (give|tell)|the answer|solve it|finish it)/.test(t)) return "do";
  if (/(hint|stuck|nudge|help me)/.test(t)) return "help";
  if (/(teach|explain|how do|walk me|show me how)/.test(t)) return "teach";
  return fallback;
}
// Accept the lock-on result only if it overlaps the first guess (guards against jumping to a different question).
function closeEnough(a: MiloBox, b: MiloBox) {
  const ix = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const inter = ix * iy;
  return inter > 0.3 * Math.min(a.width * a.height, b.width * b.height);
}
const wantsScreen = (text: string) =>
  /\b(this|screen|on here|look at|this question|this problem|number \d+|question \d+|#\d+)\b/i.test(text);

export default function App() {
  const [pos, setPos] = useState<Pos>(home);
  // a file dropped anywhere else on the see-through window must never replace the window with the file
  useEffect(() => {
    const stop = (e: DragEvent) => e.preventDefault();
    window.addEventListener("dragover", stop);
    window.addEventListener("drop", stop);
    return () => {
      window.removeEventListener("dragover", stop);
      window.removeEventListener("drop", stop);
    };
  }, []);
  // tell main where the frog is, so a file dragged onto him is caught (see milo:frog-rect)
  useEffect(() => {
    window.milo.frogRect({ x: pos.x, y: pos.y, width: MILO_W, height: MILO_H });
  }, [pos.x, pos.y]);
  const [mood, setMood] = useState<Mood>("sitting");
  const [facing, setFacing] = useState<"left" | "right">("left");
  const [speaking, setSpeaking] = useState(false);
  const speakingRef = useRef(false);
  speakingRef.current = speaking;
  const [bubble, setBubble] = useState<string | null>(null);
  // "Handle this": what Milo saw + 2-3 things he can do, as tappable chips by the frog
  const [offer, setOffer] = useState<{ seen: string; options: { label: string; say: string }[] } | null>(null);
  const chipsRef = useRef<typeof offer>(null);
  const lastAsk = useRef("");
  const sweepDoneAt = useRef(0); // when the last worksheet finished (so "you missed 7" goes back over it) // the student's newest request, word for word (the worksheet sweep reads it for "put Jake for the name") // the buttons on screen right now (cleared the instant one is picked)
  useEffect(() => {
    chipsRef.current = offer;
  }, [offer]);
  // click the frog: the quick menu with the three moves
  const [menu, setMenu] = useState(false);
  // Milo speaks first: a heads-up card by the frog ("Thursday's stacked", "While you were in class…")
  const [nudge, setNudge] = useState<Nudge | null>(null);
  // "Check this" (Preflight beta): findings, each labeled Confirmed / Possible / Unknown with its source
  type PF = Extract<Awaited<ReturnType<typeof window.milo.preflight>>, { ok: true }>;
  const [preflight, setPreflight] = useState<PF | null>(null);

  const [chatOpen, setChatOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [chatMore, setChatMore] = useState(false);
  // "Pick an area": the drag box, the request to run after it (if any), and a quick outline of what Milo is looking at
  const [picking, setPicking] = useState<{ then?: string } | null>(null);
  const [areaFlash, setAreaFlash] = useState<{ box: MiloRect; label?: string; id: number } | null>(null);
  const targetOpts = useRef<{ label: string; box: MiloRect }[]>([]); // the chat's settings list (instead of a wall of chips)
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [voice, setVoice] = useState(true);
  const [freeVoice, setFreeVoiceState] = useState(tts.isFreeVoice());
  const setFree = (on: boolean) => {
    tts.setFreeVoice(on);
    setFreeVoiceState(on);
  };
  const [character, setCharacter] = useState<Character>(() => {
    try {
      const c = localStorage.getItem("milo.character");
      return c === "monkey" || c === "frog" ? c : "frog";
    } catch {
      return "frog";
    }
  });
  const [mode, setMode] = useState<MiloMode>("teach");

  const [lesson, setLesson] = useState<MiloLesson | null>(null);
  const [lessonMode, setLessonMode] = useState<MiloMode>("teach");
  const [box, setBox] = useState<MiloBox | null>(null);
  const [locked, setLocked] = useState(false);
  const [revealed, setRevealed] = useState(0);
  const [finished, setFinished] = useState(false);
  const [confetti, setConfetti] = useState<{ x: number; y: number; seed: number } | null>(null);
  const [others, setOthers] = useState<MiloOther[]>([]);

  // ears
  const [earState, setEarState] = useState<EarState | "thinking">("off");
  const [handsFree, setHandsFree] = useState(false);
  const [level, setLevel] = useState(0);
  const [heard, setHeard] = useState<string | null>(null);
  // What you said shows above Milo until he answers. Some commands (like "close that") finish without a
  // reply, so never let it linger: it fades on its own after a few seconds.
  useEffect(() => {
    if (!heard) return;
    const t = setTimeout(() => setHeard((h) => (h === heard ? null : h)), 6000);
    return () => clearTimeout(t);
  }, [heard]);
  const [pause, setPause] = useState(0); // "sending…" bar while you finish talking
  const [working, setWorking] = useState(false); // Milo is using the computer
  // Lecture listener: in class, Milo records quietly and makes notes after.
  const inClassRef = useRef(false);
  const homeQuietUntil = useRef(0); // typed in Home base: answer there, quietly
  const fromHome = useRef(false);
  const [lecture, setLecture] = useState<{ id: string; course: string; startedAt: number } | null>(null);
  const [lectureLevel, setLectureLevel] = useState(0);
  const [lectureWarn, setLectureWarn] = useState<string | null>(null);
  // safe default: before the first recording in a class, ask if recording is allowed there
  const [lecAsk, setLecAsk] = useState<{ said: string; course: string; classId: string | null } | null>(null);
  const recRef = useRef<LectureRecorder | null>(null);
  const lectureClassAsk = useRef<{ id: string; at: number } | null>(null); // "Which class was that?"
  const earsBeforeClass = useRef<"always" | "off" | "once">("off");
  const [live, setLive] = useState<string | null>(null); // your words as you say them (smart ears)
  const [chromeOn, setChromeOn] = useState(false); // Milo's Chrome extension is connected
  const workingRef = useRef(false);
  workingRef.current = working;
  const [researchQ, setResearchQ] = useState<{ q: string; id: number } | null>(null);
  const [rpSize, setRpSize] = useState<PanelSize>("compact");
  const kitRef = useRef<KitHandle>(null);
  const [kitApp, setKitApp] = useState<KitApp | null>(null); // which of Milo's own apps is open
  const [ringOpen, setRingOpen] = useState(false); // "what can you do?" ring around Milo
  const [sweep, setSweep] = useState<SweepState | null>(null);
  const [sounds, setSoundsState] = useState(soundsOn());
  const [tool, setTool] = useState<{ request: string; id: number; existing?: SavedTool | null } | null>(null);
  const [tools, setTools] = useState<SavedTool[]>(loadTools);
  const [watching, setWatching] = useState(false);
  // Lock-in mode (focus sessions)
  const lockRef = useRef<LockInHandle>(null);
  const [lockOn, setLockOn] = useState(false);
  const [quiz, setQuiz] = useState<{ id: number; topic: string; questions: QuizQ[]; focus: string } | null>(null);
  const quizRef = useRef<QuizHandle>(null);
  const [brief, setBrief] = useState<BriefState | null>(null);
  const [activityOpen, setActivityOpen] = useState(false); // "What Milo did"
  // The first-minute offer: "Want to start on X? Together, or I can do it myself." (full = both; do_only = after a plan is up)
  const offerRef = useRef<{ item: { title: string; course: string; due: string }; at: number; mode: "full" | "do_only" } | null>(null);
  const firstBrief = useRef(false); // the brief right after setup ends with the offer
  const [feedback, setFeedback] = useState<string | null>(null); // the feedback panel (null = closed), with any words they already said
  const [briefRun, setBriefRun] = useState(0); // bump to (re)load the portal
  const [signIn, setSignIn] = useState(false);
  // First run: Milo sets himself up with the student (name, account, classes, permissions, D2L).
  const [setup, setSetup] = useState(() => !setupDone());
  // The school's calendar feed (.ics): deadlines from ANY LMS, no AI, instant.
  const [feed, setFeed] = useState(() => {
    try {
      return localStorage.getItem("milo.feed") || "";
    } catch {
      return "";
    }
  });
  const [portal, setPortal] = useState(() => {
    try {
      return localStorage.getItem("milo.portal") || "";
    } catch {
      return "";
    }
  });
  const [flag, setFlag] = useState<{ box: MiloBox; hint: string } | null>(null); // mistake Milo spotted
  const [name, setNameState] = useState(() => {
    try {
      return localStorage.getItem("milo.name") || "";
    } catch {
      return "";
    }
  });
  const sweepStop = useRef(false);

  const posRef = useRef(pos);
  const animRef = useRef<number | null>(null);
  const runId = useRef(0); // bumps to cancel an in-flight lesson
  const lastRequest = useRef("");
  const ears = useRef<Ears | null>(null);
  /** Self-test: feed a sentence in exactly as if the ears just heard it (see src/main/selftest.ts). */
  const heardRef = useRef<((t: string, ptt: boolean) => void) | null>(null);
  const testDeaf = useRef(false); // during the self-test the real mic is ignored completely
  if (!ears.current) ears.current = new Ears();
  const notebookRef = useRef<NotebookHandle>(null);
  const lessonRef = useRef<MiloLesson | null>(null);
  const lessonModeRef = useRef<MiloMode>("teach");
  const boxRef = useRef<MiloBox | null>(null);
  const finishedRef = useRef(false);
  const lastSaid = useRef("");
  const researchStart = useRef<{ q: string; at: number } | null>(null); // so a second half can be added
  const startResearchRef = useRef<(q: string, spoken?: boolean, followUp?: boolean) => void>(() => {});
  const researchThread = useRef<{ q: string; a: string }[]>([]); // earlier questions in this research box
  const researchTop = useRef<string | null>(null); // the page showing in the box
  const [researchTurns, setResearchTurns] = useState<{ q: string; a: string }[]>([]);
  const [rpAnchor, setRpAnchor] = useState<{ x: number; y: number } | null>(null); // box stays put once open
  const followUntil = useRef(0); // hands-free: no need to say "Milo" until this time
  const voiceSession = useRef(false); // the current lesson was started by voice
  const routeRef = useRef<(text: string, spoken?: boolean) => void>(() => {});
  const routeCache = useRef(new Map<string, Promise<MiloRoute>>()); // AI routing started early (while the card counts down)
  const routeCtxRef = useRef<() => Record<string, unknown>>(() => ({}));
  const getRoute = (text: string) => {
    const key = text.trim().toLowerCase();
    let p = routeCache.current.get(key);
    if (!p) {
      p = window.milo.route(text, routeCtxRef.current()).catch(() => ({ kind: "chat", failed: true }) as MiloRoute);
      routeCache.current.set(key, p);
      if (routeCache.current.size > 30) routeCache.current.delete(routeCache.current.keys().next().value as string);
      setTimeout(() => routeCache.current.delete(key), 20000); // context changes: don't reuse old decisions
    }
    return p;
  };
  const pendingTask = useRef<string | null>(null);
  const blockedTask = useRef<{ task: string; at: number } | null>(null); // waiting for the student to sign in
  const lastCommand = useRef<string | null>(null);
  const lastCommandAt = useRef(0);
  // The "Got it" card: what Milo heard, waiting for go / cancel / more.
  const [pending, setPending] = useState<{ text: string; progress: number; unfinished: boolean } | null>(null);
  const pendingRef = useRef<{ text: string; started: number; unfinished: boolean; first?: number; smart?: boolean } | null>(null);
  const smartTurn = useRef(false); // the last thing you said was ended by smart ears (Flux), not a pause timer
  const levelRef = useRef(0); // live mic loudness (0..1)
  const lastRun = useRef<{ text: string; at: number } | null>(null); // the command that just started
  const quietStop = useRef(false); // stopping a task to restart it with more words: don't say "Stopped!"
  const earStateRef = useRef<string>("off"); // last thing you asked for (so a bare "go" can redo it)
  const restoreHandsFree = useRef(false);
  const interrupted = useRef(false); // you talked over Milo / stopped him
  const resumeRef = useRef<(() => void) | null>(null); // how to pick up where he left off
  const researchSpoken = useRef(false);
  const lastStepSay = useRef("");
  const lastStepPoint = useRef<{ x: number; y: number } | null>(null); // a task waiting on the student's yes/no
  const voiceRef = useRef(voice);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  posRef.current = pos;
  voiceRef.current = voice;
  lessonRef.current = lesson;
  lessonModeRef.current = lessonMode;
  boxRef.current = box;
  finishedRef.current = finished;
  earStateRef.current = earState;

  // Apply the character's colors to the whole UI and tell the brain who Milo is.
  useEffect(() => {
    const c = CHARACTERS[character];
    const root = document.documentElement.style;
    root.setProperty("--accent", c.accent);
    root.setProperty("--accent-soft", c.soft);
    root.setProperty("--accent-deep", c.deep);
    window.milo.setCharacter(c.persona);
    try {
      localStorage.setItem("milo.character", character);
    } catch {
      /* ignore */
    }
  }, [character]);

  // Remember the student's name (and tell the brain).
  useEffect(() => {
    window.milo.setName(name);
    try {
      localStorage.setItem("milo.name", name);
    } catch {
      /* ignore */
    }
  }, [name]);

  // Re-send "clickable" while the mouse moves over a panel (throttled): Milo's hands turn clicks off
  // while he works, and a plain mouseenter never fires again if the cursor never left the panel.
  const lastHover = useRef({ on: false, at: 0 });
  const hover = useCallback((on: boolean) => {
    const now = Date.now();
    if (on && lastHover.current.on && now - lastHover.current.at < 400) return;
    lastHover.current = { on, at: now };
    window.milo.setClickable(on);
  }, []);

  // ---- movement ---------------------------------------------------------------
  const moveTo = useCallback((target: Pos, styleIn: "walk" | "jump" | "zip" = "walk") => {
    // While he's working, he zips (fast and snappy) instead of strolling.
    const style = workingRef.current ? "zip" : styleIn;
    return new Promise<void>((resolve) => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
      const tx = clamp(target.x, MARGIN, window.innerWidth - MILO_W - MARGIN);
      const ty = clamp(target.y, MARGIN, window.innerHeight - MILO_H - 4);
      const start = { ...posRef.current };
      const dist = Math.hypot(tx - start.x, ty - start.y);
      if (dist < 2) return resolve();

      setFacing(tx < start.x ? "left" : "right");
      setMood(style === "walk" ? "walking" : "jumping");
      const duration =
        style === "zip" ? clamp(dist / 4500, 0.12, 0.26) * 1000 : style === "jump" ? clamp(dist / 2200, 0.25, 0.55) * 1000 : (dist / WALK_SPEED) * 1000;
      const arc = style === "zip" ? Math.min(40, 10 + dist * 0.04) : style === "jump" ? Math.min(160, 50 + dist * 0.18) : 0;
      const t0 = performance.now();

      const step = (now: number) => {
        const k = Math.min(1, (now - t0) / duration);
        const e = style === "zip" ? 1 - Math.pow(1 - k, 3) : style === "jump" ? (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2) : k;
        const next = {
          x: start.x + (tx - start.x) * e,
          y: start.y + (ty - start.y) * e - arc * Math.sin(Math.PI * k),
        };
        posRef.current = next;
        setPos(next);
        if (k >= 1) {
          animRef.current = null;
          if (style === "jump") sfx.hop();
          else if (style === "zip") sfx.tick();
          setMood("idle");
          resolve();
          return;
        }
        animRef.current = requestAnimationFrame(step);
      };
      animRef.current = requestAnimationFrame(step);
    });
  }, []);

  // Wander along the bottom when nothing is going on.
  useEffect(() => {
    if (chatOpen || lesson || busy || working || researchQ || kitApp || lockOn) return; // stay put while a box is open or locked in
    if (homeSpot() !== "bottom-right") return; // you put him somewhere: he stays there
    const t = window.setInterval(() => {
      if (animRef.current) return;
      const r = Math.random();
      if (r < 0.45) {
        const h = home();
        moveTo({ x: Math.random() * window.innerWidth, y: h.y }).then(() => setMood(Math.random() < 0.5 ? "sitting" : "idle"));
      } else if (r < 0.65) setMood("sitting");
    }, 7000);
    return () => window.clearInterval(t);
  }, [chatOpen, lesson, busy, working, moveTo, researchQ, kitApp, lockOn]);

  // ---- voice ------------------------------------------------------------------
  const say = useCallback(async (text: string, opts: { minMs?: number; noBarge?: boolean; loud?: boolean } = {}) => {
    // Home base sees everything Milo says (it's the same Milo)
    try {
      window.milo.home.echo("said", text);
    } catch {
      /* preload not ready */
    }
    // In class, or answering something typed in Home base: on screen only.
    if ((inClassRef.current && !opts.loud) || Date.now() < homeQuietUntil.current) {
      setBubble(text);
      bb("say_quiet", { text: text.slice(0, 80) });
      await sleep(Math.max(opts.minMs ?? 1400, text.split(/\s+/).length * 300));
      return;
    }
    setBubble(text);
    setHeard(null);
    lastSaid.current = text;
    const t0 = Date.now();
    bb("say", { text, voiceOn: voiceRef.current, bargeIn: !opts.noBarge });
    ears.current?.mute(true, !opts.noBarge && !testDeaf.current); // don't let Milo hear himself
    try {
      if (!voiceRef.current) {
        setSpeaking(true);
        await sleep(Math.max(opts.minMs ?? 1400, text.split(/\s+/).length * 300));
        return;
      }
      await tts.play(text, () => {
        setSpeaking(true);
        ears.current?.started();
      });
    } finally {
      bb("say_done", { ms: Date.now() - t0, text: text.slice(0, 60) });
      setSpeaking(false);
      setTimeout(() => ears.current?.mute(false), 250);
    }
  }, []);

  const hush = () => {
    tts.stop();
    setSpeaking(false);
  };

  // ---- ears ---------------------------------------------------------------------
  /** Listen for one thing (push-to-talk / follow-up). In hands-free mode, just open a no-wake-word window. */
  const listen = useCallback(async (pushToTalk = false) => {
    if (testDeaf.current) return;
    const e = ears.current!;
    if (e.mode === "always" && pushToTalk) {
      // Push-to-talk beats hands-free: listen to just you right now, then go back to hands-free.
      restoreHandsFree.current = true;
      await e.setMode("once");
      return;
    }
    if (e.mode === "always") {
      followUntil.current = Date.now() + 12000;
      setEarState("waiting");
      return;
    }
    const ok = await window.milo.micAccess();
    if (!ok) {
      say("I need microphone access. Turn on Terminal in System Settings, Privacy and Security, Microphone.");
      return;
    }
    try {
      await e.setMode("once");
    } catch {
      say("I couldn't open the microphone.");
    }
  }, [say]);

  // ---- the magic: look at the screen and teach --------------------------------
  const closeLesson = useCallback(() => {
    runId.current++;
    hush();
    setLesson(null);
    setBox(null);
    setOthers([]);
    setBubble(null);
    setFinished(false);
    setRevealed(0);
    voiceSession.current = false;
    hover(false);
    moveTo(home(), "jump").then(() => setMood("sitting"));
  }, [hover, moveTo]);

  const look = useCallback(
    async (m: MiloMode, request: string, focus: MiloBox | null = null, byVoice = false) => {
      const id = ++runId.current;
      lastRequest.current = request;
      voiceSession.current = byVoice;
      hush();
      setChatOpen(false);
      setLesson(null);
      setBox(null);
      setOthers([]);
      setFinished(false);
      setRevealed(0);
      setBusy(true);
      setMood("looking");
      setBubble(m === "do" ? "On it. Let me see…" : "Ooh, let me look…");

      const r = await window.milo.look(m, request, focus);
      if (id !== runId.current) return;
      setBusy(false);
      if (!r.ok && (r as { asked?: boolean }).asked) return void setMood("idle"); // "Which one?" buttons are up

      if (!r.ok) {
        setMood("idle");
        setMessages((msgs) => [...msgs, { role: "assistant", content: r.text }]);
        await say(r.text, { minMs: 4000 });
        if (id === runId.current) setBubble(null);
        return;
      }

      const { lesson: L, box: b } = r;
      // Generate all of Milo's lines in parallel right now, so he never pauses between steps.
      if (voiceRef.current) [L.intro, ...L.steps.map((s) => s.say), m === "do" ? L.summary : ""].forEach((t) => t && tts.prefetch(t));
      if (!L.found || !b) {
        setMood("happy");
        await say(L.intro || "I don't see a question on your screen. Open one up and try again!");
        if (id === runId.current) setBubble(null);
        return;
      }

      // 1) Spotlight the problem and fly over to it.
      setBox(b);
      setOthers(r.others ?? []);
      setLocked(false);
      setLessonMode(m);
      const perchFor = (bx: MiloBox) => ({
        x: bx.x + bx.width - MILO_W * 0.55,
        y: bx.y - MILO_H + 22 >= MARGIN ? bx.y - MILO_H + 22 : bx.y + bx.height - 30,
      });
      let perch = perchFor(b);

      // Lock-on runs in the background while Milo flies over and talks.
      const refined = window.milo
        .refine(b, L.topic)
        .then((rr) => (rr.ok && closeEnough(rr.box, b) ? rr.box : null))
        .catch(() => null);

      setBubble(null);
      await moveTo(perch, "jump");
      if (id !== runId.current) return;
      setFacing(b.x + b.width + NB_W + 40 < window.innerWidth ? "right" : "left");

      // 2) Point at it and say the intro.
      setMood("pointing");
      await Promise.all([say(L.intro), refined.then((rb) => {
        if (rb && id === runId.current) {
          setBox(rb);
          setLocked(true);
          sfx.lock();
        }
      })]);
      if (id !== runId.current) return;
      const rb = await Promise.race([refined, sleep(1500).then(() => null)]);
      if (rb) {
        const np = perchFor(rb);
        if (Math.hypot(np.x - perch.x, np.y - perch.y) > 24) {
          perch = np;
          await moveTo(perch, "jump");
          setMood("pointing");
        }
      }
      if (id !== runId.current) return;

      // 3) Open the notebook and write each step while explaining it.
      setLesson(L);
      interrupted.current = false;
      resumeRef.current = null;
      let stoppedAt = -1;
      const teachFrom = async (start: number) => {
        for (let i = start; i < L.steps.length; i++) {
          if (id !== runId.current) return false;
          setRevealed(i + 1);
          setMood("writing");
          await Promise.all([say(L.steps[i].say), sleep(900)]);
          if (interrupted.current) {
            stoppedAt = i + 1;
            return false;
          }
        }
        return true;
      };
      if (!(await teachFrom(0))) {
        if (stoppedAt >= 0 && id === runId.current) {
          // You interrupted: remember the spot so "keep going" continues from here.
          resumeRef.current = async () => {
            interrupted.current = false;
            if (await teachFrom(stoppedAt)) {
              setFinished(true);
              setMood("happy");
              await say(L.check_question ? "Your turn. What do you get?" : "That's the move!");
              setBubble(null);
              listen();
            }
          };
        }
        return;
      }
      if (id !== runId.current) return;
      setFinished(true);

      // 4) Wrap up.
      if (m === "do") {
        setMood("celebrating");
        setConfetti({ x: perch.x + MILO_W / 2, y: perch.y + 40, seed: Date.now() });
        await say(L.summary || "Done! Check it over and you're good.");
      } else {
        setMood("happy");
        await say(L.check_question ? (byVoice ? "Your turn. What do you get?" : "Your turn. Give the last part a shot.") : "That's the move!");
      }
      if (id !== runId.current) return;
      setBubble(null);
      // Keep the conversation going: listen for an answer or a follow-up without needing a key.
      if (byVoice || ears.current?.mode === "always") listen();
    },
    [moveTo, say, listen]
  );

  const skipAhead = () => {
    if (!lesson) return;
    runId.current++;
    hush();
    setBubble(null);
    setRevealed(lesson.steps.length);
    setFinished(true);
    setMood("happy");
  };

  const onFeedback = async (text: string, correct: boolean) => {
    if (correct) {
      setMood("celebrating");
      sfx.success();
      setConfetti({ x: posRef.current.x + MILO_W / 2, y: posRef.current.y + 40, seed: Date.now() });
    } else setMood("thinking");
    await say(text);
    setBubble(null);
    setMood("happy");
    if (!correct && voiceSession.current) listen(); // let them try again out loud
  };

  // ---- hands: do things on the computer -------------------------------------------
  /** Do something on the computer. Resolves true if it finished (so a chain can continue). */
  const runTask = useCallback(
    async (task: string, byVoice = true, partOfChain = false): Promise<boolean> => {
      if (!(await window.milo.handsAccess())) {
        await say("I need permission to use your keyboard and mouse. Turn on Terminal in System Settings, Privacy and Security, Accessibility, then restart me.");
        setBubble(null);
        return false;
      }
      runId.current++;
      hush();
      setChatOpen(false);
      hover(false);
      setWorking(true);
      pendingTask.current = null;
      lastStepSay.current = "";
      lastStepPoint.current = null;
      setMood("looking");
      setBubble("On it!");
      // You just rephrased: tell the planner the last try failed, so it picks a different, more direct way.
      const hint = retryHint.current && Date.now() - retryHint.current.at < 60000 ? retryHint.current : null;
      retryHint.current = null;
      const r = await window.milo.task(
        hint ? `${task}\n(The student is repeating themselves: the last try at "${hint.was}" didn't do what they wanted. Do it a different, more direct way this time. For a whole app, quit or open the app itself instead of pressing keys inside a page.)` : task
      );
      setWorking(false);
      // Done working: hop back to his spot first (bottom right by default), THEN say what he did.
      await moveTo(home(), "jump");
      if (!r.ok) {
        setMood("thinking");
        await say(r.text);
        setBubble(null);
        return false;
      }
      if (r.status === "blocked") {
        // a sign-in, 2-step code or "are you human" check: his job is to wait, not to fail
        blockedTask.current = { task, at: Date.now() };
        bb("task_blocked", { task: task.slice(0, 120) });
        setMood("thinking");
        await say(r.text);
        setBubble(null);
        return false;
      }
      if (r.status === "ask") {
        pendingTask.current = task;
        setMood("happy");
        await say(r.text);
        setBubble(null);
        if (/\?\s*$/.test(r.text)) waitForAnswer(); // a yes/no question: ding, then just say yes
        else listen();
        return false;
      }
      if (r.status === "stopped") {
        if (quietStop.current) {
          quietStop.current = false;
          return false;
        }
        setMood("idle");
        await say("Stopped!");
        setBubble(null);
        return false;
      }
      if (r.status === "quick") {
        // Instant command (open an app, new tab…) already happened. Anything left gets routed:
        // homework ("…and solve the problem") or more computer work ("…and write a poem").
        setMood("happy");
        if (r.rest) {
          const intent = parse(r.rest, { inLesson: false, awaitingAnswer: false });
          if (intent.kind === "look" && !partOfChain) {
            setMode(intent.mode);
            look(intent.mode, intent.request, null, byVoice);
            return true;
          }
          return runTask(`${r.rest}\n(Already done: ${(r.did ?? []).join("; ")})`, byVoice, partOfChain);
        }
        await sleep(partOfChain ? 400 : 1200);
        setBubble(null);
        return true;
      }
      // Finished.
      if (partOfChain) {
        setMood("happy");
        await say(shortLine(r.text || "Found it."));
        setBubble(null);
        return true;
      }
      setMood("happy");
      await say(shortLine(r.text));
      setBubble(null);
      if (byVoice) listen();
      return true;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [say, hover, listen, look]
  );

  // ---- Startup check: anything broken (permissions, D2L sign-in) is said once, up front ----
  const startupChecked = useRef(false);
  useEffect(() => {
    if (setup || startupChecked.current) return;
    // (marked done only once it really runs: dev mode starts effects twice and cancels the first)
    const t = window.setTimeout(async () => {
      if (startupChecked.current) return;
      startupChecked.current = true;
      const r = await window.milo.startupCheck(portal || undefined).catch(() => ({ problems: [] as { kind: string; text: string }[] }));
      if (portal && !r.problems.some((p) => p.kind === "d2l")) {
        void ensureFeed(); // signed in: grab the backup link if we don't have it
        void syncClasses();
      }
      if (!r.problems.length) return;
      setMood("thinking");
      for (const p of r.problems.filter((x) => x.text).slice(0, 2)) await say(p.text);
      setBubble(null);
      if (r.problems.some((p) => p.kind === "d2l")) void fixD2l().then((ok) => ok && startBrief(false)); // Chrome first, then Milo's own sign-in
    }, 6000);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setup]);

  // ---- Jobs: long tasks that finish (plan -> do -> check each step -> retry -> final check) ----------
  const [job, setJob] = useState<MiloJob | null>(null);
  const jobRef = useRef<MiloJob | null>(null);
  jobRef.current = job;
  const jobSaid = useRef<string>("");
  // Google: an email waiting to be sent, or an event waiting to be added: both need a yes
  const pendingGoogle = useRef<{ kind: "send"; draftId: string; at: number } | { kind: "event"; ev: { title: string; start: string; end?: string; where?: string }; at: number } | null>(null);
  const googleConnecting = useRef(false);
  // ---- Follow-up answers, like Alexa/Siri: after Milo ASKS something, the mic opens for a short
  // answer with no "Milo" needed. The clock starts when he stops talking, gets longer once you start
  // speaking, and only yes/no style answers count. Silence = nothing happens.
  const answerUntil = useRef(0);
  const answerTimer = useRef<number | undefined>(undefined);
  const [answering, setAnswering] = useState<string | false>(false); // the hint on the glowing tag
  const pendingAddr = useRef<{ request: string; name: string; at: number } | null>(null);
  const ANSWER_MS = 8000;
  const answerTick = useRef(() => {});
  answerTick.current = () => {
    if (!answerUntil.current) return;
    const left = answerUntil.current - Date.now();
    if (left > 0) {
      answerTimer.current = window.setTimeout(() => answerTick.current(), left + 50);
      return;
    }
    answerUntil.current = 0;
    setAnswering(false);
    ears.current?.stopExpect();
    bb("answer_window_end", { why: "no answer" });
    setMood((m) => (m === "listening" ? "idle" : m));
  };
  const waitForAnswer = (hint = "say yes or no") => {
    answerUntil.current = Date.now() + ANSWER_MS;
    followUntil.current = Math.max(followUntil.current, answerUntil.current);
    setAnswering(hint);
    setMood("listening");
    ears.current?.mute(false); // open the mic now, before the ding, so an instant "yes" is caught
    ears.current?.expect(ANSWER_MS + 4000);
    sfx.chime(); // the "I'm listening" sound, like Siri's ding
    bb("answer_window_open", { ms: ANSWER_MS });
    window.clearTimeout(answerTimer.current);
    answerTimer.current = window.setTimeout(() => answerTick.current(), ANSWER_MS + 50);
    if (ears.current && ears.current.mode !== "always") void listen();
  };
  const endAnswer = (why: string) => {
    if (!answerUntil.current) return;
    answerUntil.current = 0;
    window.clearTimeout(answerTimer.current);
    setAnswering(false);
    ears.current?.stopExpect();
    bb("answer_window_end", { why });
  };
  // Proof after a Google action: a little "View in Calendar" button, so the student can check it really happened.
  const [proof, setProof] = useState<{ label: string; url: string } | null>(null);
  const proofTimer = useRef<number | undefined>(undefined);
  const showProof = (r: GoogleReply) => {
    if (!r.ok || !r.link) return;
    window.clearTimeout(proofTimer.current);
    setProof({ label: r.linkLabel || "Open it", url: r.link });
    proofTimer.current = window.setTimeout(() => setProof(null), 30000);
  };
  const startDraft = (request: string) => {
    setMood("thinking");
    setBubble("Writing it…");
    void window.milo.google.draft(request).then((r) => {
      if (r.ok && r.draftId) pendingGoogle.current = { kind: "send", draftId: r.draftId, at: Date.now() };
      if (!r.ok && r.needAddress) pendingAddr.current = { request, name: r.needAddress, at: Date.now() };
      setMood(r.ok ? "happy" : "thinking");
      showProof(r);
      say(r.text).then(() => {
        setBubble(null);
        if (r.ok && pendingGoogle.current) waitForAnswer();
        else if (pendingAddr.current) waitForAnswer("say their email");
      });
    });
  };
  const googleVoice = (text: string): boolean => {
    const t = text.toLowerCase().replace(/[.!?,]+/g, " ").replace(/\s+/g, " ").trim();
    const pa = pendingAddr.current;
    if (pa && Date.now() - pa.at < 60e3) {
      const addr = spokenEmail(text);
      if (addr) {
        endAnswer("address");
        pendingAddr.current = null;
        hush();
        const esc = pa.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const req = new RegExp(esc, "i").test(pa.request) ? pa.request.replace(new RegExp(esc, "i"), addr) : `${pa.request} (send it to ${addr})`;
        bb("google_voice", { do: "draft", from: "address_answer" });
        startDraft(req);
        return true;
      }
      if (parseAnswer(t) === "no") {
        endAnswer("no");
        pendingAddr.current = null;
        say("Okay, never mind the email.").then(() => setBubble(null));
        return true;
      }
    }
    const pg = pendingGoogle.current;
    if (pg && Date.now() - pg.at < 60e3) {
      const ans = parseAnswer(t);
      if (ans === "yes") {
        endAnswer("yes");
        pendingGoogle.current = null;
        setMood("thinking");
        void (pg.kind === "send" ? window.milo.google.send(pg.draftId) : window.milo.google.eventAdd(pg.ev)).then((r) => {
          if (r.ok) sfx.success();
          setMood(r.ok ? "happy" : "thinking");
          showProof(r);
          say(r.text).then(() => setBubble(null));
        });
        return true;
      }
      if (ans === "no") {
        endAnswer("no");
        pendingGoogle.current = null;
        say(pg.kind === "send" ? "Okay, I won't send it. It's still in your drafts." : "Okay, I won't add it.").then(() => setBubble(null));
        return true;
      }
    }
    // Two answers back to back: keep each one short (top 3), like Alexa does.
    const brief = (x: string) => {
      const list = x.match(/^([^:]+):\s*(.+)$/);
      if (list) {
        const items = list[2].replace(/\.\s*$/, "").split(/,\s+(?=[A-Z0-9])/);
        return items.length > 3 ? `${list[1]}: ${items.slice(0, 3).join(", ")}, and ${items.length - 3} more.` : x;
      }
      const sents = x.split(/(?<=\.)\s+/);
      return sents.length > 3 ? sents.slice(0, 3).join(" ") : x;
    };
    // Two questions in one breath: answer both, in order.
    const multi = parseGoogleMulti(text);
    if (multi) {
      hush();
      setMood("thinking");
      bb("google_voice", { do: multi.map((m) => m.do).join("+") });
      void (async () => {
        for (const m of multi) {
          const r = m.do === "calendar" ? await window.milo.google.calendar(m.days, m.range) : await window.milo.google.mail();
          setMood(r.ok ? "happy" : "thinking");
          await say(r.ok ? brief(r.text) : r.text);
          if (!r.ok) break;
        }
        setBubble(null);
      })();
      return true;
    }
    const ga = parseGoogle(text);
    if (!ga) return false;
    hush();
    const reply = (r: GoogleReply) => {
      setMood(r.ok ? "happy" : "thinking");
      showProof(r);
      say(r.text).then(() => setBubble(null));
    };
    if (ga.do === "connect") {
      if (googleConnecting.current) return true; // already waiting on the sign-in
      googleConnecting.current = true;
      setBubble("Opening Google sign-in…");
      say("Sign in with Google in your browser, and I'll be connected.").then(() => setBubble(null));
      void window.milo.google.connect().then((r) => {
        googleConnecting.current = false;
        reply(r);
      });
    } else if (ga.do === "calendar") void window.milo.google.calendar(ga.days, ga.range).then(reply);
    else if (ga.do === "mail") void window.milo.google.mail().then(reply);
    else if (ga.do === "doc") void window.milo.google.doc(ga.title).then(reply);
    else if (ga.do === "draft") startDraft(ga.request); else if (ga.do === "event") {
      setMood("thinking");
      void window.milo.google.eventParse(ga.request).then((r) => {
        if (r.ok && r.ev) pendingGoogle.current = { kind: "event", ev: r.ev, at: Date.now() };
        setMood(r.ok ? "happy" : "thinking");
        say(r.text).then(() => {
          setBubble(null);
          if (r.ok && pendingGoogle.current) waitForAnswer();
        });
      });
    }
    bb("google_voice", { do: ga.do });
    return true;
  };
  const jobActive = (j: MiloJob | null) => !!j && ["planning", "running", "checking"].includes(j.status);
  useEffect(
    () =>
      window.milo.onJob((j) => {
        setJob(j);
        setWorking(jobActive(j));
        // say each new outcome once
        const key = `${j.id}:${j.status}`;
        if (jobSaid.current === key) return;
        jobSaid.current = key;
        if (j.status === "done") {
          sfx.success();
          setMood("happy");
          setConfetti({ x: posRef.current.x + MILO_W / 2, y: posRef.current.y + 40, seed: Date.now() });
          void moveTo(home(), "jump");
          say(j.summary || "All done.").then(() => setBubble(null));
        } else if (j.status === "needs_you") say(`${j.question ?? "Should I go ahead?"} Say yes to go ahead.`).then(() => setBubble(null));
        else if (j.status === "stuck") say(`${j.question ?? "I got stuck."} Say keep going and I'll try again.`).then(() => setBubble(null));
        else if (j.status === "stopped") say("Stopped. Say keep going and I'll pick up right where I left off.").then(() => setBubble(null));
        else if (j.status === "failed") say(j.question || "That didn't work.").then(() => setBubble(null));
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  /** Do a computer task: a long, multi-part one becomes a job (planned, checked, finished); a quick one just runs. */
  const work = async (task: string, spoken: boolean) => {
    if (!(await window.milo.jobIs(task).catch(() => false))) return runTask(task, spoken);
    bb("route_job", { task: task.slice(0, 200) });
    hush();
    setChatOpen(false);
    setMood("thinking");
    setBubble("Planning it out…");
    void window.milo.jobStart(task);
    return true;
  };
  /** Voice for jobs: "stop", "keep going", "yes go ahead", "what are you doing". */
  const jobVoice = (text: string): boolean => {
    const t = text.toLowerCase().replace(/[.!?,]+/g, " ").replace(/\s+/g, " ").trim();
    const j = jobRef.current;
    // after "sign in for me": "ok I'm in" picks the task back up
    const bt = blockedTask.current;
    if (bt && Date.now() - bt.at < 15 * 60e3 && !(j && ["needs_you", "stuck"].includes(j.status)) && /^(keep going|continue|i'?m in|i'?m signed in|signed in|done|ok(ay)?|go( ahead)?|all set|got it|go on|try (it )?again)\b/.test(t)) {
      blockedTask.current = null;
      setBubble("Picking it back up…");
      void runTask(bt.task, true);
      return true;
    }
    if (jobActive(j) && /^(stop|cancel|pause|hold on|wait|quit it|stop the job)\b/.test(t)) {
      void window.milo.jobStop();
      return true;
    }
    // he finished but didn't turn it in: "submit it" / "turn it in" does just that
    if (j?.status === "done" && Date.now() - j.updatedAt < 60 * 60e3 && /^(submit|turn (it|this|that) in|hand (it|this) in|go ahead and (submit|turn it in))\b/.test(t)) {
      setBubble("Turning it in…");
      bb("submit_after", {});
      void window.milo.jobStart(`Submit / turn in the work you just finished (it's open on screen). It was: ${j.goal.replace(/ The last step is submitting.*$/, "")}`, { approved: true });
      return true;
    }
    if (j?.status === "needs_you" && /^(yes|yeah|yep|sure|go ahead|do it|ok(ay)?|submit( it)?|turn (it|this) in|hand it in|send it|approved?)\b/.test(t)) {
      setBubble("Going!");
      void window.milo.jobResume(true);
      return true;
    }
    if (/^(keep going|continue|resume|go on|carry on|pick (it |that )?(back )?up|finish (it|that|the job|what you were doing)|try again)\b/.test(t) && j && ["stopped", "paused", "stuck", "needs_you"].includes(j.status)) {
      setBubble("Picking up where I left off…");
      void window.milo.jobResume(false);
      return true;
    }
    if (j && jobActive(j) && /^(what are you (doing|working on)|status|how'?s it going|where are you at)\b/.test(t)) {
      const cur = j.steps.find((s) => s.status === "doing" || s.status === "retrying");
      const n = j.steps.filter((s) => s.status === "done").length;
      say(`${n} of ${j.steps.length} done. ${cur ? `Now: ${cur.do.split("\n")[0]}` : ""}`).then(() => setBubble(null));
      return true;
    }
    return false;
  };

  // ---- "Start my stats homework": the Game Plan ---------------------------------------------------
  // Finds the assignment (D2L), opens it, reads it, splits it into small steps (step 1 is tiny), coaches each step.
  const [gp, setGp] = useState<SavedPlan | null>(null);
  const [gpPop, setGpPop] = useState<number | null>(null);
  const gpRef = useRef<SavedPlan | null>(null);
  gpRef.current = gp;
  const hwRun = useRef(0);
  const planSync = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showPlan = (sp: SavedPlan) => {
    savePlan(sp);
    // follow you to your other Macs a few seconds after each change
    if (planSync.current) clearTimeout(planSync.current);
    planSync.current = setTimeout(() => void syncPlans(), 4000);
    gpRef.current = sp;
    setGp(sp);
  };
  const stepLine = (sp: SavedPlan, i: number) => {
    const st = sp.plan.steps[i];
    return st ? `Step ${i + 1}: ${st.text}. About ${st.minutes} minutes.` : "";
  };
  const CHEER = ["Nice.", "Boom.", "One down.", "Let's go.", "Easy.", "Nailed it."];
  const finishStep = async (i?: number) => {
    const sp = gpRef.current;
    if (!sp) return;
    const k = i ?? nextStep(sp);
    if (k < 0 || k >= sp.plan.steps.length || sp.done.includes(k)) return;
    const next: SavedPlan = { ...sp, done: [...sp.done, k], at: Date.now() };
    showPlan(next);
    setGpPop(k);
    setTimeout(() => setGpPop((x) => (x === k ? null : x)), 900);
    bb("homework_step_done", { step: k + 1, of: sp.plan.steps.length });
    const n = nextStep(next);
    if (n < 0) {
      sfx.success();
      setMood("happy");
      setConfetti({ x: posRef.current.x + MILO_W / 2, y: posRef.current.y + 40, seed: Date.now() });
      await say(`That's every step of ${sp.plan.title}. Submit it and you're done. Proud of you.`);
      setBubble(null);
      return;
    }
    sfx.tick();
    await say(`${CHEER[Math.floor(Math.random() * CHEER.length)]} ${stepLine(next, n)}`);
    setBubble(null);
  };
  const undoStep = (i?: number) => {
    const sp = gpRef.current;
    if (!sp || !sp.done.length) return;
    const k = i ?? sp.done[sp.done.length - 1];
    showPlan({ ...sp, done: sp.done.filter((x) => x !== k), at: Date.now() });
  };
  /** "skip": that step moves to the end; everything stays checked off where it was. */
  const skipStep = (i?: number) => {
    const sp = gpRef.current;
    if (!sp) return;
    const k = i ?? nextStep(sp);
    if (k < 0 || k >= sp.plan.steps.length - 1) return;
    const order = sp.plan.steps.map((_s, j) => j).filter((j) => j !== k).concat(k);
    const steps = order.map((j) => sp.plan.steps[j]);
    const done = sp.done.map((d) => order.indexOf(d));
    const next = { ...sp, plan: { ...sp.plan, steps }, done, at: Date.now() };
    showPlan(next);
    say(`Okay, saving that for last. ${stepLine(next, nextStep(next))}`).then(() => setBubble(null));
  };
  const stepWithMe = (i?: number, byVoice = false) => {
    const sp = gpRef.current;
    if (!sp) return;
    const k = i ?? nextStep(sp);
    const st = sp.plan.steps[k];
    if (!st) return;
    bb("homework_with_me", { step: k + 1, text: st.text });
    setMode("teach");
    look("teach", `Coach me through step ${k + 1} of my game plan for "${sp.plan.title}": ${st.text}. ${st.detail} Only this step. Find it on my screen.`, null, byVoice);
  };
  const planLockIn = () => {
    const sp = gpRef.current;
    if (!sp || lockOn) return;
    const left = sp.plan.steps.reduce((a, st, j) => a + (sp.done.includes(j) ? 0 : st.minutes), 0);
    lockRef.current?.start(Math.min(90, Math.max(10, left)), sp.plan.title);
  };
  const closePlan = () => {
    gpRef.current = null;
    setGp(null);
  };
  const startHomework = async (text: string, byVoice: boolean, hw: { target: string; here: boolean }, preset?: { title: string; course: string; due: string }) => {
    const id = ++hwRun.current;
    hush();
    setChatOpen(false);
    setRingOpen(false);
    closePlan();
    if (!hw.here && portal) {
      let items: { title: string; course: string; due: string }[] = [];
      try {
        items = JSON.parse(localStorage.getItem("milo.briefItems") || "[]");
      } catch {
        /* ignore */
      }
      const cls = hw.target && !preset ? await window.milo.kit.classFor(hw.target).catch(() => null) : null;
      const words = [hw.target, cls?.name, cls?.code].filter(Boolean).map((w) => String(w).toLowerCase());
      const item = preset ?? items.find((it) => !words.length || words.some((w) => `${it.course} ${it.title}`.toLowerCase().includes(w)));
      const course = item?.course || cls?.name || hw.target;
      if (item || course) {
        setMood("happy");
        await say(item ? `Let's go. Opening ${item.title}.` : `Let's go. Finding your ${course} homework.`);
        if (id !== hwRun.current) return;
        const ok = await runTask(
          item
            ? `In Chrome, go to ${portal}, open my ${item.course} course, and open the assignment "${item.title}"${item.due ? ` (due ${item.due})` : ""}. Stop as soon as the assignment's own page is open.`
            : `In Chrome, go to ${portal}, open my ${course} course, and open the next assignment that's due. Stop as soon as the assignment's own page is open.`,
          byVoice,
          true
        );
        if (id !== hwRun.current) return;
        if (!ok) {
          await say("Open the assignment page and say “start this.” I'll take it from there.");
          setBubble(null);
          return;
        }
      }
    }
    setMood("looking");
    setBubble("Reading the assignment…");
    const r = await window.milo.gameplan(text);
    if (id !== hwRun.current) return;
    if (!r.ok) {
      setMood("idle");
      await say(r.text);
      setBubble(null);
      return;
    }
    if (!r.data.found) {
      setMood("thinking");
      await say(r.data.missing || "Open the assignment and say “start this.”");
      setBubble(null);
      return;
    }
    const key = planKey(r.data);
    const old = loadPlans().find((x) => x.key === key && x.plan.steps.length === r.data.steps.length);
    const sp: SavedPlan = { key, plan: r.data, done: old?.done ?? [], at: Date.now() };
    showPlan(sp);
    sfx.lock();
    setMood("happy");
    bb("homework_plan_shown", { title: r.data.title, steps: r.data.steps.length, minutes: r.data.total_minutes, resumed: !!old?.done.length });
    let told = true;
    try {
      told = localStorage.getItem("milo.toldCanDo") === "1";
      localStorage.setItem("milo.toldCanDo", "1");
    } catch {
      /* ignore */
    }
    const canDo = told ? "" : " And if you're ever short on time, just say “do it for me” and I'll do the whole thing myself.";
    await say(old?.done.length ? `Welcome back. ${stepLine(sp, nextStep(sp))}` : `${r.data.say}${canDo}`);
    setBubble(null);
    const item = preset ?? { title: r.data.title, course: r.data.course, due: r.data.due };
    offerRef.current = { item, at: Date.now(), mode: "do_only" };
  };
  /** "Write a 5 page paper on…": Milo plans, finds real sources, and writes it into a Google Doc live. */
  const paperTopic = useRef<{ base: string; at: number } | null>(null);
  /** Optional syllabus rules: if the student asked Milo to follow this class's rules and they say no, say why and stop. */
  const heldBack = async (act: "check" | "write" | "fill", said: string) => {
    const r = await window.milo.rules.check(act, said).catch(() => ({ ok: true as const, text: "" }));
    if (r.ok) return false;
    setMood("idle");
    say(r.text || "Your syllabus rules for this class say no to that.").then(() => setBubble(null));
    return true;
  };
  const startPaper = async (text: string) => {
    if (await heldBack("write", text)) return;
    paperTopic.current = null;
    hush();
    setChatOpen(false);
    setMood("thinking");
    bb("paper_start", {});
    const first = window.milo.paper(text, name || undefined);
    // the main side answers right away when something's missing (no topic, no Google)
    const quick = await Promise.race([first, new Promise<null>((r) => setTimeout(() => r(null), 600))]);
    if (quick && !quick.ok) {
      setMood("idle");
      await say(quick.text);
      setBubble(null);
      if (quick.needTopic) {
        paperTopic.current = { base: text, at: Date.now() };
        waitForAnswer("say the topic");
      }
      return;
    }
    await say(/\b(help me|with me|together|outline)\b/i.test(text) ? "On it. I'll find real sources and lay out the plan in a Google Doc." : "On it. I'll find real sources and write it in a Google Doc. You can watch it appear.");
    const r = await first;
    setMood(r.ok ? "happy" : "thinking");
    if (r.ok) sfx.success();
    await say(r.text);
    setBubble(null);
  };
  useEffect(
    () =>
      window.milo.onPaperProgress((p) => {
        if (p.stage === "done" || p.stage === "error") return;
        setBubble(p.text);
        setMood("thinking");
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  /** "Listen to my stats lecture": record quietly (saved every 2 minutes), notes after class. */
  const startLecture = async (said: string, confirmed = false) => {
    if (recRef.current) {
      say("I'm already listening to class.", { loud: true }).then(() => setBubble(null));
      return;
    }
    let first = true;
    try {
      first = localStorage.getItem("milo.lectureNotice") !== "1";
      localStorage.setItem("milo.lectureNotice", "1");
    } catch {
      /* ignore */
    }
    const m = await window.milo.lecture.start(said, confirmed);
    if (m.blocked === "ask") {
      setLecAsk({ said, course: m.course, classId: m.classId ?? null });
      say(`Quick check before I listen${m.course ? ` to ${m.course}` : ""}: does this class allow recording?`).then(() => setBubble(null));
      return;
    }
    if (m.blocked) {
      say(
        m.blocked === "paused"
          ? "I'm paused, so I'm not listening. Turn me back on in Home base first."
          : `You turned off recording for ${m.course}, so I won't listen in this class. You can change that in Home base, Settings.`
      ).then(() => setBubble(null));
      return;
    }
    const rec = new LectureRecorder(
      m.id,
      (id, n, wav) => void window.milo.lecture.chunk(id, n, wav),
      (rms) => setLectureLevel(rms)
    );
    try {
      await rec.start();
    } catch (e) {
      bb("lecture_mic_failed", { error: (e as Error).message });
      await window.milo.lecture.stop().catch(() => null);
      say("I can't use the microphone. Turn on the mic for me in System Settings, Privacy and Security.", { loud: true }).then(() => setBubble(null));
      return;
    }
    recRef.current = rec;
    setLecture(m);
    setLectureWarn(null);
    bb("lecture_start", { course: !!m.course });
    await say(
      `Got it. I'm listening${m.course ? ` to ${m.course}` : ""}. I'll stay quiet and make your notes when class is over. Say “class is over” or tap stop.${first ? " Heads up: check that your professor allows recording." : ""}`,
      { loud: true }
    );
    setBubble(null);
    // from here on: quiet, and no wake-word listening (the professor isn't talking to Milo)
    inClassRef.current = true;
    window.milo.home.echo("lecture", { on: true, course: m.course, startedAt: m.startedAt });
    earsBeforeClass.current = (ears.current?.mode as "always" | "off" | "once") ?? "off";
    if (ears.current?.mode === "always") await ears.current.setMode("off");
  };
  // "Not in this class": stop now and delete everything recorded. No notes. Milo remembers the class.
  /** "Milo, handle this": look, then offer 2-3 things instead of guessing. Tapping one runs it like a command. */
  const handleThis = async (said: string) => {
    setMenu(false);
    setChatOpen(false);
    setOffer(null);
    setMood("looking");
    say("Let me look.").then(() => undefined);
    const r = await window.milo.suggest(said || "handle this");
    setMood("idle");
    if (!r.ok && (r as { asked?: boolean }).asked) return; // "Which one?" buttons are up
    // couldn't see the screen (permission, paused): say so. Anything else (the AI stumbled): still offer the basics.
    if (!r.ok && /screen|paused|permission|privacy/i.test(r.text || "")) {
      say(r.text).then(() => setBubble(null));
      return;
    }
    if (!r.ok) {
      bb("suggest_fallback", { why: (r.text || "").slice(0, 80) });
      setOffer({ seen: "", options: [{ label: "Explain this", say: "explain this" }, { label: "Quiz me on this", say: "quiz me on this" }, { label: "Start this", say: "start this" }] });
      say("Here's what I can do with this.").then(() => setBubble(null));
      return;
    }
    // nothing specific came back: still offer the moves that work on almost any screen
    if (!r.options.length)
      r.options = [
        { label: "Explain this", say: "explain this" },
        { label: "Quiz me on this", say: "quiz me on this" },
        { label: "Start this", say: "start this" },
      ];
    setBubble(null);
    setOffer({ seen: r.seen, options: r.options });
    bb("offer_shown", { n: r.options.length });
    say(`${r.seen ? `${r.seen} ` : ""}Want me to ${r.options[0].label.toLowerCase()}?`).then(() => setBubble(null));
  };
  const pickOffer = (o: { label: string; say: string }) => {
    // "Which one?" buttons: remember that part of the screen, then do what they asked
    const area = o.say.match(/^__area:(\d+):(.*)$/s);
    if (area) {
      chipsRef.current = null;
      setOffer(null);
      hover(false);
      const t = targetOpts.current[Number(area[1])];
      bb("area_pick_chip", { label: o.label });
      if (t)
        void window.milo.areaSet(t.box).then(() => {
          setAreaFlash({ box: t.box, label: t.label, id: Date.now() });
          routeRef.current(area[2], false);
        });
      return;
    }
    if (o.say.startsWith("__pick:")) {
      chipsRef.current = null;
      setOffer(null);
      setPicking({ then: o.say.slice(7) || undefined });
      return;
    }
    chipsRef.current = null; // before routing: the chosen command must never be read as picking a button again
    setOffer(null);
    hover(false);
    bb("offer_picked", { label: o.label });
    routeRef.current(o.say, false);
  };
  /** Something dragged onto the frog: a file, a link, or some text. */
  const onDropToMilo = (e: React.DragEvent) => {
    e.preventDefault();
    const dt = e.dataTransfer;
    const file = dt.files?.[0];
    const url = (dt.getData("text/uri-list") || "").split("\n").find((l) => /^https?:\/\//.test(l.trim()))?.trim();
    const text = dt.getData("text/plain").trim();
    bb("drop", { file: !!file, url: !!url, text: !!text && !url });
    if (file) {
      const path = window.milo.pathForFile(file);
      say(`Opening ${file.name}.`).then(() => undefined);
      void window.milo.openDropped({ path }).then((r) => {
        if (r.ok) window.setTimeout(() => void handleThis(`handle this file: ${file.name}`), 1800);
        else void say(r.text || "I couldn't open that.").then(() => setBubble(null));
      });
      return;
    }
    if (url) {
      say("Opening it.").then(() => undefined);
      void window.milo.openDropped({ url }).then(() => window.setTimeout(() => void handleThis("handle this link"), 2500));
      return;
    }
    if (text) {
      const t = text.slice(0, 600);
      setOffer({
        seen: `“${t.slice(0, 60)}${t.length > 60 ? "…" : ""}”`,
        options: [
          { label: "Explain it", say: `explain this: ${t}` },
          { label: "Quiz me on it", say: `quiz me on this: ${t}` },
          { label: "Add to my notes", say: `add to my notes: ${t}` },
        ],
      });
      say("Got it. What should I do with it?").then(() => setBubble(null));
    }
  };

  /** The student's answer to "does this class allow recording?" */
  const answerLecAsk = async (allowed: boolean) => {
    const a = lecAsk;
    setLecAsk(null);
    if (!a) return;
    await window.milo.lecture.allow(a.classId, allowed);
    if (allowed) return void startLecture(a.said, true);
    say(`Got it. I won't record${a.course ? ` ${a.course}` : " this class"}. You can change that in Home base, Settings.`).then(() => setBubble(null));
  };
  const notInThisClass = async () => {
    const rec = recRef.current;
    if (!rec) return;
    recRef.current = null;
    await rec.stop().catch(() => {});
    inClassRef.current = false;
    window.milo.home.echo("lecture", { on: false });
    setLecture(null);
    setLectureWarn(null);
    if (earsBeforeClass.current === "always") await ears.current?.setMode("always");
    const r = await window.milo.lecture.discard();
    setMood("happy");
    await say(r.remembered ? `Done. I deleted that recording and I won't listen in ${r.course} again. You can change that in Home base, Settings.` : "Done. I deleted that recording. Nothing was saved.");
    setBubble(null);
  };

  const stopLecture = async () => {
    const rec = recRef.current;
    if (!rec) {
      say("I wasn't listening to a class.").then(() => setBubble(null));
      return;
    }
    recRef.current = null;
    await rec.stop();
    inClassRef.current = false;
    window.milo.home.echo("lecture", { on: false });
    setLecture(null);
    setLectureWarn(null);
    if (earsBeforeClass.current === "always") await ears.current?.setMode("always");
    setMood("thinking");
    setBubble("Making your lecture notes…");
    const r = await window.milo.lecture.stop();
    setMood(r.ok ? "happy" : "thinking");
    if (r.ok) sfx.success();
    await say(
      r.ok
        ? `Your notes on ${r.title} are ready: ${r.minutes} of class, ${r.flashcards} flashcards${r.alerts ? `, and ${r.alerts} thing${r.alerts > 1 ? "s" : ""} the professor flagged for the exam` : ""}. They're in your Notes.${r.needsClass ? " Which class was that?" : ""}`
        : r.text
    );
    setBubble(null);
    if (r.ok && r.needsClass && r.lectureId) {
      lectureClassAsk.current = { id: r.lectureId, at: Date.now() };
      waitForAnswer("say the class");
    }
  };
  // In class: every minute, check he can actually hear (quietly, on screen only)
  useEffect(() => {
    if (!lecture) return;
    setClock(Date.now());
    const tick = window.setInterval(() => setClock(Date.now()), 15e3); // the pill's minute counter
    const t = window.setInterval(() => {
      const rec = recRef.current;
      if (rec?.tooQuiet()) {
        setLectureWarn("I can barely hear. Move closer or use AirPods.");
        bb("lecture_quiet", {});
      } else setLectureWarn(null);
    }, 60e3);
    return () => {
      window.clearInterval(t);
      window.clearInterval(tick);
    };
  }, [lecture]);
  const startHomeworkRef = useRef(startHomework);
  startHomeworkRef.current = startHomework;
  const doItForMeRef = useRef<(item: { title: string; course: string; due: string }, submit?: boolean) => Promise<void>>(async () => {});
  /** "Want to start on X?" Work through it together (default), or Milo does it himself. */
  const offerStart = async (item: { title: string; course: string; due: string }) => {
    setMood("happy");
    bb("offer_start", { course: item.course });
    await say(
      `Want to start ${item.title}? I'll work through it with you, or if you're short on time, I can do it myself. Together?`
    );
    offerRef.current = { item, at: Date.now(), mode: "full" };
    waitForAnswer("say yes, or “do it for me”");
  };
  /** Their answer to the offer. Returns true if it was one. */
  const offerAnswer = (text: string): boolean => {
    const o = offerRef.current;
    if (!o || Date.now() - o.at > (o.mode === "full" ? 90e3 : 120e3)) return false;
    const a = parseOfferAnswer(text);
    if (!a || (o.mode === "do_only" && a !== "do" && a !== "do_submit")) {
      if (o.mode === "full") offerRef.current = null; // they said something else: drop the offer, do what they said
      return false;
    }
    offerRef.current = null;
    endAnswer(a);
    bb("offer_answer", { answer: a, mode: o.mode });
    if (a === "no") {
      say("No problem. Say “start my homework” whenever you're ready.").then(() => setBubble(null));
    } else if (a === "together") {
      void startHomework(`${o.item.title} ${o.item.course}`.trim(), true, { target: "", here: false }, o.item);
    } else {
      void doItForMe(o.item, a === "do_submit");
    }
    return true;
  };
  /** Milo does the assignment himself as a job. The job engine never submits without the student's yes. */
  // submit=false: he does it, then asks "want me to turn it in?" (the job engine pauses at the submit button).
  // submit=true: the student said "and turn it in", so that yes is already given.
  const doItForMe = async (item: { title: string; course: string; due: string }, submit = false) => {
    closePlan();
    setMood("happy");
    await say(submit ? "On it. I'll do it and turn it in when it's done." : "On it. I'll do the whole thing, then check with you before I turn it in.");
    setBubble("Planning it out…");
    const where = portal ? `In Chrome, go to ${portal}, open my ${item.course} course, open the assignment "${item.title}", and complete it.` : `Complete my assignment "${item.title}"${item.course ? ` for ${item.course}` : ""} on screen.`;
    const goal = `${where} The last step is submitting / turning it in.`;
    bb("offer_do", { submit, approved: submit, goal });
    void window.milo.jobStart(goal, { approved: submit });
  };
  doItForMeRef.current = doItForMe;
  const resumeHomework = async (text: string) => {
    const sp = findPlan(text);
    if (!sp) {
      await say("No plan saved yet. Say “start my stats homework” and I'll make one.");
      setBubble(null);
      return;
    }
    hush();
    setChatOpen(false);
    showPlan({ ...sp, at: Date.now() });
    sfx.lock();
    await say(`Back to ${sp.plan.title}. ${stepLine(sp, nextStep(sp))}`);
    setBubble(null);
  };
  /** While a plan is up: "next", "what's next", "do this step with me", "skip", "close the plan". */
  const planVoice = (text: string, spoken: boolean): boolean => {
    const sp = gpRef.current;
    if (!sp) return false;
    const v = parsePlanVoice(text, !!lessonRef.current);
    if (!v) return false;
    bb("route_instant", { text, kind: "plan_voice", ...v });
    const idx = v.step ? v.step - 1 : undefined;
    if (v.do === "done") void finishStep(idx);
    else if (v.do === "with_me") stepWithMe(idx, spoken);
    else if (v.do === "skip") skipStep(idx);
    else if (v.do === "undo") undoStep(idx);
    else if (v.do === "next_info") {
      const n = nextStep(sp);
      say(n < 0 ? "Every step's done. Submit it!" : stepLine(sp, n)).then(() => setBubble(null));
    } else {
      closePlan();
      say("Saved. Say “pick up my homework” anytime.").then(() => setBubble(null));
    }
    return true;
  };

  // Sync came through (sign-in, startup, every 5 min, or a change): game plans too, and refresh the open one.
  useEffect(
    () =>
      window.milo.onSyncNow(async () => {
        const n = await syncPlans();
        if (!n || !gpRef.current) return;
        const fresh = loadPlans().find((x) => x.key === gpRef.current?.key);
        if (fresh && fresh.at > gpRef.current.at) {
          gpRef.current = fresh;
          setGp(fresh);
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // A new version of Milo downloaded: tell them once, show a small pill. It also installs on its own next quit.
  const [updateReady, setUpdateReady] = useState<string | null>(null);
  useEffect(
    () =>
      window.milo.onUpdateReady((v) => {
        setUpdateReady(v || "new");
        bb("update_ready_shown", { version: v });
        if (!radarBusy.current) say("There's a new version of me. Restart me whenever you're ready, or I'll update next time you quit.").then(() => setBubble(null));
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // ---- Deadline radar ---------------------------------------------------------------------------
  // Scans D2L in the background (startup + every 3 h), remembers every assignment, catches NEW and MOVED ones,
  // and warns 3 days out, the day before and the morning of: at a calm moment, with a Start button.
  const [radar, setRadarState] = useState<Radar>(() => {
    try {
      const r = JSON.parse(localStorage.getItem("milo.radar") || "null");
      return r && Array.isArray(r.items) ? r : emptyRadar();
    } catch {
      return emptyRadar();
    }
  });
  const radarRef = useRef(radar);
  radarRef.current = radar;
  const setRadar = (r: Radar) => {
    radarRef.current = r;
    setRadarState(r);
    try {
      localStorage.setItem("milo.radar", JSON.stringify(r));
    } catch {
      /* ignore */
    }
  };
  const [radarView, setRadarView] = useState<RadarView | null>(null);
  const radarViewRef = useRef<RadarView | null>(null);
  radarViewRef.current = radarView;
  const [radarScan, setRadarScan] = useState(0); // > 0 while the hidden D2L view is reading
  const radarAfter = useRef<((ok: boolean) => void) | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const radarBusy = useRef(false); // is now a bad moment to interrupt? (kept fresh every render, below)
  const ingest = (items: ScanItem[]) => setRadar(mergeScan(radarRef.current, items, Date.now()));
  /** Read the calendar feed (if connected) into the radar. Resolves true if it worked. */
  const scanFeed = async (): Promise<boolean> => {
    if (!feed) return false;
    const r = await window.milo.feedFetch(feed).catch(() => ({ ok: false, text: "" }));
    if (!r.ok) {
      bb("feed_scan", { ok: false, why: r.text.slice(0, 120) });
      return false;
    }
    const items = parseIcs(r.text);
    bb("feed_scan", { ok: true, items: items.length });
    if (!portal) {
      // no hidden D2L scan to bump the scan count: count this one
      setRadar({ ...mergeScan(radarRef.current, items, Date.now()) });
    } else ingest(items);
    return true;
  };
  const scanRadar = (after?: (ok: boolean) => void) => {
    const fed = scanFeed();
    if (portal) {
      // D2L's own calendar data first: every class, about a second, no AI. Only if that fails, the page-reading scan.
      void window.milo.d2lDue(portal).then((r) => {
        bb("radar_d2l", r.ok ? { ok: true, items: r.items.length } : { ok: false, signin: r.signin });
        if (r.ok) {
          ingest(r.items);
          if (after) after(true);
          else checkAlerts();
          return;
        }
        radarAfter.current = after ?? null;
        setRadarScan(Date.now());
      });
      return;
    }
    if (!portal) {
      void fed.then((ok) => (after ? after(ok) : ok && checkAlerts()));
      return;
    }
    radarAfter.current = after ?? null;
    setRadarScan(Date.now());
  };
  /** "Connect my calendar": take the feed link they just copied, or tell them where to find it. */
  const connectFeed = async () => {
    setMood("thinking");
    const r = await window.milo.feedConnect();
    if (!r.ok) {
      const help = LMS[detectLms(portal)].feedHelp;
      setMood("idle");
      say(r.reason === "no_link" ? `Copy your calendar link first. ${help} Then say connect my calendar.` : `That link didn't work as a calendar feed. ${help}`).then(() => setBubble(null));
      return;
    }
    localStorage.setItem("milo.feed", r.url);
    setFeed(r.url);
    const items = parseIcs(r.text);
    setRadar(mergeScan(radarRef.current, items, Date.now()));
    bb("feed_connected", { items: items.length, lms: detectLms(r.url) });
    sfx.success();
    setMood("happy");
    const soon = items.filter((x) => x.due_iso && x.due_iso < new Date(Date.now() + 7 * 86400e3).toISOString().slice(0, 16)).length;
    say(`Connected! I can see ${items.length} things on your calendar${soon ? `, ${soon} due this week` : ""}. I'll warn you before anything's due.`).then(() => setBubble(null));
  };
  const onRadarScan = (st: BriefState) => {
    setRadarScan(0);
    const ok = st.phase === "ready";
    if (ok) ingest(st.items);
    bb("radar_scan", { ok, phase: st.phase, items: ok ? st.items.length : 0, known: radarRef.current.items.length });
    const after = radarAfter.current;
    radarAfter.current = null;
    if (after) after(ok);
    else if (ok) checkAlerts();
  };
  const badges = (x: RadarItem, now: number): Warn[] => {
    const w: Warn[] = [];
    if (radarRef.current.scans > 1 && now - x.firstSeen < 3 * 86400e3) w.push("new");
    if (x.movedAt && now - x.movedAt < 3 * 86400e3) w.push("moved");
    return w;
  };
  /** Warn about what's due, if there's anything to say and it's a calm moment. */
  const checkAlerts = (force = false) => {
    const now = Date.now();
    setClock(now);
    const h = new Date(now).getHours();
    if (!force && (h < 8 || h >= 23 || radarBusy.current)) return;
    const pa = pendingAlerts(radarRef.current, now);
    if (!pa.length) return;
    setRadar(markWarned(radarRef.current, pa, now));
    setBrief((b) => (b?.phase === "ready" ? null : b)); // the warning takes the morning card's place
    setRadarView({ mode: "alert", rows: pa.slice(0, 5).map((a) => ({ item: a.item, why: a.why })), title: pa.length === 1 ? "Heads up" : `${pa.length} things coming up` });
    bb("radar_alert", { items: pa.map((a) => ({ title: a.item.title, why: a.why })) });
    sfx.chime();
    setMood("happy");
    say(alertLine(pa, now)).then(() => setBubble(null));
  };
  const showRadarList = (days: number, speak = true, old = false) => {
    const now = Date.now();
    setClock(now);
    const rows = upcoming(radarRef.current, now, days)
      .slice(0, 8)
      .map((item) => ({ item, why: badges(item, now) }));
    const range = days === 0 ? "today" : days === 1 ? "by tomorrow" : days <= 7 ? "this week" : days <= 14 ? "in the next two weeks" : "coming up";
    setRadarView({ mode: "list", rows, title: days === 0 ? "Due today" : days === 1 ? "Due by tomorrow" : days <= 7 ? "Due this week" : "Coming up" });
    if (!speak) return;
    const x = rows[0]?.item;
    const line = !x
      ? `Nothing due ${range}. You're all caught up.`
      : `${rows.length === 1 ? "One thing" : `${rows.length} things`} ${range}. First up: ${x.title}${x.course ? ` for ${x.course}` : ""}, due ${whenText(x.dueAt, now, x.due)}.`;
    say(old ? `I couldn't reach D2L just now, so this is from my last check. ${line}` : line).then(() => setBubble(null));
  };
  /** "what's due this week": answer instantly from the radar; re-check D2L first only if it's stale. */
  const askRadar = (days: number) => {
    // Fresh enough: answer instantly from what the radar already knows.
    if (radarRef.current.scans > 0 && Date.now() - radarRef.current.lastScan < 3 * 3600e3) return showRadarList(days);
    if (!portal && !feed) {
      if (radarRef.current.items.length) return showRadarList(days); // a bit old, but better than nothing
      return startBrief(true); // walks them through adding D2L
    }
    setMood("looking");
    setBubble("Checking D2L…");
    scanRadar((ok) => {
      setBubble(null);
      if (!ok && radarRef.current.scans === 0) return startBrief(true); // probably needs to sign in
      if (!ok && !upcoming(radarRef.current, Date.now(), days).length) {
        // Never say "all caught up" when he couldn't actually check.
        bb("radar_unchecked", { days });
        setMood("thinking");
        void fixD2l().then((ok) => ok && askRadar(days)); // never "all caught up" when he couldn't check
        return;
      }
      showRadarList(days, true, !ok);
    });
  };
  const startFromRadar = (x?: RadarItem) => {
    const item = x ?? radarViewRef.current?.rows[0]?.item ?? upcoming(radarRef.current, Date.now())[0];
    setRadarView(null);
    if (!item) return askRadar(Infinity);
    bb("radar_start", { title: item.title, course: item.course });
    void startHomework(`start my ${item.course} homework`, false, { target: item.course, here: false }, { title: item.title, course: item.course, due: item.due });
  };
  // Background scans: shortly after startup if the last one is old, then every 3 hours. Warnings checked every minute.
  useEffect(() => {
    if (!portal && !feed) return;
    const stale = () => Date.now() - radarRef.current.lastScan > 3 * 3600e3;
    const first = window.setTimeout(() => stale() && !radarScan && scanRadar(), 90e3);
    const every = window.setInterval(() => stale() && scanRadar(), 10 * 60e3);
    const alerts = window.setInterval(() => checkAlerts(), 60e3);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(every);
      window.clearInterval(alerts);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portal, feed]);

  // During setup Milo stands to the left of the card, so he can talk you through it.
  useEffect(() => {
    if (!setup) return;
    const x = signIn ? 24 : Math.max(16, window.innerWidth / 2 - 260 - 150); // D2L window open on the right: step out of the way
    const t = window.setTimeout(() => moveTo({ x, y: window.innerHeight / 2 - 30 }, "jump"), 400);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setup, signIn]);
  const finishSetup = () => {
    try {
      localStorage.setItem("milo.onboarded", "1");
      localStorage.removeItem("milo.setupStep");
      localStorage.setItem("milo.lastBrief", new Date().toDateString());
    } catch {
      /* ignore */
    }
    bb("setup_done", { portal: !!portal, name: !!name });
    setSetup(false);
    hover(false);
    moveTo(home(), "jump");
    firstBrief.current = true;
    if (portal) window.setTimeout(() => startBrief(true), 900); // the first thing he does: tell you what's due, then offer to start
  };

  /** "Open chrome, find a worksheet, and complete it": the computer part first, then the screen job on what's open. */
  const runChain = async (steps: Intent[], spoken: boolean) => {
    const last = steps[steps.length - 1];
    const what =
      last.kind === "sweep" ? "do the whole thing" : last.kind === "quiz" ? "quiz you on it" : last.kind === "look" ? "work through it" : "take a look";
    setBubble(null);
    await say(`Got it. First I'll find it, then I'll ${what}.`);
    setBubble(null);
    for (let i = 0; i < steps.length; i++) {
      const st = steps[i];
      if (st.kind === "task") {
        const ok = await runTask(st.task, spoken, true);
        if (!ok) return; // stopped, failed, or waiting on a yes/no: don't charge ahead
        await sleep(1200); // let the page finish drawing before Milo reads it
        continue;
      }
      if (st.kind === "sweep") return runSweep();
      if (st.kind === "quiz") return startQuiz(st.focus);
      if (st.kind === "look") {
        setMode(st.mode);
        return look(st.mode, st.request, null, spoken);
      }
      if (st.kind === "checkwork") return checkWorkNow();
      if (st.kind === "watch") return setWatch(st.on);
    }
  };

  // Follow Milo's hands: hop next to whatever he's about to click, show what he's doing.
  useEffect(
    () =>
      window.milo.onTaskStep((st) => {
        // Never repeat the same line back to back; it sounds glitchy.
        const norm = st.say.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
        if (norm && norm !== lastStepSay.current) {
          lastStepSay.current = norm;
          setBubble(st.say); // shown, not spoken: saves voice credits and keeps tasks quick
        }
        if (st.action === "typing" || st.action === "type") {
          // Step aside so the text he's typing isn't hidden behind him:
          // go to the screen edge farther from where he clicked.
          const p = lastStepPoint.current;
          const W = window.innerWidth;
          const x = p && p.x < W / 2 ? W - MILO_W - 20 : 20;
          const y = clamp((p?.y ?? window.innerHeight / 2) - MILO_H / 2, MARGIN, window.innerHeight - MILO_H - 8);
          lastStepPoint.current = null;
          moveTo({ x, y }, "jump").then(() => {
            setFacing(x > W / 2 ? "left" : "right");
            setMood("writing");
          });
        }
        if (st.point && lastStepPoint.current && Math.hypot(st.point.x - lastStepPoint.current.x, st.point.y - lastStepPoint.current.y) < 30) {
          setMood("pointing"); // already standing there
        } else if (st.point) {
          lastStepPoint.current = st.point;
          // Stand just to the left of the spot (or right if no room) so he never covers it.
          const left = st.point.x - MILO_W - 18;
          const x = left > MARGIN ? left : st.point.x + 18;
          moveTo({ x, y: st.point.y - MILO_H * 0.6 }, "jump").then(() => {
            setFacing(x < st.point!.x ? "right" : "left");
            setMood("pointing");
          });
        } else if (st.action === "open_app" || st.action === "open_url") {
          setMood("jumping");
        }
      }),
    [moveTo]
  );

  // ---- Worksheet Sweep: every question, solved and filled in --------------------------
  /** Fill in or just show, switchable mid-worksheet from the progress bar. */
  const sweepFill = useRef(true);
  const runSweep = async (fillOverride?: boolean, fromTop = false) => {
    if (await heldBack("fill", "")) return;
    runId.current++;
    hush();
    setChatOpen(false);
    setLesson(null);
    setBox(null);
    setResearchQ(null);
    hover(false);
    sweepStop.current = false;
    const results: SweepState["results"] = [];
    let state: SweepState = { items: [], index: -1, status: "scanning", results };
    const show = (patch: Partial<SweepState>) => {
      state = { ...state, ...patch, results: [...results], fill: sweepFill.current };
      setSweep(state);
    };
    show({});
    setMood("looking");
    // fill in by default (Settings can change that); "show me the answers" or the progress-bar button = just show
    sweepFill.current =
      fillOverride ??
      (await window.milo.prefs
        .get()
        .then((p) => p.autofill !== false)
        .catch(() => true));
    show({ fill: sweepFill.current });
    say(sweepFill.current ? "Reading the whole page." : "Reading the whole page. I'll show you each answer and how I got it, you type it in.").then(() => setBubble(null));

    const ask = lastAsk.current; // "...and fill in Jake for the name": the whole request goes with the plan
    // start at the top so nothing above the fold is missed (worksheets are longer than the screen)
    if (fromTop || sweepFill.current) await window.milo.scrollTop();
    // one question: lock on, put the answer in (or just show it)
    const doItem = async (it: SweepItem, items: SweepItem[], i: number) => {
      show({ items, index: i, status: "working" });
      setBox(it.box);
      setLocked(true);
      sfx.lock();
      await moveTo({ x: it.box.x + it.box.width + 12, y: it.box.y - MILO_H * 0.35 }, "jump");
      setMood("writing");
      await sleep(900); // time to read the work card
      let filled = false;
      if (sweepFill.current && it.kind !== "none" && it.screen) {
        setMood("pointing");
        const r = await window.milo.sweepFill(it);
        filled = r.ok;
        if (r.ok) sfx.tick();
      }
      const prev = results.findIndex((r) => r.label === it.label);
      if (prev >= 0) results[prev] = { label: it.label, answer: it.answer, filled };
      else results.push({ label: it.label, answer: it.answer, filled });
      show({});
      await sleep(250);
    };

    for (let page = 0; page < 5; page++) {
      // skip only what was really done; a box too close to the bottom waits for the next scroll
      const plan = await window.milo.sweepPlan(
        results.map((r) => r.label),
        ask,
        name
      );
      if (sweepStop.current) return show({ status: "stopped" });
      if (!plan.ok) {
        setMood("idle");
        return show({ status: "error", message: plan.text });
      }
      const items = plan.items;
      if (!items.length && page === 0) {
        setMood("idle");
        await say("I don't see any questions to answer on this page.");
        setBubble(null);
        return setSweep(null);
      }
      const now = items.filter((it) => !it.later);
      for (let i = 0; i < now.length; i++) {
        if (sweepStop.current) return show({ status: "stopped" });
        await doItem(now[i], items, items.indexOf(now[i]));
      }
      if (!plan.more && now.length === items.length) break;
      show({ status: "scrolling" });
      setBox(null);
      await window.milo.scrollPage();
    }

    // Did I miss anything? Back to the top and look for questions that still have no answer, then fix them.
    const missed: string[] = [];
    if (sweepFill.current && results.some((r) => r.filled) && !sweepStop.current) {
      show({ status: "scanning" });
      setBox(null);
      say("Double-checking I got everything.").then(() => setBubble(null));
      await window.milo.scrollTop();
      for (let page = 0; page < 4; page++) {
        const plan = await window.milo.sweepPlan([], ask, name);
        if (sweepStop.current || !plan.ok) break;
        const blanks = plan.items.filter((it) => !it.later && it.kind !== "none");
        bb("sweep_verify", { page, blanks: blanks.map((b) => b.label) });
        for (let i = 0; i < blanks.length; i++) {
          if (sweepStop.current) break;
          await doItem(blanks[i], plan.items, plan.items.indexOf(blanks[i]));
        }
        // a second look at the same spot: anything still blank there didn't take
        if (blanks.length) {
          const again = await window.milo.sweepPlan([], ask, name);
          if (again.ok) for (const it of again.items) if (!it.later && blanks.some((b) => b.label === it.label) && !missed.includes(it.label)) missed.push(it.label);
        }
        if (!plan.more) break;
        await window.milo.scrollPage();
      }
      for (const m of missed) {
        const r = results.find((x) => x.label === m);
        if (r) r.filled = false;
      }
    }

    setBox(null);
    show({ status: "done" });
    sweepDoneAt.current = Date.now();
    moveTo(home(), "jump");
    const filled = results.filter((r) => r.filled).length;
    setMood(missed.length ? "idle" : "celebrating");
    if (!missed.length) sfx.success();
    // say only what's true: what's in, and what still needs them
    await say(
      !sweepFill.current
        ? `Done. ${results.length} answer${results.length === 1 ? "" : "s"} on screen for you to type in.`
        : missed.length
          ? `Filled ${filled} of ${results.length}. I couldn't get ${missed.length === 1 ? "number" : "numbers"} ${missed.join(" and ")} to stick. Can you fill ${missed.length === 1 ? "that one" : "those"} in? The answers are on the card.`
          : `Done. All ${filled} filled in. Give it a quick look before you submit.`
    );
    setBubble(null);
    setMood("happy");
  };
  const stopSweep = () => {
    sweepStop.current = true;
    window.milo.stopTask();
    hush();
  };
  const closeSweep = () => {
    sweepStop.current = true;
    setSweep(null);
    setBox(null);
    setLocked(false);
    hover(false);
  };

  // ---- Build-a-Tool ---------------------------------------------------------------
  const closeOthers = () => {
    kitRef.current?.close();
    runId.current++;
    hush();
    setChatOpen(false);
    setLesson(null);
    setBox(null);
    setResearchQ(null);
    setSweep(null);
  };
  const startBuild = (request: string) => {
    closeOthers();
    setRpSize("compact");
    setTool({ request, id: Date.now() });
    setMood("writing");
    say("Building it now. Watch.").then(() => setBubble(null));
    setTimeout(() => window.milo.build(request), 60);
  };
  const openTool = (t: SavedTool) => {
    closeOthers();
    setRpSize("half");
    setTool({ request: t.title, id: Date.now(), existing: t });
    setMood("happy");
  };
  const closeTool = () => {
    window.milo.stopBuild();
    setTool(null);
    hover(false);
    setMood("idle");
  };
  const onToolDone = async (title: string) => {
    setMood("celebrating");
    sfx.success();
    setRpSize((s) => (s === "compact" ? "half" : s)); // give the new tool room
    await say(`Done. Your ${title} is ready.`);
    setBubble(null);
    setMood("happy");
  };
  const onToolSaved = (t: SavedTool) => {
    const next = [t, ...tools.filter((x) => x.id !== t.id)];
    setTools(next);
    saveTools(next);
  };

  // ---- Watch Me Work ----------------------------------------------------------------
  const watchBusy = useRef(false);
  const lastFlag = useRef<MiloBox | null>(null);
  const showMistake = async (b: MiloBox, hint: string) => {
    setChatOpen(false);
    hover(false);
    setFlag({ box: b, hint });
    sfx.alert();
    // Stand to the right of the mistake (usually empty space), or the left if there's no room.
    const right = b.x + b.width + 14;
    const onRight = right + MILO_W < window.innerWidth - MARGIN;
    await moveTo({ x: onRight ? right : b.x - MILO_W - 14, y: b.y + b.height / 2 - MILO_H * 0.55 }, "jump");
    setFacing(onRight ? "left" : "right");
    setMood("pointing");
    await say(hint);
    setBubble(null);
    setTimeout(() => setFlag((f) => (f && f.box === b ? null : f)), 7000);
    setMood("idle");
  };
  const checkOnce = async (force: boolean) => {
    if (watchBusy.current) return null;
    watchBusy.current = true;
    try {
      return await window.milo.watchCheck(force);
    } finally {
      watchBusy.current = false;
    }
  };
  // Every few seconds, if the screen changed and Milo isn't busy, take a quiet look.
  useEffect(() => {
    if (!watching) return;
    const t = window.setInterval(async () => {
      if (lessonRef.current || working || sweep || tool || researchQ || speaking) return;
      const r = await checkOnce(false);
      if (!r || !r.ok || !r.changed || !r.mistake || !r.box) return;
      const p = lastFlag.current;
      if (p && Math.hypot(p.x - r.box.x, p.y - r.box.y) < 40) return; // already told you about this one
      lastFlag.current = r.box;
      showMistake(r.box, r.hint || "Take another look at this part.");
    }, 6000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watching, working, sweep, tool, researchQ, speaking]);

  const setWatch = (on: boolean) => {
    setChatOpen(false);
    setWatching(on);
    lastFlag.current = null;
    window.milo.watchReset();
    if (!on) setFlag(null);
    say(on ? "Okay, I'll watch quietly and only speak up if something's off." : "Okay, I stopped watching.").then(() => setBubble(null));
  };
  /** "Milo, check this": the work on screen vs. the rubric they copied / instructions on screen. Never blocks Submit. */
  const runPreflight = async () => {
    setPreflight(null);
    setMood("looking");
    setBubble("Checking your work against the requirements…");
    const r = await window.milo.preflight();
    setBubble(null);
    if (!r.ok && (r as { asked?: boolean }).asked) return void setMood("idle"); // "Which one?" buttons are up
    if (!r.ok) return say(r.text || "I couldn't check right now.").then(() => setBubble(null));
    const fix = r.items.filter((i) => i.status === "confirmed").length;
    const look = r.items.filter((i) => i.status === "possible").length;
    bb("preflight_done", { items: r.items.length, fix, look, rubric: !!r.rubricFrom });
    setPreflight(r);
    setMood(fix ? "pointing" : "happy");
    if (!fix && !look) sfx.success();
    const line = !r.items.length
      ? r.requirements_seen
        ? "Everything I can check looks good. Nice."
        : "I didn't see a rubric, but nothing looks wrong. Copy the rubric and ask again for a real check."
      : `${fix ? `${fix} thing${fix > 1 ? "s" : ""} to fix` : ""}${fix && look ? ", " : ""}${look ? `${look} to double-check` : ""}.`;
    say(line).then(() => setBubble(null));
  };
  const checkWorkNow = async () => {
    setChatOpen(false);
    hover(false);
    if (await heldBack("check", "")) return;
    // beta: the rubric-aware check, if the student turned it on
    if ((await window.milo.prefs.get().catch(() => null))?.preflight) return runPreflight();
    setMood("looking");
    setBubble("Checking your work…");
    const r = await checkOnce(true);
    setBubble(null);
    if (!r || !r.ok) return say(r && !r.ok ? r.text : "I couldn't check right now.").then(() => setBubble(null));
    if (r.mistake && r.box) return showMistake(r.box, r.hint || "Take another look at this part.");
    setMood("happy");
    sfx.tick();
    await say("Looks right so far.");
    setBubble(null);
  };

  // ---- Daily Brief ------------------------------------------------------------------
  const greeting = () => {
    const h = new Date().getHours();
    const part = h < 5 ? "Hey" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
    return `${part}${name ? `, ${name}` : ""}.`;
  };
  const startBrief = (spoken: boolean) => {
    if (!portal) {
      setBrief({ phase: "setup" });
      say(greeting()).then(() => setBubble(null));
      return;
    }
    setBrief({ phase: "loading" });
    if (spoken) setMood("looking");
    // D2L's own data first: uses the sign-in in Chrome, about a second, no AI. Reading the page only if that fails.
    void window.milo.d2lDue(portal).then((r) => {
      bb("brief_d2l", r.ok ? { ok: true, items: r.items.length } : { ok: false, signin: r.signin });
      if (!r.ok) return setBriefRun(Date.now());
      const now = Date.now();
      const week = r.items
        .filter((x) => {
          const t = x.due_iso ? new Date(x.due_iso).getTime() : NaN;
          return !isNaN(t) && t > now - 6 * 3600e3 && t < now + 7 * 86400e3;
        })
        .map((x) => ({ ...x, urgent: new Date(x.due_iso!).getTime() - now < 48 * 3600e3 }));
      const first = week[0];
      const spokenLine = first ? `You've got ${week.length === 1 ? "one thing" : `${week.length} things`} due this week. First up: ${first.title}${first.course ? ` for ${first.course}` : ""}, due ${first.due}.` : "";
      void onBrief({ phase: "ready", items: week, spoken: spokenLine });
    });
  };
  /** Save D2L's calendar link once (quietly), so "what's due" works even when every sign-in has run out. */
  /** Keep Milo's classes lined up with D2L (once a day, and right after D2L is connected). */
  const syncClasses = async (p = portal, force = false) => {
    if (!p) return;
    try {
      if (!force && localStorage.getItem("milo.classesSynced") === new Date().toDateString()) return;
      localStorage.setItem("milo.classesSynced", new Date().toDateString());
    } catch {
      /* ignore */
    }
    const r = await window.milo.classesSync(p).catch(() => null);
    bb("classes_sync", { changed: !!r?.changed, added: r?.added?.length ?? 0 });
    if (r?.changed && r.names?.length) say(`I lined up your classes with D2L: ${r.names.join(", ")}.`).then(() => setBubble(null));
  };
  const saveFeed = (url: string) => {
    try {
      localStorage.setItem("milo.feed", url);
    } catch {
      /* ignore */
    }
    setFeed(url);
  };
  const ensureFeed = async (p = portal) => {
    if (!p || feed) return;
    const url = await window.milo.d2lFeedUrl(p).catch(() => null);
    bb("feed_auto", { found: !!url });
    if (url) return saveFeed(url);
    // No link yet: D2L only makes one after "Reset" on its Subscribe page. Offer it once.
    let asked = true;
    try {
      asked = localStorage.getItem("milo.feedOffered") === "1";
    } catch {
      /* ignore */
    }
    // TCU's D2L hides its Subscribe button and its Reset doesn't work outside the calendar, so the offer is off for now.
    // Still there by voice: "set up my calendar backup" / "connect my calendar".
    void asked;
  };
  /** "Want a backup so I can always see what's due?" Yes: open D2L's Subscribe page, they tap Reset, Milo saves the link. */
  const feedOfferRef = useRef<{ portal: string; at: number } | null>(null);
  const offerFeed = async (p: string) => {
    if (speakingRef.current || offerRef.current || feedOfferRef.current) return window.setTimeout(() => void offerFeed(p), 8000); // never talk over something else
    try {
      localStorage.setItem("milo.feedOffered", "1");
    } catch {
      /* ignore */
    }
    bb("feed_offer", {});
    setMood("happy");
    await say("Want a backup so I can always see what's due, even if you get signed out? I'll open a D2L page. Just tap Reset.");
    feedOfferRef.current = { portal: p, at: Date.now() };
    waitForAnswer();
  };
  const feedAnswer = (text: string): boolean => {
    const o = feedOfferRef.current;
    if (!o || Date.now() - o.at > 60e3) return false;
    const a = parseAnswer(text);
    feedOfferRef.current = null;
    if (!a) return false;
    endAnswer(a);
    bb("feed_offer_answer", { answer: a });
    if (a === "no") {
      say("No problem. Say “set up my calendar backup” anytime.").then(() => setBubble(null));
      return true;
    }
    void setUpFeed(o.portal);
    return true;
  };
  const setUpFeed = async (p: string) => {
    const page = await window.milo.d2lSubscribeUrl(p);
    if (!page) {
      say("I couldn't open D2L's calendar page. Make sure you're signed in to D2L, then try again.").then(() => setBubble(null));
      return;
    }
    const chrome = await window.milo.d2lOpenChrome(page);
    await say(chrome ? "Opened it in Chrome. Tap Reset, and I'll grab the link." : "Opened it. Tap Reset, and I'll grab the link.");
    setBubble(null);
    for (let i = 0; i < 40; i++) {
      await new Promise((res) => setTimeout(res, 3000));
      const url = await window.milo.d2lFeedUrl(p).catch(() => null);
      if (url) {
        saveFeed(url);
        bb("feed_set", { seconds: (i + 1) * 3 });
        sfx.success();
        setMood("happy");
        await say("Got it. Your backup is set. You can close that tab.");
        setBubble(null);
        return;
      }
    }
    bb("feed_set_timeout", {});
  };
  /** Signed out of D2L: Chrome first (sign in there, Milo picks it up), else Milo's own sign-in. Never a wrong answer. */
  const fixingD2l = useRef(false);
  const fixD2l = async (): Promise<boolean> => {
    if (!portal || fixingD2l.current) return false;
    fixingD2l.current = true;
    try {
      const c = await window.milo.d2lCheck(portal);
      if (c.ok) return true;
      bb("d2l_fix", { chrome: c.chrome });
      setMood("thinking");
      if (!c.chrome) {
        setBrief(null);
        setSignIn(true); // Milo's own sign-in window
        await say("Your D2L sign-in ran out. Sign in here once, and check “Keep me signed in” so I won't ask again.");
        setBubble(null);
        return false;
      }
      await say("Your D2L sign-in ran out. I'm opening it in Chrome. Sign in there, and check “Keep me signed in.” I'll pick it up on my own.");
      setBubble(null);
      await window.milo.d2lOpenChrome(portal);
      for (let i = 0; i < 45; i++) {
        await new Promise((res) => setTimeout(res, 4000));
        if ((await window.milo.d2lCheck(portal)).ok) {
          bb("d2l_fixed", { via: "chrome", seconds: (i + 1) * 4 });
          sfx.success();
          setMood("happy");
          await say("Got it, you're signed in.");
          setBubble(null);
          void ensureFeed();
          void syncClasses(portal, true);
          return true;
        }
      }
      bb("d2l_fix_timeout", {});
      return false;
    } finally {
      fixingD2l.current = false;
    }
  };
  const onBrief = async (st: BriefState) => {
    setBrief(st);
    if (st.phase === "ready") {
      try {
        localStorage.setItem("milo.briefItems", JSON.stringify(st.items));
      } catch {
        /* ignore */
      }
      const r = mergeScan(radarRef.current, st.items, Date.now());
      setRadar(markWarned(r, pendingAlerts(r, Date.now()).filter((a) => !a.why.includes("moved")), Date.now()));
    }
    setBriefRun(0);
    if (st.phase === "ready") {
      setMood("happy");
      await say(`${greeting()} ${st.spoken || (st.items.length ? "" : "Nothing due soon. You're all caught up.")}`.trim());
      setBubble(null);
      if (firstBrief.current) {
        firstBrief.current = false;
        const it = firstOffer(st.items);
        if (it) await offerStart(it);
      }
    } else if (st.phase === "signin") {
      setBrief(null);
      if (await fixD2l()) startBrief(false);
    }
  };
  const setPortalUrl = (url: string) => {
    const u = /^https?:\/\//.test(url) ? url : `https://${url}`;
    setPortal(u);
    try {
      localStorage.setItem("milo.portal", u);
    } catch {
      /* ignore */
    }
    // Already signed in to D2L in Chrome? Then there's nothing to sign in to.
    void window.milo.d2lCheck(u).then((c) => {
      bb("portal_set", { signedIn: c.ok, via: c.via ?? null, chrome: c.chrome });
      if (c.ok) {
        setBrief(null);
        say("You're already signed in to D2L, so I'm connected.").then(() => setBubble(null));
        scanRadar();
        void ensureFeed(u);
        void syncClasses(u, true);
      } else setBrief({ phase: "signin" });
    });
  };
  // Greet once a day when Milo starts.
  useEffect(() => {
    const today = new Date().toDateString();
    let last = "";
    try {
      last = localStorage.getItem("milo.lastBrief") || "";
      localStorage.setItem("milo.lastBrief", today);
    } catch {
      /* ignore */
    }
    if (last === today) return;
    if (!setupDone()) return; // first run: setup comes first, the brief after
    const t = window.setTimeout(() => startBrief(false), 1500);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When a panel goes half screen, Milo steps to its left edge so he's never hidden behind it.
  useEffect(() => {
    if (!(researchQ || tool || quiz)) return;
    if (rpSize === "half") moveTo({ x: Math.round(window.innerWidth / 2) - MILO_W - 28, y: home().y }, "jump");
    else if (rpSize === "compact") moveTo(home(), "jump");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rpSize, !!(researchQ || tool || quiz)]);

  // ---- Exam-proof mode: a practice test like the real one, from what this class covered ----
  const lastForecastCourse = useRef("");
  const startExam = async (kind: string, course: string) => {
    const now = Date.now();
    const cls = course || upcoming(radarRef.current, now, 21).find((x) => /exam|quiz|midterm|final|test/i.test(`${x.kind} ${x.title}`))?.course || "";
    if (!cls) {
      say(`Which class? Say it like: make me a practice ${kind} for stats.`).then(() => setBubble(null));
      return;
    }
    closeOthers();
    setTool(null);
    setQuiz(null);
    hover(false);
    setMood("thinking");
    void say(`On it. Writing your practice ${kind} now, give me a few seconds.`); // it takes ~15s: say so right away
    setBubble(`Writing your practice ${kind}…`);
    const soon = upcoming(radarRef.current, now, 30)
      .filter((x) => !course || x.course.toLowerCase().includes(course.toLowerCase()) || course.toLowerCase().includes(x.course.toLowerCase()))
      .slice(0, 8)
      .map((x) => `${x.title} (${x.kind}, due ${x.due})`)
      .join("; ");
    const r = await window.milo.exam({ course: cls, kind, extra: soon });
    setBubble(null);
    if (!r.ok || !r.questions.length) {
      setMood("idle");
      await say(r.ok ? "I couldn't write that one. Save some notes to the class first?" : r.text);
      setBubble(null);
      return;
    }
    bb("exam_made", { course: cls, kind, questions: r.questions.length });
    setRpSize("half");
    setMood("happy");
    setQuiz({ id: Date.now(), topic: r.topic, questions: r.questions, focus: `practice ${kind}` });
    say(`Here's your practice ${kind}. ${r.questions.length} questions, just like the real thing. No peeking at notes!`).then(() => setBubble(null));
  };

  // ---- Quiz Mode --------------------------------------------------------------------
  const startQuiz = async (focus: string) => {
    closeOthers();
    setTool(null);
    setQuiz(null);
    hover(false);
    setMood("looking");
    setBubble("Writing your quiz…");
    const r = await window.milo.quiz(focus);
    setBubble(null);
    if (!r.ok && (r as { asked?: boolean }).asked) return void setMood("idle");
    if (!r.ok || !r.questions.length) {
      setMood("idle");
      await say(r.ok ? "I couldn't find enough material on screen to quiz you on." : r.text);
      setBubble(null);
      return;
    }
    setRpSize("half");
    setMood("happy");
    setQuiz({ id: Date.now(), topic: r.topic, questions: r.questions, focus });
  };
  const closeQuiz = () => {
    hush();
    setQuiz(null);
    hover(false);
    setBubble(null);
    setMood("idle");
  };
  const quizSay = async (text: string) => {
    await say(text);
    setBubble(null);
  };
  const onQuizFinished = async (score: number, total: number) => {
    const pct = score / Math.max(1, total);
    setMood(pct >= 0.7 ? "celebrating" : "happy");
    await say(pct === 1 ? `Perfect score. ${score} out of ${total}.` : `You got ${score} out of ${total}.${pct < 0.7 ? " Let's review the ones you missed." : " Nice work."}`);
    setBubble(null);
  };

  // ---- research panel -------------------------------------------------------------
  const startResearch = (q: string, spoken = true, followUp = false) => {
    kitRef.current?.close();
    if (!followUp || !researchQ) {
      researchThread.current = [];
      setResearchTurns([]);
      setRpAnchor({ x: pos.x, y: pos.y });
    } else setResearchTurns([...researchThread.current]);
    researchTop.current = null;
    runId.current++;
    hush();
    setChatOpen(false);
    setLesson(null);
    setBox(null);
    setRpSize("compact");
    setResearchQ({ q, id: Date.now() });
    setMood("looking");
    setBubble(null);
    researchSpoken.current = spoken;
    // Let the panel mount (and start listening for events) before research begins.
    const history = researchThread.current.slice(-4);
    setTimeout(() => window.milo.research(q, history), 60);
    researchStart.current = { q, at: Date.now() };
  };
  startResearchRef.current = startResearch;
  const closeResearch = () => {
    researchStart.current = null;
    researchThread.current = [];
    researchTop.current = null;
    setResearchTurns([]);
    setRpAnchor(null);
    window.milo.stopResearch();
    tts.stop();
    setResearchQ(null);
    hover(false);
    setMood("idle");
    setBubble(null);
  };
  const onResearchDone = async (answer: string, top: string | null) => {
    researchTop.current = top;
    const q = researchStart.current?.q;
    if (q) {
      researchThread.current = [...researchThread.current, { q, a: answer }].slice(-6);
      researchStart.current = { q, at: 0 }; // finished: later speech is a follow-up, not a correction
    }
    const lead = answer
      .split("\n")
      .map((l) => l.trim())
      .find(Boolean)
      ?.replace(/^[-•]\s*/, "")
      .replace(/\*\*/g, "");
    setMood("happy");
    if (lead) {
      await say(lead.length > 220 ? lead.slice(0, 217) + "…" : lead);
      setBubble(null);
    }
    if (researchSpoken.current) listen();
  };

  // ---- chat (typed or spoken) ---------------------------------------------------
  const chat = async (text: string, spoken = false) => {
    const L = lessonRef.current;
    const content = L ? `(We're working on "${L.topic}" on my screen.) ${text}` : text;
    const next: Msg[] = [...messages, { role: "user", content }];
    if (spoken) setMessages((m) => [...m, { role: "user", content: text }]);
    setBusy(true);
    setMood("thinking");
    const history = next[0]?.role === "assistant" ? next.slice(1) : next;
    const reply = await window.milo.ask(history);
    setMessages((m) => [...m, { role: "assistant", content: reply.text }]);
    setBusy(false);
    setMood("happy");
    await say(reply.text);
    setBubble(null);
    if (spoken) listen();
  };

  // ---- voice commands -------------------------------------------------------------
  useEffect(() => {
    if (!chatOpen) return;
    const check = () => window.milo.bridgeStatus().then(setChromeOn).catch(() => {});
    check();
    const t = window.setInterval(check, 3000);
    return () => window.clearInterval(t);
  }, [chatOpen]);
  routeCtxRef.current = () => ({
    researchOpen: !!researchQ,
    researchTopic: researchQ?.q,
    inLesson: !!lessonRef.current,
    lessonTopic: lessonRef.current?.topic,
    toolOpen: tool ? tool.request : undefined,
    kitOpen: kitApp ? kitRef.current?.describe() || `Milo's ${kitApp} app` : undefined,
    quizOpen: !!quiz,
    lockinOn: lockOn,
    lastCommand: lastCommand.current || undefined,
  });
  routeRef.current = (raw: string, spoken = true) => {
    // Filler ("uh", "cool", "okay") never decides anything. Curly quotes from speech-to-text become plain ones.
    const text = stripFiller(raw.replace(/[’‘]/g, "'").replace(/[“”]/g, '"'));
    lastAsk.current = text;
    // Right after a worksheet: "you missed 7 and 8", "number 4 is wrong", "you didn't put my name" = go back over it
    if (Date.now() - sweepDoneAt.current < 15 * 60e3 && /\b(didn'?t|did not|missed|forgot|skipped|wrong|incorrect|look (back|over)|go back|fix|redo|again)\b/i.test(text) && /\b(number|question|name|answer|blank|\d+|those|them|it)\b/i.test(text)) {
      bb("route_instant", { text, kind: "sweep_redo" });
      void runSweep(true, true);
      return;
    }
    // Home base shows what you said to the frog; typed there = answered quietly there, spoken = out loud
    if (!fromHome.current) {
      window.milo.home.echo("heard", text);
      homeQuietUntil.current = 0;
    }
    fromHome.current = false;
    const dstate: DecideState = { kitOpen: (kitApp as DecideState["kitOpen"]) ?? null, researchOpen: !!researchQ, toolOpen: !!tool, lessonOpen: !!lessonRef.current, hasLastAnswer: !!lastAnswer() };
    // "Which class was that?" -> "stats": file it there (and learn the time slot for next week)
    if (lectureClassAsk.current && Date.now() - lectureClassAsk.current.at < 120e3) {
      const ask = lectureClassAsk.current;
      lectureClassAsk.current = null;
      if (!/^(no|nope|never ?mind|skip|i don'?t know)\b/i.test(text.trim())) {
        endAnswer("class");
        void window.milo.lecture.file(ask.id, text).then((name) =>
          say(name ? `Filed under ${name}. I'll remember this time slot.` : "I don't know that class. You can move the notes in your Notes app.").then(() => setBubble(null))
        );
        return;
      }
    }
    if (PICK_AREA.test(text.trim())) {
      bb("route_instant", { text, kind: "pick_area" });
      setChatOpen(false);
      setPicking({});
      return;
    }
    if (CLEAR_AREA.test(text.trim())) {
      bb("route_instant", { text, kind: "clear_area" });
      void window.milo.areaSet(null);
      say("Okay, I'll look at your whole window again.").then(() => setBubble(null));
      return;
    }
    {
      const lc = lectureCommand(text);
      if (lc?.do === "start") return void startLecture(lc.course || text);
      if (lc?.do === "stop" && recRef.current) return void stopLecture();
    }
    if (/^(open|show|go to|pull up)( my| the)? (home|home ?base|dashboard)$/i.test(text.trim().replace(/[.!?]+$/, ""))) {
      void window.milo.home.open();
      say("Opening Home base.").then(() => setBubble(null));
      return;
    }
    if (offerAnswer(text)) return;
    // Milo's buttons are up ("help me with bio" → three choices): "the first one" / "quiz me" picks one
    const chips = chipsRef.current;
    if (chips) {
      chipsRef.current = null;
      const i = pickSpoken(text, chips.options);
      if (i >= 0) return pickOffer(chips.options[i]);
      setOffer(null); // they said something else: drop the buttons and do that
    }
    // "What's it about?" -> "the french revolution"
    // (a whole new "write a paper on X" is its own request, not the topic of the last one)
    if (paperTopic.current && parse(text, { inLesson: false, awaitingAnswer: false, pendingAsk: false }).kind === "paper") paperTopic.current = null;
    if (paperTopic.current && Date.now() - paperTopic.current.at < 90e3 && text.trim().length > 2 && !/^(no|nope|never ?mind|cancel|stop)\b/i.test(text.trim())) {
      const base = paperTopic.current.base;
      endAnswer("topic");
      void startPaper(`${base} on ${text.trim().replace(/^(it'?s |about |on )/i, "")}`);
      return;
    }
    if (feedAnswer(text)) return;
    if (/^(set ?up|turn on|make) (my |the )?(calendar )?(backup|calendar link|calendar feed)\b/i.test(text.replace(/[.!?]+$/, "").trim()) && portal) {
      void setUpFeed(portal);
      return;
    }
    if (fastDecide(text, dstate)?.do === "flag") {
      // Flag the log (for Jake) AND open the feedback box with their words, so they can add what happened.
      flagNow(text);
      setFeedback(text.replace(/^\W*(flag (that|this|it)|that was (wrong|bad|weird|a bug|broken)|log (that|this)|report (a |that |this )?bug|bug report|that'?s a bug)\b[\s:,.-]*(that )?/i, "").trim());
      return;
    }

    // "Undo that": Milo's own undo when he just did something undoable (3 min); otherwise ⌘Z in the app in front.
    {
      const ut = text.toLowerCase().replace(/[.!?]+$/, "").trim();
      const always = /^(undo what you (just )?did|take (that|it) back|cancel what you (just )?did)$/.test(ut);
      if (always || /^undo( that| it| this| the last (thing|one))?$/.test(ut)) {
        void (async () => {
          // still doing the thing they want undone ("open calculator… undo that"): let it finish first
          for (let i = 0; i < 40 && workingRef.current; i++) await new Promise((r) => setTimeout(r, 250));
          return window.milo.activity.list();
        })().then((list) => {
          const recent = list.find((e) => e.canUndo && Date.now() - e.at < 3 * 60e3);
          bb("undo_choice", { milo: !!(recent || always) });
          if (recent || always) runUndo();
          else runTask(text, spoken); // their own undo (⌘Z)
        });
        return;
      }
    }

    // Lock-in: unmistakable starts and stops, no AI call needed.
    {
      const lt = text.toLowerCase().replace(/[.!?]+$/, "").trim();
      if (lockOn) {
        if (/^(stop|end|cancel|quit|finish|kill)( the| this| my)?( lock[- ]?in| focus( mode| session)?| session| studying| pomodoro)?$|^(i'?m|we'?re) (done|finished)( studying| here| for (now|today))?$|^unlock( me)?$|^that'?s (it|enough)( for (now|today))?$/.test(lt)) {
          lockRef.current?.stop("voice");
          return;
        }
        if (/\b(how (much|long)|what'?s the) (time )?(is )?(left|remaining|to go)\b|\bhow long (do i have|until|till|left)\b|\btime left\b/.test(lt)) {
          const left = lockRef.current?.timeLeftText();
          say(left ? `${left} left. You've got this.` : "Almost done.").then(() => setBubble(null));
          return;
        }
      }
      if (LOCKIN_START.test(lt)) {
        setChatOpen(false);
        if (lockOn) {
          say("We're already locked in.").then(() => setBubble(null));
          return;
        }
        const p = parseLockIn(lt);
        bb("route_instant", { text, kind: "lockin", minutes: p.minutes, topic: p.topic });
        lockRef.current?.start(p.minutes ?? 25, p.topic);
        return;
      }
    }
    if (jobVoice(text)) return;
    if (googleVoice(text)) return;
    // Grade forecaster: "what do I need on the final for a B in stats?"
    const fc = parseForecast(text);
    if (fc) {
      const course = fc.course || lastForecastCourse.current;
      if (!course) {
        say("Which class? Say it like: what do I need on the final for a B in stats.").then(() => setBubble(null));
        return;
      }
      lastForecastCourse.current = course;
      hush();
      setMood("looking");
      setBubble("Checking your grades…");
      void window.milo.forecast({ course, letter: fc.letter, exam: fc.exam, portal }).then((r) => {
        setMood(r.ok ? "happy" : "thinking");
        say(r.text).then(() => setBubble(null));
      });
      return;
    }
    // Milo's gradebook: syllabus weights + scores you tell him
    const sc = parseScore(text);
    if (sc) {
      const course = sc.course || lastForecastCourse.current;
      if (!course) {
        say(`Which class was that? Say it like: I got an 85 on the midterm in stats.`).then(() => setBubble(null));
        return;
      }
      lastForecastCourse.current = course;
      void window.milo.gradeScore({ course, name: sc.name, earned: sc.earned, possible: sc.possible }).then((r) => {
        setMood("happy");
        say(r.text).then(() => setBubble(null));
      });
      return;
    }
    const syl = parseSyllabus(text);
    if (syl) {
      const course = syl.course || lastForecastCourse.current;
      if (course) lastForecastCourse.current = course;
      hush();
      setMood("looking");
      setBubble("Reading your syllabus…");
      void window.milo.syllabus(course).then((r) => {
        setMood(r.ok ? "happy" : "thinking");
        say(r.text).then(() => setBubble(null));
      });
      return;
    }
    const gn = parseGradeNow(text);
    if (gn) {
      lastForecastCourse.current = gn.course;
      void window.milo.gradeNow(gn.course, portal).then((r) =>
        say(r.text).then(() => {
          setBubble(null);
          if (r.signin) void fixD2l();
        })
      );
      return;
    }
    const fw = parseFinalWeight(text);
    if (fw) {
      const course = fw.course || lastForecastCourse.current;
      void window.milo.finalWeight(course, fw.weight).then((ok) => say(ok ? `Got it, the ${fw.exam} is ${fw.weight} percent. Ask me again what you need.` : "Ask me what you need on the final first, then tell me what it's worth.").then(() => setBubble(null)));
      return;
    }
    // Exam-proof mode: "make me a practice midterm for stats"
    const ex = parseExam(text);
    if (ex) {
      void startExam(ex.kind, ex.course);
      return;
    }
    // "connect my calendar": any school's calendar feed into the deadline radar
    if (/^(?:hey milo,?\s*)?(?:connect|add|link|hook up|set up)\s+(?:my\s+)?(?:school\s+|class\s+|canvas\s+|d2l\s+|blackboard\s+|moodle\s+)?(?:calendar|calendar feed|feed|deadlines)\b/i.test(text.trim())) {
      void connectFeed();
      return;
    }
    // "my student ID is 1234567": saved on this Mac, filled into forms for you
    const fact = parseProfileFact(text);
    if (fact) {
      void window.milo.profileSet({ [fact.key]: fact.value });
      bb("profile_saved", { key: fact.key });
      setMood("happy");
      say(`Got it, I'll remember your ${profileLabel(fact.key).toLowerCase()} and fill it in for you.`).then(() => setBubble(null));
      return;
    }
    // "Milo, remember my favorite study spot is the common area": saved right now, not "someday"
    const rem = parseRemember(text);
    if (rem) {
      void window.milo.remember(rem);
      bb("route_instant", { text, kind: "remember" });
      setMood("happy");
      say("Got it, I'll remember that.").then(() => setBubble(null));
      return;
    }
    // "Update Milo" / "restart to update"
    if (updateReady && /^(update( yourself| milo)?|restart( to update| and update)?|install( the)? update|get the update)$/.test(text.toLowerCase().replace(/[.!?]+$/, "").trim())) {
      bb("route_instant", { text, kind: "update_install" });
      say("Updating. Back in a few seconds.").then(() => window.milo.updateInstall());
      return;
    }
    // "Run setup again"
    if (/^(run|redo|restart|open|start|do)( the| my)? (setup|onboarding)( again)?$|^set me up( again)?$/.test(text.toLowerCase().replace(/[.!?]+$/, "").trim())) {
      try {
        localStorage.setItem("milo.setupStep", "hi");
      } catch {
        /* ignore */
      }
      setSetup(true);
      return;
    }
    // Deadline radar: "what's due this week", "check D2L", "start the next one"; on its card: "start it", "later".
    {
      const rv = parseRadar(text, !!radarViewRef.current);
      if (rv) {
        bb("route_instant", { text, kind: "radar", ...rv });
        if (rv.do === "list") askRadar(rv.days);
        else if (rv.do === "scan") {
          setBubble("Checking D2L…");
          scanRadar((ok) => (ok ? showRadarList(Infinity) : startBrief(true)));
        } else if (rv.do === "start_first") startFromRadar();
        else {
          setRadarView(null);
          say("Okay. I'll remind you.").then(() => setBubble(null));
        }
        return;
      }
    }
    // "Start my stats homework" / "pick up my bio lab", and the plan's own words ("next", "do this step with me").
    {
      if (planVoice(text, spoken)) return;
      const hw = parseHomework(text);
      if (hw?.kind === "start") {
        bb("route_instant", { text, kind: "homework", target: hw.target, here: hw.here });
        void startHomework(text, spoken, hw);
        return;
      }
      if (hw?.kind === "resume") {
        bb("route_instant", { text, kind: "homework_resume" });
        void resumeHomework(text);
        return;
      }
    }
    // "Go to my math tab": a class tab in Milo's own apps, never a Mac app called "Math Tab".
    if (kitRef.current?.gotoClass(text)) {
      bb("route_instant", { text, kind: "class_tab" });
      return;
    }
    // Unmistakable commands for the open Milo app ("next", "the answer is 5", "box plot").
    if (kitApp && kitRef.current?.voice(text)) return;

    if (quiz && quizRef.current?.active()) {
      const t = text.toLowerCase().trim().replace(/[.!?]+$/, "");
      if (/^(end|stop|quit|exit|close)( the)? quiz$|^(i'?m )?done$/.test(t)) return closeQuiz();
      if (/^(next|next question|continue|go on|okay next)$/.test(t)) return quizRef.current.next();
      const letter = t.match(/^(?:(?:the )?answer is |it'?s |i (?:think|say|pick|choose) |option |letter )?(a|b|c|d)\b/);
      if (letter) return quizRef.current.answer("abcd".indexOf(letter[1]));
      const ch = quizRef.current.choices().map((c) => stripMath(c).toLowerCase());
      const hit = ch.findIndex((c) => c && (t.includes(c) || (c.length > 3 && c.includes(t))));
      if (hit >= 0) return quizRef.current.answer(hit);
    }
    const om = text.toLowerCase().match(/^(?:open|show|launch|pull up|bring up)\s+(?:my\s+)?(.+?)(?:\s+(?:tool|app))?$/);
    if (om) {
      const words = om[1].split(/\s+/).filter((w) => w.length > 2);
      const hit = tools.find((t) => words.length && words.every((w) => t.title.toLowerCase().includes(w)));
      if (hit) {
        openTool(hit);
        return;
      }
    }
    const fv = text.toLowerCase().match(/^(?:use |switch to |turn on )?(?:the )?(free|natural|normal|good|mac|built[- ]in) voice(?: on| mode)?$/);
    if (fv) {
      const on = /free|mac|built/.test(fv[1]);
      setFree(on);
      say(on ? "Free voice on. I'm using your Mac's voice now." : "Natural voice on.").then(() => setBubble(null));
      return;
    }
    const nm = text.match(/^(?:call me|my name is|my name's|i'?m called)\s+([a-z][a-z' -]{0,30})$/i);
    if (nm) {
      const n = nm[1].trim().replace(/\b\w/g, (c) => c.toUpperCase());
      setNameState(n);
      say(`Got it, ${n}.`).then(() => setBubble(null));
      return;
    }

    // The few instant decisions (all unit-tested in tests/decide.test.ts). Anything else: the brain decides.
    // "Close the calculator app", "quit the whole Chrome", "open Spotify", "switch to Dictionary": unmistakable,
    // so straight to the native action. (The AI router once read "close the X app" as "close Milo's panel".)
    {
      const qp = quickPlan(text);
      const own = /^(sketch|sheet|planner|study|pocket|notebook|research|chat|milo|lock ?in|plan|radar)$/i;
      const mine = fastDecide(text, dstate); // "open notes" / "open excel" are Milo's own Notes and Sheet: those win
      if (
        (!mine || mine.do === "shortcut") &&
        qp.steps.length &&
        !qp.rest &&
        qp.steps.every((st) => (st.kind === "quit" || st.kind === "app") && !own.test(st.app))
      ) {
        bb("route_instant", { text, kind: "quick_app", steps: qp.steps.map((st) => `${st.kind}:${"app" in st ? st.app : ""}`) });
        void runTask(text, spoken);
        return;
      }
    }
    const f = fastDecide(text, dstate);
    if (f) bb("route_instant", { text, ...f });
    switch (f?.do) {
      case "kit_menu":
        setRingOpen(true);
        say("Here's what I can open.").then(() => setBubble(null));
        return;
      case "classes":
        kitRef.current?.setupClasses(f.text);
        return;
      case "hold":
        kitRef.current?.hold();
        return;
      case "drop":
        kitRef.current?.drop(f.target);
        return;
      case "save_notes":
        kitRef.current?.saveToNotes(lastAnswer());
        return;
      case "open_kit":
        openKit(f.app as KitApp);
        return;
      case "close_chrome_then":
        runTask("close this Chrome tab", spoken).then(() => routeRef.current(f.rest, spoken));
        return;
      case "close_own":
        if (kitApp) kitRef.current?.close();
        else if (tool) closeTool();
        else closeResearch();
        if (f.then) setTimeout(() => routeRef.current(f.then!, spoken), 400);
        return;
      case "resize":
        setRpSize(f.size);
        return;
      case "shortcut":
        runTask(text, spoken);
        return;
    }
    const inLesson = !!lessonRef.current;
    const awaitingAnswer = inLesson && finishedRef.current && lessonModeRef.current !== "do" && !!lessonRef.current?.check_question;
    const intent = parse(text, { inLesson, awaitingAnswer, pendingAsk: !!pendingTask.current });
    const nb = notebookRef.current;
    // Unmistakable commands run right away. Everything else: the router decides, knowing what's open.
    if (!isSure(intent, text, inLesson)) {
      setMood("thinking");
      const r0 = Date.now();
      getRoute(text).then((rt) => {
        bb("route_ai", { text, ...rt, waitedMs: Date.now() - r0, keywordGuess: intent.kind });
        if (rt.failed) return runIntent(intent.kind === "chat" ? { kind: "chat", text } : intent);
        applyRoute(rt, text, spoken, intent);
      });
      return;
    }
    bb("route_instant", { text, kind: intent.kind });
    runIntent(intent);
    function runIntent(intent: Intent) {
    switch (intent.kind) {
      case "hush":
        hush();
        void window.milo.paperStop();
        sweepStop.current = true;
        window.milo.stopTask();
        setBubble(null);
        return;
      case "task":
        void work(intent.task, spoken);
        return;
      case "research":
        startResearch(intent.question, spoken);
        return;
      case "sweep":
        runSweep(intent.show ? false : intent.fill ? true : undefined);
        return;
      case "build":
        startBuild(intent.request);
        return;
      case "watch":
        setWatch(intent.on);
        return;
      case "checkwork":
        checkWorkNow();
        return;
      case "quiz":
        startQuiz(intent.focus);
        return;
      case "brief":
        // "what's due…" is a radar question: answered instantly from D2L's data, not the slow page read
        if (/\b(due|deadline|homework|assignment|coming up)\b/i.test(text)) askRadar(/\btoday\b/i.test(text) ? 0 : /\btomorrow\b/i.test(text) ? 1 : /\bweek\b/i.test(text) ? 7 : 14);
        else startBrief(spoken);
        return;
      case "chain":
        runChain(intent.steps, spoken);
        return;
      case "paper":
        void startPaper(intent.text);
        return;
      case "feedback":
        setFeedback(intent.text);
        say(intent.text ? "Got it. Check it and hit send." : "What happened? Type it and I'll send it to Jake.").then(() => setBubble(null));
        return;
      case "handle":
        void handleThis(text);
        return;
      case "d2lclass":
        void window.milo.d2lOpenClass(portal, intent.course, intent.page).then((r) => say(r.text).then(() => setBubble(null)));
        return;
      case "week":
        try {
          localStorage.setItem("milo.openWeek", String(Date.now()));
        } catch {
          /* ignore */
        }
        void window.milo.home.open().then(() => window.setTimeout(() => window.milo.home.echo("week", {}), 400));
        say("Looking at your whole week. It's in Home base.").then(() => setBubble(null));
        return;
      case "home":
        void window.milo.home.open();
        say("Opening Home base.").then(() => setBubble(null));
        return;
      case "activity":
        setActivityOpen(true);
        window.milo.activity.say().then((t) => say(t)).then(() => setBubble(null));
        return;
      case "undo":
        runUndo();
        return;
      case "resume": {
        const r = resumeRef.current;
        resumeRef.current = null;
        if (r) r();
        else if (lastCommand.current) routeRef.current(lastCommand.current);
        else say("There's nothing to pick back up.").then(() => setBubble(null));
        return;
      }
      case "fill": {
        const L = lessonRef.current;
        if (!L) return;
        const ans = L.answer.replace(/\$([^$]+)\$/g, "$1");
        runTask(
          `On the screen, find the answer blank/box for the homework question about "${L.topic}" and type this answer into it (don't submit): ${ans}`
        );
        return;
      }
      case "yes":
        endAnswer("yes");
        if (pendingTask.current) runTask(`${pendingTask.current}\n(The student said yes, go ahead with what you asked about.)`);
        return;
      case "no":
        endAnswer("no");
        pendingTask.current = null;
        say("No problem, I won't.").then(() => setBubble(null));
        return;
      case "close":
        closeLesson();
        setHeard(null);
        return;
      case "goto":
        look(intent.mode ?? lessonModeRef.current, intent.request, null, spoken);
        return;
      case "mode":
        setMode(intent.mode);
        look(intent.mode, lastRequest.current, boxRef.current, spoken);
        return;
      case "look":
        setMode(intent.mode);
        look(intent.mode, intent.request, null, spoken);
        return;
      case "answer":
        nb?.check(intent.text);
        return;
      case "show":
        nb?.showAnswer();
        say("Here you go!").then(() => setBubble(null));
        return;
      case "copy":
        nb?.copy();
        say("Copied. Paste it wherever you need it.").then(() => setBubble(null));
        return;
      case "practice":
        nb?.practice();
        say("Cooking up three more for you.").then(() => setBubble(null));
        return;
      case "skip":
        skipAhead();
        return;
      case "repeat":
        if (lastSaid.current) say(lastSaid.current).then(() => setBubble(null));
        return;
      case "chat":
        chat(intent.text, spoken);
        return;
    }
    }
  };

  /** Do what the router decided. */
  const applyRoute = (rt: MiloRoute, text: string, spoken: boolean, local: Intent) => {
    switch (rt.kind) {
      case "ask": {
        // Not sure what they meant: ask with buttons instead of guessing. Tapping (or saying) one runs it.
        const options = rt.choices ?? [];
        setChatOpen(false); // the buttons sit where the chat box is: show them on their own
        setMood("idle");
        setBubble(null);
        setOffer({ seen: rt.question ?? "", options });
        bb("route_ask", { text, options: options.map((o) => o.label) });
        say(`${rt.question ?? "What do you want me to do?"} ${options.map((o) => o.label).join(", or ")}?`).then(() => setBubble(null));
        return;
      }
      case "research":
        startResearch(rt.question?.trim() || text, spoken, !!researchQ && rt.followUp === true);
        return;
      case "task":
        if (local.kind === "chain") runChain(local.steps, spoken);
        else void work(text, spoken);
        return;
      case "look": {
        const m = rt.mode ?? "teach";
        setMode(m);
        look(m, text, null, spoken);
        return;
      }
      case "move":
        moveMilo(rt.where ?? "away");
        if (rt.after) setTimeout(() => routeRef.current(rt.after!, spoken), 900);
        return;
      case "screen_question":
        askAboutScreen(text, spoken);
        return;
      case "kit": {
        const app = (["study", "sketch", "notes", "sheet", "planner", "pocket"].includes(rt.app ?? "") ? rt.app : "study") as KitApp;
        // Already open: do it in place (no reload). Otherwise open it with the request.
        if (kitApp === app && rt.request && kitRef.current?.direct(rt.request)) {
          /* handled in the open app */
        } else openKit(app, rt.request?.trim() || text);
        if (rt.after) setTimeout(() => routeRef.current(rt.after!, spoken), 1200);
        return;
      }
      case "in_app": {
        const req = rt.request?.trim() || text;
        if (kitApp && kitRef.current?.direct(req)) {
          /* the open app handles it */
        } else if (kitApp || rt.app) openKit(((rt.app as KitApp) || kitApp) as KitApp, req);
        else chat(text, spoken);
        if (rt.after) setTimeout(() => routeRef.current(rt.after!, spoken), 1200);
        return;
      }
      case "kit_menu":
        setRingOpen(true);
        say("Here's what I can open.").then(() => setBubble(null));
        return;
      case "hold":
        kitRef.current?.hold();
        return;
      case "drop":
        kitRef.current?.drop(rt.target);
        return;
      case "close":
        if (kitApp) kitRef.current?.close();
        else if (tool) closeTool();
        else if (researchQ) closeResearch();
        else if (quiz) closeQuiz();
        else if (lessonRef.current) closeLesson();
        else setMood("idle");
        setHeard(null);
        if (rt.after) setTimeout(() => routeRef.current(rt.after!, spoken), 400);
        return;
      case "open_result":
        if (researchTop.current) {
          window.milo.openUrl(researchTop.current);
          say("Opened it in Chrome.").then(() => setBubble(null));
        } else runTask(text, spoken);
        return;
      case "sweep":
        runSweep(SHOW_ONLY.test(text.toLowerCase()) ? false : FILL_IN.test(text.toLowerCase()) ? true : undefined);
        return;
      case "build":
        startBuild(text);
        return;
      case "quiz":
        startQuiz(text);
        return;
      case "brief":
        // "what's due…" is a radar question: answered instantly from D2L's data, not the slow page read
        if (/\b(due|deadline|homework|assignment|coming up)\b/i.test(text)) askRadar(/\btoday\b/i.test(text) ? 0 : /\btomorrow\b/i.test(text) ? 1 : /\bweek\b/i.test(text) ? 7 : 14);
        else startBrief(spoken);
        return;
      case "watch":
        setWatch(rt.on ?? true);
        return;
      case "checkwork":
        checkWorkNow();
        return;
      case "lockin": {
        setChatOpen(false);
        if (rt.on === false) {
          if (lockOn) lockRef.current?.stop("voice");
          else say("We're not locked in right now.").then(() => setBubble(null));
          return;
        }
        if (lockOn) {
          say("We're already locked in.").then(() => setBubble(null));
          return;
        }
        const p = parseLockIn(text);
        const minutes = rt.minutes && rt.minutes > 0 ? Math.round(rt.minutes) : p.minutes ?? 25;
        lockRef.current?.start(Math.max(5, Math.min(240, minutes)), rt.request?.trim() || p.topic);
        return;
      }
      default:
        chat(text, spoken);
    }
  };

  /** Mark this moment in the black-box log, so the bug is easy to find. */
  const flagNow = (note = "") => {
    window.milo.flag(note).then(() => {
      sfx.lock();
      setBubble("Flagged. I saved what just happened.");
      setTimeout(() => setBubble((b) => (b === "Flagged. I saved what just happened." ? null : b)), 2500);
    });
  };
  const runUndo = () => {
    setMood("thinking");
    window.milo.activity
      .undoLast()
      .then((r) => {
        setMood(r.ok ? "happy" : "idle");
        return say(r.ok ? `Done. ${r.text}` : r.text);
      })
      .then(() => setBubble(null));
  };
  const flagRef = useRef(flagNow);
  flagRef.current = flagNow;
  useEffect(() => window.milo.onFlag(() => flagRef.current("shortcut")), []);
  useEffect(() => window.milo.activity.onOpen(() => setActivityOpen(true)), []);
  // Typed in Home base: same router, same Milo, answered quietly there.
  useEffect(
    () =>
      window.milo.home.onRouteText((text) => {
        homeQuietUntil.current = Date.now() + 120e3;
        fromHome.current = true;
        routeRef.current(text, false);
      }),
    []
  );
  // Home base's Next up card: Start together / Do it for me
  useEffect(
    () =>
      window.milo.home.onAction((a) => {
        homeQuietUntil.current = Date.now() + 120e3;
        if (a.kind === "together") void startHomeworkRef.current(`${a.item.title} ${a.item.course}`.trim(), false, { target: "", here: false }, a.item);
        else void doItForMeRef.current(a.item, a.kind === "do_submit");
      }),
    []
  );
  useEffect(() => window.milo.onOpenFeedback(() => setFeedback("")), []);

  /** "Milo, when's my next exam?" with D2L open: read the screen and answer out loud. */
  const askAboutScreen = async (question: string, spoken: boolean) => {
    setMood("looking");
    setBubble("Reading your screen…");
    const r = await window.milo.screenAsk(question);
    if (!r.ok && (r as { asked?: boolean }).asked) return void setMood("idle");
    setMessages((m) => [...m, { role: "user", content: question }, { role: "assistant", content: r.text }]);
    setMood(r.ok ? "happy" : "thinking");
    await say(r.text);
    setBubble(null);
    if (spoken) listen();
  };

  /** Open one of Milo's own apps (Study, Sketch, Notes, Sheet, Planner, Pocket). */
  const openKit = (app: KitApp, request = "") => {
    setRingOpen(false);
    setChatOpen(false);
    setLesson(null);
    setBox(null);
    if (researchQ) closeResearch();
    if (tool) closeTool();
    setRpSize(app === "pocket" || app === "notes" ? "compact" : "half");
    setMood("writing");
    kitRef.current?.open(app, request);
  };
  const lastAnswer = () => (researchThread.current.at(-1)?.a || lastSaid.current || "").replace(/\*\*/g, "");

  /** "Milo, move to the bottom left": go there and make it his new spot. */
  const moveMilo = (where: string) => {
    let w = where;
    if (w === "away") w = posRef.current.x > window.innerWidth / 2 ? "bottom-left" : "bottom-right";
    try {
      localStorage.setItem("milo.home", w);
    } catch {
      /* ignore */
    }
    setMood("happy");
    moveTo(spot(w)).then(() => {
      setBubble("Got it, I'll hang out here.");
      setTimeout(() => setBubble((b) => (b === "Got it, I'll hang out here." ? null : b)), 2200);
      setMood("sitting");
    });
  };

  // If ElevenLabs stops working, say why once (in the backup voice).
  useEffect(() => {
    tts.setVoiceTroubleHandler((why) => {
      const msg =
        why === "quota"
          ? "Heads up: I'm out of ElevenLabs credits, so I'm using my backup voice and can't hear you until they're topped up. You can still type to me."
          : "Heads up: ElevenLabs rejected my key, so I'm using my backup voice.";
      setMessages((m) => [...m, { role: "assistant", content: msg }]);
      setBubble(msg);
      setTimeout(() => setBubble((b) => (b === msg ? null : b)), 9000);
    });
  }, []);

  // Wire up the microphone once.
  useEffect(() => {
    const e = ears.current!;
    e.onLevel = (l) => {
      levelRef.current = l;
      setLevel(l);
    };
    e.onState = (st) => {
      // A push-to-talk turn just ended: switch hands-free back on.
      if (st === "off" && restoreHandsFree.current) {
        restoreHandsFree.current = false;
        e.setMode("always");
        return;
      }
      setEarState(st);
      if (st === "hearing" && answerUntil.current && Date.now() < answerUntil.current) {
        answerUntil.current = Date.now() + 12000; // you're answering: don't cut you off mid-word
        followUntil.current = Math.max(followUntil.current, answerUntil.current);
      }
      if (st === "hearing" && (e.mode !== "always" || Date.now() < followUntil.current)) setMood("listening");
      if (st === "timeout") {
        setHeard(null);
        setMood((m) => (m === "listening" ? "idle" : m));
      }
    };
    let inFlight = false;
    type Heard = { wav: ArrayBuffer; text?: string; pushToTalk: boolean; forced: boolean };
    const queued: Heard[] = []; // waiting utterances, in order (never drop any)
    e.onPause = (p) => setPause(p);
    e.onDebug = (ev, d) => window.milo.log("ears", ev, d);
    e.onBargeIn = () => {
      bb("interrupted_by_voice", { saying: lastSaid.current.slice(0, 80), working: workingRef.current });
      interrupted.current = true;
      tts.stop();
      setSpeaking(false);
      setBubble(null);
      setMood("listening");
      followUntil.current = Date.now() + 12000; // what you say next is for Milo, no "Hey Milo" needed
    };
    const take = async (h: Heard) => {
      if (inFlight) {
        queued.push(h);
        return;
      }
      inFlight = true;
      try {
        await handle(h.wav, h.pushToTalk, h.forced, h.text);
      } finally {
        inFlight = false;
        const q = queued.shift();
        if (q) take(q);
      }
    };
    e.onUtterance = (wav, pushToTalk, forced) => {
      if (!testDeaf.current) take({ wav, pushToTalk, forced });
    };
    // Smart ears: the words are already transcribed (and Flux decided you were done).
    e.onTranscript = (text, pushToTalk, forced, wav) => {
      setLive(null);
      if (testDeaf.current) return;
      window.milo.saveClip(wav, text);
      take({ wav, text, pushToTalk, forced });
    };
    // Your words, live, while you're still talking (only when you're clearly talking to Milo).
    e.onPartial = (t) => {
      const toMilo = e.mode === "once" || !!pendingRef.current || Date.now() < followUntil.current || /\b(milo|mylo|my low)\b/i.test(t);
      if (toMilo && !testDeaf.current) setLive(t.length > 140 ? "…" + t.slice(-140) : t);
    };
    window.milo.fluxAvailable().then((ok) => e.setSmart(ok));
    const offFlux = window.milo.onFlux((ev) => {
      e.handleFlux(ev);
      if (ev.type === "end" || ev.type === "closed") setTimeout(() => setLive(null), 400);
    });
    const handle = async (wav: ArrayBuffer, pushToTalk: boolean, forced: boolean, already?: string) => {
      const direct = pushToTalk || !!pendingRef.current || Date.now() < followUntil.current; // you were clearly talking to Milo
      const longEnough = e.voicedFrames * 1024 > 16000 * 1.0; // over ~1s of real talking
      if (direct) {
        setEarState("thinking");
        setMood("thinking");
      }
      smartTurn.current = already != null;
      const r = already != null ? { ok: true as const, text: already } : await window.milo.stt(wav);
      setEarState(e.mode === "off" ? "off" : "waiting");
      if (!r.ok) {
        setMood((m) => (m === "thinking" ? "idle" : m));
        // Only complain if you were talking to him directly; stay quiet about background noise.
        if (direct || longEnough) {
          await say(r.text === "busy" ? "Sorry, I missed that. Say it one more time?" : r.text);
          setBubble(null);
          if (r.text === "busy") listen();
        }
        return;
      }
      let text = r.text.replace(/[’‘]/g, "'").replace(/[“”]/g, '"'); // "What’s" -> "What's" so every command matches
      const addressed = stripWake(r.text, true).woke;
      // Only listening because he just spoke, and it sounds like room chatter, not you: let it go.
      // Right after his ding, a short answer ("not now", "do it for me") is for him, never background.
      const answering = !!answerUntil.current && Date.now() < answerUntil.current + 3000 && (!!parseAnswer(text) || (!!offerRef.current && !!parseOfferAnswer(text)));
      if (direct && !pushToTalk && !forced && !pendingRef.current && !addressed && !answering && looksLikeBackground(text)) {
        bb("ignored_background", { text: text.slice(0, 120) });
        followUntil.current = 0;
        setMood((m) => (m === "thinking" || m === "listening" ? "idle" : m));
        setEarState(e.mode === "off" ? "off" : "waiting");
        return;
      }
      bb("heard", { text, direct, addressed, pushToTalk, forced, followWindow: Date.now() < followUntil.current, cardUp: !!pendingRef.current }); // you said "Milo" again: that's a NEW command, not more of the last one
      // Did Milo just hear HIMSELF? (Speakers leaking into the mic right after an "interruption".)
      if (Date.now() - e.bargedAt < 20000 && isEcho(text, lastSaid.current)) {
        bb("ignored_own_echo", { heard: text, said: lastSaid.current.slice(0, 80) });
        e.bargedAt = 0;
        followUntil.current = 0;
        setEarState(e.mode === "off" ? "off" : "waiting");
        // It was a false alarm: finish what he was saying, then carry on.
        const cut = lastSaid.current;
        interrupted.current = false;
        if (cut) await say(cut, { noBarge: true });
        const r = resumeRef.current;
        resumeRef.current = null;
        if (r) r();
        else {
          setMood((m) => (m === "thinking" || m === "listening" ? "idle" : m));
          setTimeout(() => setBubble((b) => (b === cut ? null : b)), 2500);
        }
        return;
      }
      if (!direct) {
        // Hands-free: only act when you start with "Milo".
        const w = stripWake(text, true);
        if (!w.woke) {
          bb("ignored_no_wake_word", { text });
          setMood((m) => (m === "thinking" || m === "listening" ? "idle" : m));
          return;
        }
        e.learnVoice(); // that was you, so remember how loud you are
        if (!w.rest) {
          // Just "Hey Milo": chime and show "Yeah?" without talking, so his ears stay open for your command.
          setMood("listening");
          followUntil.current = Date.now() + 15000; // "Milo" ... (pause) ... command: people take a breath
          sfx.chime();
          setHeard(null);
          setBubble("Yeah?");
          setTimeout(() => setBubble((b) => (b === "Yeah?" ? null : b)), 4000);
          return;
        }
        text = w.rest;
      } else {
        const sw = stripWake(text);
        if (sw.woke && !sw.rest.replace(/[^a-z0-9]/gi, "")) {
          // Just "Milo." — he's listening, wait for the actual command.
          setMood("listening");
          followUntil.current = Date.now() + 10000;
          sfx.chime();
          setBubble("Yeah?");
          setTimeout(() => setBubble((b) => (b === "Yeah?" ? null : b)), 4000);
          return;
        }
        text = sw.rest || text;
        if (text) e.learnVoice();
      }
      if (!text) return;
      // E) "...never mind" / "cancel that" at the end cancels the whole thing.
      if (/(never ?mind|forget it|scratch that|cancel( that| it)?|don'?t do (it|that))[.!]*$/i.test(text.trim())) {
        bb("cancelled_by_speaker", { text });
        if (pendingRef.current) cancelPending();
        else {
          setBubble("Okay, never mind.");
          setTimeout(() => setBubble((b) => (b === "Okay, never mind." ? null : b)), 1800);
        }
        return;
      }

      // ---- You kept talking right after a research question started: add it to the question.
      const R = researchStart.current;
      if (!pendingRef.current && !addressed && R && Date.now() - R.at < 15000 && !isBareGo(text) &&
          !/^(close|stop|cancel|done|thanks|thank you|never ?mind|full ?screen|half|smaller|bigger|expand|shrink|make it|move|go to the|get out|open|launch)\b/i.test(text.trim())) {
        const q = `${R.q.replace(/[?.!\s]+$/, "")}. ${stripGo(text)}`;
        bb("merged_into_research", { was: R.q, now: q });
        setHeard(q);
        startResearchRef.current(q, true, true);
        return;
      }

      // ---- You kept talking right after a command started: it was one long command. Stop, merge, restart.
      const LR = lastRun.current;
      if (!pendingRef.current && !addressed && LR && Date.now() - LR.at < 15000) {
        const tt = text.trim().toLowerCase().replace(/[.!?]+$/, "");
        const isStop = /^(stop|cancel|never ?mind|forget it|wait|hold on|pause)\b/.test(tt) && tt.split(/\s+/).length <= 4;
        const connects = /^(and|then|also|plus|after that|so|but|with|to|in|on|about|that|which|where|make|write|type|put|have it|and then)\b/.test(tt);
        // A complete command on its own ("later", "close the plan", "save this to English", "what's next") is never glued onto the last one.
        const standalone =
          !connects &&
          (!!fastDecide(tt, { kitOpen: null, researchOpen: false, toolOpen: false, lessonOpen: !!lessonRef.current, hasLastAnswer: false }) ||
            !!lectureCommand(tt) || // "class is over" is never the end of the last sentence
            ["undo", "activity", "feedback", "paper"].includes(parse(tt, { inLesson: false, awaitingAnswer: false, pendingAsk: false }).kind) ||
            !!parseHomework(tt) ||
            !!parseRadar(tt, !!radarViewRef.current) ||
            (!!gpRef.current && !!parsePlanVoice(tt, !!lessonRef.current)) ||
            /^(save|put|move|file|keep) (this|it|that)\b.*\b(to|in|into|under)\b/.test(tt) ||
            /^(close|hide|later|not now|show me|open|switch to|go to|what'?s|how|why|who|when|where|can you|could you)\b/.test(tt));
        if (!isStop && !standalone && !isBareGo(tt) && (connects || soundsUnfinished(LR.text) || Date.now() - LR.at < 5000)) {
          lastRun.current = null;
          bb("merged_into_last_command", { was: LR.text, added: text, msSinceStart: Date.now() - LR.at, stoppedTask: workingRef.current });
          if (workingRef.current) {
            quietStop.current = true;
            window.milo.stopTask();
          }
          runId.current++; // cancels a lesson/look that was starting
          hush();
          setPendingCmd(`${LR.text.replace(/[.!?]+$/, "")} ${stripGo(text)}`.trim(), stripGo(text) !== text.trim());
          return;
        }
      }

      // ---- A command is waiting on the "Got it" card: go / cancel / keep adding.
      const P = pendingRef.current;
      if (P) {
        if (isBareGo(text) || /^(yes|yeah|yep|do it|send it|run it|start|okay|ok)\b[.!]*$/i.test(text.trim())) {
          confirmPending();
          return;
        }
        // "No, I meant open the Dictionary app": a correction. Replace the command instead of cancelling it.
        const corr = text.trim().match(/^(?:no+|nope|not that|wait|actually)[,.!]?\s+(?:milo[,.]?\s+)?(?:i (?:meant|mean|said|want(?:ed)?(?: you)? to)|make (?:it|that))?[,.]?\s*(.+)$/i);
        if (corr && corr[1].replace(/[^a-z0-9 ]+/gi, " ").trim().split(/\s+/).length >= 2) {
          bb("card_corrected", { was: P.text, now: corr[1] });
          lastTry.current = { text: P.text, at: Date.now() }; // so the rephrase counts as a retry
          setPendingCmd(stripGo(corr[1]), stripGo(corr[1]) !== corr[1].trim());
          return;
        }
        if (/^(cancel|no|nope|never ?mind|forget it|scratch that|stop)\b/i.test(text.trim())) {
          cancelPending();
          return;
        }
        const added = stripGo(text);
        bb("card_added", { was: P.text, added });
        setPendingCmd(`${P.text} ${added}`.trim(), added !== text.trim()); // ended with "go" -> run now
        return;
      }

      followUntil.current = 0;
      // A bare "go" with nothing waiting: redo the last command if it was recent.
      if (isBareGo(text)) {
        if (lastCommand.current && Date.now() - lastCommandAt.current < 60000) {
          routeRef.current(lastCommand.current);
        } else {
          setBubble("Tell me what to do first, then say go.");
          setTimeout(() => setBubble(null), 3000);
          listen();
        }
        return;
      }

      // Quick, reversible things happen right away (answers, yes/no, stop, notebook controls).
      const inLesson = !!lessonRef.current;
      const awaitingAnswer = inLesson && finishedRef.current && lessonModeRef.current !== "do" && !!lessonRef.current?.check_question;
      const kind = parse(stripGo(text), { inLesson, awaitingAnswer, pendingAsk: !!pendingTask.current }).kind;
      const instant = ["answer", "yes", "no", "hush", "close", "show", "copy", "practice", "skip", "repeat", "mode", "goto", "fill"].includes(kind);
      if (forced || instant) {
        const t = stripGo(text);
        lastCommand.current = t;
        lastCommandAt.current = Date.now();
        setHeard(t);
        setBubble(null);
        routeRef.current(t);
        return;
      }

      // Everything else goes on the "Got it" card first, except a few that can only mean one thing:
      // "what can you do", "open sketch", "hold this", "flag that". Those happen the moment you finish.
      const cleaned = stripGo(text);
      const sure = fastDecide(cleaned, { kitOpen: null, researchOpen: false, toolOpen: false, lessonOpen: false, hasLastAnswer: false });
      const planWords = !!gpRef.current && !!parsePlanVoice(cleaned, !!lessonRef.current);
      if ((answerUntil.current && Date.now() < answerUntil.current && parseAnswer(cleaned)) || (sure && ["kit_menu", "open_kit", "hold", "flag"].includes(sure.do)) || parseHomework(cleaned) || planWords || parseRadar(cleaned, !!radarViewRef.current)) {
        bb("card_skipped", { text: cleaned, do: sure?.do ?? (planWords ? "plan_voice" : parseRadar(cleaned, !!radarViewRef.current) ? "radar" : "homework") });
        return runPending(cleaned);
      }
      setPendingCmd(cleaned, cleaned !== text.trim());
    };
    heardRef.current = (t: string, ptt: boolean) => void handle(new ArrayBuffer(0), ptt, false, t);
    return () => {
      offFlux();
      e.setMode("off");
    };
  }, [say, listen]);

  // ---- "Got it" card --------------------------------------------------------------
  const AUTO_GO_MS = 4000;
  // ---- Frustration detector: you rephrased because the last try didn't work. Try a different way, and flag it.
  const lastTry = useRef<{ text: string; at: number } | null>(null);
  const retryHint = useRef<{ was: string; at: number } | null>(null);
  const STOP = new Set(["the", "a", "an", "my", "i", "you", "to", "it", "that", "this", "milo", "please", "can", "could", "would", "want", "like", "um", "uh", "and", "of", "on", "in", "is", "me", "just"]);
  const words = (t: string) => new Set(t.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w)));
  const isFrustrated = (text: string): boolean => {
    const L = lastTry.current;
    if (!L || Date.now() - L.at > 45000) return false;
    const t = text.toLowerCase();
    if (/^(no+|nope|not that|that'?s not|wrong|what i meant)\b|\bi (meant|said|asked)\b|\b(didn'?t|did not|doesn'?t) (work|do (it|anything)|close|open)\b|\bstill (open|there|on my screen|not)\b|\b(try|do (it|that)) again\b|\bthe (whole|entire) (thing|app|application)\b/.test(t)) return true;
    const a = words(L.text);
    const b = words(text);
    if (a.size < 2 || b.size < 2) return false;
    let both = 0;
    a.forEach((w) => b.has(w) && both++);
    return both / Math.min(a.size, b.size) >= 0.6; // mostly the same words again
  };
  const runPending = (text: string) => {
    if (isFrustrated(text)) {
      bb("frustration", { was: lastTry.current?.text, now: text, secondsLater: Math.round((Date.now() - (lastTry.current?.at ?? Date.now())) / 1000) });
      retryHint.current = { was: lastTry.current!.text, at: Date.now() };
      setBubble("My bad, trying another way…");
    }
    lastTry.current = { text, at: Date.now() };
    bb("card_run", { text, waitedMs: pendingRef.current ? Date.now() - (pendingRef.current.first ?? pendingRef.current.started) : 0 });
    pendingRef.current = null;
    setPending(null);
    followUntil.current = Date.now() + 8000; // if you keep talking, the rest still counts (no "Milo" needed)
    lastCommand.current = text;
    lastCommandAt.current = Date.now();
    lastRun.current = { text, at: Date.now() };
    setHeard(text);
    setBubble(null);
    routeRef.current(text);
  };
  function setPendingCmd(text: string, goNow = false) {
    if (!text) return;
    if (goNow && !soundsUnfinished(text)) return runPending(text);
    // Smart ears already judged that you finished; only an obvious dangling word ("…and", "…then") holds the card.
    const unfinished = smartTurn.current ? /\b(and|and then|then|to|the|a|an|my|or|with|for|of)[.,!?]*$/i.test(text.trim()) : soundsUnfinished(text);
    if (!unfinished) getRoute(text); // think about it now, so it's ready when the card runs
    bb("card_shown", { text, unfinished, goNow });
    pendingRef.current = { text, started: Date.now(), unfinished, smart: smartTurn.current };
    setPending({ text, progress: 0, unfinished });
    setHeard(null);
    setBubble(null);
    setMood("listening");
    followUntil.current = Date.now() + 15000; // no need to say "Milo" again while the card is up
    if (ears.current?.mode === "off") listen();
  }
  function confirmPending() {
    const P = pendingRef.current;
    if (P) runPending(P.text);
  }
  function cancelPending() {
    bb("card_cancel", { text: pendingRef.current?.text });
    pendingRef.current = null;
    setPending(null);
    followUntil.current = 0;
    setMood("idle");
    setBubble("Okay, cancelled.");
    setTimeout(() => setBubble((b) => (b === "Okay, cancelled." ? null : b)), 1800);
  }
  // Countdown: pauses while you're talking; unfinished sentences don't auto-run.
  useEffect(() => {
    const t = window.setInterval(() => {
      const P = pendingRef.current;
      if (!P) return;
      P.first = P.first ?? Date.now();
      const stillTalking = !testDeaf.current && (earStateRef.current === "hearing" || earStateRef.current === "thinking" || levelRef.current > 0.3);
      // Hold while you're still talking, but not forever: a TV or people nearby must never stall your command.
      // (Smart ears already decided you finished; this only covers a real pause.)
      if (stillTalking && Date.now() - P.first < (P.smart ? 4000 : 8000)) {
        P.started = Date.now(); // you're still talking: hold
        setPending((p) => (p ? { ...p, progress: 0 } : p));
        return;
      }
      if (P.unfinished) {
        if (Date.now() - P.started > 15000) cancelPending(); // gave up waiting for the rest
        return;
      }
      // Smart ears already waited for you to finish, so the card only needs a short beat.
      const prog = (Date.now() - P.started) / (P.smart ? 1500 : AUTO_GO_MS);
      if (prog >= 1) runPending(P.text);
      else setPending((p) => (p ? { ...p, progress: prog } : p));
    }, 80);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const talk = useCallback(() => {
    const e = ears.current!;
    // Pressed again while listening: send what you said right now (push-to-talk in loud rooms).
    if (e.mode === "once") {
      e.flush();
      return;
    }
    if (speaking) interrupted.current = true;
    hush();
    setHeard(null);
    setBubble("I'm listening… (pause or say \"go\" to send)");
    setMood("listening");
    listen(true);
  }, [listen]);

  // "Hey Milo" is on by default (and remembered).
  useEffect(() => {
    let wanted = true;
    try {
      wanted = localStorage.getItem("milo.handsFree") !== "off";
    } catch {
      /* ignore */
    }
    if (!wanted) return;
    (async () => {
      if ((await window.milo.pause.get().catch(() => null))?.on) return; // paused: stay deaf until turned back on
      if (!(await window.milo.micAccess())) return;
      try {
        await ears.current!.setMode("always");
        setHandsFree(true);
      } catch {
        /* mic unavailable */
      }
    })();
  }, []);

  // Pause Milo (from Home base): stop listening and recording right away; listen again when resumed.
  useEffect(
    () =>
      window.milo.pause.onChange((p) => {
        if (p.on) {
          void ears.current?.setMode("off").catch(() => {});
          setHandsFree(false);
          if (recRef.current) void stopLecture();
          window.milo.stopTask();
          setBubble(null);
        } else {
          let wanted = true;
          try {
            wanted = localStorage.getItem("milo.handsFree") !== "off";
          } catch {
            /* ignore */
          }
          if (!wanted) return;
          void (async () => {
            if (!(await window.milo.micAccess())) return;
            try {
              await ears.current!.setMode("always");
              setHandsFree(true);
            } catch {
              /* mic unavailable */
            }
          })();
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const toggleHandsFree = async () => {
    const on = !handsFree;
    try {
      localStorage.setItem("milo.handsFree", on ? "on" : "off");
    } catch {
      /* ignore */
    }
    if (on && !(await window.milo.micAccess())) {
      say("I need microphone access first. Turn on Terminal under Privacy and Security, Microphone.");
      return;
    }
    setHandsFree(on);
    await ears.current!.setMode(on ? "always" : "off");
    if (on) say('Hands-free is on. Just say "Hey Milo" and tell me what you need.').then(() => setBubble(null));
  };

  // ---- chat panel -------------------------------------------------------------
  const openChat = useCallback(() => {
    setChatOpen(true);
    setMood("happy");
    hover(true);
    setTimeout(() => inputRef.current?.focus(), 50);
    setMessages((m) => (m.length ? m : [{ role: "assistant", content: "Hey! I'm Milo. Stuck on something? Hit Look at my screen, or just ask." }]));
  }, [hover]);

  // ---- "which part of the screen": named-thing outline, "Which one?" buttons, the picker shortcut ----
  useEffect(() => window.milo.onAreaFlash((a) => setAreaFlash({ ...a, id: Date.now() })), []);
  useEffect(() => window.milo.onPickArea(() => setPicking({})), []);
  useEffect(
    () =>
      window.milo.onTargetAsk((a) => {
        targetOpts.current = a.options;
        setMood("idle");
        setBubble(null);
        setChatOpen(false);
        setOffer({
          seen: a.question,
          options: [...a.options.map((o, i) => ({ label: o.label, say: `__area:${i}:${a.redo}` })), { label: "Pick an area", say: `__pick:${a.redo}` }],
        });
        void say(`${a.question} ${a.options.map((o) => o.label).join(", or ")}?`).then(() => setBubble(null));
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  useEffect(() => {
    if (!areaFlash) return;
    const t = window.setTimeout(() => setAreaFlash(null), 1900);
    return () => window.clearTimeout(t);
  }, [areaFlash]);
  const areaPicked = (b: MiloRect) => {
    const then = picking?.then;
    setPicking(null);
    hover(false);
    void window.milo.areaSet(b).then(() => {
      setAreaFlash({ box: b, id: Date.now() });
      if (then) return routeRef.current(then, false);
      // no request yet: ask what to do with it
      setOffer({
        seen: "Got it. What should I do here?",
        options: [
          { label: "Help with this", say: "handle this" },
          { label: "Check it", say: "check my work" },
          { label: "Teach me", say: "teach me this" },
          { label: "Do it", say: "do this for me" },
        ],
      });
    });
  };

  const closeChat = () => {
    setChatOpen(false);
    setMood("idle");
    hover(false);
  };

  useEffect(() => window.milo.onSummon(() => (lesson ? undefined : openChat())), [openChat, lesson]);
  useEffect(() => window.milo.onTeachScreen(() => look(mode, "")), [look, mode]);
  useEffect(() => window.milo.onTalk(() => talk()), [talk]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, busy]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (speaking) {
        interrupted.current = true;
        hush();
        setBubble(null);
        return;
      }
      if (ringOpen) {
        setRingOpen(false);
        return;
      }
      if (kitApp) {
        kitRef.current?.close();
        return;
      }
      if (tool) {
        closeTool();
        return;
      }
      if (quiz) {
        closeQuiz();
        return;
      }
      if (brief || signIn) {
        setBrief(null);
        setSignIn(false);
        hover(false);
        return;
      }
      if (sweep) {
        if (sweep.status === "done" || sweep.status === "stopped" || sweep.status === "error") closeSweep();
        else stopSweep();
      } else if (researchQ) closeResearch();
      else if (lesson) closeLesson();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lesson, closeLesson, researchQ, sweep, tool, quiz, brief, signIn, speaking]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", content: text }]);

    routeRef.current(text, false);
  };

  // ---- self-test hooks (dev only) -------------------------------------------------
  // `npm run test:milo` drives Milo through these: the same path your voice takes after it becomes text.
  const testSnap = useRef<Record<string, unknown>>({});
  const bootId = useRef(Date.now());
  useEffect(() => {
    bb("app_boot", { boot: bootId.current }); // every time Milo's screen starts fresh (helps catch surprise reloads)
  }, []);
  testSnap.current = { job: job ? { status: job.status, steps: job.steps.length, done: job.steps.filter((x) => x.status === "done").length } : null, radar: radarView ? { mode: radarView.mode, rows: radarView.rows.length } : null, plan: gp ? { title: gp.plan.title, steps: gp.plan.steps.length, done: gp.done.length } : null, speaking, bubble, heard, pending: pending?.text ?? null, chatOpen, ringOpen, kitApp, lockOn, research: !!researchQ, tool: !!tool, quiz: !!quiz, notebook: !!box, mood, pos, name, activityOpen, feedback, working, lecture: !!lecture, inClass: inClassRef.current };
  useEffect(() => {
    if (!location.protocol.startsWith("http")) return; // dev server only, never in the packaged app
    (window as unknown as { __milo: unknown }).__milo = {
      ready: true,
      boot: bootId.current,
      state: () => testSnap.current,
      hear: (t: string, ptt = true) => heardRef.current?.(t, ptt),
      key: (k: string) => window.dispatchEvent(new KeyboardEvent("keydown", { key: k })),
      move: (x: number, y: number) => setPos({ x, y }),
      chat: (on: boolean) => setChatOpen(on),
      setup: (on: boolean) => setSetup(on),
      plan: (p: GamePlan) => showPlan({ key: planKey(p), plan: p, done: [], at: Date.now() }),
      offer: (item: { title: string; course: string; due: string }) => offerStart(item),
      offerOpen: () => !!offerRef.current,
      offerFeed: () => offerFeed(portal),
      stopLecture: () => (recRef.current ? stopLecture() : null),
      radarSet: (items: ScanItem[]) => setRadar(mergeScan(mergeScan(emptyRadar(), [], Date.now()), items, Date.now())),
      radarCheck: () => checkAlerts(true),
      radarLoad: (json: string | null) => {
        setRadarView(null);
        try {
          const r = json ? JSON.parse(json) : null;
          setRadar(r && Array.isArray(r.items) ? r : emptyRadar());
        } catch {
          setRadar(emptyRadar());
        }
      },
      quietEars: () => {
        testDeaf.current = true;
        ears.current?.setMode("off");
        // switching the mic off mid-sound must not leave "you're still talking" behind
        earStateRef.current = "off";
        setEarState("off");
        levelRef.current = 0;
        setLevel(0);
        setLive(null);
      },
      reset: () => {
        hush();
        homeQuietUntil.current = 0;
        pendingRef.current = null;
        setPending(null);
        setBubble(null);
        setHeard(null);
        setRingOpen(false);
        setChatOpen(false);
        kitRef.current?.close();
        setResearchQ(null);
        followUntil.current = 0;
        lastRun.current = null;
        researchStart.current = null;
        lastTry.current = null; // each test starts fresh (not a "rephrase" of the last one)
      },
    };
  });

  // ---- layout -----------------------------------------------------------------
  const W = window.innerWidth;
  const H = window.innerHeight;
  const panelW = 360;
  const panelLeft = clamp(pos.x + MILO_W / 2 - panelW / 2, MARGIN, W - panelW - MARGIN);
  // Chat panel: above Milo if it fits, else below him, else beside him. Always fully on screen.
  const chatStyle = ((): React.CSSProperties => {
    const GAP = 16;
    const FULL = 420; // its normal height
    const MIN = 260; // smallest that's still comfortable
    const above = pos.y - GAP - MARGIN;
    const below = H - (pos.y + MILO_H + GAP) - MARGIN;
    if (above >= FULL || (above >= MIN && above >= below)) return { left: panelLeft, bottom: H - pos.y + GAP, width: panelW, maxHeight: Math.min(FULL, above) };
    if (below >= MIN) return { left: panelLeft, top: pos.y + MILO_H + GAP, width: panelW, maxHeight: Math.min(FULL, below) };
    const h = Math.min(FULL, H - 2 * MARGIN);
    const top = clamp(pos.y + MILO_H / 2 - h / 2, MARGIN, H - h - MARGIN);
    const right = W - (pos.x + MILO_W) - GAP - MARGIN;
    return right >= panelW || pos.x - GAP - MARGIN < panelW
      ? { left: clamp(pos.x + MILO_W + GAP, MARGIN, W - panelW - MARGIN), top, width: panelW, maxHeight: h }
      : { left: pos.x - GAP - panelW, top, width: panelW, maxHeight: h };
  })();

  let nbStyle: React.CSSProperties = {};
  if (box) {
    const right = box.x + box.width + 28;
    const left = box.x - NB_W - 28;
    const nbLeft = right + NB_W < W - MARGIN ? right : left > MARGIN ? left : clamp(box.x, MARGIN, W - NB_W - MARGIN);
    const below = !(right + NB_W < W - MARGIN) && !(left > MARGIN);
    const nbTop = below ? clamp(box.y + box.height + 24, MARGIN, H - 300) : clamp(box.y - 30, MARGIN, H - 300);
    nbStyle = { left: nbLeft, top: nbTop, width: NB_W, maxHeight: H - nbTop - MARGIN };
  }

  // Research panel: next to Milo (compact), right half, or almost full screen.
  let rpStyle: React.CSSProperties = {};
  if (rpSize === "half") rpStyle = { right: 16, top: 16, width: Math.round(W / 2) - 24, height: H - 32 };
  else if (rpSize === "full") rpStyle = { left: 16, top: 16, width: W - 32, height: H - 32 };
  else {
    const w = 420;
    const h = Math.min(580, H - 32);
    const a = rpAnchor ?? pos; // where Milo was when the box opened: it doesn't chase him around
    const top = clamp(a.y + MILO_H - h, 16, H - h - 16);
    rpStyle =
      a.x > W / 2
        ? { left: clamp(a.x - w - 12, 16, W - w - 16), top, width: w, height: h }
        : { left: clamp(a.x + MILO_W + 12, 16, W - w - 16), top, width: w, height: h };
  }

  // Game plan card: beside Milo; shrinks to a pill at the top while another panel or his notebook is up.
  const gpMini = !!box || !!lesson || !!kitApp || !!researchQ || !!tool || !!quiz || chatOpen || !!radarView;
  radarBusy.current = setup || speaking || lockOn || working || !!lesson || !!box || !!pending || !!quiz || !!radarView || !!tool || !!researchQ;
  const rdStyle: React.CSSProperties = (() => {
    const w = 384;
    const h = Math.min(H - 32, 150 + Math.max(1, radarView?.rows.length ?? 1) * 64);
    const top = clamp(pos.y + MILO_H - h, 16, H - h - 16);
    return pos.x > W / 2
      ? { left: clamp(pos.x - w - 14, 16, W - w - 16), top, width: w, maxHeight: H - 32 }
      : { left: clamp(pos.x + MILO_W + 14, 16, W - w - 16), top, width: w, maxHeight: H - 32 };
  })();
  const gpStyle: React.CSSProperties = (() => {
    if (gpMini) return { left: W / 2, top: 12, translate: "-50% 0" };
    const w = 372;
    const h = Math.min(H - 32, 190 + (gp?.plan.steps.length ?? 4) * 46);
    const top = clamp(pos.y + MILO_H - h, 16, H - h - 16);
    return pos.x > W / 2
      ? { left: clamp(pos.x - w - 14, 16, W - w - 16), top, width: w, maxHeight: H - 32 }
      : { left: clamp(pos.x + MILO_W + 14, 16, W - w - 16), top, width: w, maxHeight: H - 32 };
  })();

  // While Milo is using the computer, his own panels get out of the way (they come back when he's done).
  const panelStyle: React.CSSProperties = working ? { ...rpStyle, visibility: "hidden", pointerEvents: "none" } : rpStyle;

  // Speech bubble: never on top of Milo. Above him (growing upward) if there's room,
  // otherwise beside him on the side away from the notebook, otherwise below.
  const bubblePos = (): React.CSSProperties => {
    const maxW = 280;
    // His apps are fanned out around him: stack the bubble above the ring (or below it, near the top), centered.
    if (ringOpen) {
      const L = ringLayout({ x: pos.x + MILO_W / 2, y: pos.y + MILO_H / 2 }, W, H);
      return bubbleNearRing(L, { x: pos.x, y: pos.y, w: MILO_W, h: MILO_H }, W, H, short(bubble ?? heard ?? live ?? "…"));
    }
    if (pos.y > 170) {
      return { left: clamp(pos.x + MILO_W / 2 - maxW / 2, MARGIN, W - maxW - MARGIN), bottom: H - pos.y + 4, maxWidth: maxW };
    }
    const roomLeft = pos.x - MARGIN - 10;
    const roomRight = W - (pos.x + MILO_W) - MARGIN - 10;
    const nbRight = box ? (nbStyle.left as number) > pos.x : false;
    let side: "left" | "right" = nbRight ? "left" : "right";
    if ((side === "left" ? roomLeft : roomRight) < 170) side = side === "left" ? "right" : "left";
    const room = side === "left" ? roomLeft : roomRight;
    if (room < 170) return { left: clamp(pos.x + MILO_W / 2 - maxW / 2, MARGIN, W - maxW - MARGIN), top: pos.y + MILO_H + 6, maxWidth: maxW };
    const w = Math.min(maxW, room);
    return side === "left"
      ? { right: W - pos.x + 10, top: pos.y + 8, maxWidth: w }
      : { left: pos.x + MILO_W + 10, top: pos.y + 8, maxWidth: w };
  };
  const short = (t: string) => (t.length > 170 ? t.slice(0, 167).trimEnd() + "…" : t);
  // ---- Milo speaks first ----
  const showNudge = (n: Nudge) => {
    setNudge(n);
    bb("nudge", { id: n.id.split("-")[0] });
    sfx.chime();
    setMood("happy");
    say(n.text).then(() => setBubble(null));
  };
  // welcome back after class / time away
  useEffect(
    () =>
      window.milo.onBack((awayMs) => {
        void window.milo.activity.list().then((acts) => {
          const n = backNudge(awayMs, Date.now(), acts, radarRef.current.items);
          if (!n || radarBusy.current) return;
          showNudge(n);
        });
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  // once a day: a pile-up coming → offer to fix the week
  useEffect(() => {
    const tick = async () => {
      if (radarBusy.current || (await window.milo.pause.get().catch(() => null))?.on) return;
      const last = Number(localStorage.getItem("milo.weekNudge") || 0);
      const items = radarRef.current.items.filter((x) => x.dueAt != null).map((x) => ({ id: x.id, title: x.title, course: x.course, dueAt: x.dueAt!, kind: x.kind === "exam" ? ("exam" as const) : undefined }));
      const n = weekNudge(items, Date.now(), last);
      if (!n) return;
      localStorage.setItem("milo.weekNudge", String(Date.now()));
      showNudge(n);
    };
    const first = window.setTimeout(() => void tick(), 4 * 60e3);
    const t = window.setInterval(() => void tick(), 30 * 60e3);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const nudgeAct = (a: Nudge["actions"][number]) => {
    const n = nudge;
    setNudge(null);
    hover(false);
    hush();
    setBubble(null);
    bb("nudge_act", { a });
    if (a === "week") routeRef.current("what's next", false);
    else if (a === "did") setActivityOpen(true);
    else if (a === "checkup") {
      try {
        localStorage.setItem("milo.openToday", String(Date.now()));
      } catch {
        /* ignore */
      }
      void window.milo.home.open();
    }
    else if (a === "start" && n?.start) routeRef.current(`start ${n.start}`, false);
  };
  const NUDGE_LABEL: Record<Nudge["actions"][number], string> = { week: "Fix my week", did: "See what you did", start: "Start it", checkup: "Fix it", dismiss: "Later" };
  // the checkup: when something Milo needs newly breaks (Google signed out, D2L expired, a permission off), say so once
  useEffect(() => {
    const tick = async () => {
      if (radarBusy.current || (await window.milo.pause.get().catch(() => null))?.on) return;
      const items = await window.milo.checkup(portal || undefined).catch(() => null);
      if (!items) return;
      let last: string[] = [];
      try {
        last = JSON.parse(localStorage.getItem("milo.checkupBad") || "[]");
      } catch {
        /* ignore */
      }
      const line = checkupLine(items as CheckItem[], last);
      try {
        localStorage.setItem("milo.checkupBad", JSON.stringify(items.filter((i) => i.ok === false).map((i) => i.id)));
      } catch {
        /* ignore */
      }
      if (line) showNudge({ id: `checkup-${Date.now()}`, text: line, actions: ["checkup", "dismiss"] });
    };
    const first = window.setTimeout(() => void tick(), 45e3);
    const t = window.setInterval(() => void tick(), 4 * 3600e3);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portal]);

  const bStyle = bubblePos();

  return (
    <>
      {sweep && (
        <>
          <SweepHUD
            s={sweep}
            onStop={stopSweep}
            hover={hover}
            onFill={(f) => {
              sweepFill.current = f;
              setSweep((x) => (x ? { ...x, fill: f } : x));
              bb("sweep_mode", { fill: f });
            }}
          />
          {sweep.items.slice(0, sweep.status === "working" ? sweep.index : sweep.items.length).map((it, i) => {
            const r = sweep.results.find((x) => x.label === it.label);
            return r ? <Pin key={`${it.label}-${i}`} item={it} filled={r.filled} /> : null;
          })}
          {sweep.status === "working" && sweep.items[sweep.index] && (
            <WorkCard
              item={sweep.items[sweep.index]}
              style={(() => {
                const b = sweep.items[sweep.index].box;
                const w = 300;
                const right = b.x + b.width + MILO_W + 30;
                const left = right + w < W - 16 ? right : Math.max(16, b.x - w - 20);
                return { left, top: clamp(b.y, 70, H - 200), width: w };
              })()}
            />
          )}
          {(sweep.status === "done" || sweep.status === "stopped") && sweep.results.length > 0 && (
            <SweepSummary s={sweep} onClose={closeSweep} hover={hover} style={{ ...rpStyle, height: "auto", maxHeight: H - 32 }} />
          )}
        </>
      )}

      {lecAsk && !lecture && (
        <div className="lec lec-ask" role="dialog" aria-label="Recording check" onMouseEnter={() => hover(true)} onMouseLeave={() => hover(false)}>
          <span className="lec-text">
            Does {lecAsk.course || "this class"} allow recording? I only listen where it's allowed.
          </span>
          <button className="kit-btn kit-btn--sm" onClick={() => void answerLecAsk(true)}>
            Yes, my professor allows it
          </button>
          <button className="kit-btn kit-btn--sm" onClick={() => void answerLecAsk(true)}>
            I have an accommodation
          </button>
          <button className="kit-btn kit-btn--sm" onClick={() => void answerLecAsk(false)}>
            No, don't record
          </button>
        </div>
      )}
      {lecture && (
        <div className="lec" onMouseEnter={() => hover(true)} onMouseLeave={() => hover(false)}>
          <span className="lec-dot" />
          <span className="lec-text">
            Listening{lecture.course ? ` · ${lecture.course}` : ""} · {minutesText(clock - lecture.startedAt)}
          </span>
          <span className="lec-meter">
            <i style={{ width: `${Math.min(100, Math.round(lectureLevel * 900))}%` }} />
          </span>
          <button className="kit-btn kit-btn--sm" onClick={() => void stopLecture()}>
            Stop
          </button>
          <button className="kit-btn kit-btn--sm" title="Stop and delete this recording. No notes are made." onClick={() => void notInThisClass()}>
            Not in this class
          </button>
          {lectureWarn && <div className="lec-warn">{lectureWarn}</div>}
        </div>
      )}
      {feedback !== null && (
        <FeedbackPanel
          start={feedback}
          style={{ right: 18, top: activityOpen ? 300 : 14, width: 340 }}
          hover={hover}
          onSay={(t) => void say(t).then(() => setBubble(null))}
          onClose={() => {
            setFeedback(null);
            hover(false);
          }}
        />
      )}
      {activityOpen && (
        <ActivityPanel
          onFeedback={() => setFeedback("")}
          style={{ right: 18, top: 14, width: 340, maxHeight: H - 40 }}
          hover={hover}
          onSay={(t) => void say(t).then(() => setBubble(null))}
          onClose={() => {
            setActivityOpen(false);
            hover(false);
          }}
        />
      )}
      {briefRun > 0 && portal && <BriefLoader key={briefRun} url={portal} onResult={onBrief} />}
      {brief && !signIn && (
        <BriefCard
          greeting={greeting()}
          state={brief}
          style={{ ...rpStyle, height: "auto", maxHeight: H - 32 }}
          portal={portal}
          onSetPortal={setPortalUrl}
          onSignIn={() => setSignIn(true)}
          onOpenPortal={() => window.milo.openUrl(portal)}
          onClose={() => {
            setBrief(null);
            hover(false);
          }}
          hover={hover}
        />
      )}
      {signIn && portal && (
        <SignInPanel
          url={portal}
          style={{ right: 16, top: 16, width: Math.round(W / 2) - 24, height: H - 32 }}
          hover={hover}
          onDone={() => {
            setSignIn(false);
            void ensureFeed();
            if (setup) scanRadar(); // during setup: quietly fill the radar; the brief comes when setup ends
            else startBrief(true);
          }}
        />
      )}

      {quiz && (
        <QuizPanel
          ref={quizRef}
          key={quiz.id}
          topic={quiz.topic}
          questions={quiz.questions}
          style={rpStyle}
          size={rpSize}
          onSize={setRpSize}
          onClose={closeQuiz}
          onAgain={() => startQuiz(quiz.focus)}
          hover={hover}
          say={quizSay}
          onFinished={onQuizFinished}
        />
      )}

      {tool && (
        <ToolPanel
          key={tool.id}
          request={tool.request}
          existing={tool.existing}
          style={panelStyle}
          size={rpSize}
          onSize={setRpSize}
          onClose={closeTool}
          onDone={onToolDone}
          onSaved={onToolSaved}
          hover={hover}
        />
      )}

      <KitHost
        ref={kitRef}
        style={panelStyle}
        size={rpSize}
        onSize={setRpSize}
        hover={hover}
        say={(t, o) => say(t, o).then(() => setBubble(null))}
        setBubble={setBubble}
        runTask={(t) => runTask(t, true)}
        onOpenChange={(a) => {
          setKitApp(a);
          if (!a) {
            hush(); // stop talking about something that's no longer on screen
            setBubble(null);
            hover(false);
            setMood("idle");
          }
        }}
        briefItems={() => {
          try {
            return JSON.parse(localStorage.getItem("milo.briefItems") || "[]");
          } catch {
            return [];
          }
        }}
      />
      {ringOpen && (
        <KitRing
          center={{ x: pos.x + MILO_W / 2, y: pos.y + MILO_H / 2 }}
          hover={hover}
          onClose={() => {
            setRingOpen(false);
            hover(false);
          }}
          onPick={(a) => openKit(a)}
        />
      )}
      {researchQ && (
        <ResearchPanel
          key={researchQ.id}
          question={researchQ.q}
          history={researchTurns}
          style={panelStyle}
          size={rpSize}
          onSize={setRpSize}
          onClose={closeResearch}
          onDone={onResearchDone}
          hover={hover}
        />
      )}

      {flag && <Highlight key={`flag-${flag.box.x}-${flag.box.y}`} box={flag.box} dim={false} locked warn />}
      {box && <Highlight key={locked ? "locked" : "guess"} box={box} dim={!lesson && !sweep} locked={locked} />}

      {box &&
        others.map((o, i) => (
          <button
            key={i}
            className="other-tag"
            style={{ left: o.box.x - 8, top: Math.max(2, o.box.y - 14), animationDelay: `${0.4 + i * 0.08}s` }}
            onMouseEnter={() => hover(true)} onMouseMove={() => hover(true)}
            onMouseLeave={() => hover(false)}
            onClick={() => look(lessonMode, `question ${o.label}`, o.box)}
            title={`Switch to ${o.label}`}
          >
            {/^[0-9a-z]{1,3}$/i.test(o.label) ? `#${o.label}` : o.label}
          </button>
        ))}

      {lesson && (
        <Notebook
          ref={notebookRef}
          key={lesson.topic + lessonMode}
          lesson={lesson}
          mode={lessonMode}
          revealed={revealed}
          finished={finished}
          style={nbStyle}
          hover={hover}
          onSkip={skipAhead}
          onClose={closeLesson}
          onSwitchMode={(m) => {
            setMode(m);
            look(m, lastRequest.current, box);
          }}
          onFeedback={onFeedback}
          onMic={talk}
          listening={earState === "hearing" || (earState === "waiting" && ears.current?.mode === "once")}
        />
      )}

      <div
        className="milo-wrap"
        style={{ left: pos.x, top: pos.y, width: MILO_W, height: MILO_H }}
        onMouseEnter={() => hover(true)} onMouseMove={() => hover(true)}
        onMouseLeave={() => !chatOpen && hover(false)}
        onClick={() => {
          if (speaking) {
            interrupted.current = true;
            hush();
            setBubble(null);
            return;
          }
          if (lesson) return;
          if (chatOpen) return closeChat();
          setOffer(null);
          setMenu((m) => !m);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          hover(true);
          setMood("looking");
        }}
        onDragLeave={() => setMood("idle")}
        onDrop={onDropToMilo}
        title="Click me · Cmd+Shift+Y = look at my screen"
      >
        {(earState === "hearing" || (earState === "waiting" && ears.current?.mode === "once")) && (
          <div className="ear-ring" style={{ transform: `scale(${1 + level * 0.6})` }} />
        )}
        <Milo mood={mood} facing={facing} speaking={speaking} character={character} />
        {watching && !working && !pending && !sweep && (
          <button
            className="watch-pill"
            onMouseEnter={() => hover(true)} onMouseMove={() => hover(true)}
            onClick={(e) => {
              e.stopPropagation();
              setWatch(false);
            }}
            title="Stop watching"
          >
            <span className="watch-eye" /> Watching · Stop
          </button>
        )}
        {answering && !pending && <div className="ears-on ears-on--answer">Listening… {answering}</div>}
        {handsFree && !answering && !watching && !working && !pending && !sweep && <div className={`ears-on ${earState === "hearing" ? "ears-on--hot" : ""}`}>Say "Hey Milo"</div>}
      </div>

      {bubble && <Bubble text={short(bubble)} style={bStyle} />}
      {menu && !bubble && !pending && (
        <div className="qmenu" style={bStyle} role="menu" aria-label="Milo" onMouseEnter={() => hover(true)} onMouseMove={() => hover(true)} onMouseLeave={() => hover(false)}>
          {(
            [
              ["👀", "Handle this", "I look and offer options", () => void handleThis("handle this")],
              ["🗓️", "What's next?", "Fix my week", () => routeRef.current("what's next", false)],
              ["✅", "Check this", "Find mistakes in my work", () => routeRef.current("check my work", false)],
              ["⬚", "Pick an area", "Drag a box over what you need (⌘⇧2)", () => setPicking({})],
              ["💬", "Chat", "Ask me anything", () => openChat()],
              ["🏠", "Home base", "Everything in one place", () => void window.milo.home.open()],
            ] as const
          ).map(([icon, label, sub, go]) => (
            <button
              key={label}
              role="menuitem"
              className="qmenu__item"
              onClick={(e) => {
                e.stopPropagation();
                setMenu(false);
                go();
              }}
            >
              <span className="qmenu__icon" aria-hidden="true">
                {icon}
              </span>
              <span>
                <b>{label}</b>
                <em>{sub}</em>
              </span>
            </button>
          ))}
          <div className="qmenu__hint">Or just say “Milo, …”. Drop a file on me too.</div>
        </div>
      )}
      {preflight && !bubble && !menu && !pending && (
        <div className="pf" style={bStyle} role="dialog" aria-label="Check this" onMouseEnter={() => hover(true)} onMouseMove={() => hover(true)} onMouseLeave={() => hover(false)}>
          <div className="pf__head">
            <b>Check this</b>
            <span className="pf__beta">BETA</span>
            <button className="offer__x" aria-label="Close" onClick={() => (setPreflight(null), hover(false))}>
              ✕
            </button>
          </div>
          <div className="pf__src">{preflight.rubricFrom ? "Checked against the rubric you copied" : preflight.requirements_seen ? "Checked against the instructions on screen" : "No rubric found. Copy it and ask again for a full check."}</div>
          {preflight.items.length === 0 && <div className="pf__ok">✓ Nothing to fix that I can see.</div>}
          {preflight.items.map((it) => (
            <div key={it.text} className={`pf__item pf__item--${it.status}`}>
              <span className="pf__tag">{it.status === "confirmed" ? "FIX" : it.status === "possible" ? "CHECK" : "CAN'T TELL"}</span>
              <div>
                <div>{it.text}</div>
                {it.quote && <em>“{it.quote}” · {it.source === "rubric" ? "rubric" : "instructions"}</em>}
              </div>
            </div>
          ))}
          <div className="pf__foot">I can be wrong. You decide what to change.</div>
        </div>
      )}
      {nudge && !bubble && !menu && !offer && !pending && (
        <div className="offer nudge" style={bStyle} role="status" onMouseEnter={() => hover(true)} onMouseMove={() => hover(true)} onMouseLeave={() => hover(false)}>
          <div className="offer__seen">{nudge.text}</div>
          <div className="offer__row">
            {nudge.actions.map((a, i) => (
              <button key={a} className={`offer__chip ${i === 0 && a !== "dismiss" ? "offer__chip--best" : ""}`} onClick={() => nudgeAct(a)}>
                {a === "start" && nudge.start ? `Start ${nudge.start.slice(0, 24)}` : NUDGE_LABEL[a]}
              </button>
            ))}
          </div>
        </div>
      )}
      {offer && !bubble && !menu && !pending && (
        <div className="offer" style={bStyle} role="dialog" aria-label="What Milo can do" onMouseEnter={() => hover(true)} onMouseMove={() => hover(true)} onMouseLeave={() => hover(false)}>
          {offer.seen && <div className="offer__seen">{offer.seen}</div>}
          <div className="offer__row">
            {offer.options.map((o, i) => (
              <button key={o.label} className={`offer__chip ${i === 0 ? "offer__chip--best" : ""}`} onClick={() => pickOffer(o)}>
                {o.label}
              </button>
            ))}
            <button className="offer__x" aria-label="Never mind" onClick={() => (setOffer(null), hover(false))}>
              ✕
            </button>
          </div>
        </div>
      )}
      {proof && !pending && (
        <button
          className="proof"
          style={{ ...bStyle, ...(bubble ? { transform: "translateY(-46px)" } : {}) }}
          onMouseEnter={() => hover(true)}
          onMouseMove={() => hover(true)}
          onMouseLeave={() => hover(false)}
          onClick={() => {
            window.milo.openUrl(proof.url);
            bb("proof_opened", { label: proof.label });
            setProof(null);
            hover(false);
          }}
        >
          ✓ {proof.label} ↗
        </button>
      )}
      {pending && (
        <div className="got-it" style={bStyle} onMouseEnter={() => hover(true)} onMouseMove={() => hover(true)} onMouseLeave={() => hover(false)}>
          <div className="got-it__label">{pending.unfinished ? "Keep going…" : "Got it"}</div>
          <div className="got-it__text">“{short(pending.text)}{pending.unfinished ? "…" : ""}”</div>
          <div className="got-it__row">
            <button className="got-it__go" onClick={confirmPending}>
              <span className="got-it__fill" style={{ width: pending.unfinished ? 0 : `${Math.round(pending.progress * 100)}%` }} />
              <b>Go</b>
            </button>
            <button className="got-it__cancel" onClick={cancelPending}>
              Cancel
            </button>
          </div>
          <div className="got-it__hint">Say “go”, keep talking to add, or “cancel”</div>
        </div>
      )}
      {working && (
        <button
          className="stop-pill"
          style={{ left: pos.x + MILO_W / 2 - 50, top: pos.y + MILO_H + 4 }}
          onMouseEnter={() => hover(true)} onMouseMove={() => hover(true)}
          onMouseLeave={() => hover(false)}
          onClick={() => window.milo.stopTask()}
        >
          Stop (Esc)
        </button>
      )}
      {!bubble && !pending && heard && <Bubble text={`“${short(heard)}”`} style={bStyle} heard />}
      {!bubble && !pending && !heard && earState === "thinking" && <Bubble text="…" style={bStyle} heard />}
      {!bubble && !pending && !heard && live && earState !== "thinking" && <Bubble text={live} style={bStyle} heard />}
      {confetti && <Confetti key={confetti.seed} {...confetti} />}
      {updateReady && !setup && (
        <button className="upd-pill" onMouseEnter={() => hover(true)} onMouseLeave={() => hover(false)} onClick={() => window.milo.updateInstall()} title="Restart Milo to finish updating">
          <span className="upd-dot" />
          New Milo ready{updateReady !== "new" ? ` (v${updateReady})` : ""} · <b>Restart</b>
        </button>
      )}
      {setup && (
        <Onboarding
          name={name}
          setName={setNameState}
          portal={portal}
          onPortal={(u) => {
            setPortalUrl(u);
            setSignIn(true);
          }}
          onDone={finishSetup}
          say={(t) => void say(t).then(() => setBubble(null))}
          hover={hover}
          shifted={signIn}
        />
      )}
      {job && (
        <JobCard
          job={job}
          style={{ right: 18, top: updateReady ? 56 : 14, width: 330, maxHeight: H - 40 }}
          hover={hover}
          onStop={() => void window.milo.jobStop()}
          onResume={() => void window.milo.jobResume(false)}
          onApprove={() => void window.milo.jobResume(true)}
          onClose={() => {
            setJob(null);
            hover(false);
          }}
        />
      )}
      {radarScan > 0 && portal && <BriefLoader key={`radar-${radarScan}`} url={portal} onResult={onRadarScan} />}
      {radarView && !working && (
        <RadarCard
          view={radarView}
          now={clock}
          lastScan={radar.lastScan}
          scanning={radarScan > 0}
          style={rdStyle}
          hover={hover}
          onStart={(x) => startFromRadar(x)}
          onClose={() => setRadarView(null)}
          onRefresh={() => scanRadar((ok) => ok && showRadarList(Infinity, false))}
        />
      )}
      {gp && !working && (
        <GamePlanCard
          sp={gp}
          style={gpStyle}
          hover={hover}
          lockedIn={lockOn}
          mini={gpMini}
          justDone={gpPop}
          onToggle={(i) => (gp.done.includes(i) ? undoStep(i) : void finishStep(i))}
          onWithMe={(i) => stepWithMe(i)}
          onLockIn={planLockIn}
          onClose={closePlan}
        />
      )}
      <LockIn
        ref={lockRef}
        miloPos={pos}
        onActive={setLockOn}
        api={{
          say,
          moveTo,
          setMood,
          setBubble,
          home,
          confetti: (x, y) => setConfetti({ x, y, seed: Date.now() }),
          hover,
          pos: () => posRef.current,
        }}
      />

      {picking && <AreaPicker onDone={areaPicked} onCancel={() => (setPicking(null), hover(false))} hover={hover} />}
      {areaFlash && !picking && <AreaFlash key={areaFlash.id} box={areaFlash.box} label={areaFlash.label} />}
      {chatOpen && (
        <div className="mc" style={chatStyle} onMouseEnter={() => hover(true)} onMouseMove={() => hover(true)} onMouseLeave={() => hover(false)}>
          {/* header: who, how he's doing, and three quiet buttons */}
          <div className="mc__head">
            <span className="mc__avatar" aria-hidden="true">
              {character === "frog" ? "🐸" : "🐵"}
            </span>
            <div className="mc__who">
              <b>Milo</b>
              <span className={`mc__status ${busy ? "is-busy" : handsFree ? "is-live" : ""}`}>{busy ? "Thinking…" : handsFree ? "Listening for “Milo”" : "Ready"}</span>
            </div>
            <button className={`mc__icon ${chatMore ? "is-on" : ""}`} onClick={() => setChatMore((v) => !v)} title="Settings" aria-label="Settings" aria-expanded={chatMore}>
              <svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M8.6 1.5h2.8l.4 2.3c.5.2 1 .5 1.4.8l2.2-.8 1.4 2.4-1.8 1.5a5 5 0 0 1 0 1.6l1.8 1.5-1.4 2.4-2.2-.8c-.4.3-.9.6-1.4.8l-.4 2.3H8.6l-.4-2.3c-.5-.2-1-.5-1.4-.8l-2.2.8-1.4-2.4 1.8-1.5a5 5 0 0 1 0-1.6L3.2 6.2l1.4-2.4 2.2.8c.4-.3.9-.6 1.4-.8zM10 7.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6z" /></svg>
            </button>
            <button className="mc__icon" onClick={() => (closeChat(), setRingOpen(true))} title="Milo's apps: Study, Sketch, Notes, Sheet, Planner" aria-label="Milo's apps">
              <svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M4 3h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zm8 0h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM4 11h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1zm8 0h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1z" /></svg>
            </button>
            <button className="mc__icon" onClick={() => void window.milo.home.open()} title="Open Home base" aria-label="Open Home base">
              <svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M10 2.5 2.5 8.6V17a.8.8 0 0 0 .8.8h4.4v-5h4.6v5h4.4a.8.8 0 0 0 .8-.8V8.6z" /></svg>
            </button>
            <button className="mc__icon" onClick={closeChat} title="Close" aria-label="Close">
              <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true"><path stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="m5 5 10 10M15 5 5 15" /></svg>
            </button>
          </div>

          {chatMore ? (
            /* settings: one clean list instead of a wall of chips */
            <div className="mc__more">
              {(
                [
                  ["Hands-free", "Always listening for “Milo”", handsFree, () => void toggleHandsFree()],
                  ["Voice", "Milo talks out loud", voice, () => setVoice((v) => !v)],
                  ["Natural voice", freeVoice ? "Off: using your Mac's free voice" : "On: the real Milo voice", !freeVoice, () => setFree(!freeVoice)],
                  ["Sounds", "Little clicks and dings", sounds, () => (setSounds(!sounds), setSoundsState(!sounds))],
                ] as [string, string, boolean, () => void][]
              ).map(([label, sub, on, flip]) => (
                <button key={label} className="mc__row" role="switch" aria-checked={on} onClick={flip}>
                  <span>
                    <b>{label}</b>
                    <small>{sub}</small>
                  </span>
                  <i className={`mc__switch ${on ? "on" : ""}`} aria-hidden="true" />
                </button>
              ))}
              <div className="mc__row mc__row--static">
                <span>
                  <b>Chrome helper</b>
                  <small>{chromeOn ? "Connected. Web tasks are fast." : "Not connected. Open Chrome and it connects."}</small>
                </span>
                <i className={`mc__dot ${chromeOn ? "ok" : ""}`} aria-hidden="true" />
              </div>
              <button className="mc__row" onClick={() => setCharacter((c) => (c === "frog" ? "monkey" : "frog"))}>
                <span>
                  <b>Character</b>
                  <small>{CHARACTERS[character].label}</small>
                </span>
                <em>Switch</em>
              </button>
              <label className="mc__row mc__row--name">
                <span>
                  <b>Your name</b>
                </span>
                <input value={name} onChange={(e) => setNameState(e.target.value.slice(0, 30))} placeholder="So Milo can greet you" />
              </label>
              <div className="mc__foot">
                <button onClick={() => void window.milo.home.open()}>Account &amp; more in Home base</button>
                <span>
                  <button onClick={() => window.milo.openLogs()}>Logs</button>
                  <button className="mc__quit" onClick={() => window.milo.quit()}>
                    Quit Milo
                  </button>
                </span>
              </div>
            </div>
          ) : (
            <>
              <div className="mc__list" ref={listRef}>
                {messages.length === 0 && !busy && (
                  <div className="mc__empty">
                    <b>{name ? `Hey ${name}. What are we working on?` : "What are we working on?"}</b>
                    <div className="mc__sugs">
                      {["What's due this week?", "Help with this", "Lock in for 25 minutes", "Quiz me"].map((q) => (
                        <button
                          key={q}
                          onClick={() => {
                            if (q === "Help with this") return void handleThis("handle this");
                            setMessages((m) => [...m, { role: "user", content: q }]);
                            routeRef.current(q, false);
                          }}
                        >
                          {q}
                        </button>
                      ))}
                    </div>
                    {tools.length > 0 && (
                      <div className="mc__tools">
                        <small>Your tools</small>
                        {tools.slice(0, 4).map((t) => (
                          <button key={t.id} onClick={() => openTool(t)}>
                            {t.title}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {messages.map((m, i) => (
                  <div key={i} className={`mc__msg mc__msg--${m.role}`}>
                    {m.content}
                  </div>
                ))}
                {busy && (
                  <div className="mc__msg mc__msg--assistant mc__typing" aria-label="Milo is thinking">
                    <i />
                    <i />
                    <i />
                  </div>
                )}
              </div>

              {/* screen help: pick how much help, then one button */}
              <div className="mc__look">
                <div className="mc__seg" role="radiogroup" aria-label="How much help">
                  {(["teach", "help", "do"] as MiloMode[]).map((m) => (
                    <button key={m} role="radio" aria-checked={m === mode} className={m === mode ? "on" : ""} onClick={() => setMode(m)}>
                      {m === "teach" ? "Teach" : m === "help" ? "Hint" : "Do it"}
                    </button>
                  ))}
                </div>
                <button className="mc__lookbtn" onClick={() => look(mode, "")} disabled={busy}>
                  Look at my screen
                </button>
              </div>

              <form
                className="mc__input"
                onSubmit={(e) => {
                  e.preventDefault();
                  send();
                }}
              >
                <input
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Ask Milo anything…"
                  onKeyDown={(e) => e.key === "Escape" && closeChat()}
                />
                <button type="button" className="mc__mic" onClick={talk} title="Talk (⌘⇧Space)" aria-label="Talk to Milo">
                  <svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M10 12.5a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v4.5a3 3 0 0 0 3 3zm5-3a.8.8 0 0 0-1.6 0 3.4 3.4 0 0 1-6.8 0 .8.8 0 0 0-1.6 0 5 5 0 0 0 4.2 4.9V16H7.5a.8.8 0 0 0 0 1.6h5a.8.8 0 0 0 0-1.6h-1.7v-1.6A5 5 0 0 0 15 9.5z" /></svg>
                </button>
                <button type="submit" className="mc__send" disabled={busy || !input.trim()} aria-label="Send">
                  <svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M10 3.5a.9.9 0 0 1 .64.26l5 5a.9.9 0 1 1-1.28 1.28L10.9 6.58V16a.9.9 0 1 1-1.8 0V6.58L5.64 10.04a.9.9 0 0 1-1.28-1.28l5-5A.9.9 0 0 1 10 3.5z" /></svg>
                </button>
              </form>
            </>
          )}
        </div>
      )}
    </>
  );
}
