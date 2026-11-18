import { useCallback, useEffect, useRef, useState } from "react";
import Milo, { Mood } from "./Milo";

type Msg = { role: "user" | "assistant"; content: string };

const MILO_W = 120;
const MILO_H = 140;
const WALK_SPEED = 220; // px per second
const MARGIN = 24;

export default function App() {
  const [x, setX] = useState(() => window.innerWidth - MILO_W - MARGIN);
  const [mood, setMood] = useState<Mood>("sitting");
  const [facing, setFacing] = useState<"left" | "right">("left");
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [voice, setVoice] = useState(true);

  const xRef = useRef(x);
  const walkRaf = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  xRef.current = x;

  const y = window.innerHeight - MILO_H - 8;

  // ---- movement -------------------------------------------------------------
  const walkTo = useCallback((targetX: number, then?: () => void) => {
    const clamped = Math.max(MARGIN, Math.min(window.innerWidth - MILO_W - MARGIN, targetX));
    if (walkRaf.current) cancelAnimationFrame(walkRaf.current);
    setFacing(clamped < xRef.current ? "left" : "right");
    setMood("walking");

    let last = performance.now();
    const step = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const cur = xRef.current;
      const dist = clamped - cur;
      const move = Math.sign(dist) * Math.min(Math.abs(dist), WALK_SPEED * dt);
      const next = cur + move;
      xRef.current = next;
      setX(next);
      if (Math.abs(clamped - next) < 1) {
        walkRaf.current = null;
        setMood("idle");
        then?.();
        return;
      }
      walkRaf.current = requestAnimationFrame(step);
    };
    walkRaf.current = requestAnimationFrame(step);
  }, []);

  // Wander around on his own when nobody is talking to him.
  useEffect(() => {
    if (open) return;
    const t = window.setInterval(() => {
      if (walkRaf.current || busy) return;
      const r = Math.random();
      if (r < 0.45) {
        walkTo(Math.random() * window.innerWidth, () => setMood(Math.random() < 0.5 ? "sitting" : "idle"));
      } else if (r < 0.65) {
        setMood("sitting");
      }
    }, 7000);
    return () => window.clearInterval(t);
  }, [open, busy, walkTo]);

  // ---- chat panel -----------------------------------------------------------
  const openPanel = useCallback(() => {
    setOpen(true);
    setMood("happy");
    window.milo.setClickable(true);
    setTimeout(() => inputRef.current?.focus(), 50);
    if (messages.length === 0) {
      setMessages([{ role: "assistant", content: "Hey! I'm Milo. What are we working on?" }]);
    }
  }, [messages.length]);

  const closePanel = () => {
    setOpen(false);
    setMood("idle");
    window.milo.setClickable(false);
  };

  // Cmd/Ctrl+Shift+M: Milo runs to the middle of the screen and opens up.
  useEffect(() => {
    return window.milo.onSummon(() => {
      walkTo(window.innerWidth / 2 - MILO_W / 2, openPanel);
    });
  }, [walkTo, openPanel]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, busy]);

  const speak = (text: string) => {
    if (!voice || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.08;
    u.pitch = 1.25;
    u.onstart = () => setMood("talking");
    u.onend = () => setMood("happy");
    window.speechSynthesis.speak(u);
  };

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    const next: Msg[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setBusy(true);
    setMood("thinking");

    // The API wants the conversation to start with the user, so drop Milo's greeting.
    const history = next[0]?.role === "assistant" ? next.slice(1) : next;
    const reply = await window.milo.ask(history);

    setMessages((m) => [...m, { role: "assistant", content: reply.text }]);
    setBusy(false);
    setMood(reply.ok ? "happy" : "idle");
    if (reply.ok) speak(reply.text);
  };

  // ---- layout ---------------------------------------------------------------
  const panelW = 340;
  const panelLeft = Math.max(MARGIN, Math.min(window.innerWidth - panelW - MARGIN, x + MILO_W / 2 - panelW / 2));

  return (
    <>
      <div
        className="milo-wrap"
        style={{ left: x, top: y, width: MILO_W, height: MILO_H }}
        onMouseEnter={() => window.milo.setClickable(true)}
        onMouseLeave={() => !open && window.milo.setClickable(false)}
        onClick={() => (open ? closePanel() : openPanel())}
        title="Click me, or press Cmd+Shift+M"
      >
        <Milo mood={mood} facing={facing} />
      </div>

      {open && (
        <div
          className="panel"
          style={{ left: panelLeft, bottom: MILO_H + 20, width: panelW }}
          onMouseEnter={() => window.milo.setClickable(true)}
        >
          <div className="panel__head">
            <span>Milo</span>
            <div className="panel__actions">
              <button className="chip" onClick={() => setVoice((v) => !v)}>{voice ? "Voice on" : "Voice off"}</button>
              <button className="chip" onClick={closePanel}>Hide</button>
              <button className="chip chip--danger" onClick={() => window.milo.quit()}>Quit</button>
            </div>
          </div>
          <div className="panel__list" ref={listRef}>
            {messages.map((m, i) => (
              <div key={i} className={`bubble bubble--${m.role}`}>{m.content}</div>
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
              placeholder="Ask Milo anything…"
              onKeyDown={(e) => e.key === "Escape" && closePanel()}
            />
            <button type="submit" disabled={busy || !input.trim()}>Send</button>
          </form>
        </div>
      )}
    </>
  );
}
