import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import MathText, { stripMath } from "./MathText";
import type { PanelSize } from "./ResearchPanel";
import { sfx } from "./sfx";

const LETTERS = ["A", "B", "C", "D"];
const SECONDS = 30;

export type QuizHandle = { answer: (i: number) => void; next: () => void; choices: () => string[]; active: () => boolean };

type Props = {
  topic: string;
  questions: QuizQ[];
  style: React.CSSProperties;
  size: PanelSize;
  onSize: (s: PanelSize) => void;
  onClose: () => void;
  onAgain: () => void;
  hover: (on: boolean) => void;
  say: (text: string) => Promise<void>;
  onFinished: (score: number, total: number) => void;
};

const QuizPanel = forwardRef<QuizHandle, Props>(function QuizPanel(p, ref) {
  const { questions } = p;
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const [missed, setMissed] = useState<number[]>([]);
  const [left, setLeft] = useState(SECONDS);
  const [done, setDone] = useState(false);
  const busy = useRef(false);
  const q = questions[i];

  // Read each new question aloud, then start the clock.
  useEffect(() => {
    if (done || !q) return;
    setLeft(SECONDS);
    p.say(stripMath(q.q));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i, done]);

  useEffect(() => {
    if (done || picked !== null) return;
    const t = window.setInterval(() => setLeft((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => window.clearInterval(t);
  }, [i, picked, done]);

  useEffect(() => {
    if (left === 0 && picked === null && !done) answer(-1); // time's up
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left]);

  const answer = async (k: number) => {
    if (picked !== null || done || busy.current) return;
    busy.current = true;
    setPicked(k);
    const right = k === q.correct;
    if (right) {
      setScore((s) => s + 1);
      sfx.tick();
      await p.say(`Correct. ${q.explain}`);
    } else {
      setMissed((m) => [...m, i]);
      sfx.alert();
      await p.say(`${k === -1 ? "Time's up." : "Not quite."} It's ${LETTERS[q.correct]}. ${q.explain}`);
    }
    busy.current = false;
  };

  const next = () => {
    if (picked === null) return;
    if (i + 1 >= questions.length) {
      setDone(true);
      const final = score;
      sfx.success();
      p.onFinished(final, questions.length);
      return;
    }
    setPicked(null);
    setI(i + 1);
  };

  useImperativeHandle(ref, () => ({
    answer: (k: number) => answer(k),
    next: () => next(),
    choices: () => q?.choices ?? [],
    active: () => !done,
  }));

  const pct = Math.round((score / Math.max(1, questions.length)) * 100);

  return (
    <div className={`rp rp--${p.size}`} style={p.style} onMouseEnter={() => p.hover(true)} onMouseLeave={() => p.hover(false)}>
      <div className="rp-inner">
        <div className="rp-head">
          <span className="rp-orb" />
          <div className="rp-title">
            <div className="rp-kicker">
              Quiz · {done ? "Results" : `Question ${i + 1} of ${questions.length}`} · Score {score}
            </div>
            <div className="rp-q">{p.topic}</div>
          </div>
          <div className="rp-tools">
            {(["compact", "half", "full"] as PanelSize[]).map((s) => (
              <button key={s} className={`rp-icon ${p.size === s ? "rp-icon--on" : ""}`} onClick={() => p.onSize(s)} title={s}>
                <svg viewBox="0 0 16 16" width="13" height="13">
                  <rect x="2" y="2" width="12" height="12" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
                  {s === "compact" && <rect x="8" y="8" width="4" height="4" rx="1" fill="currentColor" />}
                  {s === "half" && <rect x="8" y="3.5" width="4.5" height="9" rx="1" fill="currentColor" />}
                  {s === "full" && <rect x="4" y="4" width="8" height="8" rx="1" fill="currentColor" />}
                </svg>
              </button>
            ))}
            <button className="rp-icon" onClick={p.onClose} title="End quiz (Esc)">
              <svg viewBox="0 0 16 16" width="12" height="12"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
            </button>
          </div>
        </div>

        <div className="rp-body quiz">
          {!done && q && (
            <>
              <div className="quiz-progress">
                {questions.map((_, k) => (
                  <span key={k} className={k < i ? (missed.includes(k) ? "qp--miss" : "qp--ok") : k === i ? "qp--now" : ""} />
                ))}
              </div>
              <MathText className="quiz-q" text={q.q} />
              <div className="quiz-choices">
                {q.choices.map((c, k) => {
                  const state = picked === null ? "" : k === q.correct ? "qc--right" : k === picked ? "qc--wrong" : "qc--dim";
                  return (
                    <button key={k} className={`quiz-choice ${state}`} onClick={() => answer(k)} disabled={picked !== null}>
                      <span className="qc-letter">{LETTERS[k]}</span>
                      <MathText text={c} />
                    </button>
                  );
                })}
              </div>
              {picked === null ? (
                <div className="quiz-timer">
                  <span style={{ width: `${(left / SECONDS) * 100}%` }} />
                </div>
              ) : (
                <div className="quiz-after">
                  <div className={`quiz-verdict ${picked === q.correct ? "qv--right" : "qv--wrong"}`}>
                    {picked === q.correct ? "Correct" : picked === -1 ? "Time's up" : "Not quite"}
                    <span>{q.explain}</span>
                  </div>
                  <button className="quiz-next" onClick={next}>
                    {i + 1 >= questions.length ? "See results" : "Next question"}
                  </button>
                </div>
              )}
              <div className="quiz-hint">Say the letter (“B”) or the answer, or click it. Say “next” to continue.</div>
            </>
          )}

          {done && (
            <div className="quiz-results">
              <div className="quiz-score">
                <svg viewBox="0 0 120 120" width="120" height="120">
                  <circle cx="60" cy="60" r="52" stroke="rgba(255,255,255,0.08)" strokeWidth="10" fill="none" />
                  <circle
                    cx="60"
                    cy="60"
                    r="52"
                    stroke={pct >= 70 ? "#34d399" : pct >= 40 ? "#f59e0b" : "#f87171"}
                    strokeWidth="10"
                    fill="none"
                    strokeLinecap="round"
                    strokeDasharray={`${(pct / 100) * 327} 327`}
                    transform="rotate(-90 60 60)"
                  />
                </svg>
                <div>
                  <b>{pct}%</b>
                  <span>
                    {score} of {questions.length}
                  </span>
                </div>
              </div>
              {missed.length > 0 && (
                <div className="quiz-review">
                  <div className="rp-kicker">Review what you missed</div>
                  {missed.map((k) => (
                    <div key={k} className="sum-row">
                      <span className="sum-label">{k + 1}</span>
                      <div className="quiz-rv">
                        <MathText text={questions[k].q} />
                        <div className="quiz-rv-a">
                          {LETTERS[questions[k].correct]}. <MathText text={questions[k].choices[questions[k].correct]} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="tool-bar">
                <button onClick={p.onAgain}>New quiz</button>
                <button onClick={p.onClose}>Done</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

export default QuizPanel;
