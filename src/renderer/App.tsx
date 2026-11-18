import { useCallback, useEffect, useRef, useState } from "react";
import Milo, { Character, CHARACTERS, Mood } from "./Milo";
import Notebook from "./Notebook";
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

  const posRef = useRef(pos);
  const animRef = useRef<number | null>(null);
  const runId = useRef(0); // bumps to cancel an in-flight lesson
  const lastRequest = useRef("");
  const voiceRef = useRef(voice);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  posRef.current = pos;
  voiceRef.current = voice;

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
    if (chatOpen || lesson || busy) return;
    const t = window.setInterval(() => {
      if (animRef.current) return;
      const r = Math.random();
      if (r < 0.45) {
        const h = home();
        moveTo({ x: Math.random() * window.innerWidth, y: h.y }).then(() => setMood(Math.random() < 0.5 ? "sitting" : "idle"));
      } else if (r < 0.65) setMood("sitting");
    }, 7000);
    return () => window.clearInterval(t);
  }, [chatOpen, lesson, busy, moveTo]);

  // ---- voice ------------------------------------------------------------------
  const say = useCallback(async (text: string, opts: { minMs?: number } = {}) => {
    setBubble(text);
    if (!voiceRef.current) {
      setSpeaking(true);
      await sleep(Math.max(opts.minMs ?? 1400, text.split(/\s+/).length * 300));
      setSpeaking(false);
      return;
    }
    await tts.play(text, () => setSpeaking(true));
    setSpeaking(false);
  }, []);

  const hush = () => {
    tts.stop();
    setSpeaking(false);
  };

  // ---- the magic: look at the screen and teach --------------------------------
  const closeLesson = useCallback(() => {
    runId.current++;
    hush();
    setLesson(null);
    setBox(null);
    setBubble(null);
    setFinished(false);
    setRevealed(0);
    hover(false);
    moveTo(home(), "jump").then(() => setMood("sitting"));
  }, [hover, moveTo]);

  const look = useCallback(
    async (m: MiloMode, request: string) => {
      const id = ++runId.current;
      lastRequest.current = request;
      hush();
      setChatOpen(false);
      setLesson(null);
      setBox(null);
      setFinished(false);
      setRevealed(0);
      setBusy(true);
      setMood("looking");
      setBubble(m === "do" ? "On it. Let me see…" : "Ooh, let me look…");

      const r = await window.milo.look(m, request);
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
        await say(L.check_question ? "Your turn. Give the last part a shot." : "That's the move!");
      }
      if (id === runId.current) setBubble(null);
    },
    [moveTo, say]
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

    if (wantsScreen(text)) {
      const m = detectMode(text, mode);
      setMode(m);
      look(m, text);
      return;
    }

    const next: Msg[] = [...messages, { role: "user", content: text }];
    setBusy(true);
    setMood("thinking");
    const history = next[0]?.role === "assistant" ? next.slice(1) : next;
    const reply = await window.milo.ask(history);
    setMessages((m) => [...m, { role: "assistant", content: reply.text }]);
    setBusy(false);
    setMood("happy");
    if (reply.ok) say(reply.text).then(() => setBubble(null));
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

  // Speech bubble: above Milo if there's room, otherwise beside him (away from the notebook).
  const roomAbove = pos.y - 70 >= MARGIN;
  const notebookOnRight = box ? (nbStyle.left as number) > pos.x : false;
  const bubbleX = roomAbove
    ? clamp(pos.x + MILO_W / 2 - 140, MARGIN, W - 280 - MARGIN)
    : notebookOnRight || pos.x + MILO_W + 290 > W
      ? clamp(pos.x - 290, MARGIN, W - 280 - MARGIN)
      : pos.x + MILO_W + 8;
  const bubbleY = roomAbove ? pos.y - 70 : pos.y + 12;

  return (
    <>
      {box && <Highlight key={locked ? "locked" : "guess"} box={box} dim={!lesson} locked={locked} />}

      {lesson && (
        <Notebook
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
            look(m, lastRequest.current);
          }}
          onFeedback={onFeedback}
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
        <Milo mood={mood} facing={facing} speaking={speaking} character={character} />
      </div>

      {bubble && <Bubble text={bubble} x={bubbleX} y={bubbleY} />}
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
            <div className="hint">Shortcut: Cmd+Shift+Y from any app</div>
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
