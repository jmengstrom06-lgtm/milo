// The deadline radar card: slides in beside Milo with what's due ("Heads up") or everything coming up ("what's due").
// Every row has a Start button that goes straight into the Game Plan.

import { chipText, type Alert, type RadarItem } from "./radar";

const KIND: Record<string, string> = { quiz: "Quiz", exam: "Exam", discussion: "Discussion", project: "Project", reading: "Reading" };

export type RadarView = { mode: "alert" | "list"; rows: { item: RadarItem; why: Alert["why"] }[]; title: string };

const ago = (t: number, now: number) => {
  const m = Math.round((now - t) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : "a while ago";
};

export default function RadarCard({
  view,
  now,
  lastScan,
  style,
  hover,
  onStart,
  onClose,
  onRefresh,
  scanning,
}: {
  view: RadarView;
  now: number;
  lastScan: number;
  style: React.CSSProperties;
  hover: (on: boolean) => void;
  onStart: (item: RadarItem) => void;
  onClose: () => void;
  onRefresh: () => void;
  scanning: boolean;
}) {
  return (
    <div className={`rd rd--${view.mode}`} style={style} onMouseEnter={() => hover(true)} onMouseLeave={() => hover(false)}>
      <div className="rd-head">
        <div>
          <div className="rd-kicker">
            <span className="rd-dot" /> Deadline radar
          </div>
          <div className="rd-title">{view.title}</div>
        </div>
        <button className="gp-x" onClick={onClose} title={view.mode === "alert" ? "Later" : "Close"}>
          ×
        </button>
      </div>
      {view.rows.length === 0 ? (
        <div className="rd-empty">Nothing due. You're all caught up. 🎉</div>
      ) : (
        <ul className="rd-list">
          {view.rows.map(({ item: x, why }) => {
            const chip = chipText(x.dueAt, now, x.due);
            const tone = chip === "Today" ? "today" : chip === "Tomorrow" ? "soon" : /days/.test(chip) ? "near" : "far";
            return (
              <li key={x.id} className="rd-row">
                <div className={`rd-chip rd-chip--${tone}`}>{chip}</div>
                <div className="rd-body">
                  <div className="rd-name">
                    {why.includes("new") && <span className="rd-badge rd-badge--new">NEW</span>}
                    {why.includes("moved") && <span className="rd-badge rd-badge--moved">MOVED</span>}
                    {x.title}
                  </div>
                  <div className="rd-sub">
                    {x.course}
                    {KIND[x.kind] ? ` · ${KIND[x.kind]}` : ""}
                    {x.due && !why.includes("moved") ? ` · ${x.due}` : ""}
                  </div>
                  {why.includes("moved") && x.prevDue ? (
                    <div className="rd-moved">
                      <s>{x.prevDue}</s> → <b>{x.due}</b>
                    </div>
                  ) : null}
                </div>
                <button className="kit-btn kit-btn--sm kit-btn--primary rd-start" onClick={() => onStart(x)} title="Open it and make a game plan">
                  ▶ Start
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="rd-foot">
        <span>{scanning ? "Checking D2L…" : lastScan ? `Checked D2L ${ago(lastScan, now)}` : "Not checked yet"}</span>
        <button className="rd-refresh" onClick={onRefresh} disabled={scanning}>
          ↻ Check now
        </button>
      </div>
    </div>
  );
}
