import { useCallback, useEffect, useRef, useState } from "react";
import Milo, { Character, CHARACTERS, Mood } from "./Milo";
import Notebook, { NotebookHandle } from "./Notebook";
import { Ears, EarState } from "./ears";
import { Intent, isBareGo, parse, soundsUnfinished, stripGo, stripWake } from "./commands";
import { Bubble, Confetti, Highlight } from "./Effects";
import * as tts from "./voice";
import ResearchPanel, { PanelSize } from "./ResearchPanel";
import { Pin, SweepHUD, SweepState, SweepSummary, WorkCard } from "./Sweep";
import { setSounds, sfx, soundsOn } from "./sfx";
import ToolPanel, { SavedTool, loadTools, saveTools } from "./ToolPanel";
import QuizPanel, { QuizHandle } from "./QuizPanel";
import { BriefCard, BriefLoader, BriefState, SignInPanel } from "./Brief";
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
  const [mood, setMood] = useState<Mood>("sitting");
  const [facing, setFacing] = useState<"left" | "right">("left");
  const [speaking, setSpeaking] = useState(false);
  const [bubble, setBubble] = useState<string | null>(null);

  const [chatOpen, setChatOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
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
  const [pause, setPause] = useState(0); // "sending…" bar while you finish talking
  const [working, setWorking] = useState(false); // Milo is using the computer
  const [live, setLive] = useState<string | null>(null); // your words as you say them (smart ears)
  const workingRef = useRef(false);
  workingRef.current = working;
  const [researchQ, setResearchQ] = useState<{ q: string; id: number } | null>(null);
  const [rpSize, setRpSize] = useState<PanelSize>("compact");
  const [sweep, setSweep] = useState<SweepState | null>(null);
  const [sounds, setSoundsState] = useState(soundsOn());
  const [tool, setTool] = useState<{ request: string; id: number; existing?: SavedTool | null } | null>(null);
  const [tools, setTools] = useState<SavedTool[]>(loadTools);
  const [watching, setWatching] = useState(false);
  const [quiz, setQuiz] = useState<{ id: number; topic: string; questions: QuizQ[]; focus: string } | null>(null);
  const quizRef = useRef<QuizHandle>(null);
  const [brief, setBrief] = useState<BriefState | null>(null);
  const [briefRun, setBriefRun] = useState(0); // bump to (re)load the portal
  const [signIn, setSignIn] = useState(false);
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

  const hover = useCallback((on: boolean) => window.milo.setClickable(on), []);

  // ---- movement ---------------------------------------------------------------
  const moveTo = useCallback((target: Pos, style: "walk" | "jump" = "walk") => {
    return new Promise<void>((resolve) => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
      const tx = clamp(target.x, MARGIN, window.innerWidth - MILO_W - MARGIN);
      const ty = clamp(target.y, MARGIN, window.innerHeight - MILO_H - 4);
      const start = { ...posRef.current };
      const dist = Math.hypot(tx - start.x, ty - start.y);
      if (dist < 2) return resolve();

      setFacing(tx < start.x ? "left" : "right");
      setMood(style === "jump" ? "jumping" : "walking");
      const duration = style === "jump" ? clamp(dist / 1500, 0.35, 0.8) * 1000 : (dist / WALK_SPEED) * 1000;
      const arc = style === "jump" ? Math.min(180, 60 + dist * 0.2) : 0;
      const t0 = performance.now();

      const step = (now: number) => {
        const k = Math.min(1, (now - t0) / duration);
        const e = style === "jump" ? (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2) : k;
        const next = {
          x: start.x + (tx - start.x) * e,
          y: start.y + (ty - start.y) * e - arc * Math.sin(Math.PI * k),
        };
        posRef.current = next;
        setPos(next);
        if (k >= 1) {
          animRef.current = null;
          if (style === "jump") sfx.hop();
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
    if (chatOpen || lesson || busy || working || researchQ) return; // stay put while the research box is open
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
  }, [chatOpen, lesson, busy, working, moveTo, researchQ]);

  // ---- voice ------------------------------------------------------------------
  const say = useCallback(async (text: string, opts: { minMs?: number; noBarge?: boolean } = {}) => {
    setBubble(text);
    setHeard(null);
    lastSaid.current = text;
    const t0 = Date.now();
    bb("say", { text, voiceOn: voiceRef.current, bargeIn: !opts.noBarge });
    ears.current?.mute(true, !opts.noBarge); // don't let Milo hear himself
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
      const r = await window.milo.task(task);
      setWorking(false);
      // Done working: hop back to the corner so he's not sitting on top of what he just made.
      moveTo(home(), "jump");
      if (!r.ok) {
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
        listen();
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
        await say(r.text || "Found it.");
        setBubble(null);
        return true;
      }
      setMood("celebrating");
      setConfetti({ x: posRef.current.x + MILO_W / 2, y: posRef.current.y + 40, seed: Date.now() });
      await say(r.text);
      setBubble(null);
      setMood("happy");
      if (byVoice) listen();
      return true;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [say, hover, listen, look]
  );

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
  const runSweep = async () => {
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
      state = { ...state, ...patch, results: [...results] };
      setSweep(state);
    };
    show({});
    setMood("looking");
    say("Reading the whole page.").then(() => setBubble(null));

    for (let page = 0; page < 3; page++) {
      const plan = await window.milo.sweepPlan(results.map((r) => r.label));
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
      for (let i = 0; i < items.length; i++) {
        if (sweepStop.current) return show({ status: "stopped" });
        const it = items[i];
        show({ items, index: i, status: "working" });
        // 1) lock onto the question
        setBox(it.box);
        setLocked(true);
        sfx.lock();
        await moveTo({ x: it.box.x + it.box.width + 12, y: it.box.y - MILO_H * 0.35 }, "jump");
        setMood("writing");
        await sleep(900); // time to read the work card
        if (sweepStop.current) return show({ status: "stopped" });
        // 2) put the answer in
        let filled = false;
        if (it.kind !== "none" && it.screen) {
          setMood("pointing");
          const r = await window.milo.sweepFill(it);
          filled = r.ok;
          if (r.ok) sfx.tick();
        }
        results.push({ label: it.label, answer: it.answer, filled });
        show({});
        await sleep(250);
      }
      if (!plan.more) break;
      show({ status: "scrolling" });
      setBox(null);
      await window.milo.scrollPage();
    }
    setBox(null);
    show({ status: "done" });
    moveTo(home(), "jump");
    setMood("celebrating");
    sfx.success();
    const filled = results.filter((r) => r.filled).length;
    await say(
      `Done. ${results.length} question${results.length === 1 ? "" : "s"}` +
        (filled ? `, ${filled} filled in` : "") +
        (results.length - filled ? `, ${results.length - filled} shown on screen` : "") +
        "."
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
  const checkWorkNow = async () => {
    setChatOpen(false);
    hover(false);
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
    setBriefRun(Date.now());
    if (spoken) setMood("looking");
  };
  const onBrief = async (st: BriefState) => {
    setBrief(st);
    setBriefRun(0);
    if (st.phase === "ready") {
      setMood("happy");
      await say(`${greeting()} ${st.spoken || (st.items.length ? "" : "Nothing due soon. You're all caught up.")}`.trim());
      setBubble(null);
    } else if (st.phase === "signin") {
      await say(`${greeting()} Sign in to D2L once and I'll keep track of what's due.`);
      setBubble(null);
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
    setBrief({ phase: "signin" });
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
  routeCtxRef.current = () => ({
    researchOpen: !!researchQ,
    researchTopic: researchQ?.q,
    inLesson: !!lessonRef.current,
    lessonTopic: lessonRef.current?.topic,
    toolOpen: tool ? tool.request : undefined,
    quizOpen: !!quiz,
    lastCommand: lastCommand.current || undefined,
  });
  routeRef.current = (text: string, spoken = true) => {
    if (/^(flag (that|this|it)|that was (wrong|bad|weird|a bug|broken)|log (that|this)|report (a |that |this )?bug|bug report|that'?s a bug)\b/i.test(text.trim())) {
      flagNow(text);
      return;
    }
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
    if (researchQ || tool) {
      const t = text.toLowerCase();
      if (/^(close|done|thanks|thank you|got it|never ?mind|that'?s all)\b/.test(t)) return tool ? closeTool() : closeResearch();
      if (/(full ?screen|make it (big|bigger|full)|expand( it)?|maximi[sz]e)/.test(t)) return setRpSize("full");
      if (/(half|split) ?screen|make it half/.test(t)) return setRpSize("half");
      if (/(smaller|shrink|minimi[sz]e|compact)/.test(t)) return setRpSize("compact");
    }
    const inLesson = !!lessonRef.current;
    const awaitingAnswer = inLesson && finishedRef.current && lessonModeRef.current !== "do" && !!lessonRef.current?.check_question;
    const intent = parse(text, { inLesson, awaitingAnswer, pendingAsk: !!pendingTask.current });
    const nb = notebookRef.current;
    // Unmistakable commands run right away. Everything else: the router decides, knowing what's open.
    const SURE = ["hush", "yes", "no", "resume", "chain"];
    const LESSON_SURE = ["close", "goto", "mode", "answer", "show", "copy", "practice", "skip", "repeat", "fill"];
    if (!SURE.includes(intent.kind) && !(inLesson && LESSON_SURE.includes(intent.kind))) {
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
        sweepStop.current = true;
        window.milo.stopTask();
        setBubble(null);
        return;
      case "task":
        runTask(intent.task, spoken);
        return;
      case "research":
        startResearch(intent.question, spoken);
        return;
      case "sweep":
        runSweep();
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
        startBrief(spoken);
        return;
      case "chain":
        runChain(intent.steps, spoken);
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
        if (pendingTask.current) runTask(`${pendingTask.current}\n(The student said yes, go ahead with what you asked about.)`);
        return;
      case "no":
        pendingTask.current = null;
        say("No problem, I won't.").then(() => setBubble(null));
        return;
      case "close":
        closeLesson();
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
      case "research":
        startResearch(rt.question?.trim() || text, spoken, !!researchQ && rt.followUp === true);
        return;
      case "task":
        if (local.kind === "chain") runChain(local.steps, spoken);
        else runTask(text, spoken);
        return;
      case "look": {
        const m = rt.mode ?? "teach";
        setMode(m);
        look(m, text, null, spoken);
        return;
      }
      case "move":
        moveMilo(rt.where ?? "away");
        return;
      case "close":
        if (tool) closeTool();
        else if (researchQ) closeResearch();
        else if (quiz) closeQuiz();
        else if (lessonRef.current) closeLesson();
        else setMood("idle");
        return;
      case "open_result":
        if (researchTop.current) {
          window.milo.openUrl(researchTop.current);
          say("Opened it in Chrome.").then(() => setBubble(null));
        } else runTask(text, spoken);
        return;
      case "sweep":
        runSweep();
        return;
      case "build":
        startBuild(text);
        return;
      case "quiz":
        startQuiz(text);
        return;
      case "brief":
        startBrief(spoken);
        return;
      case "watch":
        setWatch(rt.on ?? true);
        return;
      case "checkwork":
        checkWorkNow();
        return;
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
  const flagRef = useRef(flagNow);
  flagRef.current = flagNow;
  useEffect(() => window.milo.onFlag(() => flagRef.current("shortcut")), []);

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
    e.onUtterance = (wav, pushToTalk, forced) => take({ wav, pushToTalk, forced });
    // Smart ears: the words are already transcribed (and Flux decided you were done).
    e.onTranscript = (text, pushToTalk, forced, wav) => {
      setLive(null);
      window.milo.saveClip(wav, text);
      take({ wav, text, pushToTalk, forced });
    };
    // Your words, live, while you're still talking (only when you're clearly talking to Milo).
    e.onPartial = (t) => {
      const toMilo = e.mode === "once" || !!pendingRef.current || Date.now() < followUntil.current || /\b(milo|mylo|my low)\b/i.test(t);
      if (toMilo) setLive(t.length > 140 ? "…" + t.slice(-140) : t);
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
      let text = r.text;
      const addressed = stripWake(r.text, true).woke;
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
          followUntil.current = Date.now() + 10000;
          sfx.chime();
          setHeard(null);
          setBubble("Yeah?");
          setTimeout(() => setBubble((b) => (b === "Yeah?" ? null : b)), 4000);
          return;
        }
        text = w.rest;
      } else {
        text = stripWake(text).rest || text;
        if (text) e.learnVoice();
      }
      if (!text) return;

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
        if (!isStop && !isBareGo(tt) && (connects || soundsUnfinished(LR.text) || Date.now() - LR.at < 5000)) {
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

      // Everything else goes on the "Got it" card first.
      const cleaned = stripGo(text);
      setPendingCmd(cleaned, cleaned !== text.trim());
    };
    return () => {
      offFlux();
      e.setMode("off");
    };
  }, [say, listen]);

  // ---- "Got it" card --------------------------------------------------------------
  const AUTO_GO_MS = 4000;
  const runPending = (text: string) => {
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
    const unfinished = soundsUnfinished(text);
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
      const stillTalking = earStateRef.current === "hearing" || earStateRef.current === "thinking" || levelRef.current > 0.3;
      if (stillTalking && Date.now() - P.first < 30000) {
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
      if (!(await window.milo.micAccess())) return;
      try {
        await ears.current!.setMode("always");
        setHandsFree(true);
      } catch {
        /* mic unavailable */
      }
    })();
  }, []);

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

  // ---- layout -----------------------------------------------------------------
  const W = window.innerWidth;
  const H = window.innerHeight;
  const panelW = 360;
  const panelLeft = clamp(pos.x + MILO_W / 2 - panelW / 2, MARGIN, W - panelW - MARGIN);

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

  // Speech bubble: never on top of Milo. Above him (growing upward) if there's room,
  // otherwise beside him on the side away from the notebook, otherwise below.
  const bubblePos = (): React.CSSProperties => {
    const maxW = 280;
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
  const bStyle = bubblePos();
  const short = (t: string) => (t.length > 170 ? t.slice(0, 167).trimEnd() + "…" : t);

  return (
    <>
      {sweep && (
        <>
          <SweepHUD s={sweep} onStop={stopSweep} hover={hover} />
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
            startBrief(true);
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
          style={rpStyle}
          size={rpSize}
          onSize={setRpSize}
          onClose={closeTool}
          onDone={onToolDone}
          onSaved={onToolSaved}
          hover={hover}
        />
      )}

      {researchQ && (
        <ResearchPanel
          key={researchQ.id}
          question={researchQ.q}
          history={researchTurns}
          style={rpStyle}
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
            onMouseEnter={() => hover(true)}
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
        onMouseEnter={() => hover(true)}
        onMouseLeave={() => !chatOpen && hover(false)}
        onClick={() => {
          if (speaking) {
            interrupted.current = true;
            hush();
            setBubble(null);
            return;
          }
          if (lesson) return;
          chatOpen ? closeChat() : openChat();
        }}
        title="Click me · Cmd+Shift+Y = look at my screen"
      >
        {(earState === "hearing" || (earState === "waiting" && ears.current?.mode === "once")) && (
          <div className="ear-ring" style={{ transform: `scale(${1 + level * 0.6})` }} />
        )}
        <Milo mood={mood} facing={facing} speaking={speaking} character={character} />
        {watching && !working && !pending && !sweep && (
          <button
            className="watch-pill"
            onMouseEnter={() => hover(true)}
            onClick={(e) => {
              e.stopPropagation();
              setWatch(false);
            }}
            title="Stop watching"
          >
            <span className="watch-eye" /> Watching · Stop
          </button>
        )}
        {handsFree && !watching && !working && !pending && !sweep && <div className={`ears-on ${earState === "hearing" ? "ears-on--hot" : ""}`}>Say "Hey Milo"</div>}
      </div>

      {bubble && <Bubble text={short(bubble)} style={bStyle} />}
      {pending && (
        <div className="got-it" style={bStyle} onMouseEnter={() => hover(true)} onMouseLeave={() => hover(false)}>
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
          onMouseEnter={() => hover(true)}
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

      {chatOpen && (
        <div className="panel" style={{ left: panelLeft, bottom: H - pos.y + 16, width: panelW }} onMouseEnter={() => hover(true)}>
          <div className="panel__head">
            <span>Milo</span>
            <div className="panel__actions">
              <button
                className="chip"
                title="Switch character"
                onClick={() => setCharacter((c) => (c === "frog" ? "monkey" : "frog"))}
              >
                {CHARACTERS[character].label}
              </button>
              <button className={`chip ${handsFree ? "chip--on" : ""}`} onClick={toggleHandsFree} title='Always listening for "Milo…"'>
                {handsFree ? "Hands-free on" : "Hands-free"}
              </button>
              <button
                className="chip"
                onClick={() => {
                  setSounds(!sounds);
                  setSoundsState(!sounds);
                }}
                title="Interface sounds"
              >
                {sounds ? "Sounds on" : "Sounds off"}
              </button>
              <button className="chip" onClick={() => setVoice((v) => !v)}>
                {voice ? "Voice on" : "Voice off"}
              </button>
              <button
                className={`chip ${freeVoice ? "chip--on" : ""}`}
                onClick={() => setFree(!freeVoice)}
                title="Free voice uses your Mac's built-in voice and saves ElevenLabs credits. Listening still works."
              >
                {freeVoice ? "Free voice" : "Natural voice"}
              </button>
              <button className="chip" onClick={() => window.milo.openLogs()} title="Open Milo's black-box log (Cmd+Shift+B flags a bug)">
                Logs
              </button>
              <button className="chip" onClick={closeChat}>
                Hide
              </button>
              <button className="chip chip--danger" onClick={() => window.milo.quit()}>
                Quit
              </button>
            </div>
          </div>

          <div className="panel__look">
            <div className="seg">
              {(["teach", "help", "do"] as MiloMode[]).map((m) => (
                <button key={m} className={`seg__b ${m === mode ? "seg__b--on" : ""}`} onClick={() => setMode(m)}>
                  {m === "teach" ? "Teach me" : m === "help" ? "Hint" : "Do it for me"}
                </button>
              ))}
            </div>
            <button className="look-btn" onClick={() => look(mode, "")} disabled={busy}>
              Look at my screen
            </button>
            <button className="talk-btn" onClick={talk}>
              Talk to Milo
            </button>
            {tools.length > 0 && (
              <div className="mytools">
                <span>My tools</span>
                {tools.slice(0, 6).map((t) => (
                  <button key={t.id} onClick={() => openTool(t)} title={`Open ${t.title}`}>
                    {t.title}
                  </button>
                ))}
              </div>
            )}
            <label className="name-row">
              <span>Your name</span>
              <input value={name} onChange={(e) => setNameState(e.target.value.slice(0, 30))} placeholder="So Milo can greet you" />
            </label>
            <div className="hint">Cmd+Shift+Space = talk · Cmd+Shift+Y = look · or turn on Hands-free</div>
          </div>

          <div className="panel__list" ref={listRef}>
            {messages.map((m, i) => (
              <div key={i} className={`bubble bubble--${m.role}`}>
                {m.content}
              </div>
            ))}
            {busy && <div className="bubble bubble--assistant bubble--typing">Milo is thinking…</div>}
          </div>
          <form
            className="panel__input"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder='Ask anything, or "teach me this"'
              onKeyDown={(e) => e.key === "Escape" && closeChat()}
            />
            <button type="submit" disabled={busy || !input.trim()}>
              Send
            </button>
          </form>
        </div>
      )}
    </>
  );
}
