import { useCallback, useEffect, useRef, useState } from "react";
import Milo, { Character, CHARACTERS, Mood } from "./Milo";
import Notebook, { NotebookHandle } from "./Notebook";
import { Ears, EarState } from "./ears";
import { isBareGo, parse, soundsUnfinished, stripGo, stripWake } from "./commands";
import { Bubble, Confetti, Highlight } from "./Effects";
import * as tts from "./voice";

type Msg = { role: "user" | "assistant"; content: string };
type Pos = { x: number; y: number };

const MILO_W = 120;
const MILO_H = 140;
const WALK_SPEED = 220; // px/s when strolling
const MARGIN = 16;
const NB_W = 380;

const home = (): Pos => ({ x: window.innerWidth - MILO_W - 24, y: window.innerHeight - MILO_H - 8 });
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Guess what the student wants from what they typed.
function detectMode(text: string, fallback: MiloMode): MiloMode {
  const t = text.toLowerCase();
  if (/(do it|for me|just (give|tell)|the answer|solve it|finish it)/.test(t)) return "do";
  if (/(hint|stuck|nudge|help me)/.test(t)) return "help";
  if (/(teach|explain|how do|walk me|show me how)/.test(t)) return "teach";
  return fallback;
}
// A tiny two-note "I'm listening" chime (no speech, so the mic stays open).
let chimeCtx: AudioContext | null = null;
function chime() {
  try {
    chimeCtx = chimeCtx ?? new AudioContext();
    const t = chimeCtx.currentTime;
    [880, 1320].forEach((f, i) => {
      const o = chimeCtx!.createOscillator();
      const g = chimeCtx!.createGain();
      o.frequency.value = f;
      o.type = "sine";
      g.gain.setValueAtTime(0, t + i * 0.09);
      g.gain.linearRampToValueAtTime(0.12, t + i * 0.09 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.09 + 0.16);
      o.connect(g).connect(chimeCtx!.destination);
      o.start(t + i * 0.09);
      o.stop(t + i * 0.09 + 0.18);
    });
  } catch {
    /* no audio */
  }
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
  const followUntil = useRef(0); // hands-free: no need to say "Milo" until this time
  const voiceSession = useRef(false); // the current lesson was started by voice
  const routeRef = useRef<(text: string, spoken?: boolean) => void>(() => {});
  const pendingTask = useRef<string | null>(null);
  const lastCommand = useRef<string | null>(null);
  const lastCommandAt = useRef(0);
  const partial = useRef<{ text: string; timer: number } | null>(null); // a sentence you haven't finished yet // last thing you asked for (so a bare "go" can redo it)
  const restoreHandsFree = useRef(false);
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
    if (chatOpen || lesson || busy || working) return;
    const t = window.setInterval(() => {
      if (animRef.current) return;
      const r = Math.random();
      if (r < 0.45) {
        const h = home();
        moveTo({ x: Math.random() * window.innerWidth, y: h.y }).then(() => setMood(Math.random() < 0.5 ? "sitting" : "idle"));
      } else if (r < 0.65) setMood("sitting");
    }, 7000);
    return () => window.clearInterval(t);
  }, [chatOpen, lesson, busy, working, moveTo]);

  // ---- voice ------------------------------------------------------------------
  const say = useCallback(async (text: string, opts: { minMs?: number } = {}) => {
    setBubble(text);
    setHeard(null);
    lastSaid.current = text;
    ears.current?.mute(true); // don't let Milo hear himself
    try {
      if (!voiceRef.current) {
        setSpeaking(true);
        await sleep(Math.max(opts.minMs ?? 1400, text.split(/\s+/).length * 300));
        return;
      }
      await tts.play(text, () => setSpeaking(true));
    } finally {
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
      for (let i = 0; i < L.steps.length; i++) {
        if (id !== runId.current) return;
        setRevealed(i + 1);
        setMood("writing");
        await Promise.all([say(L.steps[i].say), sleep(900)]);
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
      setConfetti({ x: posRef.current.x + MILO_W / 2, y: posRef.current.y + 40, seed: Date.now() });
    } else setMood("thinking");
    await say(text);
    setBubble(null);
    setMood("happy");
    if (!correct && voiceSession.current) listen(); // let them try again out loud
  };

  // ---- hands: do things on the computer -------------------------------------------
  const runTask = useCallback(
    async (task: string, byVoice = true) => {
      if (!(await window.milo.handsAccess())) {
        await say("I need permission to use your keyboard and mouse. Turn on Terminal in System Settings, Privacy and Security, Accessibility, then restart me.");
        setBubble(null);
        return;
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
      } else if (r.status === "ask") {
        pendingTask.current = task;
        setMood("happy");
        await say(r.text);
        setBubble(null);
        listen();
        return;
      } else if (r.status === "quick") {
        // Instant command (open an app, new tab…) already happened. Anything left gets routed:
        // homework ("…and solve the problem") or more computer work ("…and write a poem").
        setMood("happy");
        if (r.rest) {
          const intent = parse(r.rest, { inLesson: false, awaitingAnswer: false });
          if (intent.kind === "look") {
            setMode(intent.mode);
            look(intent.mode, intent.request, null, byVoice);
          } else {
            runTask(`${r.rest}\n(Already done: ${(r.did ?? []).join("; ")})`, byVoice);
          }
          return;
        }
        await sleep(1200);
      } else if (r.status === "stopped") {
        setMood("idle");
        await say("Stopped!");
      } else {
        setMood("celebrating");
        setConfetti({ x: posRef.current.x + MILO_W / 2, y: posRef.current.y + 40, seed: Date.now() });
        await say(r.text);
      }
      setBubble(null);
      setMood("happy");
      if (byVoice) listen();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [say, hover, listen, look]
  );

  // Follow Milo's hands: hop next to whatever he's about to click, show what he's doing.
  useEffect(
    () =>
      window.milo.onTaskStep((st) => {
        // Never repeat the same line back to back; it sounds glitchy.
        const norm = st.say.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
        if (norm && norm !== lastStepSay.current) {
          lastStepSay.current = norm;
          setBubble(st.say);
          tts.play(st.say, () => setSpeaking(true)).then(() => setSpeaking(false));
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
  routeRef.current = (text: string, spoken = true) => {
    const inLesson = !!lessonRef.current;
    const awaitingAnswer = inLesson && finishedRef.current && lessonModeRef.current !== "do" && !!lessonRef.current?.check_question;
    const intent = parse(text, { inLesson, awaitingAnswer, pendingAsk: !!pendingTask.current });
    const nb = notebookRef.current;
    switch (intent.kind) {
      case "hush":
        hush();
        window.milo.stopTask();
        setBubble(null);
        return;
      case "task":
        runTask(intent.task, spoken);
        return;
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
        // Keywords didn't settle it: ask the router before assuming it's just chat.
        if (!inLesson) {
          setMood("thinking");
          window.milo.route(intent.text).then((rt) => {
            if (rt.kind === "look") {
              const m = rt.mode ?? "teach";
              setMode(m);
              look(m, intent.text, null, spoken);
            } else if (rt.kind === "task") runTask(intent.text, spoken);
            else chat(intent.text, spoken);
          });
          return;
        }
        chat(intent.text, spoken);
        return;
    }
  };

  // Wire up the microphone once.
  useEffect(() => {
    const e = ears.current!;
    e.onLevel = (l) => setLevel(l);
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
    let queued: { wav: ArrayBuffer; pushToTalk: boolean; forced: boolean } | null = null; // newest waiting utterance (never drop yours)
    e.onPause = (p) => setPause(p);
    e.onUtterance = async (wav, pushToTalk, forced) => {
      if (inFlight) {
        queued = { wav, pushToTalk, forced };
        return;
      }
      inFlight = true;
      try {
        await handle(wav, pushToTalk, forced);
      } finally {
        inFlight = false;
        if (queued) {
          const q = queued;
          queued = null;
          e.onUtterance(q.wav, q.pushToTalk, q.forced);
        }
      }
    };
    const handle = async (wav: ArrayBuffer, pushToTalk: boolean, forced: boolean) => {
      const direct = pushToTalk || !!partial.current || Date.now() < followUntil.current; // you were clearly talking to Milo
      const longEnough = e.voicedFrames * 1024 > 16000 * 1.0; // over ~1s of real talking
      if (direct) {
        setEarState("thinking");
        setMood("thinking");
      }
      const r = await window.milo.stt(wav);
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
      if (!direct) {
        // Hands-free: only act when you start with "Milo".
        const w = stripWake(text, true);
        if (!w.woke) {
          setMood((m) => (m === "thinking" || m === "listening" ? "idle" : m));
          return;
        }
        e.learnVoice(); // that was you, so remember how loud you are
        if (!w.rest) {
          // Just "Hey Milo": chime and show "Yeah?" without talking, so his ears stay open for your command.
          setMood("listening");
          followUntil.current = Date.now() + 10000;
          chime();
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

      // Join with the start of a sentence you paused in the middle of.
      if (partial.current) {
        text = `${partial.current.text} ${text}`.trim();
        window.clearTimeout(partial.current.timer);
        partial.current = null;
      }
      // Sounds unfinished ("go", "open the", "go to chrome and")? Keep listening for the rest.
      if (!forced && soundsUnfinished(stripGo(text)) && !(isBareGo(text) && Date.now() - lastCommandAt.current < 30000)) {
        const sofar = text;
        partial.current = {
          text: sofar,
          // If nothing else comes, go with what we have.
          timer: window.setTimeout(() => {
            if (partial.current?.text !== sofar) return;
            partial.current = null;
            setHeard(sofar);
            routeRef.current(stripGo(sofar));
          }, 6000),
        };
        followUntil.current = Date.now() + 8000;
        setHeard(`${sofar}…`);
        setMood("listening");
        if (e.mode === "off") listen();
        return;
      }
      followUntil.current = 0;
      // A bare "go" means: do the last thing I asked (if it didn't happen).
      if (isBareGo(text)) {
        if (lastCommand.current) text = lastCommand.current;
        else {
          await say("Go where? Tell me what to do.");
          setBubble(null);
          listen();
          return;
        }
      } else {
        text = stripGo(text);
        lastCommand.current = text;
        lastCommandAt.current = Date.now();
      }
      setHeard(text);
      setBubble(null);
      routeRef.current(text);
    };
    return () => {
      e.setMode("off");
    };
  }, [say, listen]);

  const talk = useCallback(() => {
    const e = ears.current!;
    // Pressed again while listening: send what you said right now (push-to-talk in loud rooms).
    if (e.mode === "once") {
      e.flush();
      return;
    }
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
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && lesson && closeLesson();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lesson, closeLesson]);

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
      {box && <Highlight key={locked ? "locked" : "guess"} box={box} dim={!lesson} locked={locked} />}

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
          if (lesson) return;
          chatOpen ? closeChat() : openChat();
        }}
        title="Click me · Cmd+Shift+Y = look at my screen"
      >
        {(earState === "hearing" || (earState === "waiting" && ears.current?.mode === "once")) && (
          <div className="ear-ring" style={{ transform: `scale(${1 + level * 0.6})` }} />
        )}
        <Milo mood={mood} facing={facing} speaking={speaking} character={character} />
        {pause > 0.05 && earState === "hearing" && (
          <div className="send-bar">
            <span style={{ width: `${Math.round(pause * 100)}%` }} />
            <em>sending…</em>
          </div>
        )}
        {handsFree && !working && pause <= 0.05 && <div className={`ears-on ${earState === "hearing" ? "ears-on--hot" : ""}`}>Say "Hey Milo"</div>}
      </div>

      {bubble && <Bubble text={short(bubble)} style={bStyle} />}
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
      {!bubble && heard && <Bubble text={`“${short(heard)}”`} style={bStyle} heard />}
      {!bubble && !heard && earState === "thinking" && <Bubble text="…" style={bStyle} heard />}
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
              <button className="chip" onClick={() => setVoice((v) => !v)}>
                {voice ? "Voice on" : "Voice off"}
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
