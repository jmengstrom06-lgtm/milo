// The job card: a long task's plan with live progress. Each step shows working / trying another way /
// done / stuck. Stop anytime; "keep going" picks up exactly where it left off.

const ICON: Record<MiloJobStep["status"], string> = { todo: "", doing: "", retrying: "↻", done: "✓", failed: "✕", skipped: "–" };
const HEAD: Record<MiloJob["status"], string> = {
  planning: "Planning it out…",
  running: "Working on it",
  checking: "Double-checking everything…",
  done: "Done",
  needs_you: "Needs your OK",
  stuck: "Stuck",
  paused: "Paused",
  stopped: "Stopped",
  failed: "Couldn't do it",
};

export default function JobCard({
  job,
  style,
  hover,
  onStop,
  onResume,
  onApprove,
  onClose,
}: {
  job: MiloJob;
  style: React.CSSProperties;
  hover: (on: boolean) => void;
  onStop: () => void;
  onResume: () => void;
  onApprove: () => void;
  onClose: () => void;
}) {
  const done = job.steps.filter((s) => s.status === "done").length;
  const total = job.steps.length;
  const active = job.status === "planning" || job.status === "running" || job.status === "checking";
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className={`jb jb--${job.status}`} style={style} onMouseEnter={() => hover(true)} onMouseLeave={() => hover(false)}>
      <div className="jb-head">
        <div className="jb-kicker">
          {active && <span className="jb-spin" />}
          {HEAD[job.status]}
          {total > 0 && <span className="jb-count">{done}/{total}</span>}
        </div>
        {!active && (
          <button className="gp-x" onClick={onClose} title="Close">
            ×
          </button>
        )}
      </div>
      <div className="jb-goal">{job.goal}</div>
      {total > 0 && (
        <div className="gp-bar">
          <i style={{ width: `${Math.max(4, pct)}%` }} />
        </div>
      )}
      <ol className="jb-steps">
        {job.steps.map((s, i) => (
          <li key={i} className={`jb-step jb-step--${s.status}`}>
            <span className="jb-ico">{s.status === "doing" ? <span className="jb-spin jb-spin--sm" /> : ICON[s.status]}</span>
            <span className="jb-text">
              {s.do.split("\n")[0]}
              {s.status === "retrying" && <em> trying another way…</em>}
            </span>
          </li>
        ))}
      </ol>
      {job.status === "done" && job.summary && <div className="jb-msg jb-msg--ok">{job.summary}</div>}
      {(job.status === "needs_you" || job.status === "stuck" || job.status === "failed") && job.question && <div className="jb-msg">{job.question}</div>}
      <div className="jb-actions">
        {active && (
          <button className="kit-btn kit-btn--sm" onClick={onStop}>
            ■ Stop
          </button>
        )}
        {job.status === "needs_you" && (
          <>
            <button className="kit-btn kit-btn--sm kit-btn--primary" onClick={onApprove}>
              Yes, go ahead
            </button>
            <button className="kit-btn kit-btn--sm" onClick={onClose}>
              No
            </button>
          </>
        )}
        {(job.status === "stopped" || job.status === "paused" || job.status === "stuck") && (
          <button className="kit-btn kit-btn--sm kit-btn--primary" onClick={onResume}>
            ▶ Keep going
          </button>
        )}
      </div>
    </div>
  );
}
