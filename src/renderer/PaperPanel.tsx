import { useEffect, useMemo, useRef, useState } from "react";

// The paper panel: the student's paper beside Milo with his changes shown like tracked changes
// (red = out, green = in, new sections highlighted, formatting tagged). Tap any change to keep your original.
// Nothing touches the real doc until they accept; then it's written in one go (and one "undo" takes it back).

export type PaperState = {
  phase: "reading" | "review" | "saving";
  title: string;
  source: "gdoc" | "text";
  rows: MiloPaperRow[];
  status?: string;
  view?: MiloPaperView;
};

type Props = {
  p: PaperState;
  rejected: Set<number>;
  style: React.CSSProperties;
  hover: (on: boolean) => void;
  onToggle: (groups: number[]) => void;
  onAccept: () => void;
  onExport: (to: "google" | "word" | "copy") => void;
  onClose: () => void;
};

const isOff = (r: MiloPaperRow, rejected: Set<number>) => r.groups.length > 0 && r.groups.every((g) => rejected.has(g));

function Text({ r, off }: { r: MiloPaperRow; off: boolean }) {
  if (r.kind === "changed" && r.segs) {
    return (
      <>
        {r.segs.map((s, i) =>
          s.op === "=" ? (
            <span key={i}>{s.t}</span>
          ) : s.op === "-" ? (
            off ? <span key={i}>{s.t}</span> : <del key={i}>{s.t}</del>
          ) : off ? null : (
            <ins key={i}>{s.t}</ins>
          )
        )}
      </>
    );
  }
  return <>{r.text || " "}</>;
}

export function PaperPanel({ p, rejected, style, hover, onToggle, onAccept, onExport, onClose }: Props) {
  const body = useRef<HTMLDivElement>(null);
  const [reqOpen, setReqOpen] = useState(false);
  const v = p.view;
  const changedRows = useMemo(() => p.rows.filter((r) => r.kind !== "same"), [p.rows]);
  const total = v?.groups.length ?? 0;
  const keep = v ? v.groups.filter((g) => !rejected.has(g.id)).length : 0;
  // when the changes arrive, glide to the first one
  useEffect(() => {
    if (p.phase !== "review") return;
    const el = body.current?.querySelector(".pp__row--changed, .pp__row--added, .pp__row--removed, .pp__row--restyled");
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [p.phase]);
  let reveal = 0;
  return (
    <div className="wc wc--tall pp" style={style} onMouseEnter={() => hover(true)} onMouseMove={() => hover(true)} onMouseLeave={() => hover(false)} role="dialog" aria-label="Your paper">
      <div className="wc__head">
        <div>
          <b>{p.title}</b>
          <small>
            {p.phase === "reading"
              ? p.status || "Reading your paper…"
              : p.phase === "saving"
                ? "Saving…"
                : `${keep} of ${total} change${total === 1 ? "" : "s"} · ${v?.wordsBefore ?? 0} → ${v?.wordsAfter ?? 0} words · tap a change to keep your original`}
          </small>
        </div>
        <button className="wc__x" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      {p.phase === "review" && v?.summary && <p className="wc__sum">{v.summary}</p>}
      {p.phase === "review" && (v?.missing || v?.cant) && (
        <p className="wc__sum wc__warn">
          {v.missing ? `Not done yet: ${v.missing}` : ""}
          {v.missing && v.cant ? " " : ""}
          {v.cant ? `Can't do here: ${v.cant}` : ""}
        </p>
      )}
      {p.phase === "review" && v && v.assignment && v.requirements.length > 0 && (
        <div className="pp__req">
          <button className="pp__reqhead" onClick={() => setReqOpen((o) => !o)} aria-expanded={reqOpen}>
            <span>
              📋 {v.assignment} · <b>{v.requirements.filter((r) => r.met).length}/{v.requirements.length}</b> requirements met
            </span>
            <span>{reqOpen ? "▾" : "▸"}</span>
          </button>
          {reqOpen && (
            <ul>
              {v.requirements.map((r, i) => (
                <li key={i} className={r.met ? "is-met" : "is-miss"}>
                  <span>{r.met ? "✓" : "○"}</span>
                  <span>
                    {r.req}
                    {r.note ? <small> · {r.note}</small> : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div ref={body} className={`pp__paper${p.phase === "reading" ? " is-reading" : ""}`}>
        {p.rows.map((r, i) => {
          const off = isOff(r, rejected);
          const live = r.kind !== "same" && r.groups.length > 0;
          const delay = r.kind !== "same" ? reveal++ * 70 : 0;
          return (
            <div
              key={`${i}-${r.kind}`}
              className={`pp__row pp__row--${r.kind}${off ? " is-off" : ""} pp__st--${r.style.toLowerCase()}${r.align ? ` pp__al--${r.align.toLowerCase()}` : ""}${r.bold ? " pp__b" : ""}`}
              style={r.kind !== "same" ? { animationDelay: `${delay}ms` } : undefined}
              onClick={live ? () => onToggle(r.groups) : undefined}
              title={live ? (off ? "Tap to use Milo's change" : "Tap to keep your original") : undefined}
            >
              <Text r={r} off={off} />
              {r.tags.length > 0 && !off && (
                <span className="pp__tags">
                  {r.tags.map((t) => (
                    <i key={t}>{t}</i>
                  ))}
                </span>
              )}
              {live && <span className="pp__mark">{off ? "↺" : "✓"}</span>}
            </div>
          );
        })}
      </div>
      {p.phase === "review" && v && v.notes.length > 0 && (
        <div className="wc__notes">
          <small>Only you can fix these</small>
          {v.notes.map((n, i) => (
            <p key={i}>• {n}</p>
          ))}
        </div>
      )}
      <div className="wc__foot">
        {p.phase !== "review" ? (
          <span className="pp__count">{p.phase === "reading" ? "Your doc isn't touched until you accept." : "Writing your changes…"}</span>
        ) : p.source === "gdoc" ? (
          <>
            <button className="wc__ghost" onClick={onClose}>
              Cancel
            </button>
            <button className="wc__go" disabled={!keep} onClick={onAccept}>
              {keep === total ? `Accept all ${total}` : `Accept ${keep} of ${total}`}
            </button>
          </>
        ) : (
          <>
            <button className="wc__ghost" onClick={() => onExport("copy")}>
              Copy
            </button>
            <button className="wc__ghost" onClick={() => onExport("word")}>
              Word file
            </button>
            <button className="wc__go" onClick={() => onExport("google")}>
              Google Doc
            </button>
          </>
        )}
      </div>
      {changedRows.length === 0 && p.phase === "review" && null}
    </div>
  );
}
