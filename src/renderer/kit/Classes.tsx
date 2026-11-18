// Your classes: a chip bar on every Kit app (tap one and every app tailors itself to that class)
// plus a quick setup ("Stats 2023, English Comp, Bio 101, US History, Spanish 2").

import { useEffect, useState } from "react";
import { KitLoading } from "./KitPanel";
import { SUBJECT_NAMES, type ClassStore, type Klass, type Subject } from "./types";

const short = (c: Klass) => c.code || (c.name.length > 16 ? c.name.split(/\s+/).map((w) => (/^[A-Z0-9]/.test(w) ? w : w[0]?.toUpperCase() ?? "")).join("").slice(0, 8) || c.name.slice(0, 14) : c.name);

export function ClassBar({ store, onPick, onEdit }: { store: ClassStore; onPick: (id: string | null) => void; onEdit: () => void }) {
  if (!store.classes.length)
    return (
      <div className="cls-bar">
        <button className="cls-add" onClick={onEdit}>+ Add your classes so every app fits them</button>
      </div>
    );
  return (
    <div className="cls-bar">
      <button className={`cls-chip ${!store.active ? "cls-chip--on" : ""}`} onClick={() => onPick(null)}>All</button>
      {store.classes.map((c) => (
        <button key={c.id} className={`cls-chip ${store.active === c.id ? "cls-chip--on" : ""}`} onClick={() => onPick(store.active === c.id ? null : c.id)} title={`${c.code ? c.code + " · " : ""}${c.name} (${SUBJECT_NAMES[c.subject]})`}>
          <span className="cls-dot" style={{ background: c.color }} />
          {short(c)}
        </button>
      ))}
      <button className="cls-edit" onClick={onEdit} title="Edit classes">
        <svg viewBox="0 0 16 16" width="12" height="12"><path d="M11 2.5l2.5 2.5L6 12.5H3.5V10z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>
      </button>
    </div>
  );
}

export function ClassesEditor({ store, seed, courses, onSave, say }: { store: ClassStore; seed?: string; courses: string[]; onSave: (s: ClassStore) => void; say: (t: string) => void }) {
  const [list, setList] = useState<Klass[]>(store.classes.length ? store.classes : []);
  const [busy, setBusy] = useState<string | null>(null);
  const [text, setText] = useState(seed ?? "");
  const COLORS = ["#a78bfa", "#38bdf8", "#34d399", "#f472b6", "#fbbf24", "#fb923c", "#60a5fa"];

  const fill = async (t: string, useScreen = false) => {
    if (!t.trim() && !useScreen) return;
    setBusy(useScreen ? "Reading your courses" : "Setting up your classes");
    const r = await window.milo.kit.parseClasses(t, useScreen);
    setBusy(null);
    if (!r.ok || !r.data.classes.length) return say("I couldn't find classes there. Type them like: Stats 2023, English Comp, Bio 101.");
    setList(r.data.classes.slice(0, 7).map((c, i) => ({ id: `c${Date.now().toString(36)}${i}`, name: c.name, code: c.code ?? "", subject: c.subject, color: COLORS[i % COLORS.length] })));
    say(r.data.say);
  };
  useEffect(() => {
    if (seed) fill(seed); // came from voice: "my classes are..."
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed]);
  const upd = (i: number, k: Partial<Klass>) => setList((l) => l.map((c, j) => (j === i ? { ...c, ...k } : c)));

  return (
    <div className="cls-ed">
      <div className="cls-ed__lead">Tell Milo your classes once. Every app then fits the class you're working on.</div>
      <form
        className="sd-input"
        onSubmit={(e) => {
          e.preventDefault();
          fill(text);
        }}
      >
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="STAT 2023, English Comp, Bio 101, US History, Spanish 2" autoFocus />
        <button className="kit-btn kit-btn--primary">Set up</button>
      </form>
      <div className="sd-actions">
        {courses.length > 0 && <button className="kit-btn" onClick={() => fill(`My courses from D2L: ${courses.join("; ")}`)}>Use my D2L courses</button>}
        <button className="kit-btn" onClick={() => fill("Find my classes on this page", true)}>Read them off my screen</button>
      </div>
      {busy && <KitLoading text={busy} />}
      {list.length > 0 && (
        <div className="cls-rows">
          {list.map((c, i) => (
            <div key={c.id} className="cls-row">
              <span className="cls-dot" style={{ background: c.color }} />
              <input className="cls-code" value={c.code} placeholder="Code" onChange={(e) => upd(i, { code: e.target.value })} />
              <input className="cls-name" value={c.name} placeholder="Class name" onChange={(e) => upd(i, { name: e.target.value })} />
              <select value={c.subject} onChange={(e) => upd(i, { subject: e.target.value as Subject })}>
                {(Object.keys(SUBJECT_NAMES) as Subject[]).map((s) => (
                  <option key={s} value={s}>{SUBJECT_NAMES[s]}</option>
                ))}
              </select>
              <button className="rp-icon" onClick={() => setList((l) => l.filter((_, j) => j !== i))} title="Remove">
                <svg viewBox="0 0 16 16" width="10" height="10"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="sd-actions">
        {list.length < 7 && <button className="kit-btn" onClick={() => setList((l) => [...l, { id: `c${Date.now().toString(36)}`, name: "", code: "", subject: "other", color: COLORS[l.length % COLORS.length] }])}>+ Add a class</button>}
        <button
          className="kit-btn kit-btn--primary"
          disabled={!list.some((c) => c.name.trim())}
          onClick={async () => {
            const saved = await window.milo.kit.saveClasses(list, store.active);
            onSave(saved);
            say(`Saved your ${saved.classes.length} classes. Tap one and every app fits it.`);
          }}
        >
          Save classes
        </button>
      </div>
    </div>
  );
}
