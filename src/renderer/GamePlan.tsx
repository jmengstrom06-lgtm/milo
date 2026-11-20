// The Game Plan: "start my stats homework" turned into small steps you can actually begin.
// Checklist with minutes, a progress bar, the due date, "Do step N with me" and "Lock in".

const KIND_ICON: Record<PlanStep["kind"], string> = { read: "📖", solve: "✏️", write: "📝", research: "🔎", review: "🔁", submit: "📤" };

export type SavedPlan = { key: string; plan: GamePlan; done: number[]; at: number };

const STORE = "milo.gameplans";
export function loadPlans(): SavedPlan[] {
  try {
    const xs = JSON.parse(localStorage.getItem(STORE) || "[]") as SavedPlan[];
    return Array.isArray(xs) ? xs : [];
  } catch {
    return [];
  }
}
export function savePlan(p: SavedPlan) {
  const xs = loadPlans().filter((x) => x.key !== p.key);
  xs.unshift(p);
  try {
    localStorage.setItem(STORE, JSON.stringify(xs.slice(0, 12)));
  } catch {
    /* ignore */
  }
}
export function dropPlan(key: string) {
  try {
    localStorage.setItem(STORE, JSON.stringify(loadPlans().filter((x) => x.key !== key)));
  } catch {
    /* ignore */
  }
}
/** Sync: send game plans edited here, take ones edited on your other Macs (newest edit wins). Returns how many came down. */
export async function syncPlans(): Promise<number> {
  const local = loadPlans();
  const got = await window.milo.syncExchange("gameplan", local.map((p) => ({ id: p.key, updated: p.at, data: p }))).catch(() => null);
  if (!got || !got.length) return 0;
  let xs = loadPlans();
  let n = 0;
  for (const r of got) {
    const d = r.data as SavedPlan | null;
    if (r.deleted) {
      xs = xs.filter((x) => x.key !== r.id);
      n++;
    } else if (d && d.plan && Array.isArray(d.plan.steps) && Array.isArray(d.done)) {
      xs = [{ ...d, key: r.id, at: r.updated }, ...xs.filter((x) => x.key !== r.id)];
      n++;
    }
  }
  xs.sort((a, b) => b.at - a.at);
  try {
    localStorage.setItem(STORE, JSON.stringify(xs.slice(0, 12)));
  } catch {
    /* ignore */
  }
  return n;
}

/** "pick up my stats homework": the newest unfinished plan that matches the words (or just the newest). */
export function findPlan(words: string): SavedPlan | null {
  const open = loadPlans().filter((p) => p.done.length < p.plan.steps.length);
  const w = words.toLowerCase().replace(/\b(my|the|homework|hw|assignment|plan|game plan|pick up|resume|continue|back to|go back to|where was i)\b/g, " ").trim();
  if (w) {
    const hit = open.find((p) => `${p.plan.course} ${p.plan.title}`.toLowerCase().split(/\W+/).some((x) => x.length > 2 && w.includes(x)));
    if (hit) return hit;
  }
  return open[0] ?? null;
}
export const planKey = (p: GamePlan) => `${p.course}|${p.title}`.toLowerCase();
export const nextStep = (p: SavedPlan) => p.plan.steps.findIndex((_s, i) => !p.done.includes(i));

const mins = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}` : `${m} min`);

export default function GamePlanCard({
  sp,
  style,
  hover,
  lockedIn,
  mini,
  justDone,
  onToggle,
  onWithMe,
  onLockIn,
  onClose,
}: {
  sp: SavedPlan;
  style: React.CSSProperties;
  hover: (on: boolean) => void;
  lockedIn: boolean;
  mini: boolean; // shrinks to a pill while his notebook is open
  justDone: number | null;
  onToggle: (i: number) => void;
  onWithMe: (i: number) => void;
  onLockIn: () => void;
  onClose: () => void;
}) {
  const { plan, done } = sp;
  const cur = nextStep(sp);
  const left = plan.steps.reduce((a, s, i) => a + (done.includes(i) ? 0 : s.minutes), 0);
  const pct = Math.round((done.length / plan.steps.length) * 100);
  const finished = cur < 0;

  if (mini)
    return (
      <div className="gp-pill" style={style} onMouseEnter={() => hover(true)} onMouseLeave={() => hover(false)}>
        <span className="gp-pill__ring" style={{ ["--p" as string]: `${pct}%` }} />
        <span>
          {finished ? "All steps done" : `Step ${cur + 1} of ${plan.steps.length}`} · <b>{plan.title}</b>
        </span>
      </div>
    );

  return (
    <div className="gp" style={style} onMouseEnter={() => hover(true)} onMouseLeave={() => hover(false)}>
      <div className="gp-head">
        <div>
          <div className="gp-kicker">Game plan{plan.course ? ` · ${plan.course}` : ""}</div>
          <div className="gp-title">{plan.title}</div>
        </div>
        <button className="gp-x" onClick={onClose} title="Close (your progress is saved)">
          ×
        </button>
      </div>
      <div className="gp-meta">
        {plan.due && <span className="gp-due">Due {plan.due}</span>}
        <span>{finished ? "Done!" : `${mins(left)} left`}</span>
        <span>
          {done.length}/{plan.steps.length} steps
        </span>
      </div>
      <div className="gp-bar">
        <i style={{ width: `${Math.max(4, pct)}%` }} />
      </div>
      <ol className="gp-steps">
        {plan.steps.map((s, i) => {
          const isDone = done.includes(i);
          const isCur = i === cur;
          return (
            <li key={i} className={`gp-step ${isDone ? "gp-step--done" : ""} ${isCur ? "gp-step--now" : ""} ${justDone === i ? "gp-step--pop" : ""}`}>
              <button className="gp-check" onClick={() => onToggle(i)} title={isDone ? "Mark not done" : "Mark done"}>
                {isDone ? "✓" : ""}
              </button>
              <div className="gp-step__body" onClick={() => !isDone && onWithMe(i)} title="Do this step with Milo">
                <div className="gp-step__text">
                  <span className="gp-ico">{KIND_ICON[s.kind] ?? "•"}</span>
                  {s.text}
                </div>
                {isCur && <div className="gp-step__detail">{s.detail}</div>}
              </div>
              <span className="gp-min">{s.minutes}m</span>
              {isCur && <span className="gp-now">NOW</span>}
            </li>
          );
        })}
      </ol>
      {finished ? (
        <div className="gp-done">🎉 Every step done. Submit it and go enjoy your night.</div>
      ) : (
        <div className="gp-actions">
          <button className="kit-btn kit-btn--primary" onClick={() => onWithMe(cur)}>
            ▶ Do step {cur + 1} with me
          </button>
          {!lockedIn && (
            <button className="kit-btn" onClick={onLockIn}>
              🔒 Lock in {mins(Math.min(90, Math.max(10, left)))}
            </button>
          )}
        </div>
      )}
      <div className="gp-hint">{finished ? "Say “close the plan” when you're done." : "Say “next” when you finish a step."}</div>
    </div>
  );
}
