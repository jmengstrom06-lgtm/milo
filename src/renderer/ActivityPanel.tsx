// "What Milo did": everything Milo actually did for you, newest first, with Undo where it can be undone.
import { useEffect, useState } from "react";

const ICON: Record<MiloActivity["kind"], string> = { calendar: "📅", email_draft: "✉️", email_sent: "📤", doc: "📄", memory: "🧠", job: "🛠️", app: "🪟", web: "🌐", classes: "🎒" };

function when(t: number) {
  const d = new Date(t);
  const today = new Date().toDateString() === d.toDateString();
  const yest = new Date(Date.now() - 86400e3).toDateString() === d.toDateString();
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return today ? time : yest ? `Yesterday ${time}` : `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} ${time}`;
}

export default function ActivityPanel({ style, hover, onClose, onSay, onFeedback }: { style: React.CSSProperties; hover: (on: boolean) => void; onClose: () => void; onSay: (t: string) => void; onFeedback: () => void }) {
  const [items, setItems] = useState<MiloActivity[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const load = () => window.milo.activity.list().then(setItems);
  useEffect(() => {
    void load();
    return window.milo.activity.onChange(() => void load());
  }, []);
  const undo = async (id: string) => {
    setBusy(id);
    const r = await window.milo.activity.undo(id);
    setBusy(null);
    onSay(r.ok ? "Undone." : r.text);
    void load();
  };
  return (
    <div className="jb act" style={style} onMouseEnter={() => hover(true)} onMouseLeave={() => hover(false)}>
      <div className="jb-head">
        <div className="jb-kicker">What I did</div>
        <button className="gp-x" onClick={onClose} title="Close">
          ×
        </button>
      </div>
      {items && !items.length && <div className="jb-msg">Nothing yet. Everything I do for you shows up here, and you can undo it.</div>}
      <ol className="act-list">
        {(items ?? []).map((e) => (
          <li key={e.id} className={`act-row${e.undone ? " act-row--undone" : ""}`}>
            <span className="act-ico">{ICON[e.kind] ?? "•"}</span>
            <div className="act-main">
              <div className="act-title" onClick={() => setOpen(open === e.id ? null : e.id)}>
                {e.title}
              </div>
              <div className="act-meta">
                {when(e.at)}
                {e.undone ? " · undone" : ""}
                {e.link && !e.undone && (
                  <>
                    {" · "}
                    <a onClick={() => window.milo.openUrl(e.link!)}>open</a>
                  </>
                )}
              </div>
              {open === e.id && (e.detail || e.noUndo) && <div className="act-detail">{[e.detail, !e.canUndo && !e.undone ? e.noUndo : ""].filter(Boolean).join("\n\n")}</div>}
              {e.undoError && !e.undone && <div className="act-err">Undo failed: {e.undoError}</div>}
            </div>
            {e.canUndo && (
              <button className="kit-btn kit-btn--sm" disabled={busy === e.id} onClick={() => void undo(e.id)}>
                {busy === e.id ? "…" : "Undo"}
              </button>
            )}
          </li>
        ))}
      </ol>
      <div className="act-foot">
        Something wrong? <a onClick={onFeedback}>Tell Jake</a>
      </div>
    </div>
  );
}
