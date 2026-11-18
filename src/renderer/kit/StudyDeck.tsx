// Study Deck: worked examples that Milo solves step by step (with a graph when it helps),
// practice problems he checks, flashcards, and practice tests. Remembers your weak spots.

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import MathText, { stripMath } from "../MathText";
import { sfx } from "../sfx";
import Graph from "./Graph";
import type { StudyItem, StudyMode, StudySet } from "./types";

export type StudyHandle = {
  /** Is it waiting for an answer from you right now? */
  awaiting: () => boolean;
  answer: (text: string) => void;
  next: () => void;
  hint: () => void;
  show: () => void;
  replay: () => void;
  more: () => void;
};

type Phase = "intro" | "ask" | "checking" | "right" | "wrong" | "solving" | "solved";

const StudyDeck = forwardRef<StudyHandle, {
  set: StudySet;
  mode: StudyMode;
  say: (t: string, opts?: { minMs?: number }) => Promise<void>;
  onMore: (request: string, mode: StudyMode) => void;
  onDone?: (score: number, total: number) => void;
}>(function StudyDeck({ set, mode, say, onMore, onDone }, ref) {
  const [i, setI] = useState(0);
  const [phase, setPhase] = useState<Phase>("intro");
  const [shown, setShown] = useState(0); // steps revealed
  const [typed, setTyped] = useState("");
  const [feedback, setFeedback] = useState("");
  const [hintOn, setHintOn] = useState(false);
  const [flipped, setFlipped] = useState(false);
  const [score, setScore] = useState(0);
  const [results, setResults] = useState<boolean[]>([]);
  const [finished, setFinished] = useState(false);
  const run = useRef(0);
  const item: StudyItem | undefined = set.items[i];
  const isCards = mode === "cards" || item?.kind === "card";
  const graphAt = item?.graph ? Math.min(1, item.steps.length) : -1; // the graph shows up with the first step

  // Walk through the solution: each step is written while Milo says it.
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

  // New item: worked mode solves it right away; practice asks you.
  useEffect(() => {
    if (!item) return;
    run.current++;
    setShown(0);
    setTyped("");
    setFeedback("");
    setHintOn(false);
    setFlipped(false);
    if (isCards) {
      setPhase("ask");
      return;
    }
    if (mode === "worked") {
      (async () => {
        setPhase("intro");
        await say(i === 0 && set.say ? set.say : "Here's the next one.");
        solve();
      })();
    } else {
      setPhase("ask");
      if (i === 0 && set.say) say(set.say);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i, set]);

  const check = async (answer: string) => {
    if (!item || !answer.trim() || phase === "checking") return;
    setPhase("checking");
    const r = await window.milo.kit.check({ prompt: item.prompt, answer: item.answer, skill: item.skill }, answer);
    if (!r.ok) {
      setFeedback(r.text);
      setPhase("ask");
      return;
    }
    setFeedback(r.data.feedback);
    setResults((x) => [...x, r.data.correct]);
    if (r.data.correct) {
      setScore((s) => s + 1);
      setPhase("right");
      sfx.success();
      await say(r.data.feedback);
    } else {
      setPhase("wrong");
      sfx.alert();
      await say(r.data.feedback);
    }
  };

  const next = () => {
    run.current++;
    if (i + 1 < set.items.length) setI(i + 1);
    else {
      setFinished(true);
      const total = results.length;
      onDone?.(score, total);
      if (mode !== "worked") say(total ? `You got ${score} of ${total}.` : "That's the set.");
    }
  };

  const markCard = (gotIt: boolean) => {
    if (!item) return;
    window.milo.kit.mark(item.skill, gotIt);
    setResults((x) => [...x, gotIt]);
    if (gotIt) setScore((s) => s + 1);
    next();
  };

  useImperativeHandle(ref, () => ({
    awaiting: () => !finished && !isCards && phase === "ask",
    answer: (t) => (isCards ? setFlipped(true) : check(t)),
    next,
    hint: () => {
      setHintOn(true);
      if (item?.hint) say(stripMath(item.hint));
    },
    show: () => (isCards ? setFlipped(true) : solve()),
    replay: () => solve(),
    more: () => onMore(`more like: ${item ? stripMath(item.prompt) : set.title}`, mode === "worked" ? "practice" : mode),
  }));

  if (finished) {
    const total = results.length;
    const missedSkills = [...new Set(set.items.filter((_, k) => results[k] === false).map((x) => x.skill))];
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
        {missedSkills.length > 0 && (
          <div className="sd-weak">
            Work on: {missedSkills.map((s) => <span key={s}>{s}</span>)}
          </div>
        )}
        <div className="sd-actions">
          {missedSkills.length > 0 && <button className="kit-btn kit-btn--primary" onClick={() => onMore(`practice: ${missedSkills.join(", ")}`, "practice")}>Practice my weak spots</button>}
          <button className="kit-btn" onClick={() => onMore(set.title, "practice")}>More problems</button>
          <button className="kit-btn" onClick={() => onMore(set.title, "test")}>Practice test</button>
        </div>
      </div>
    );
  }
  if (!item) return null;

  return (
    <div className="sd">
      <div className="sd-progress">
        {set.items.map((_, k) => (
          <span key={k} className={`sd-dot ${k === i ? "sd-dot--on" : ""} ${results[k] === true ? "sd-dot--right" : results[k] === false ? "sd-dot--wrong" : ""}`} />
        ))}
        <span className="sd-skill">{item.skill}</span>
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

      {/* the graph, when it helps */}
      {item.graph && !isCards && ((shown > 0 && shown >= graphAt) || phase === "right" || phase === "wrong" || phase === "solved") && (
        <div className="sd-graph">
          <Graph spec={item.graph} />
        </div>
      )}

      {/* worked solution, written step by step */}
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
      {feedback && (phase === "right" || phase === "wrong" || phase === "ask") && <div className={`sd-feedback sd-feedback--${phase}`}>{feedback}</div>}

      {/* controls */}
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
              <button className="kit-btn kit-btn--primary" disabled={!typed.trim() || phase === "checking"}>{phase === "checking" ? "Checking…" : "Check"}</button>
            </form>
            <button className="kit-btn" onClick={() => setHintOn(true)}>Hint</button>
            <button className="kit-btn" onClick={solve}>Show me</button>
          </>
        ) : phase === "solving" || phase === "intro" ? (
          <button className="kit-btn" onClick={() => { run.current++; setShown(item.steps.length); setPhase("solved"); }}>Skip ahead</button>
        ) : (
          <>
            {phase === "wrong" && <button className="kit-btn" onClick={() => { setFeedback(""); setTyped(""); setPhase("ask"); }}>Try again</button>}
            {(phase === "wrong" || phase === "right") && <button className="kit-btn" onClick={solve}>See the steps</button>}
            {phase === "solved" && <button className="kit-btn" onClick={solve}>Replay</button>}
            <button className="kit-btn" onClick={() => onMore(`more like: ${stripMath(item.prompt)}`, "practice")}>Try one like this</button>
            <button className="kit-btn kit-btn--primary" onClick={next}>{i + 1 < set.items.length ? "Next" : "Finish"}</button>
          </>
        )}
      </div>
    </div>
  );
});

export default StudyDeck;
