import { useState } from "react";

// What Milo shows after working on the student's real writing: every edit (with undo), the sources he added,
// and a discussion post they can edit before anything is posted. Same look as the chat panel.

type Hover = (on: boolean) => void;
const words = (s: string) => (s.match(/\b[\w'’-]+\b/g) ?? []).length;

/** "Edit my paper": what changed, why, and undo for each (or all). */
export function EditsCard({ r, style, hover, onClose, onUndone }: { r: Extract<MiloEditResult, { ok: true }>; style: React.CSSProperties; hover: Hover; onClose: () => void; onUndone: (n: number) => void }) {
  const [gone, setGone] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<number | null>(0);
  const undo = async (idx: number[]) => {
    setBusy(true);
    const res = await window.milo.paperUndo(r.docId, idx.map((i) => r.applied[i])).catch(() => ({ ok: false, undone: 0 }));
    setBusy(false);
    if (res.undone) {
      setGone((g) => new Set([...g, ...idx]));
      onUndone(res.undone);
    }
  };
  const left = r.applied.map((_, i) => i).filter((i) => !gone.has(i));
  const delta = r.wordsAfter - r.wordsBefore;
  return (
    <div className="wc" style={style} onMouseEnter={() => hover(true)} onMouseMove={() => hover(true)} onMouseLeave={() => hover(false)} role="dialog" aria-label="Edits to your paper">
      <div className="wc__head">
        <div>
          <b>Edited “{r.title}”</b>
          <small>
            {r.applied.length - gone.size} change{r.applied.length - gone.size === 1 ? "" : "s"} · {r.wordsBefore} → {r.wordsAfter} words{delta ? ` (${delta > 0 ? "+" : ""}${delta})` : ""}
            {r.rubric ? " · checked against your rubric" : ""}
          </small>
        </div>
        <button className="wc__x" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      {r.summary && <p className="wc__sum">{r.summary}</p>}
      <ol className="wc__list">
        {r.applied.map((e, i) => (
          <li key={i} className={gone.has(i) ? "is-gone" : ""}>
            <button className="wc__row" onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}>
              <span className={`wc__kind wc__kind--${e.kind ?? "clarity"}`}>{e.kind ?? "edit"}</span>
              <span className="wc__why">{gone.has(i) ? `Undone: ${e.why}` : e.why}</span>
            </button>
            {open === i && !gone.has(i) && (
              <div className="wc__diff">
                <del>{e.find}</del>
                <ins>{e.replace}</ins>
                <button disabled={busy} onClick={() => void undo([i])}>
                  Undo this one
                </button>
              </div>
            )}
          </li>
        ))}
      </ol>
      {r.notes.length > 0 && (
        <div className="wc__notes">
          <small>Only you can fix these</small>
          {r.notes.map((n, i) => (
            <p key={i}>• {n}</p>
          ))}
        </div>
      )}
      <div className="wc__foot">
        <button className="wc__ghost" disabled={busy || !left.length} onClick={() => void undo(left)}>
          Undo all
        </button>
        <button className="wc__go" onClick={onClose}>
          Keep it
        </button>
      </div>
    </div>
  );
}

/** "Find sources for my paper": what he added and where. */
export function SourcesCard({ r, style, hover, onClose }: { r: Extract<MiloCiteResult, { ok: true }>; style: React.CSSProperties; hover: Hover; onClose: () => void }) {
  return (
    <div className="wc" style={style} onMouseEnter={() => hover(true)} onMouseMove={() => hover(true)} onMouseLeave={() => hover(false)} role="dialog" aria-label="Sources added">
      <div className="wc__head">
        <div>
          <b>{r.sources.length} real sources · {r.style}</b>
          <small>
            {r.placed} cited in your paper{r.addedList ? ` · ${r.style === "APA" ? "References" : "Works Cited"} added` : ""}
          </small>
        </div>
        <button className="wc__x" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      <ol className="wc__list">
        {r.sources.map((s, i) => (
          <li key={i}>
            <a className="wc__src" href={s.url} target="_blank" rel="noreferrer" onClick={(e) => (e.preventDefault(), window.milo.openUrl(s.url))}>
              <b>{s.title}</b>
              <small>
                {[s.authors.slice(0, 2).join(", ") + (s.authors.length > 2 ? " et al." : ""), s.container || s.site, s.year ?? (s.date ?? "").slice(0, 4)].filter(Boolean).join(" · ")}
              </small>
              <em>{s.why}</em>
            </a>
          </li>
        ))}
      </ol>
      <div className="wc__foot">
        <span className="wc__fine">Every source is real: from a scholarly database or a page that loaded. Skim them before you submit.</span>
        <button className="wc__go" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}

/** A discussion post (and replies) the student can edit. Nothing is posted until they press Post. */
export function DiscussionCard({
  r,
  style,
  hover,
  busy,
  onChange,
  onPost,
  onClose,
}: {
  r: Extract<MiloDraftResult, { ok: true }>;
  style: React.CSSProperties;
  hover: Hover;
  busy: boolean;
  onChange: (how: string, current: MiloDraft) => void;
  onPost: (d: MiloDraft) => void;
  onClose: () => void;
}) {
  const [d, setD] = useState<MiloDraft>(r.draft);
  const [sure, setSure] = useState(false);
  const n = words(d.body);
  const wordsOk = !r.req.minWords || n >= r.req.minWords;
  const repliesOk = !r.req.replies || d.replies.filter((x) => x.body.trim()).length >= r.req.replies;
  const copy = () => void navigator.clipboard?.writeText([d.body, ...d.replies.map((x) => `\n\nReply to ${x.to}:\n${x.body}`)].join("")).catch(() => {});
  return (
    <div className="wc wc--tall" style={style} onMouseEnter={() => hover(true)} onMouseMove={() => hover(true)} onMouseLeave={() => hover(false)} role="dialog" aria-label="Your discussion post">
      <div className="wc__head">
        <div>
          <b>
            {r.course}: {r.topic}
          </b>
          <small>
            {r.due ? `Due ${new Date(r.due).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · ` : ""}
            {r.voice ? "written in your voice (from your past posts)" : "draft"}
            {r.already ? " · you already posted here" : ""}
          </small>
        </div>
        <button className="wc__x" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      <div className="wc__checks">
        <span className={wordsOk ? "ok" : "no"}>
          {wordsOk ? "✓" : "!"} {n} words{r.req.minWords ? ` (needs ${r.req.minWords})` : ""}
        </span>
        {r.req.replies > 0 && (
          <span className={repliesOk ? "ok" : "no"}>
            {repliesOk ? "✓" : "!"} {d.replies.length} of {r.req.replies} replies
          </span>
        )}
        {d.checklist.slice(0, 3).map((c, i) => (
          <span key={i} className="ok" title={c}>
            ✓ {c.length > 38 ? c.slice(0, 36) + "…" : c}
          </span>
        ))}
      </div>
      <label className="wc__field">
        <small>Your post</small>
        <input value={d.subject} onChange={(e) => setD({ ...d, subject: e.target.value })} aria-label="Subject" />
        <textarea value={d.body} onChange={(e) => setD({ ...d, body: e.target.value })} rows={8} aria-label="Post" />
      </label>
      {d.replies.map((x, i) => (
        <label className="wc__field" key={i}>
          <small>
            Reply to {x.to}: <em>“{x.excerpt.slice(0, 90)}…”</em>
          </small>
          <textarea value={x.body} rows={4} onChange={(e) => setD({ ...d, replies: d.replies.map((y, k) => (k === i ? { ...y, body: e.target.value } : y)) })} aria-label={`Reply to ${x.to}`} />
        </label>
      ))}
      <div className="wc__tweak">
        {["Shorter", "More casual", "More detail", "Rewrite it"].map((t) => (
          <button key={t} disabled={busy} onClick={() => onChange(t, d)}>
            {t}
          </button>
        ))}
        <button onClick={copy}>Copy</button>
      </div>
      <div className="wc__foot">
        <a className="wc__fine" href={r.url} onClick={(e) => (e.preventDefault(), window.milo.openUrl(r.url))}>
          Open the discussion
        </a>
        <button
          className="wc__go"
          disabled={busy || !d.body.trim()}
          onClick={() => {
            if (!sure) return setSure(true);
            onPost(d);
          }}
        >
          {sure ? `Yes, post${d.replies.length ? ` + ${d.replies.length} repl${d.replies.length > 1 ? "ies" : "y"}` : ""}` : "Post to D2L"}
        </button>
      </div>
    </div>
  );
}
