import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { Mood } from "./Milo";
import { sfx } from "./sfx";

// Lock-in mode: Milo studies with you. Drift to TikTok and he walks over to that window and knocks on it.
// Stay gone and he covers it with a card that takes you straight back to your work, same app, same tab.
// Breaks every 25 minutes on long sessions, and a recap worth screenshotting at the end.

type Pos = { x: number; y: number };
const MILO_W = 120;
const MILO_H = 140;

export type LockInApi = {
  say: (text: string, opts?: { noBarge?: boolean }) => Promise<void>;
  moveTo: (p: Pos, style?: "walk" | "jump" | "zip") => Promise<void>;
  setMood: (m: Mood) => void;
  setBubble: (t: string | null) => void;
  home: () => Pos;
  confetti: (x: number, y: number) => void;
  hover: (on: boolean) => void;
  pos: () => Pos;
};

export type LockInHandle = {
  start: (minutes?: number, topic?: string) => void;
  stop: (why?: "voice" | "button") => void;
  active: () => boolean;
  timeLeftText: () => string;
};

type Segment = { kind: "focus" | "break"; ms: number };
type Session = {
  topic?: string;
  minutes: number;
  startedAt: number;
  segments: Segment[];
  focusedMs: number;
  slips: number;
  streakStart: number | null;
  longestMs: number;
  distractedSince: number | null;
  level: 0 | 1 | 2; // 0 calm, 1 knocked, 2 card up
  graceUntil: number; // "give me 2 minutes"
  lastTick: number;
  segIndex: number;
};
type Recap = { topic?: string; minutes: number; focusedMs: number; elapsedMs: number; slips: number; longestMs: number; days: number; completed: boolean };

const SLIP_AFTER_MS = 6000; // a glance isn't a slip; 6 seconds is
const CARD_AFTER_MS = 25000;
const CARD_H = 276; // height of the "Take me back" card
const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];
const mmss = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const spokenLeft = (ms: number) => {
  const m = Math.max(1, Math.round(ms / 60000));
  return m === 1 ? "one minute" : `${m} minutes`;
};
const dayKey = (d = new Date()) => d.toISOString().slice(0, 10);

/** Days in a row with at least 10 focused minutes, ending today. */
function bumpDayStreak(focusedMs: number): number {
  let days: string[] = [];
  try {
    days = JSON.parse(localStorage.getItem("milo.focusDays") || "[]");
  } catch {
    days = [];
  }
  if (focusedMs >= 10 * 60000 && !days.includes(dayKey())) days.push(dayKey());
  days = days.slice(-400);
  try {
    localStorage.setItem("milo.focusDays", JSON.stringify(days));
  } catch {
    /* fine */
  }
  const set = new Set(days);
  let n = 0;
  const d = new Date();
  if (!set.has(dayKey(d))) d.setDate(d.getDate() - 1); // today not done yet: count up to yesterday
  while (set.has(dayKey(d))) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

function segmentsFor(blocks: { focus: number; rest: number }[]): Segment[] {
  const out: Segment[] = [];
  for (const b of blocks) {
    out.push({ kind: "focus", ms: b.focus * 60000 });
    if (b.rest) out.push({ kind: "break", ms: b.rest * 60000 });
  }
  return out;
}

const LockIn = forwardRef<LockInHandle, { api: LockInApi; miloPos: Pos; onActive: (on: boolean) => void }>(function LockIn({ api, miloPos, onActive }, ref) {
  const S = useRef<Session | null>(null);
  const [, force] = useState(0);
  const rerender = () => force((n) => n + 1);
  const [intro, setIntro] = useState<{ minutes: number; topic?: string } | null>(null);
  const [state, setState] = useState<MiloFocusState | null>(null);
  const stateRef = useRef<MiloFocusState | null>(null);
  const [knock, setKnock] = useState<{ x: number; y: number; seed: number } | null>(null);
  const [card, setCard] = useState<{ label: string; box: MiloBox | null } | null>(null);
  const [recap, setRecap] = useState<Recap | null>(null);
  const [hudOpen, setHudOpen] = useState(false);
  const apiRef = useRef(api);
  apiRef.current = api;
  const busy = useRef(false); // Milo is mid-walk / mid-line for lock-in

  const segInfo = (s: Session, now: number) => {
    let t = now - s.startedAt;
    for (let i = 0; i < s.segments.length; i++) {
      if (t < s.segments[i].ms) return { i, seg: s.segments[i], left: s.segments[i].ms - t };
      t -= s.segments[i].ms;
    }
    return null; // finished
  };
  const totalMs = (s: Session) => s.segments.reduce((a, g) => a + g.ms, 0);

  // ---- going home to "study" -------------------------------------------------------------
  const settle = useCallback(async (style: "walk" | "jump" = "jump") => {
    const a = apiRef.current;
    await a.moveTo(a.home(), style);
    if (S.current) a.setMood("studying");
  }, []);

  // ---- start / stop --------------------------------------------------------------------------
  const stoppedAt = useRef(0);
  const start = useCallback(async (minutes = 25, topic?: string) => {
    // who asked (so a surprise restart names its culprit in the log)
    window.milo.log("lockin", "start_call", { minutes, from: (new Error().stack ?? "").split("\n").slice(2, 6).map((l) => l.trim().slice(0, 90)) });
    if (S.current) return;
    // Right after you stop, nothing may quietly start it again (a "stop" must stick).
    if (Date.now() - stoppedAt.current < 4000) {
      window.milo.log("lockin", "restart_blocked", { msSinceStop: Date.now() - stoppedAt.current });
      return;
    }
    const blocks = await window.milo.focusStart(minutes);
    const now = Date.now();
    S.current = {
      topic: topic?.trim() || undefined,
      minutes,
      startedAt: now + 1800, // the clock starts after the intro
      segments: segmentsFor(blocks),
      focusedMs: 0,
      slips: 0,
      streakStart: now + 1800,
      longestMs: 0,
      distractedSince: null,
      level: 0,
      graceUntil: 0,
      lastTick: now + 1800,
      segIndex: 0,
    };
    onActive(true);
    setRecap(null);
    setIntro({ minutes, topic: S.current.topic });
    sfx.lockin();
    const a = apiRef.current;
    a.setMood("celebrating");
    setTimeout(() => setIntro(null), 2200);
    const line = S.current.topic
      ? `Locked in. ${minutes} minutes on ${S.current.topic}. I'll keep watch.`
      : `Locked in for ${minutes} minutes. I'll keep watch.`;
    await a.say(line);
    a.setBubble(null);
    await settle();
    rerender();
  }, [onActive, settle]);

  const finish = useCallback(
    async (completed: boolean) => {
      const s = S.current;
      if (!s) return;
      S.current = null;
      stoppedAt.current = Date.now();
      window.milo.focusStop();
      onActive(false);
      setCard(null);
      setKnock(null);
      setHudOpen(false);
      const now = Date.now();
      const longestMs = Math.max(s.longestMs, s.streakStart ? now - s.streakStart : 0);
      const elapsedMs = Math.max(1, Math.min(totalMs(s), now - s.startedAt));
      const days = bumpDayStreak(s.focusedMs);
      const r: Recap = { topic: s.topic, minutes: s.minutes, focusedMs: s.focusedMs, elapsedMs, slips: s.slips, longestMs, days, completed };
      setRecap(r);
      window.milo.focusSave({
        topic: s.topic,
        plannedMinutes: s.minutes,
        focusedSeconds: s.focusedMs / 1000,
        slips: s.slips,
        longestStreakSeconds: longestMs / 1000,
        completed,
        startedAt: new Date(s.startedAt).toISOString(),
      });
      const a = apiRef.current;
      await a.moveTo(a.home(), "jump");
      const mins = Math.round(s.focusedMs / 60000);
      if (completed || mins >= 5) {
        a.setMood("celebrating");
        sfx.success();
        const p = a.pos();
        a.confetti(p.x + MILO_W / 2, p.y + 20);
      } else a.setMood("idle");
      const slipText = s.slips === 0 ? "zero slips" : s.slips === 1 ? "one slip" : `${s.slips} slips`;
      await a.say(completed ? `Done. ${mins} minutes locked in, ${slipText}.` : `Stopped. ${mins} minutes locked in, ${slipText}.`);
      a.setBubble(null);
      a.setMood("sitting");
    },
    [onActive]
  );

  useImperativeHandle(ref, () => ({
    start: (m, t) => void start(m, t),
    stop: () => void finish(false),
    active: () => !!S.current,
    timeLeftText: () => {
      const s = S.current;
      if (!s) return "";
      const info = segInfo(s, Date.now());
      return info ? spokenLeft(totalMs(s) - (Date.now() - s.startedAt)) : "";
    },
  }));

  // ---- the distraction moments -----------------------------------------------------------
  const knockOn = useCallback(async (label: string, box: MiloBox | null) => {
    const s = S.current;
    if (!s || busy.current) return;
    busy.current = true;
    const a = apiRef.current;
    try {
      const W = window.innerWidth;
      // Walk to the top edge of the distracting window (or the top middle of the screen).
      const target = box
        ? { x: Math.min(W - MILO_W - 16, Math.max(16, box.x + box.width / 2 - MILO_W / 2)), y: Math.max(16, box.y + 24) }
        : { x: W / 2 - MILO_W / 2, y: 60 };
      await a.moveTo(target, "jump");
      if (!S.current || stateRef.current?.status !== "distracted") return;
      a.setMood("knocking");
      setKnock({ x: target.x + MILO_W * 0.78, y: target.y + MILO_H * 0.62, seed: Date.now() });
      sfx.knock();
      setTimeout(() => sfx.knock(), 420);
      const left = spokenLeft(totalMs(s) - (Date.now() - s.startedAt));
      const topic = s.topic ?? "this";
      const line = pick([
        `${label} can wait. ${left} left on ${topic}.`,
        `Knock knock. It's ${topic}. ${left} to go.`,
        `${label} will still be there in ${left}. Promise.`,
        `I'll pretend I didn't see that. Back to ${topic}?`,
        `Hey. ${label}? We had a deal. ${left} left.`,
      ]);
      await a.say(line, { noBarge: true });
      a.setBubble(null);
      if (S.current && stateRef.current?.status === "distracted") a.setMood("pointing");
    } finally {
      busy.current = false;
    }
  }, []);

  const welcomeBack = useCallback(async () => {
    const a = apiRef.current;
    setCard(null);
    setKnock(null);
    a.hover(false);
    sfx.tick();
    a.setMood("happy");
    if (Math.random() < 0.6) {
      await a.say(pick(["There you go.", "Welcome back.", "Locked back in.", "Nice save."]), { noBarge: true });
      a.setBubble(null);
    }
    await settle();
  }, [settle]);

  // ---- focus events from the Mac ----------------------------------------------------------
  useEffect(
    () =>
      window.milo.onFocusState((st) => {
        stateRef.current = st;
        setState(st);
        const s = S.current;
        if (!s) return;
        const now = Date.now();
        if (st.status === "distracted") {
          if (s.distractedSince === null) s.distractedSince = now;
          if (card) setCard({ label: st.label ?? "That", box: st.box ?? null });
        } else if (st.status === "work") {
          const wasOut = s.level > 0;
          s.distractedSince = null;
          s.level = 0;
          if (s.streakStart === null) s.streakStart = now;
          if (wasOut) void welcomeBack();
        }
      }),
    [card, welcomeBack]
  );

  // ---- the clock -----------------------------------------------------------------------------
  useEffect(() => {
    const t = window.setInterval(() => {
      const s = S.current;
      if (!s) return;
      const now = Date.now();
      if (now < s.startedAt) return; // intro still playing
      const dt = Math.max(0, now - s.lastTick);
      s.lastTick = now;
      const info = segInfo(s, now);
      if (!info) return void finish(true);

      // Moving between focus and break.
      if (info.i !== s.segIndex) {
        s.segIndex = info.i;
        const a = apiRef.current;
        setCard(null);
        setKnock(null);
        a.hover(false);
        if (info.seg.kind === "break") {
          sfx.success();
          a.setMood("celebrating");
          const p = a.pos();
          a.confetti(p.x + MILO_W / 2, p.y + 20);
          a.say(`Break time. ${spokenLeft(info.seg.ms)}, you earned it. Go wild.`).then(() => a.setBubble(null));
        } else {
          sfx.chime();
          a.say(`Back to it. ${spokenLeft(info.seg.ms)} on ${s.topic ?? "this"}.`).then(() => {
            a.setBubble(null);
            void settle();
          });
        }
      }

      const st = stateRef.current;
      const out = info.seg.kind === "focus" && st?.status === "distracted" && now >= s.graceUntil;
      if (info.seg.kind === "focus" && !out) {
        s.focusedMs += dt;
        if (s.streakStart === null) s.streakStart = now;
      }
      if (out) {
        if (s.distractedSince === null) s.distractedSince = now;
        const away = now - s.distractedSince;
        if (s.streakStart !== null && away >= SLIP_AFTER_MS) {
          s.longestMs = Math.max(s.longestMs, s.distractedSince - s.streakStart);
          s.streakStart = null;
        }
        if (away >= SLIP_AFTER_MS && s.level < 1) {
          s.level = 1;
          s.slips++;
          void knockOn(st!.label ?? "That", st!.box ?? null);
        } else if (away >= CARD_AFTER_MS && s.level < 2) {
          s.level = 2;
          const box = st!.box ?? null;
          setCard({ label: st!.label ?? "That", box });
          sfx.alert();
          // Milo hops up and stands on top of the card, pointing at "Take me back".
          const a = apiRef.current;
          const cx = box ? box.x + box.width / 2 : window.innerWidth / 2;
          const cy = box ? box.y + box.height / 2 : window.innerHeight / 2;
          a.moveTo({ x: cx - MILO_W / 2, y: cy - CARD_H / 2 - MILO_H + 14 }, "jump").then(() => {
            if (S.current?.level === 2) a.setMood("pointing");
          });
        }
      }
      rerender();
    }, 1000);
    return () => window.clearInterval(t);
  }, [finish, knockOn, settle]);

  // ---- actions on the card ---------------------------------------------------------------------
  const takeMeBack = async () => {
    setCard(null);
    api.hover(false);
    const where = await window.milo.focusBack();
    if (!where) {
      api.say("Click back into your work and I'll count it.").then(() => api.setBubble(null));
    }
  };
  const forSchool = (label: string) => {
    window.milo.focusAllow(label);
    const s = S.current;
    if (s) {
      s.level = 0;
      s.distractedSince = null;
      if (s.slips > 0) s.slips--; // it wasn't a slip after all
    }
    setCard(null);
    setKnock(null);
    api.hover(false);
    api.say(`Got it, ${label} counts as school today.`).then(() => {
      api.setBubble(null);
      void settle();
    });
  };
  const twoMinutes = () => {
    const s = S.current;
    if (s) {
      s.graceUntil = Date.now() + 2 * 60000;
      s.level = 0;
      s.distractedSince = null;
    }
    setCard(null);
    setKnock(null);
    api.hover(false);
    api.say("Two minutes. I'm timing it.").then(() => {
      api.setBubble(null);
      void settle();
    });
  };

  // ---- drawing ---------------------------------------------------------------------------------
  const s = S.current;
  const now = Date.now();
  const info = s && now >= s.startedAt ? segInfo(s, now) : null;
  const segLeft = info ? info.left : s ? s.segments[0]?.ms ?? 0 : 0;
  const segTotal = info ? info.seg.ms : s?.segments[0]?.ms ?? 1;
  const onBreak = info?.seg.kind === "break";
  const graceLeft = s && s.graceUntil > now ? s.graceUntil - now : 0;
  const R = 24;
  const C = 2 * Math.PI * R;
  const frac = Math.max(0, Math.min(1, 1 - segLeft / segTotal));

  return (
    <>
      {intro && (
        <div className="lk-intro">
          <div className="lk-intro__vignette" />
          <div className="lk-intro__text">
            <div className="lk-intro__title">LOCKED IN</div>
            <div className="lk-intro__sub">
              {intro.minutes} min{intro.topic ? ` · ${intro.topic}` : ""}
            </div>
          </div>
        </div>
      )}

      {s && (
        <div
          className={`lk-hud ${onBreak ? "lk-hud--break" : ""} ${state?.status === "distracted" && !onBreak && !graceLeft ? "lk-hud--warn" : ""}`}
          style={{ left: Math.max(8, Math.min(window.innerWidth - 236, miloPos.x + MILO_W / 2 - 34)), top: Math.max(8, miloPos.y - 66) }}
          onMouseEnter={() => {
            api.hover(true);
            setHudOpen(true);
          }}
          onMouseLeave={() => {
            api.hover(false);
            setHudOpen(false);
          }}
        >
          <svg width={60} height={60} className="lk-hud__ring">
            <circle cx={30} cy={30} r={R} className="lk-hud__track" />
            <circle cx={30} cy={30} r={R} className="lk-hud__bar" style={{ strokeDasharray: C, strokeDashoffset: C * (1 - frac) }} />
          </svg>
          <div className="lk-hud__time">{mmss(segLeft)}</div>
          <div className="lk-hud__info">
            <div className="lk-hud__phase">{onBreak ? "Break" : graceLeft ? `2-min pass · ${mmss(graceLeft)}` : s.topic ?? "Locked in"}</div>
            <div className="lk-hud__meta">
              {Math.round(s.focusedMs / 60000)}m focused · {s.slips} {s.slips === 1 ? "slip" : "slips"}
            </div>
            {hudOpen && (
              <button className="lk-btn lk-btn--ghost" onClick={() => void finish(false)}>
                End session
              </button>
            )}
          </div>
        </div>
      )}

      {knock && (
        <div key={knock.seed} className="lk-knock" style={{ left: knock.x, top: knock.y }}>
          <span />
          <span />
          <span />
          <b>knock knock</b>
        </div>
      )}

      {card && s && (
        <div
          className="lk-veil"
          style={
            card.box
              ? { left: card.box.x, top: card.box.y, width: card.box.width, height: card.box.height }
              : { left: 0, top: 0, width: "100%", height: "100%" }
          }
        >
          <div className="lk-card" onMouseEnter={() => api.hover(true)} onMouseLeave={() => api.hover(false)}>
            <div className="lk-card__eyebrow">{card.label} can wait</div>
            <div className="lk-card__big">{mmss(totalMs(s) - (now - s.startedAt))}</div>
            <div className="lk-card__sub">left on {s.topic ?? "your session"}</div>
            <button className="lk-btn lk-btn--primary" onClick={takeMeBack}>
              Take me back
            </button>
            <div className="lk-card__row">
              <button className="lk-btn lk-btn--ghost" onClick={() => forSchool(card.label)}>
                It's for school
              </button>
              <button className="lk-btn lk-btn--ghost" onClick={twoMinutes}>
                2-min pass
              </button>
            </div>
          </div>
        </div>
      )}

      {recap && (
        <div className="lk-recap" onMouseEnter={() => api.hover(true)} onMouseLeave={() => api.hover(false)}>
          <div className="lk-recap__eyebrow">{recap.completed ? "Session complete" : "Session ended"}</div>
          <div className="lk-recap__title">{recap.topic ? `Locked in on ${recap.topic}` : "Locked in"}</div>
          <div className="lk-recap__grid">
            <div>
              <b>{Math.round(recap.focusedMs / 60000)}</b>
              <span>minutes focused</span>
            </div>
            <div>
              <b>{Math.min(100, Math.round((recap.focusedMs / recap.elapsedMs) * 100))}%</b>
              <span>focus score</span>
            </div>
            <div>
              <b>{recap.slips}</b>
              <span>{recap.slips === 1 ? "slip" : "slips"}</span>
            </div>
            <div>
              <b>{Math.round(recap.longestMs / 60000)}m</b>
              <span>longest streak</span>
            </div>
          </div>
          {recap.days > 0 && (
            <div className="lk-recap__streak">
              🔥 {recap.days}-day streak
            </div>
          )}
          <div className="lk-card__row">
            <button
              className="lk-btn lk-btn--primary"
              onClick={() => {
                setRecap(null);
                api.hover(false);
                void start(recap.minutes, recap.topic);
              }}
            >
              Go again
            </button>
            <button
              className="lk-btn lk-btn--ghost"
              onClick={() => {
                setRecap(null);
                api.hover(false);
              }}
            >
              Done
            </button>
          </div>
        </div>
      )}
    </>
  );
});

export default LockIn;
