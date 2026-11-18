import { useState } from "react";
import MathText, { stripMath } from "./MathText";

type Props = {
  lesson: MiloLesson;
  mode: MiloMode;
  revealed: number;
  finished: boolean;
  style: React.CSSProperties;
  hover: (on: boolean) => void;
  onSkip: () => void;
  onClose: () => void;
  onSwitchMode: (m: MiloMode) => void;
  onFeedback: (text: string, correct: boolean) => void;
};

const MODE_LABEL: Record<MiloMode, string> = { teach: "Teach me", help: "Hint", do: "Do it for me" };

export default function Notebook(p: Props) {
  const { lesson, mode, revealed, finished } = p;
  const [answer, setAnswer] = useState("");
  const [checking, setChecking] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; correct: boolean } | null>(null);
  const [showAnswer, setShowAnswer] = useState(mode === "do");
  const [practice, setPractice] = useState<{ question: string; answer: string }[] | null>(null);
  const [practiceBusy, setPracticeBusy] = useState(false);
  const [openPractice, setOpenPractice] = useState<Record<number, boolean>>({});
  const [copied, setCopied] = useState(false);

  const check = async () => {
    if (!answer.trim() || checking) return;
    setChecking(true);
    const r = await window.milo.check(lesson, answer.trim());
    setChecking(false);
    const fb = r.ok ? r.data : { text: r.text, correct: false };
    const text = "feedback" in fb ? fb.feedback : fb.text;
    setFeedback({ text, correct: fb.correct });
    if (fb.correct) setShowAnswer(true);
    p.onFeedback(text, fb.correct);
  };

  const loadPractice = async () => {
    setPracticeBusy(true);
    const r = await window.milo.practice(lesson);
    setPracticeBusy(false);
    if (r.ok) setPractice(r.data.problems);
    else p.onFeedback(r.text, false);
  };

  const copy = () => {
    window.milo.copy(stripMath(lesson.answer));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div
      className="notebook"
      style={p.style}
      onMouseEnter={() => p.hover(true)}
      onMouseLeave={() => p.hover(false)}
    >
      <div className="notebook__rings">
        {Array.from({ length: 9 }).map((_, i) => (
          <span key={i} />
        ))}
      </div>

      <div className="notebook__head">
        <div className="notebook__topic">{lesson.topic}</div>
        <button className="nb-x" onClick={p.onClose} title="Done (Esc)">
          ×
        </button>
      </div>

      <div className="notebook__modes">
        {(["teach", "help", "do"] as MiloMode[]).map((m) => (
          <button key={m} className={`nb-mode ${m === mode ? "nb-mode--on" : ""}`} onClick={() => m !== mode && p.onSwitchMode(m)}>
            {MODE_LABEL[m]}
          </button>
        ))}
      </div>

      <div className="notebook__page">
        {lesson.steps.slice(0, revealed).map((s, i) => (
          <div key={i} className="nb-step">
            <span className="nb-num">{i + 1}</span>
            <MathText className="nb-write" text={s.write} />
          </div>
        ))}

        {!finished && (
          <button className="nb-link" onClick={p.onSkip}>
            Skip ahead
          </button>
        )}

        {finished && (
          <div className="nb-end">
            {mode === "do" && lesson.summary && <div className="nb-summary">What I did: {lesson.summary}</div>}

            {mode !== "do" && lesson.check_question && (
              <div className="nb-check">
                <MathText className="nb-q" text={lesson.check_question} />
                <form
                  className="nb-answer"
                  onSubmit={(e) => {
                    e.preventDefault();
                    check();
                  }}
                >
                  <input
                    value={answer}
                    onChange={(e) => setAnswer(e.target.value)}
                    placeholder="Your answer…"
                    autoFocus
                    onKeyDown={(e) => e.key === "Escape" && p.onClose()}
                  />
                  <button type="submit" disabled={checking || !answer.trim()}>
                    {checking ? "…" : "Check"}
                  </button>
                </form>
                {feedback && (
                  <div className={`nb-feedback ${feedback.correct ? "nb-feedback--yes" : "nb-feedback--no"}`}>{feedback.text}</div>
                )}
              </div>
            )}

            {showAnswer ? (
              <div className="nb-final">
                <span>Answer:</span> <MathText text={lesson.answer} />
                <button className="nb-copy" onClick={copy}>
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
            ) : (
              <button className="nb-link" onClick={() => setShowAnswer(true)}>
                Just show me the answer
              </button>
            )}

            <div className="nb-actions">
              <button className="nb-btn" onClick={loadPractice} disabled={practiceBusy}>
                {practiceBusy ? "Making some…" : "3 more like this"}
              </button>
            </div>

            {practice && (
              <ol className="nb-practice">
                {practice.map((q, i) => (
                  <li key={i}>
                    <MathText text={q.question} />
                    <button className="nb-link" onClick={() => setOpenPractice((o) => ({ ...o, [i]: !o[i] }))}>
                      {openPractice[i] ? "hide" : "answer"}
                    </button>
                    {openPractice[i] && <MathText className="nb-pans" text={q.answer} />}
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
