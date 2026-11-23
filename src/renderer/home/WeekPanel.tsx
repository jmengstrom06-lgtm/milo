// "Milo, what's next?" in Home base: everything due + your calendar → the problems → study blocks,
// all approved with ONE tap → "Here's what I fixed", with proof and one Undo for the whole batch.
import { useEffect, useMemo, useState } from "react";
import MiloFrog, { type FrogOutfit } from "./MiloFrog";
import { fixWeek, hoursText, sampleWeek, type WItem, type WeekFix } from "./weekFix";

type Due = { title: string; course: string; due: string; due_iso?: string; kind?: string };
type Bridge = Window["milo"];

const day = (t: number) => new Date(t).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
const time = (t: number) => new Date(t).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

export function toItems(due: Due[] | null): WItem[] {
  return (due ?? [])
    .filter((d) => d.due_iso && !isNaN(Date.parse(d.due_iso)))
    .map((d, i) => ({ id: `w${i}`, title: d.title, course: d.course, dueAt: Date.parse(d.due_iso!), kind: d.kind === "exam" ? "exam" : d.kind === "quiz" ? "quiz" : undefined }));
}

export default function WeekPanel({
  M,
  due,
  demo,
  googleOn,
  outfit,
  onClose,
  onConnect,
  onSay,
}: {
  M: Bridge;
  due: Due[] | null;
  demo: boolean;
  googleOn: boolean;
  outfit: FrogOutfit;
  onClose: () => void;
  onConnect: () => void;
  onSay: (text: string) => void;
}) {
  const [phase, setPhase] = useState<"loading" | "review" | "adding" | "done" | "error">("loading");
  const [plan, setPlan] = useState<WeekFix | null>(null);
  const [calNote, setCalNote] = useState("");
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<{ added: number; failed: number; text: string } | null>(null);
  const items = useMemo(() => toItems(due), [due]);

  useEffect(() => {
    let live = true;
    (async () => {
      const now = Date.now();
      let events: { title: string; start: number; end: number }[] = [];
      let its = items;
      if (demo) {
        const s = sampleWeek(now);
        events = s.events;
        its = s.items;
      } else if (googleOn) {
        const r = await M.week.busy().catch(() => ({ ok: false, events: [] as typeof events, text: "" }));
        if (r.ok) events = r.events;
        else setCalNote("I couldn't read your calendar, so I only avoided class-time guesses. Check the times before approving.");
      } else setCalNote("Your Google Calendar isn't connected, so I can't see when you're busy. Connect it and I'll plan around everything.");
      if (!live) return;
      const p = fixWeek(its, events, now);
      setPlan(p);
      setPhase("review");
      onSay(p.say);
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const chosen = plan?.blocks.filter((b) => !skip.has(b.id)) ?? [];
  const byDay = useMemo(() => {
    const g: { label: string; list: WeekFix["blocks"] }[] = [];
    for (const b of plan?.blocks ?? []) {
      const l = day(b.start);
      const last = g[g.length - 1];
      if (last && last.label === l) last.list.push(b);
      else g.push({ label: l, list: [b] });
    }
    return g;
  }, [plan]);

  const approve = async () => {
    if (!chosen.length) return;
    setPhase("adding");
    if (demo) {
      await new Promise((r) => window.setTimeout(r, 900));
      setResult({ added: chosen.length, failed: 0, text: "" });
      setPhase("done");
      onSay(`Done. ${chosen.length} study blocks on your calendar. (Demo: nothing was really added.)`);
      return;
    }
    const r = await M.week.apply(chosen.map((b) => ({ title: b.title, course: b.course, start: b.start, end: b.end }))).catch((e: Error) => ({ ok: false, added: 0, failed: chosen.length, text: e.message }));
    setResult(r);
    setPhase(r.added ? "done" : "error");
    onSay(r.added ? `Done. ${r.added} study block${r.added > 1 ? "s are" : " is"} on your calendar. Everything's in What Milo did, with one Undo for all of them.` : `I couldn't add them: ${r.text || "Google said no"}.`);
  };

  return (
    <section className="hb-card hb-wkp hb-rise" aria-label="What's next: your week">
      <div className="hb-cardhead">
        <span className="hb-kicker hb-purple">WHAT'S NEXT · YOUR WEEK</span>
        <button className="hb-link" onClick={onClose}>
          Close
        </button>
      </div>

      {phase === "loading" && (
        <div className="hb-wkhead">
          <MiloFrog size={56} mood="think" outfit={outfit} />
          <div>
            <h2>Looking at your whole week…</h2>
            <p className="hb-muted">Everything due, your calendar, and when you're actually free.</p>
          </div>
        </div>
      )}

      {plan && phase === "review" && (
        <>
          <div className="hb-wkhead">
            <MiloFrog size={56} mood={plan.problems.length ? "worried" : "happy"} outfit={outfit} />
            <div>
              <h2>{plan.blocks.length ? plan.say : "Nothing due this week. You're clear."}</h2>
              {calNote && <p className="hb-muted">{calNote}</p>}
            </div>
          </div>
          {plan.problems.length > 0 && (
            <div className="hb-wkprobs">
              {plan.problems.map((p) => (
                <div key={p.text} className={`hb-wkprob ${p.kind}`}>
                  {p.kind === "tight" ? "⏳" : p.kind === "early" ? "🌙" : "⚠️"} {p.text}
                </div>
              ))}
            </div>
          )}
          {byDay.map((g) => (
            <div key={g.label} className="hb-wkday">
              <span className="hb-kicker">{g.label.toUpperCase()}</span>
              {g.list.map((b) => {
                const off = skip.has(b.id);
                return (
                  <label key={b.id} className={`hb-wkblock ${off ? "off" : ""}`}>
                    <input
                      type="checkbox"
                      checked={!off}
                      onChange={() =>
                        setSkip((s) => {
                          const n = new Set(s);
                          if (n.has(b.id)) n.delete(b.id);
                          else n.add(b.id);
                          return n;
                        })
                      }
                    />
                    <span className="hb-wktime">
                      {time(b.start)}
                      <em>{Math.round((b.end - b.start) / 60e3)} min</em>
                    </span>
                    <span className="hb-wktitle">
                      <b>{b.title}</b>
                      <em>
                        {b.course} · {b.why}
                      </em>
                    </span>
                  </label>
                );
              })}
            </div>
          ))}
          {plan.blocks.length > 0 && (
            <div className="hb-wkact">
              {!demo && !googleOn ? (
                <button className="hb-primary" onClick={onConnect}>
                  Connect Google Calendar to add these
                </button>
              ) : (
                <button className="hb-primary" disabled={!chosen.length} onClick={() => void approve()}>
                  Approve all {chosen.length} · {hoursText(Math.round(chosen.reduce((s, b) => s + (b.end - b.start), 0) / 60e3))}
                </button>
              )}
              <span className="hb-muted">Untick anything you don't want. Nothing is added until you approve.</span>
            </div>
          )}
        </>
      )}

      {phase === "adding" && (
        <div className="hb-wkhead">
          <MiloFrog size={56} mood="write" outfit={outfit} />
          <h2>Adding {chosen.length} study blocks…</h2>
        </div>
      )}

      {phase === "done" && result && (
        <div className="hb-wkhead hb-wkdone">
          <MiloFrog size={64} mood="celebrate" outfit={outfit} />
          <div>
            <h2>Here's what I fixed ✨</h2>
            <p>
              {result.added} study block{result.added > 1 ? "s" : ""} on your calendar
              {plan?.doneEarly ? `, ${plan.doneEarly} thing${plan.doneEarly > 1 ? "s" : ""} done a day early` : ""}.
            </p>
            <p className="hb-wkproof">✓ {demo ? "Demo: nothing was really added." : `Google Calendar confirmed ${result.added} of ${result.added + result.failed}.`} One Undo takes them all back, in What Milo did.</p>
          </div>
        </div>
      )}
      {phase === "error" && (
        <div className="hb-wkhead">
          <MiloFrog size={56} mood="sad" outfit={outfit} />
          <div>
            <h2>I couldn't add them.</h2>
            <p className="hb-muted">{result?.text || "Google Calendar didn't answer."} Nothing was changed.</p>
            <button className="hb-ghost hb-sm" onClick={() => setPhase("review")}>
              Try again
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
