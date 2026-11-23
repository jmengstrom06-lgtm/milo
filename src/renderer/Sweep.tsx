import MathText from "./MathText";

export type SweepState = {
  items: SweepItem[];
  index: number; // current question (-1 while scanning)
  status: "scanning" | "working" | "scrolling" | "done" | "stopped" | "error";
  results: { label: string; answer: string; filled: boolean }[];
  message?: string;
  fill?: boolean; // typing answers in (true) or just showing them (false)
};

/** Top-center progress bar: what Milo is doing and how far along he is. */
export function SweepHUD({ s, onStop, hover, onFill }: { s: SweepState; onStop: () => void; hover: (on: boolean) => void; onFill?: (fill: boolean) => void }) {
  const total = s.results.length + (s.status === "working" ? s.items.length - s.index : 0);
  const doneCount = s.results.length;
  const cur = s.items[s.index];
  const label =
    s.status === "scanning"
      ? "Reading the page"
      : s.status === "scrolling"
        ? "Scrolling for more questions"
        : s.status === "working" && cur
          ? `Question ${cur.label}`
          : s.status === "done"
            ? "Worksheet complete"
            : s.status === "stopped"
              ? "Stopped"
              : s.message ?? "Something went wrong";
  return (
    <div className="hud" onMouseEnter={() => hover(true)} onMouseMove={() => hover(true)} onMouseLeave={() => hover(false)}>
      <span className={`hud-orb ${s.status === "done" ? "hud-orb--done" : s.status === "error" ? "hud-orb--err" : ""}`} />
      <div className="hud-text">
        <div className="hud-kicker">Worksheet{total > 0 && ` · ${Math.min(doneCount + (s.status === "working" ? 1 : 0), total)} of ${total}`}</div>
        <div className="hud-label">{label}</div>
      </div>
      {total > 0 && (
        <div className="hud-segs">
          {Array.from({ length: total }).map((_, i) => (
            <span key={i} className={i < doneCount ? "seg--done" : i === doneCount && s.status === "working" ? "seg--now" : ""} />
          ))}
        </div>
      )}
      {onFill && (s.status === "scanning" || s.status === "working" || s.status === "scrolling") && (
        <button className="hud-stop hud-mode" title={s.fill ? "I'll show each answer and you type it" : "I'll type the answers in for you"} onClick={() => onFill(!s.fill)}>
          {s.fill ? "Just show me" : "Fill it in"}
        </button>
      )}
      {(s.status === "scanning" || s.status === "working" || s.status === "scrolling") && (
        <button className="hud-stop" onClick={onStop}>
          Stop
        </button>
      )}
    </div>
  );
}

/** The work for the current question, shown right next to it. */
export function WorkCard({ item, style }: { item: SweepItem; style: React.CSSProperties }) {
  return (
    <div className="workcard" style={style}>
      <div className="workcard-k">Question {item.label}</div>
      {item.work && <MathText className="workcard-work" text={item.work} />}
      <div className="workcard-ans">
        <span>Answer</span>
        <MathText text={item.answer} />
      </div>
    </div>
  );
}

/** Small check (filled in) or answer tag (no field to type into) left on each finished question. */
export function Pin({ item, filled }: { item: SweepItem; filled: boolean }) {
  const style: React.CSSProperties = {
    left: item.box.x + item.box.width + 8,
    top: item.box.y + 2,
  };
  return filled ? (
    <div className="pin pin--check" style={style} title={`Filled in: ${item.answer}`}>
      ✓
    </div>
  ) : (
    <div className="pin pin--ans" style={style}>
      <MathText text={item.answer} />
    </div>
  );
}

/** End card: what got done, copy all answers. */
export function SweepSummary({
  s,
  style,
  onClose,
  hover,
}: {
  s: SweepState;
  style: React.CSSProperties;
  onClose: () => void;
  hover: (on: boolean) => void;
}) {
  const filled = s.results.filter((r) => r.filled).length;
  const copyAll = () => window.milo.copy(s.results.map((r) => `${r.label}. ${r.answer}`).join("\n"));
  return (
    <div className="rp rp--compact sweep-sum" style={style} onMouseEnter={() => hover(true)} onMouseMove={() => hover(true)} onMouseLeave={() => hover(false)}>
      <div className="rp-inner">
        <div className="rp-head">
          <span className="rp-orb" />
          <div className="rp-title">
            <div className="rp-kicker">Worksheet complete</div>
            <div className="rp-q">
              {s.results.length} questions · {filled} filled in{s.results.length - filled > 0 ? ` · ${s.results.length - filled} shown on screen` : ""}
            </div>
          </div>
          <div className="rp-tools">
            <button className="rp-icon" onClick={onClose} title="Close">
              <svg viewBox="0 0 16 16" width="12" height="12"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
            </button>
          </div>
        </div>
        <div className="rp-body">
          <div className="sum-list">
            {s.results.map((r, i) => (
              <div key={i} className="sum-row">
                <span className="sum-label">{r.label}</span>
                <MathText className="sum-ans" text={r.answer} />
                <span className={`sum-tag ${r.filled ? "sum-tag--ok" : ""}`}>{r.filled ? "Filled in" : "On screen"}</span>
              </div>
            ))}
          </div>
          <div className="rp-page__actions">
            <button onClick={copyAll}>Copy all answers</button>
          </div>
        </div>
      </div>
    </div>
  );
}
