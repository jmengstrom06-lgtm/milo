// Study Deck: Milo's tutor.
//  - learn:    a mini-lesson first, then a worked example, then problems for you
//  - worked:   he solves it step by step (written as he says it), with a graph when it helps
//  - practice: you answer (typed or out loud, with or without your work); he checks it and adapts
//  - cards:    flashcards
//  - test:     timed, silent until the end, then a full breakdown
// Remembers every skill you practice (mastery bars), and serves your weak spots back.

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import MathText, { stripMath } from "../MathText";
import { sfx } from "../sfx";
import Graph from "./Graph";
import type { StudyItem, StudyMode, StudySet } from "./types";

export type StudyHandle = {
  awaiting: () => boolean;
  answer: (text: string) => void;
  next: () => void;
  hint: () => void;
  show: () => void;
  replay: () => void;
  more: () => void;
  easier: () => void;
  harder: () => void;
};

type Phase = "lesson" | "intro" | "ask" | "checking" | "right" | "wrong" | "solving" | "solved";
type Result = { correct: boolean; answer: string; feedback: string } | undefined;
const SECS_PER_TEST_Q = 150;

const StudyDeck = forwardRef<StudyHandle, {
  set: StudySet;
  mode: StudyMode;
  say: (t: string, opts?: { minMs?: number }) => Promise<void>;
  onMore: (request: string, mode: StudyMode) => void;
}>(function StudyDeck({ set, mode, say, onMore }, ref) {
  const hasLesson = mode === "learn" && !!set.lesson?.points?.length;
  const [i, setI] = useState(0);
  const [phase, setPhase] = useState<Phase>(hasLesson ? "lesson" : "intro");
  const [lessonShown, setLessonShown] = useState(0);
  const [shown, setShown] = useState(0);
  const [typed, setTyped] = useState("");
  const [work, setWork] = useState("");
  const [showWork, setShowWork] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [hintOn, setHintOn] = useState(false);
  const [flipped, setFlipped] = useState(false);
  const [results, setResults] = useState<Result[]>([]);
  const [streak, setStreak] = useState(0);
  const [finished, setFinished] = useState(false);
  const [mastery, setMastery] = useState<Record<string, { right: number; wrong: number }>>({});
  const [left, setLeft] = useState(SECS_PER_TEST_Q * set.items.length);
  const [review, setReview] = useState<number | null>(null);
  const run = useRef(0);
  const item: StudyItem | undefined = set.items[i];
  const isCards = mode === "cards" || item?.kind === "card";
  const isTest = mode === "test";
  const solvesItself = mode === "worked" || (mode === "learn" && i === 0);
  const score = results.filter((r) => r?.correct).length;

  const refreshMastery = () => window.milo.kit.mastery().then(setMastery).catch(() => {});
  useEffect(() => {
    refreshMastery();
  }, []);

  // ---- the mini-lesson (learn mode)
  useEffect(() => {
    if (!hasLesson) return;
    const id = ++run.current;
    (async () => {
      if (set.say) await say(set.say);
      for (let k = 0; k < set.lesson!.points.length; k++) {
        if (run.current !== id) return;
        setLessonShown(k + 1);
        sfx.tick();
        await say(set.lesson!.points[k].say, { minMs: 1100 });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [set]);

  // ---- walk through a solution: each step is written while Milo says it
  const solve = async () => {
    if (!item) return;
    const id = ++run.current;
    setPhase("solving");
    setShown(0);
    for (let k = 0; k < item.steps.length; k++) {
      if (run.current !== id) return;
      setShown(k + 1);
      sfx.tick();
      await say(item.steps[k].say, { minMs: 900 });
    }
    if (run.current !== id) return;
    setPhase("solved");
    sfx.success();
  };

  // ---- each new item
  const lessonDone = phase !== "lesson";
  useEffect(() => {
    if (!item || !lessonDone) return;
    run.current++;
    setShown(0);
    setTyped("");
    setWork("");
    setFeedback("");
    setHintOn(false);
    setFlipped(false);
    if (isCards) return setPhase("ask");
    if (solvesItself) {
      (async () => {
        setPhase("intro");
        await say(hasLesson && i === 0 ? "Here's an example." : i === 0 && set.say ? set.say : "Here's the next one.");
        solve();
      })();
    } else {
      setPhase("ask");
      if (i === 0 && set.say && !hasLesson) say(set.say);
      else if (mode === "learn" && i === 1) say("Your turn.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i, set, lessonDone]);

  // ---- test clock
  useEffect(() => {
    if (!isTest || finished) return;
    const t = window.setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => window.clearInterval(t);
  }, [isTest, finished]);
  useEffect(() => {
    if (isTest && left === 0 && !finished) finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left]);

  const record = (k: number, r: Result) =>
    setResults((x) => {
      const y = [...x];
      y[k] = r;
      return y;
    });

  const check = async (answer: string) => {
    if (!item || !answer.trim() || phase === "checking") return;
    setPhase("checking");
    const student = showWork && work.trim() ? `My work:\n${work.trim()}\nFinal answer: ${answer}` : answer;
    const r = await window.milo.kit.check({ prompt: item.prompt, answer: item.answer, skill: item.skill }, student);
    if (!r.ok) {
      setFeedback(r.text);
      setPhase("ask");
      return;
    }
    record(i, { correct: r.data.correct, answer, feedback: r.data.feedback });
    refreshMastery();
    if (isTest) {
      sfx.tick(); // tests stay quiet: straight on to the next one
      return next();
    }
    setFeedback(r.data.feedback);
    if (r.data.correct) {
      const s = streak + 1;
      setStreak(s);
      setPhase("right");
      sfx.success();
      await say(s === 3 ? `${r.data.feedback} That's three in a row. Want harder ones?` : r.data.feedback);
    } else {
      setStreak(0);
      setPhase("wrong");
      sfx.alert();
      await say(r.data.feedback);
    }
  };

  const finish = () => {
    run.current++;
    setFinished(true);
    refreshMastery();
  };
  // Announce the score once the last answer has landed.
  useEffect(() => {
    if (!finished || mode === "worked") return;
    const total = results.filter(Boolean).length;
    say(total ? `You got ${score} of ${total}.` : "That's the set.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished]);
  const next = () => {
    run.current++;
    if (i + 1 < set.items.length) setI(i + 1);
    else finish();
  };
  const markCard = (gotIt: boolean) => {
    if (!item) return;
    window.milo.kit.mark(item.skill, gotIt);
    record(i, { correct: gotIt, answer: "", feedback: "" });
    next();
  };
  const easier = () => item && onMore(`easier problems on: ${item.skill} (like: ${stripMath(item.prompt)})`, "practice");
  const harder = () => item && onMore(`harder problems on: ${item.skill} (like: ${stripMath(item.prompt)})`, "practice");

  useImperativeHandle(ref, () => ({
    awaiting: () => !finished && !isCards && phase === "ask",
    answer: (t) => (isCards ? setFlipped(true) : check(t)),
    next: () => (phase === "lesson" ? (run.current++, setPhase("intro")) : next()),
    hint: () => {
      setHintOn(true);
      if (item?.hint) say(stripMath(item.hint));
    },
    show: () => (isCards ? setFlipped(true) : solve()),
    replay: () => solve(),
    more: () => onMore(`more like: ${item ? stripMath(item.prompt) : set.title}`, mode === "worked" || mode === "learn" ? "practice" : mode),
    easier,
    harder,
  }));

  // ---------------------------------------------------------------- results
  if (finished) {
    const total = results.filter(Boolean).length;
    const skills = [...new Set(set.items.map((x) => x.skill))];
    const missed = [...new Set(set.items.filter((_, k) => results[k] && !results[k]!.correct).map((x) => x.skill))];
    return (
      <div className="sd-done">
        <div className="sd-score">
          {total ? (
            <>
              <b>{score}</b>
              <span>/ {total}</span>
            </>
          ) : (
            <b>Done</b>
          )}
        </div>
        <div className="sd-mastery">
          {skills.map((sk) => {
            const m = mastery[sk];
            const pct = m && m.right + m.wrong ? Math.round((m.right / (m.right + m.wrong)) * 100) : 0;
            return (
              <div key={sk} className="sd-mrow">
                <span className="sd-mname">{sk}</span>
                <span className="sd-mbar">
                  <i style={{ width: `${pct}%` }} className={pct >= 80 ? "sd-mbar--good" : pct >= 50 ? "sd-mbar--ok" : "sd-mbar--low"} />
                </span>
                <span className="sd-mpct">{m ? `${pct}%` : "–"}</span>
              </div>
            );
          })}
        </div>
        {isTest && (
          <div className="sd-review">
            {set.items.map((it, k) => (
              <button key={it.id} className={`sd-rq ${results[k]?.correct ? "sd-rq--right" : "sd-rq--wrong"}`} onClick={() => setReview(review === k ? null : k)}>
                <span className="sd-rq__n">{k + 1}</span>
                <span className="sd-rq__p">
                  <MathText text={it.prompt.length > 110 ? it.prompt.slice(0, 107) + "…" : it.prompt} />
                  {review === k && (
                    <span className="sd-rq__more">
                      <span>
                        You said: {results[k]?.answer || "(skipped)"} · Answer: <MathText text={it.answer} />
                      </span>
                      {it.steps.map((s, j) => (
                        <span key={j} className="sd-rq__step">
                          <MathText text={s.write} />
                        </span>
                      ))}
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
        )}
        <div className="sd-actions">
          {missed.length > 0 && <button className="kit-btn kit-btn--primary" onClick={() => onMore(`practice: ${missed.join(", ")}`, "practice")}>Practice what I missed</button>}
          <button className="kit-btn" onClick={() => onMore(set.title, "practice")}>More problems</button>
          {!isTest && <button className="kit-btn" onClick={() => onMore(set.title, "test")}>Practice test</button>}
          <button className="kit-btn" onClick={() => onMore(set.title, "cards")}>Flashcards</button>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------- the mini-lesson
  if (phase === "lesson" && set.lesson) {
    return (
      <div className="sd">
        <div className="sd-lesson">
          {set.lesson.points.slice(0, lessonShown).map((pt, k) => (
            <div key={k} className="sd-point">
              <MathText text={pt.write} />
            </div>
          ))}
        </div>
        <div className="sd-actions">
          <button className="kit-btn kit-btn--primary" onClick={() => { run.current++; setPhase("intro"); }}>
            {lessonShown >= set.lesson.points.length ? "Show me an example" : "Skip to the example"}
          </button>
        </div>
      </div>
    );
  }
  if (!item) return null;

  const mm = mastery[item.skill];
  const mpct = mm && mm.right + mm.wrong ? Math.round((mm.right / (mm.right + mm.wrong)) * 100) : null;
  const showGraph = !!item.graph && !isCards && !isTest && (shown > 0 || phase === "right" || phase === "wrong" || phase === "solved");

  return (
    <div className="sd">
      <div className="sd-progress">
        {set.items.map((_, k) => (
          <span
            key={k}
            className={`sd-dot ${k === i ? "sd-dot--on" : ""} ${!isTest && results[k]?.correct === true ? "sd-dot--right" : !isTest && results[k]?.correct === false ? "sd-dot--wrong" : isTest && results[k] ? "sd-dot--done" : ""}`}
          />
        ))}
        {isTest ? (
          <span className={`sd-clock ${left < 60 ? "sd-clock--low" : ""}`}>
            {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
          </span>
        ) : (
          <span className="sd-skill">
            {item.skill}
            {mpct !== null && <em> · {mpct}%</em>}
          </span>
        )}
      </div>

      {isCards ? (
        <div className={`sd-card ${flipped ? "sd-card--flipped" : ""}`} onClick={() => setFlipped(true)}>
          <div className="sd-card__face sd-card__front">
            <MathText text={item.prompt} />
            {!flipped && <span className="sd-card__tap">Tap or say "flip"</span>}
          </div>
          <div className="sd-card__face sd-card__back">
            <MathText text={item.answer} />
          </div>
        </div>
      ) : (
        <div className="sd-problem">
          <MathText text={item.prompt} />
        </div>
      )}

      {showGraph && (
        <div className="sd-graph">
          <Graph spec={item.graph!} />
        </div>
      )}

      {shown > 0 && (
        <ol className="sd-steps">
          {item.steps.slice(0, shown).map((s, k) => (
            <li key={k} className="sd-step">
              <MathText text={s.write} />
            </li>
          ))}
        </ol>
      )}
      {phase === "solved" && (
        <div className="sd-answer">
          <span className="sd-answer__label">Answer</span>
          <MathText text={item.answer} />
        </div>
      )}

      {hintOn && item.hint && phase === "ask" && (
        <div className="sd-hint">
          <MathText text={item.hint} />
        </div>
      )}
      {feedback && !isTest && (phase === "right" || phase === "wrong" || phase === "ask") && <div className={`sd-feedback sd-feedback--${phase}`}>{feedback}</div>}

      {showWork && (phase === "ask" || phase === "checking") && (
        <textarea className="sd-work" value={work} onChange={(e) => setWork(e.target.value)} placeholder={"Your work, one step per line:\nz = (78 - 70) / 5 = 1.6\n…"} />
      )}

      <div className="sd-actions">
        {isCards ? (
          flipped ? (
            <>
              <button className="kit-btn" onClick={() => markCard(false)}>Missed it</button>
              <button className="kit-btn kit-btn--primary" onClick={() => markCard(true)}>Got it</button>
            </>
          ) : (
            <button className="kit-btn kit-btn--primary" onClick={() => setFlipped(true)}>Flip</button>
          )
        ) : phase === "ask" || phase === "checking" ? (
          <>
            <form
              className="sd-input"
              onSubmit={(e) => {
                e.preventDefault();
                check(typed);
              }}
            >
              <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Your answer (or just say it)" disabled={phase === "checking"} />
              <button className="kit-btn kit-btn--primary" disabled={!typed.trim() || phase === "checking"}>
                {phase === "checking" ? "Checking…" : isTest ? "Submit" : "Check"}
              </button>
            </form>
            {!isTest && <button className={`kit-btn ${showWork ? "kit-btn--on" : ""}`} onClick={() => setShowWork((v) => !v)}>Show my work</button>}
            {!isTest && <button className="kit-btn" onClick={() => setHintOn(true)}>Hint</button>}
            {!isTest && <button className="kit-btn" onClick={solve}>Show me</button>}
            {isTest && (
              <button className="kit-btn" onClick={() => { record(i, { correct: false, answer: "", feedback: "" }); next(); }}>
                Skip
              </button>
            )}
          </>
        ) : phase === "solving" || phase === "intro" ? (
          <button className="kit-btn" onClick={() => { run.current++; setShown(item.steps.length); setPhase("solved"); }}>
            Skip ahead
          </button>
        ) : (
          <>
            {phase === "wrong" && <button className="kit-btn" onClick={() => { setFeedback(""); setTyped(""); setPhase("ask"); }}>Try again</button>}
            {phase === "wrong" && <button className="kit-btn" onClick={easier}>Easier one</button>}
            {(phase === "wrong" || phase === "right") && <button className="kit-btn" onClick={solve}>See the steps</button>}
            {phase === "solved" && <button className="kit-btn" onClick={solve}>Replay</button>}
            {phase === "right" && streak >= 3 ? (
              <button className="kit-btn" onClick={harder}>Harder ones</button>
            ) : (
              <button className="kit-btn" onClick={() => onMore(`more like: ${stripMath(item.prompt)}`, "practice")}>Try one like this</button>
            )}
            <button className="kit-btn kit-btn--primary" onClick={next}>{i + 1 < set.items.length ? "Next" : "Finish"}</button>
          </>
        )}
      </div>
    </div>
  );
});

export default StudyDeck;
