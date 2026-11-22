// One-tap feedback for testers: what went wrong (or right), straight to Jake.
import { useState } from "react";

const KINDS = [
  { id: "bug", label: "Something broke" },
  { id: "wrong", label: "Milo did the wrong thing" },
  { id: "idea", label: "Idea" },
  { id: "love", label: "I loved this" },
];

export default function FeedbackPanel({ style, hover, onClose, onSay, start }: { style: React.CSSProperties; hover: (on: boolean) => void; onClose: () => void; onSay: (t: string) => void; start?: string }) {
  const [kind, setKind] = useState("bug");
  const [text, setText] = useState(start ?? "");
  const [busy, setBusy] = useState(false);
  const send = async () => {
    if (!text.trim()) return;
    setBusy(true);
    const r = await window.milo.feedback(text, kind);
    setBusy(false);
    onSay(r.text);
    if (r.ok) onClose();
  };
  return (
    <div className="jb fb" style={style} onMouseEnter={() => hover(true)} onMouseLeave={() => hover(false)}>
      <div className="jb-head">
        <div className="jb-kicker">Tell Jake</div>
        <button className="gp-x" onClick={onClose} title="Close">
          ×
        </button>
      </div>
      <div className="fb-kinds">
        {KINDS.map((k) => (
          <button key={k.id} className={`kit-btn kit-btn--sm${kind === k.id ? " kit-btn--primary" : ""}`} onClick={() => setKind(k.id)}>
            {k.label}
          </button>
        ))}
      </div>
      <textarea
        className="fb-text"
        autoFocus
        rows={4}
        placeholder="What happened? What did you expect?"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send();
        }}
      />
      <div className="fb-note">Sends your words plus which features ran just before. Never your screen or what you said to Milo.</div>
      <div className="jb-actions">
        <button className="kit-btn kit-btn--sm kit-btn--primary" disabled={busy || !text.trim()} onClick={() => void send()}>
          {busy ? "Sending…" : "Send"}
        </button>
      </div>
    </div>
  );
}
