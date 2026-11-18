// Milo Notes: his notepad, organized by class. Saved on this Mac; one click copies a note into Apple Notes.

import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from "react";
import MathText from "../MathText";
import type { Note, Klass } from "./types";

export type NotesHandle = {
  add: (draft: { title: string; course: string; body: string }) => Promise<Note>;
  appendToOpen: (text: string) => Promise<boolean>;
  open: (id: string) => void;
  current: () => Note | null;
};

function Rendered({ body }: { body: string }) {
  return (
    <div className="nt-render">
      {body.split("\n").map((l, k) => {
        if (/^##\s/.test(l)) return <h3 key={k}><MathText text={l.replace(/^##\s*/, "")} /></h3>;
        if (/^#\s/.test(l)) return <h2 key={k}><MathText text={l.replace(/^#\s*/, "")} /></h2>;
        if (/^\s*[-•*]\s/.test(l)) return <div key={k} className="nt-bullet"><MathText text={l.replace(/^\s*[-•*]\s*/, "")} /></div>;
        if (!l.trim()) return <div key={k} className="nt-gap" />;
        return <p key={k}><MathText text={l} /></p>;
      })}
    </div>
  );
}

const NotesView = forwardRef<NotesHandle, {
  focusId?: string | null;
  answer?: string | null;
  say: (t: string) => Promise<void>;
  onStudy: (note: Note, mode: "practice" | "cards" | "test") => void;
  cls?: Klass | null;
}>(function NotesView({ focusId, answer, say, onStudy, cls }, ref) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [openId, setOpenId] = useState<string | null>(focusId ?? null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Note | null>(null);
  const [toast, setToast] = useState("");

  const refresh = () => window.milo.kit.notes().then(setNotes);
  useEffect(() => {
    refresh();
  }, []);
  useEffect(() => {
    if (focusId) {
      setOpenId(focusId);
      setEditing(false);
      refresh();
    }
  }, [focusId]);

  const open = notes.find((n) => n.id === openId) ?? null;
  const byCourse = useMemo(() => {
    const m = new Map<string, Note[]>();
    const mine = (n: Note) => {
      if (!cls) return true;
      const c = (n.course || "").toLowerCase();
      return [cls.name, cls.code].filter(Boolean).some((w) => c.includes(w.toLowerCase()) || w.toLowerCase().includes(c) && c.length > 2);
    };
    for (const n of notes.filter(mine)) m.set(n.course || "General", [...(m.get(n.course || "General") ?? []), n]);
    return [...m.entries()];
  }, [notes, cls]);

  const flash = (t: string) => {
    setToast(t);
    setTimeout(() => setToast(""), 1800);
  };

  useImperativeHandle(ref, () => ({
    add: async (d) => {
      const saved = await window.milo.kit.saveNote({ title: d.title, course: d.course, body: d.body });
      await refresh();
      setOpenId(saved.id);
      setEditing(false);
      return saved;
    },
    appendToOpen: async (text) => {
      if (!open) return false;
      await window.milo.kit.saveNote({ ...open, body: `${open.body.trimEnd()}\n- ${text}` });
      await refresh();
      return true;
    },
    open: (id) => setOpenId(id),
    current: () => open,
  }));

  if (open && editing && draft) {
    return (
      <div className="nt">
        <input className="nt-title-in" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
        <input className="nt-course-in" value={draft.course} onChange={(e) => setDraft({ ...draft, course: e.target.value })} placeholder="Class" />
        <textarea className="nt-body-in" value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
        <div className="sd-actions">
          <button className="kit-btn" onClick={() => setEditing(false)}>Cancel</button>
          <button
            className="kit-btn kit-btn--primary"
            onClick={async () => {
              await window.milo.kit.saveNote(draft);
              await refresh();
              setEditing(false);
              flash("Saved");
            }}
          >
            Save
          </button>
        </div>
      </div>
    );
  }

  if (open) {
    return (
      <div className="nt">
        <button className="nt-back" onClick={() => setOpenId(null)}>← All notes</button>
        <div className="nt-head">
          <h2>{open.title}</h2>
          <span className="nt-course">{open.course}</span>
        </div>
        {answer && <div className="nt-answer">{answer}</div>}
        <Rendered body={open.body} />
        <div className="sd-actions">
          <button className="kit-btn kit-btn--primary" onClick={() => onStudy(open, "practice")}>Quiz me on this</button>
          <button className="kit-btn" onClick={() => onStudy(open, "cards")}>Flashcards</button>
          <button className="kit-btn" onClick={() => { setDraft(open); setEditing(true); }}>Edit</button>
          <button className="kit-btn" onClick={() => { window.milo.kit.copy(`${open.title}\n\n${open.body}`); flash("Copied"); }}>Copy</button>
          <button
            className="kit-btn"
            onClick={async () => {
              const ok = await window.milo.kit.exportNote(open);
              flash(ok ? "Added to Apple Notes" : "Couldn't open Apple Notes");
              if (ok) say("It's in your Apple Notes.");
            }}
          >
            Send to Apple Notes
          </button>
          <button
            className="kit-btn kit-btn--danger"
            onClick={async () => {
              await window.milo.kit.deleteNote(open.id);
              setOpenId(null);
              refresh();
            }}
          >
            Delete
          </button>
        </div>
        {toast && <div className="kit-toast">{toast}</div>}
      </div>
    );
  }

  return (
    <div className="nt">
      {answer && <div className="nt-answer">{answer}</div>}
      {byCourse.length === 0 ? (
        <div className="kit-empty">
          <p>{cls && notes.length ? `No notes for ${cls.name} yet.` : "No notes yet."}</p>
          <p className="kit-sub">Try “Milo, make notes on this page” or “Milo, add to my notes: exam 3 is Nov 25.”</p>
        </div>
      ) : (
        byCourse.map(([course, list]) => (
          <div key={course} className="nt-group">
            <div className="nt-group__name">{course}</div>
            {list.map((n) => (
              <button key={n.id} className="nt-item" onClick={() => setOpenId(n.id)}>
                <span className="nt-item__title">{n.title}</span>
                <span className="nt-item__date">{new Date(n.updated).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
              </button>
            ))}
          </div>
        ))
      )}
      <div className="sd-actions">
        <button
          className="kit-btn kit-btn--primary"
          onClick={async () => {
            const n = await window.milo.kit.saveNote({ title: "New note", course: cls?.name ?? "General", body: "" });
            await refresh();
            setOpenId(n.id);
            setDraft(n);
            setEditing(true);
          }}
        >
          New note
        </button>
      </div>
    </div>
  );
});

export default NotesView;
