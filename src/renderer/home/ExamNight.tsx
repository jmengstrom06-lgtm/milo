// Exam night: the night before an exam, Today turns into one thing. A live countdown, what the
// professor said will be on it (from lecture notes), what you have to study from, and tonight's plan
// worked back from a real bedtime.

import { useEffect, useMemo, useState } from "react";
import MiloFrog, { type FrogOutfit } from "./MiloFrog";
import { examFlags, planTonight } from "./examPlan";

type Due = { title: string; course: string; due: string; due_iso?: string };
type Note = { id: string; title: string; course: string; body: string; created: number };

const clock = (t: number) => new Date(t).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

export default function ExamNight({
  exam,
  color,
  notes,
  sets,
  hidden,
  outfit,
  onSend,
  onShowAll,
}: {
  exam: Due;
  color: string;
  notes: Note[];
  sets: number;
  hidden: number;
  outfit: FrogOutfit;
  onSend: (text: string) => void;
  onShowAll: () => void;
}) {
  const examAt = new Date(exam.due_iso!).getTime();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const left = Math.max(0, examAt - now);
  const h = Math.floor(left / 3600e3);
  const m = Math.floor((left % 3600e3) / 60e3);
  const s = Math.floor((left % 60e3) / 1000);

  const flags = useMemo(
    () =>
      notes
        .flatMap((n) => examFlags(n.body).map((text) => ({ text, from: n.title, at: n.created })))
        .slice(0, 4),
    [notes]
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const plan = useMemo(() => planTonight(Date.now(), examAt), [examAt, Math.floor(now / 300e3)]);
  const course = exam.course;

  return (
    <section className="hb-examnight hb-rise" aria-label={`Exam night: ${exam.title}`}>
      <div className="hb-en-top">
        <span className="hb-kicker hb-purple">
          <i className="hb-live" aria-hidden="true" />
          EXAM NIGHT · EVERYTHING ELSE CAN WAIT
        </span>
        {hidden > 0 && (
          <button className="hb-link" onClick={onShowAll}>
            {hidden} other thing{hidden > 1 ? "s" : ""} hidden until after · show
          </button>
        )}
      </div>

      <div className="hb-en-hero">
        <div className="hb-en-title">
          <div className="hb-en-course">
            <i style={{ background: color }} aria-hidden="true" />
            {course}
          </div>
          <h1>{exam.title}</h1>
          <p>
            {new Date(examAt).toLocaleDateString("en-US", { weekday: "long" })} at {clock(examAt)} · sleep by {clock(plan.sleep)}
          </p>
        </div>
        <div className="hb-en-count" role="timer" aria-label={`${h} hours ${m} minutes until the exam`}>
          <b>
            {h}
            <small>h</small> {String(m).padStart(2, "0")}
            <small>m</small> <span className="hb-en-sec">{String(s).padStart(2, "0")}</span>
          </b>
          <span>UNTIL THE EXAM</span>
        </div>
      </div>

      <div className="hb-en-say">
        <MiloFrog size={92} mood="focus" outfit={outfit} />
        <p>
          {flags.length
            ? `Your professor flagged ${flags.length} thing${flags.length > 1 ? "s" : ""} in lecture. We start there, then a practice test, then sleep. You've got this.`
            : notes.length
              ? `I've got ${notes.length} set${notes.length > 1 ? "s" : ""} of your lecture notes for this class. Practice test first so we find the gaps, then we fix them.`
              : "Let's find your weak spots with a quick practice test, then fix them. Then sleep, it matters more than one more hour."}
        </p>
      </div>

      <div className="hb-en-grid">
        <section className="hb-card hb-en-flags" aria-label="What the professor said">
          <span className="hb-kicker hb-purple">THE PROFESSOR SAID</span>
          {flags.map((f, i) => (
            <figure key={i}>
              <blockquote>“{f.text}”</blockquote>
              <figcaption>
                {f.from} · {new Date(f.at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              </figcaption>
            </figure>
          ))}
          {!flags.length && <p className="hb-muted">No exam hints from lectures yet. Say “Milo, listen to class” next lecture and I'll catch them.</p>}
        </section>

        <section className="hb-card" aria-label="What you have">
          <span className="hb-kicker">WHAT YOU HAVE</span>
          <div className="hb-en-have">
            <div>
              <b>{notes.length}</b>
              <span>lecture notes</span>
            </div>
            <div>
              <b>{sets}</b>
              <span>flashcard sets</span>
            </div>
            <div>
              <b>{flags.length}</b>
              <span>exam hints</span>
            </div>
          </div>
          <button className="hb-ghost hb-sm" onClick={() => onSend(`Make a 1-page cheat sheet for ${exam.title} in ${course}`)}>
            Make a 1-page cheat sheet
          </button>
        </section>
      </div>

      <section className="hb-card" aria-label="Tonight">
        <div className="hb-cardhead">
          <span className="hb-kicker">
            TONIGHT · {Math.floor(plan.minutes / 60)}H {plan.minutes % 60}M
          </span>
          <span className="hb-muted">worked back from a real bedtime</span>
        </div>
        <div className="hb-en-bar" aria-hidden="true">
          {plan.blocks.map((b, i) => (
            <i key={i} style={{ flex: b.minutes, background: i === 0 ? "var(--purple)" : "#2e2645" }} />
          ))}
        </div>
        <div className="hb-en-blocks">
          {plan.blocks.map((b, i) => (
            <div key={i} style={{ flex: b.minutes }}>
              <em className={i === 0 ? "now" : ""}>{i === 0 ? `${clock(b.at)} · NOW` : clock(b.at)}</em>
              <b>{b.label}</b>
              <span>
                {b.minutes} min · {b.detail}
              </span>
            </div>
          ))}
        </div>
      </section>

      <div className="hb-row">
        <button className="hb-primary hb-big" onClick={() => onSend(`Give me a practice test for ${exam.title} in ${course}, like the real exam`)}>
          Start the practice test
        </button>
        <button className="hb-ghost" onClick={() => onSend(`Quiz me for ${exam.title} in ${course}`)}>
          Quiz me now
        </button>
        <button className="hb-ghost" onClick={() => onSend(`Lock in for ${Math.min(240, plan.minutes)} minutes on ${course}`)}>
          Lock in for tonight
        </button>
      </div>
    </section>
  );
}
