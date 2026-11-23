// The first-run wow: before any setup, Milo fixes a sample student's week right in front of you.
// 1) the week appears, 2) the problems light up, 3) "Fix it" → study blocks drop in → "Here's what I fixed".
// Same engine as the real "Milo, what's next?" (fixWeek), so the demo is honest about what Milo does.
import { useEffect, useMemo, useState } from "react";
import { fixWeek, hoursText, sampleWeek } from "./home/weekFix";

const dayName = (t: number) => new Date(t).toLocaleDateString("en-US", { weekday: "short" });
const time = (t: number) => new Date(t).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

export default function WeekShow({ name, say, onNext }: { name: string; say: (t: string) => void; onNext: () => void }) {
  const now = useMemo(() => Date.now(), []);
  const week = useMemo(() => sampleWeek(now), [now]);
  const fix = useMemo(() => fixWeek(week.items, week.events, now), [week, now]);
  const [shown, setShown] = useState(0); // items revealed
  const [phase, setPhase] = useState<"week" | "problems" | "fixing" | "fixed">("week");
  const [blocks, setBlocks] = useState(0);

  // reveal the week one item at a time, then flag the problems
  useEffect(() => {
    if (phase !== "week") return;
    if (shown < week.items.length) {
      const t = window.setTimeout(() => setShown((n) => n + 1), 280);
      return () => window.clearTimeout(t);
    }
    const t = window.setTimeout(() => {
      setPhase("problems");
      say(`This is a sample student's week. See the problems? ${fix.problems[0]?.text ?? ""} Tap fix it.`);
    }, 500);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, phase]);

  // drop the study blocks in
  useEffect(() => {
    if (phase !== "fixing") return;
    if (blocks < fix.blocks.length) {
      const t = window.setTimeout(() => setBlocks((n) => n + 1), 110);
      return () => window.clearTimeout(t);
    }
    const t = window.setTimeout(() => {
      setPhase("fixed");
      say(`Done. ${fix.say} That took me about two seconds. Want me to do yours?`);
    }, 300);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks, phase]);

  const bad = new Set(phase === "week" ? [] : fix.problems.flatMap((p) => p.items));
  return (
    <>
      <div className="ob-big">{phase === "fixed" ? "Here's what I fixed ✨" : `Watch this${name ? `, ${name}` : ""}`}</div>
      <p className="ob-sub">
        {phase === "fixed"
          ? `${fix.blocks.length} study blocks, ${hoursText(fix.minutes)} total, worked around class and work. ${fix.doneEarly} things done a day early.`
          : "A sample student's week. No setup, no typing."}
      </p>

      {phase !== "fixed" && (
        <div className="ws-list" aria-label="Sample week">
          {week.items.slice(0, shown).map((i) => (
            <div key={i.id} className={`ws-item ${bad.has(i.id) ? "ws-item--bad" : ""}`}>
              <span className="ws-day">{dayName(i.dueAt)}</span>
              <div>
                <b>{i.title}</b>
                <em>
                  {i.course} · due {time(i.dueAt)}
                </em>
              </div>
            </div>
          ))}
        </div>
      )}
      {(phase === "problems" || phase === "fixing") && (
        <div className="ws-problems" role="status">
          {fix.problems.map((p) => (
            <div key={p.text} className="ws-problem">
              ⚠️ {p.text}
            </div>
          ))}
        </div>
      )}
      {(phase === "fixing" || phase === "fixed") && (
        <div className="ws-blocks" aria-label="Study blocks Milo added">
          {fix.blocks.slice(0, phase === "fixed" ? 6 : blocks).map((b) => (
            <div key={b.id} className="ws-block">
              <span className="ws-day">{dayName(b.start)}</span>
              <div>
                <b>{b.title}</b>
                <em>
                  {time(b.start)} to {time(b.end)} · {b.why}
                </em>
              </div>
              <span className="ws-ok">✓</span>
            </div>
          ))}
          {phase === "fixed" && fix.blocks.length > 6 && <div className="ws-more">+ {fix.blocks.length - 6} more</div>}
        </div>
      )}

      <div className="ob-actions">
        {phase === "problems" && (
          <button
            className="kit-btn kit-btn--primary ob-next ob-next--wide"
            autoFocus
            onClick={() => {
              setPhase("fixing");
              say("On it.");
            }}
          >
            Fix it, Milo
          </button>
        )}
        {phase === "fixed" && (
          <button className="kit-btn kit-btn--primary ob-next ob-next--wide" autoFocus onClick={onNext}>
            Now do mine →
          </button>
        )}
        {(phase === "week" || phase === "fixing") && <span className="ws-wait">{phase === "week" ? "Reading the week…" : "Fixing…"}</span>}
      </div>
      {phase === "fixed" && <p className="ws-note">In your real week, nothing goes on your calendar until you tap Approve.</p>}
    </>
  );
}
