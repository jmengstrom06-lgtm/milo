// The class library: a folder per class with everything Milo made for it (drawings, sheets, study sets,
// plans and notes). Thumbnails, one tap to reopen, move between classes, delete. Plus the little
// "Saved to MATH 1324" pill and the "Recent in Math" shelf every app shows.

import { useEffect, useMemo, useState } from "react";
import Drawing from "./Drawing";
import Graph from "./Graph";
import { KitIcon } from "./icons";
import type { ClassStore, GraphSpec, Klass, KitApp, LibApp, LibItem, Note, Plan, Sketch, StudySet, Table } from "./types";

export type LibFilter = LibApp | "notes" | "all";
const FILTERS: { id: LibFilter; label: string }[] = [
  { id: "all", label: "Everything" },
  { id: "sketch", label: "Sketches" },
  { id: "sheet", label: "Sheets" },
  { id: "study", label: "Study sets" },
  { id: "notes", label: "Notes" },
  { id: "planner", label: "Plans" },
];

export const classLabel = (c: Klass | null | undefined) => (c ? c.code || c.name : "Unsorted");

/** Does this note belong to that class? (Notes are filed by course name.) */
export function noteInClass(n: Note, c: Klass | null): boolean {
  const course = (n.course || "").toLowerCase().trim();
  if (!c) return !course || course === "general";
  return [c.name, c.code].filter(Boolean).some((w) => {
    const x = w.toLowerCase();
    return course.includes(x) || (course.length > 2 && x.includes(course));
  });
}

const SUBJECT_WORDS: Record<string, RegExp> = {
  math: /\b(math|calc(ulus)?|algebra|geometry|trig(onometry)?|precalc)\b/,
  stats: /\b(stats?|statistics|probability)\b/,
  science: /\b(bio(logy)?|chem(istry)?|physics|science|anatomy|geology|astronomy)\b/,
  english: /\b(english|writing|comp(osition)?|lit(erature)?|essay)\b/,
  history: /\b(history|gov(ernment)?|poli(tical)? ?sci|sociology|psych(ology)?)\b/,
  language: /\b(spanish|french|german|chinese|japanese|italian|latin|language)\b/,
  cs: /\b(cs|computer science|coding|programming|python|java)\b/,
  business: /\b(business|econ(omics)?|finance|accounting|marketing|management)\b/,
  arts: /\b(art|music|design|theater|theatre|film)\b/,
};

/** Which of the student's classes does this sentence name? Only an explicit mention counts. */
export function matchClass(text: string, classes: Klass[]): Klass | null {
  const t = ` ${text.toLowerCase().replace(/[^a-z0-9 ]+/g, " ")} `;
  // 1) course code ("stat 2023", "bio 1305")
  for (const c of classes) {
    const code = c.code.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").trim();
    if (code && (t.includes(` ${code} `) || t.includes(` ${code.replace(/\s+/g, "")} `))) return c;
  }
  // 2) the class name, or its first word ("english composition" -> "english")
  for (const c of classes) {
    const name = c.name.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").trim();
    if (name && t.includes(` ${name} `)) return c;
  }
  for (const c of classes) {
    const first = c.name.toLowerCase().split(/\s+/).find((w) => w.length > 3 && !/^(intro|introduction|elementary|principles|general|foundations|advanced|survey|honors)$/.test(w));
    if (first && t.includes(` ${first} `)) return c;
  }
  // 3) the subject ("bio" -> the science class, "stats" -> the statistics class); only if exactly one class fits
  const bySubject = classes.filter((c) => c.subject !== "other" && SUBJECT_WORDS[c.subject]?.test(t));
  if (bySubject.length === 1) return bySubject[0];
  // a more specific word picks between two science classes etc.
  for (const c of bySubject) {
    const n = c.name.toLowerCase();
    const word = t.match(/\b(bio(logy)?|chem(istry)?|physics|calc(ulus)?|algebra|spanish|french)\b/)?.[0];
    if (word && n.includes(word.slice(0, 4))) return c;
  }
  return null;
}

/** "show my math sketches" / "open my bio folder" / "what did I save for stats" -> a library view. */
export function parseBrowse(text: string): { filter: LibFilter; latest: boolean } | null {
  const t = text.toLowerCase().replace(/[.!?]+$/, "");
  const latest = /\b(last|latest|most recent|newest|previous)\b/.test(t) && /\b(sketch|drawing|diagram|graph|sheet|table|chart|study set|flashcards|problems|plan|one)\b/.test(t);
  const browse =
    /\b(folder|library|saved|everything i (made|did|saved)|my (stuff|work))\b/.test(t) ||
    /\b(show|open|pull up|bring up|see|find|go to|where( are| is)?)\b.*\bmy\b.*\b(sketches|drawings|diagrams|graphs|sheets|tables|charts|flashcards|study sets|practice sets|plans|notes)\b/.test(t) ||
    /^(what|which)\b.*\b(did i|have i) (save|make|draw)\b/.test(t);
  if (!browse && !latest) return null;
  const filter: LibFilter = /\b(sketch|drawing|diagram|graph)/.test(t)
    ? "sketch"
    : /\b(sheet|table|chart|spreadsheet)/.test(t)
      ? "sheet"
      : /\b(flashcards?|study sets?|practice|problems|quiz)/.test(t)
        ? "study"
        : /\bnotes?\b/.test(t)
          ? "notes"
          : /\bplans?\b/.test(t)
            ? "planner"
            : "all";
  return { filter, latest };
}

const ago = (t: number) => {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  const d = Math.round(s / 86400);
  return d === 1 ? "yesterday" : d < 7 ? `${d} days ago` : new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

/** A small picture of the thing, so you can spot it at a glance. */
export function Thumb({ item }: { item: LibItem }) {
  if (item.app === "sketch") {
    const s = item.data as Sketch;
    if (s?.graph) return <div className="lib-thumb lib-thumb--graph"><Graph spec={s.graph as GraphSpec} animate={false} /></div>;
    if (s?.svg) return <div className="lib-thumb lib-thumb--draw"><Drawing svg={s.svg} /></div>;
  }
  if (item.app === "sheet") {
    const t = item.data as Table;
    return (
      <div className="lib-thumb lib-thumb--sheet">
        <table>
          <thead><tr>{t?.columns?.slice(0, 3).map((c, i) => <th key={i}>{String(c)}</th>)}</tr></thead>
          <tbody>{t?.rows?.slice(0, 4).map((r, i) => <tr key={i}>{r.slice(0, 3).map((v, j) => <td key={j}>{String(v)}</td>)}</tr>)}</tbody>
        </table>
      </div>
    );
  }
  if (item.app === "study") {
    const d = item.data as { set: StudySet; mode: string };
    const n = d?.set?.items?.length ?? 0;
    const kind = d?.mode === "cards" ? "flashcards" : d?.mode === "test" ? "test questions" : d?.mode === "learn" ? "lesson + practice" : n === 1 ? "worked problem" : "problems";
    return (
      <div className="lib-thumb lib-thumb--study">
        <b>{n}</b>
        <span>{kind}</span>
      </div>
    );
  }
  if (item.app === "planner") {
    const p = item.data as Plan;
    return (
      <div className="lib-thumb lib-thumb--plan">
        {p?.days?.slice(0, 3).map((d, i) => <div key={i}><b>{d.label}</b><span>{d.tasks.length} tasks</span></div>)}
      </div>
    );
  }
  return <div className="lib-thumb" />;
}

type Row = { kind: "item"; item: LibItem } | { kind: "note"; note: Note };

export default function Library({
  classes,
  initialClass,
  initialFilter,
  onOpen,
  onOpenNote,
  onBack,
}: {
  classes: ClassStore;
  initialClass: string | null | "all";
  initialFilter: LibFilter;
  onOpen: (item: LibItem) => void;
  onOpenNote: (note: Note) => void;
  onBack: () => void;
}) {
  const [cls, setCls] = useState<string | null | "all">(initialClass);
  const [filter, setFilter] = useState<LibFilter>(initialFilter);
  const [items, setItems] = useState<LibItem[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [menu, setMenu] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const reload = () => {
    window.milo.lib.list({ classId: "all" }).then(setItems).catch(() => {});
    window.milo.kit.notes().then(setNotes).catch(() => {});
  };
  useEffect(reload, []);

  const klass = (id: string | null) => classes.classes.find((c) => c.id === id) ?? null;
  const inClass = (r: Row) =>
    cls === "all" ? true : r.kind === "item" ? r.item.classId === cls : noteInClass(r.note, klass(cls));
  const rows: Row[] = useMemo(() => {
    const all: Row[] = [
      ...items.map((item) => ({ kind: "item" as const, item })),
      ...notes.map((note) => ({ kind: "note" as const, note })),
    ];
    return all
      .filter(inClass)
      .filter((r) => filter === "all" || (r.kind === "note" ? filter === "notes" : r.item.app === filter))
      .sort((a, b) => (b.kind === "item" ? b.item.updated : b.note.updated) - (a.kind === "item" ? a.item.updated : a.note.updated));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, notes, cls, filter]);

  const countFor = (id: string | null | "all") =>
    id === "all" ? items.length + notes.length : items.filter((x) => x.classId === id).length + notes.filter((n) => noteInClass(n, klass(id))).length;

  const folders: { id: string | null | "all"; label: string; color: string }[] = [
    { id: "all", label: "All classes", color: "#9ca3af" },
    ...classes.classes.map((c) => ({ id: c.id, label: classLabel(c), color: c.color })),
    ...(countFor(null) ? [{ id: null, label: "Unsorted", color: "#6b7280" }] : []),
  ];
  const here = cls === "all" ? "all your classes" : classLabel(klass(cls));

  return (
    <div className="lib">
      <div className="lib-folders">
        {folders.map((f) => (
          <button key={String(f.id)} className={`lib-folder ${cls === f.id ? "lib-folder--on" : ""}`} onClick={() => setCls(f.id)} style={{ ["--c" as string]: f.color }}>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
              <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" fill="var(--c)" opacity="0.9" />
            </svg>
            <span className="lib-folder__name">{f.label}</span>
            <span className="lib-folder__n">{countFor(f.id)}</span>
          </button>
        ))}
      </div>

      <div className="lib-filters">
        {FILTERS.map((f) => (
          <button key={f.id} className={`lib-filter ${filter === f.id ? "lib-filter--on" : ""}`} onClick={() => setFilter(f.id)}>
            {f.label}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="lib-empty">
          <div className="lib-empty__big">Nothing here yet</div>
          <p>
            Anything you make with Milo while {cls === "all" || cls === null ? "a class" : here} is on gets saved here automatically: drawings, sheets, flashcards, plans and notes.
          </p>
        </div>
      ) : (
        <div className="lib-grid">
          {rows.map((r) => {
            const id = r.kind === "item" ? r.item.id : `note-${r.note.id}`;
            const c = r.kind === "item" ? klass(r.item.classId) : classes.classes.find((k) => noteInClass(r.note, k)) ?? null;
            const app: KitApp = r.kind === "item" ? r.item.app : "notes";
            return (
              <div key={id} className="lib-card" onClick={() => (r.kind === "item" ? onOpen(r.item) : onOpenNote(r.note))}>
                {r.kind === "item" ? (
                  <Thumb item={r.item} />
                ) : (
                  <div className="lib-thumb lib-thumb--note">{r.note.body.replace(/[#*$]/g, "").slice(0, 160)}</div>
                )}
                <div className="lib-card__meta">
                  <span className="lib-card__app">
                    <KitIcon app={app} size={12} />
                  </span>
                  <span className="lib-card__title" title={r.kind === "item" ? r.item.title : r.note.title}>
                    {r.kind === "item" ? r.item.title : r.note.title}
                  </span>
                </div>
                <div className="lib-card__sub">
                  {cls === "all" && <span className="lib-tag" style={{ background: c?.color ?? "#6b7280" }}>{classLabel(c)}</span>}
                  <span>{ago(r.kind === "item" ? r.item.updated : r.note.updated)}</span>
                </div>
                {r.kind === "item" && (
                  <button
                    className="lib-card__more"
                    title="Move or delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenu(menu === id ? null : id);
                      setConfirm(null);
                    }}
                  >
                    ⋯
                  </button>
                )}
                {menu === id && r.kind === "item" && (
                  <div className="lib-menu" onClick={(e) => e.stopPropagation()}>
                    <div className="lib-menu__lab">Move to</div>
                    {classes.classes.map((k) => (
                      <button
                        key={k.id}
                        disabled={k.id === r.item.classId}
                        onClick={async () => {
                          await window.milo.lib.move(r.item.id, k.id);
                          setMenu(null);
                          reload();
                        }}
                      >
                        <span className="cls-dot" style={{ background: k.color }} /> {classLabel(k)}
                      </button>
                    ))}
                    <div className="lib-menu__sep" />
                    {confirm === id ? (
                      <button
                        className="lib-menu__danger"
                        onClick={async () => {
                          await window.milo.lib.remove(r.item.id);
                          setMenu(null);
                          setConfirm(null);
                          reload();
                        }}
                      >
                        Yes, delete it
                      </button>
                    ) : (
                      <button className="lib-menu__danger" onClick={() => setConfirm(id)}>
                        Delete
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="lib-foot">
        <button className="kit-btn kit-btn--sm" onClick={onBack}>
          ← Back
        </button>
        <span className="kit-sub">Everything saves on its own to the class that's on.</span>
      </div>
    </div>
  );
}

/** "Saved to MATH 1324 ▾": shows where the thing on screen lives; tap to move it to another class. */
export function SavedPill({ classes, classId, onMove, fresh }: { classes: Klass[]; classId: string | null; onMove: (id: string | null) => void; fresh: boolean }) {
  const [open, setOpen] = useState(false);
  const c = classes.find((k) => k.id === classId) ?? null;
  return (
    <span className={`lib-saved ${fresh ? "lib-saved--fresh" : ""}`}>
      <button className="lib-saved__btn" onClick={() => setOpen((o) => !o)} title="Where this is saved. Tap to move it.">
        <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden>
          <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" fill={c?.color ?? "#9ca3af"} />
        </svg>
        {c ? `Saved to ${classLabel(c)}` : "Saved"}
        <svg viewBox="0 0 12 12" width="9" height="9" aria-hidden>
          <path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <span className="lib-menu lib-menu--pill">
          <span className="lib-menu__lab">Save to</span>
          {classes.map((k) => (
            <button
              key={k.id}
              disabled={k.id === classId}
              onClick={() => {
                onMove(k.id);
                setOpen(false);
              }}
            >
              <span className="cls-dot" style={{ background: k.color }} /> {classLabel(k)}
            </button>
          ))}
          <button
            disabled={classId === null}
            onClick={() => {
              onMove(null);
              setOpen(false);
            }}
          >
            <span className="cls-dot" style={{ background: "#6b7280" }} /> Unsorted
          </button>
        </span>
      )}
    </span>
  );
}

/** "Recent in Math": the last few things you made in this app, one tap to reopen. */
export function RecentShelf({ app, cls, onOpen, onAll }: { app: LibApp; cls: Klass | null; onOpen: (item: LibItem) => void; onAll: () => void }) {
  const [items, setItems] = useState<LibItem[]>([]);
  useEffect(() => {
    window.milo.lib.list({ classId: cls ? cls.id : "all", app }).then((xs) => setItems(xs.slice(0, 6))).catch(() => {});
  }, [app, cls?.id]);
  if (!items.length) return null;
  return (
    <div className="lib-shelf">
      <div className="lib-shelf__head">
        <span>{cls ? `Recent in ${classLabel(cls)}` : "Recent"}</span>
        <button className="lib-shelf__all" onClick={onAll}>
          See all →
        </button>
      </div>
      <div className="lib-shelf__row">
        {items.map((it) => (
          <button key={it.id} className="lib-mini" onClick={() => onOpen(it)} title={it.title}>
            <Thumb item={it} />
            <span>{it.title}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
