// Runs Milo's Kit: opens the right app, loads what you asked for, and handles voice inside each app.

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { PanelSize } from "../ResearchPanel";
import { stripMath } from "../MathText";
import KitPanel, { KitLoading } from "./KitPanel";
import NotesView, { type NotesHandle } from "./NotesView";
import PlannerView from "./PlannerView";
import PocketView from "./PocketView";
import SheetView, { type SheetHandle } from "./SheetView";
import SketchView from "./SketchView";
import StudyDeck, { type StudyHandle } from "./StudyDeck";
import { ClassBar, ClassesEditor } from "./Classes";
import Library, { classLabel, isNewSketch, matchClass, parseBrowse, RecentShelf, SavedPill, type LibFilter } from "./Library";
import { startersFor } from "./subjects";
import { KIT_APPS, SUBJECT_NAMES, type ClassStore, type GraphSpec, type KitApp, type Plan, type PocketItem, type Sketch, type StudyMode, type StudySet, type Subject, type Table, type LibApp, type LibItem } from "./types";

export type KitHandle = {
  open: (app: KitApp, request?: string) => void;
  close: () => void;
  current: () => KitApp | null;
  /** Unmistakable speech for the open app (instant). Returns true if handled. */
  voice: (text: string) => boolean;
  /** The router said this is for the open app. */
  direct: (text: string) => boolean;
  /** "go to my math tab" / "open my bio class": open Milo's apps on that class's tab. */
  gotoClass: (text: string) => boolean;
  /** What's open, for the router. */
  describe: () => string;
  /** "hold this" */
  hold: () => Promise<void>;
  /** "drop it" / "drop it in ChatGPT" */
  drop: (target?: string) => Promise<void>;
  /** "save that to my notes" */
  saveToNotes: (body: string, title?: string) => Promise<void>;
  /** "my classes are stats, English comp, ..." (or no text: open the setup) */
  setupClasses: (text?: string) => void;
};

/** "Uh, okay, can you please…" -> the actual words. */
export const clean = (text: string) =>
  text
    .toLowerCase()
    .replace(/[.!?]+$/, "")
    .replace(/^(?:(?:hey|ok(?:ay)?|so|uh+|um+|cool|alright|all right|yeah|well|now|and|milo|can you|could you|would you|will you|please|just)\b[,.]?\s*)+/, "")
    .trim();

const NUM: Record<string, number> = { one: 1, a: 1, an: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, fifteen: 15, twenty: 20 };
export function studyModeFor(req: string): { mode: StudyMode; count: number } {
  const t = req.toLowerCase();
  const n = t.match(/\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen|twenty)\b(?=\s+(?:\w+\s+){0,3}(problems?|questions?|cards?|flashcards?|examples?))/);
  const count = n ? Number(n[1]) || NUM[n[1]] || 0 : 0;
  if (/flash ?cards?|\bcards\b/.test(t)) return { mode: "cards", count: count || 10 };
  if (/practice (test|exam)|mock (test|exam)|test me|exam prep/.test(t)) return { mode: "test", count: count || 8 };
  if (/\b(teach me|help me (understand|learn)|i don'?t (get|understand)|learn (about|how)|explain (how|what|why)|from scratch|go over)\b/.test(t)) return { mode: "learn", count: 3 };
  if (/\b(solve (it|them)|and solve|walk me through|show me how|worked|example|explain)\b/.test(t) && !/for me to (solve|try)|let me (try|solve)|i('ll| will) (try|solve)/.test(t)) return { mode: "worked", count: count || 1 };
  if (/\b(practice|quiz me|let me try|for me to (solve|try)|problems?|questions?)\b/.test(t)) return { mode: "practice", count: count || 5 };
  return { mode: "worked", count: count || 1 };
}

const KitHost = forwardRef<KitHandle, {
  style: React.CSSProperties;
  size: PanelSize;
  onSize: (s: PanelSize) => void;
  hover: (on: boolean) => void;
  say: (t: string, opts?: { minMs?: number }) => Promise<void>;
  setBubble: (t: string | null) => void;
  runTask: (task: string) => Promise<boolean>;
  onOpenChange: (app: KitApp | null) => void;
  briefItems: () => { title: string; course: string; due: string }[];
}>(function KitHost(p, ref) {
  const [app, setApp] = useState<KitApp | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [study, setStudy] = useState<{ set: StudySet; mode: StudyMode; id: number } | null>(null);
  const [sketch, setSketch] = useState<Sketch | null>(null);
  const [table, setTable] = useState<Table | null>(null);
  const [plan, setPlanState] = useState<Plan | null>(() => {
    try {
      return JSON.parse(localStorage.getItem("milo.plan") || "null");
    } catch {
      return null;
    }
  });
  const setPlan = (pl: Plan | null) => {
    setPlanState(pl);
    try {
      localStorage.setItem("milo.plan", JSON.stringify(pl));
    } catch {
      /* ignore */
    }
  };
  const [notesFocus, setNotesFocus] = useState<string | null>(null);
  const [notesAnswer, setNotesAnswer] = useState<string | null>(null);
  const [pocketV, setPocketV] = useState(0);
  const [classes, setClasses] = useState<ClassStore>({ classes: [], active: null });
  const [editClasses, setEditClasses] = useState<{ seed?: string } | null>(null);
  useEffect(() => {
    window.milo.kit.classes().then(setClasses).catch(() => {});
  }, []);
  const activeClass = classes.classes.find((c) => c.id === classes.active) ?? null;
  const subject: Subject | undefined = activeClass?.subject;
  const starters = startersFor(subject);
  // Each class is its own tab: it remembers what was open in every app. A class you haven't used yet starts clean.
  const activeRef = useRef<string | null>(null);
  activeRef.current = classes.active;
  const tabKey = (id: string | null) => id ?? "all";
  const tabs = useRef<Record<string, Partial<Record<LibApp, string>>>>({});
  const remember = (classId: string | null, a: LibApp, id: string | null) => {
    const k = tabKey(classId);
    tabs.current[k] = { ...tabs.current[k], [a]: id ?? undefined };
  };
  /** Light up a class without touching what's on screen (Milo is already making something for it). */
  const pickClass = (id: string | null) => {
    activeRef.current = id;
    return window.milo.kit.setActiveClass(id).then(setClasses);
  };
  /** Put every app back the way this class left it (or clean, if it's new). */
  const restoreTab = async (classId: string | null, keepLoading: boolean) => {
    const mem = tabs.current[tabKey(classId)] ?? {};
    const ticket = req.current;
    const all: LibItem[] = Object.values(mem).some(Boolean) ? await window.milo.lib.list({ classId: "all" }).catch(() => []) : [];
    if (activeRef.current !== classId) return; // they already clicked somewhere else
    const find = (a: LibApp) => (mem[a] ? all.find((x) => x.id === mem[a]) ?? null : null);
    const busy = keepLoading && req.current !== ticket;
    const s = find("sketch"), t = find("sheet"), st = find("study"), pl = find("planner");
    if (!busy || app !== "sketch") setSketch((s?.data as Sketch) ?? null);
    if (!busy || app !== "sheet") {
      setTable((t?.data as Table) ?? null);
      setTableKey((k) => k + 1);
    }
    if (!busy || app !== "study") {
      const d = st?.data as { set: StudySet; mode: StudyMode } | undefined;
      setStudy(d ? { set: d.set, mode: d.mode, id: Date.now() } : null);
    }
    if (!busy || app !== "planner") setPlan((pl?.data as Plan) ?? null);
    const cur = app === "sketch" ? s : app === "sheet" ? t : app === "study" ? st : app === "planner" ? pl : null;
    if (!busy) setItem(cur ? { id: cur.id, app: cur.app, classId: cur.classId, fresh: false } : null);
  };
  /** The student tapped a class (or said "switch to bio"): switch tabs. */
  const switchClass = (id: string | null) => {
    if (id === classes.active) return;
    req.current++;
    setLoading(null);
    setError(null);
    setLib(null);
    void pickClass(id);
    void restoreTab(id, false);
  };
  /** "for my English class": light up that class before the app loads. */
  const noteClass = (request: string) =>
    window.milo.kit.classFor(request).then((c) => {
      if (c && c.id !== activeRef.current) {
        void pickClass(c.id);
        void restoreTab(c.id, true);
      }
    });
  // The class library: what's on screen is saved under a class; the library shows every class's folder.
  const [item, setItem] = useState<{ id: string; app: LibApp; classId: string | null; fresh: boolean } | null>(null);
  const [lib, setLib] = useState<{ filter: LibFilter; cls: string | null | "all" } | null>(null);
  const [tableKey, setTableKey] = useState(0);
  const sheetSave = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Save what Milo just made under the right class: the one named in the request, else the class that's on. */
  const file = async (a: LibApp, title: string, data: unknown, request: string, isEdit = false) => {
    if (isEdit && item && item.app === a) {
      await window.milo.lib.save({ id: item.id, app: a, title, data });
      return;
    }
    const named = matchClass(request, classes.classes);
    const classId = named?.id ?? activeRef.current ?? null;
    const saved = await window.milo.lib.save({ app: a, title, data, classId });
    if (!saved) return;
    if (saved.classId !== activeRef.current) void pickClass(saved.classId);
    remember(saved.classId, a, saved.id);
    setItem({ id: saved.id, app: a, classId: saved.classId, fresh: true });
    setTimeout(() => setItem((it) => (it && it.id === saved.id ? { ...it, fresh: false } : it)), 2600);
  };
  const moveItem = async (classId: string | null) => {
    if (!item) return;
    await window.milo.lib.move(item.id, classId);
    remember(item.classId, item.app, null);
    remember(classId, item.app, item.id);
    if (classId !== activeRef.current) void pickClass(classId);
    setItem({ ...item, classId, fresh: true });
    setTimeout(() => setItem((it) => (it ? { ...it, fresh: false } : it)), 2600);
  };
  const openLibrary = (filter: LibFilter, cls?: string | null | "all") => {
    req.current++;
    setLoading(null);
    setError(null);
    setEditClasses(null);
    setLib({ filter, cls: cls === undefined ? classes.active ?? "all" : cls });
  };
  /** Reopen something from the library, exactly as it was. */
  const openItem = (it: LibItem) => {
    req.current++;
    setLoading(null);
    setError(null);
    setLib(null);
    if (it.app === "sketch") setSketch(it.data as Sketch);
    else if (it.app === "sheet") {
      setTable(it.data as Table);
      setTableKey((k) => k + 1);
    } else if (it.app === "study") {
      const d = it.data as { set: StudySet; mode: StudyMode };
      setStudy({ set: d.set, mode: d.mode, id: Date.now() });
    } else if (it.app === "planner") setPlan(it.data as Plan);
    show(it.app);
    remember(it.classId, it.app, it.id);
    setItem({ id: it.id, app: it.app, classId: it.classId, fresh: false });
    if (it.classId !== activeRef.current) {
      // the other apps follow the class too
      const keep = it.app;
      const mem = tabs.current[tabKey(it.classId)] ?? {};
      void pickClass(it.classId);
      void window.milo.lib.list({ classId: "all" }).then((all) => {
        const find = (a: LibApp) => (mem[a] ? all.find((x) => x.id === mem[a]) ?? null : null);
        if (keep !== "sketch") setSketch((find("sketch")?.data as Sketch) ?? null);
        if (keep !== "sheet") setTable((find("sheet")?.data as Table) ?? null);
        if (keep !== "study") {
          const d = find("study")?.data as { set: StudySet; mode: StudyMode } | undefined;
          setStudy(d ? { set: d.set, mode: d.mode, id: Date.now() } : null);
        }
        if (keep !== "planner") setPlan((find("planner")?.data as Plan) ?? null);
      });
    }
  };
  const libFilterFor = (a: KitApp | null): LibFilter => (a === "sketch" || a === "sheet" || a === "study" || a === "planner" ? a : a === "notes" ? "notes" : "all");
  const studyRef = useRef<StudyHandle>(null);
  const notesRef = useRef<NotesHandle>(null);
  const sheetRef = useRef<SheetHandle>(null);
  const req = useRef(0);

  const lastApp = useRef<KitApp>("sketch");
  const show = (a: KitApp | null) => {
    if (a && a !== "pocket") lastApp.current = a;
    if (a !== app) {
      const id = a && a !== "notes" && a !== "pocket" ? tabs.current[tabKey(activeRef.current)]?.[a as LibApp] : undefined;
      setItem(id ? { id, app: a as LibApp, classId: activeRef.current, fresh: false } : null);
      setLib(null);
    }
    setApp(a);
    p.onOpenChange(a);
  };
  const begin = (a: KitApp, text: string) => {
    show(a);
    setLib(null);
    setError(null);
    setLoading(text);
    return ++req.current;
  };
  const fail = (id: number, text: string) => {
    if (id !== req.current) return;
    setLoading(null);
    setError(text);
    p.say("That didn't work. Try asking a little differently.");
  };

  const loadStudy = async (request: string, forced?: StudyMode, context?: string) => {
    const { mode, count } = studyModeFor(request);
    const m = forced ?? mode;
    const id = begin("study", m === "worked" ? "Writing a problem" : m === "learn" ? "Planning your lesson" : m === "cards" ? "Making flashcards" : m === "test" ? "Building your practice test" : "Writing practice problems");
    const r = await window.milo.kit.study(request, m, forced && forced !== mode ? (m === "worked" ? 1 : m === "cards" ? 10 : m === "test" ? 8 : 5) : count, context);
    if (id !== req.current) return;
    if (!r.ok || !r.data.items.length) return fail(id, r.ok ? "No problems came back." : r.text);
    setLoading(null);
    setStudy({ set: r.data, mode: m, id: Date.now() });
    void file("study", r.data.title, { set: r.data, mode: m }, request);
  };
  /** "Shade above 80" / "add labels": change what's showing instead of starting over. */
  const editRequest = (r: string) =>
    sketch
      ? sketch.graph
        ? `${r}\n(Change this existing graph "${sketch.title}": ${JSON.stringify(sketch.graph)})`
        : sketch.svg && sketch.svg.length < 30000
          ? `${r}\n(Change this existing drawing "${sketch.title}" and return the full updated SVG: ${sketch.svg})`
          : r
      : r;
  const loadSketch = async (request: string) => {
    const id = begin("sketch", "Sketching it");
    const r = await window.milo.kit.sketch(request);
    if (id !== req.current) return;
    if (!r.ok) return fail(id, r.text);
    setLoading(null);
    setSketch(r.data);
    p.say(r.data.say);
    void file("sketch", r.data.title, r.data, request, request.includes("(Change this existing"));
  };
  const loadTable = async (request: string) => {
    const id = begin("sheet", "Building the table");
    const r = await window.milo.kit.table(request);
    if (id !== req.current) return;
    if (!r.ok) return fail(id, r.text);
    setLoading(null);
    setTable(r.data);
    setTableKey((k) => k + 1);
    p.say(r.data.say);
    void file("sheet", r.data.title, r.data, request);
  };
  const loadPlan = async (request: string) => {
    const id = begin("planner", "Planning your week");
    const r = await window.milo.kit.plan(request, p.briefItems());
    if (id !== req.current) return;
    if (!r.ok) return fail(id, r.text);
    setLoading(null);
    setPlan(r.data);
    p.say(r.data.say);
    void file("planner", r.data.title, r.data, request);
  };
  const askNotes = async (q: string) => {
    const id = begin("notes", "Looking through your notes");
    const r = await window.milo.kit.askNotes(q);
    if (id !== req.current) return;
    setLoading(null);
    if (!r.ok) return fail(id, r.text);
    setNotesAnswer(r.data.answer);
    if (r.data.note_id) setNotesFocus(r.data.note_id);
    p.say(r.data.answer);
  };
  const studyNote = (n: { title: string; body: string }, mode: "practice" | "cards" | "test") =>
    loadStudy(`${mode === "cards" ? "flashcards" : mode === "test" ? "a practice test" : "practice problems"} on my note: ${n.title}`, mode, `${n.title}\n\n${n.body}`);
  const makeNote = async (request: string) => {
    const id = begin("notes", "Writing your note");
    const r = await window.milo.kit.makeNote(request);
    if (id !== req.current) return;
    if (!r.ok) return fail(id, r.text);
    setLoading(null);
    const saved = await notesRef.current?.add(r.data);
    if (!saved) {
      const n = await window.milo.kit.saveNote(r.data);
      setNotesFocus(n.id);
    } else setNotesFocus(saved.id);
    p.say(r.data.say || "Saved to your notes.");
  };

  const open = (a: KitApp, request = "") => {
    const r = request.trim();
    setEditClasses(null);
    const browse = r ? parseBrowse(r) : null;
    if (browse) {
      const named = matchClass(r, classes.classes);
      const filter = browse.filter === "all" && a !== "pocket" ? libFilterFor(a) : browse.filter;
      if (browse.latest) {
        const want = filter === "all" || filter === "notes" ? undefined : filter;
        window.milo.lib.list({ classId: named ? named.id : "all", app: want ?? "all" }).then((xs) => {
          if (xs[0]) openItem(xs[0]);
          else {
            show(a);
            openLibrary(filter, named ? named.id : "all");
          }
        });
        return;
      }
      show(a === "pocket" ? "study" : a);
      openLibrary(filter, named ? named.id : /\b(all|every)\b/.test(r.toLowerCase()) ? "all" : undefined);
      p.say(named ? `Here's your ${classLabel(named)} folder.` : "Here's everything you've saved.");
      return;
    }
    if (r) noteClass(r);
    const meaningful = r && !/^(open |show |pull up |bring up )?(up )?(your |my |the )?(notes|study( deck)?|sketch( ?pad)?|sheet|spreadsheet|planner|pocket|kit|tool ?box|tools)( app)?$/i.test(r);
    setError(null);
    if (!meaningful) {
      req.current++;
      setLoading(null);
      if (a === "planner" && !plan) return loadPlan("Plan my studying for what's coming up");
      show(a);
      return;
    }
    if (a === "study") loadStudy(r);
    else if (a === "sketch") loadSketch(r);
    else if (a === "sheet") loadTable(r);
    else if (a === "planner") loadPlan(r);
    else if (a === "notes") {
      setNotesAnswer(null);
      // A question about your notes gets answered; an instruction ("make notes on this", "write down...") makes a note.
      const isCommand = /^(make|write|take|create|add|summari[sz]e|put|jot|note|save)\b/i.test(r);
      if (!isCommand && (/^(what|when|where|who|how|why|did|do|does|which|find|search|look up|is there)\b/i.test(r) || /\?$/.test(r))) askNotes(r);
      else makeNote(r);
    }
    else show(a);
  };

  /** "save this to bio" / "move it to my stats class": file what's on screen under that class. */
  const fileTo = (t: string): boolean => {
    const mv = t.match(/^(?:save|put|move|file|add|keep|stick) (?:this|it|that)(?: (?:drawing|sketch|diagram|graph|sheet|table|chart|set|plan|one))?\s+(?:to|in|into|under|for|with) (.+)$/);
    if (!mv) return false;
    const c = matchClass(mv[1], classes.classes);
    if (!item) p.say("There's nothing to file yet. Make something first.");
    else if (!c) p.say(`Which class? I have ${classes.classes.map((k) => classLabel(k)).join(", ") || "none yet"}.`);
    else void moveItem(c.id).then(() => p.say(`Saved to ${classLabel(c)}.`));
    return true;
  };
  useImperativeHandle(ref, () => ({
    open,
    close: () => {
      req.current++;
      setLoading(null);
      show(null);
    },
    current: () => app,
    /** Only UNMISTAKABLE in-app commands run instantly. Everything else goes to the router, which knows what's open. */
    voice: (text) => {
      if (!app) return false;
      const t = clean(text);
      if (editClasses && !/^(close|stop|go|never ?mind|cancel)\b/.test(t) && !/\b(close|open|chrome|move)\b/.test(t)) {
        setEditClasses({ seed: text });
        return true;
      }
      // "save this to bio" / "move it to my stats class"
      if (fileTo(t)) return true;
      // "show my math sketches" / "open my bio folder" / "open my last drawing"
      const br = parseBrowse(t);
      if (br) {
        open(app, text);
        return true;
      }
      // "go to the math tab" / "switch to my bio class" / "open English" / "math tab": the class chips are tabs.
      const sw = t.match(/^(?:((?:switch|change|go|flip|jump|move)(?: over)? to|open(?: up)?|i'?m (?:working on|doing|studying)(?: for)?|let'?s do|now)\s+)?(?:my |the )?(.{2,40}?)(?: (tab|class|course))?$/);
      if (sw && !/\b(sketch|sheet|study|notes?|planner|pocket|library|chrome|safari|app|it|that|this)\b/.test(sw[2])) {
        const said = sw[2];
        const explicit = !!sw[3];
        const hasVerb = !!sw[1];
        if (/^(all|all classes|everything)$/.test(said) && (explicit || hasVerb)) {
          switchClass(null);
          p.say("All classes.");
          return true;
        }
        const c = matchClass(said, classes.classes);
        if (c && (explicit || hasVerb)) {
          switchClass(c.id);
          p.say(`${classLabel(c)}. Everything fits it now.`);
          return true;
        }
        if (explicit) {
          p.say(classes.classes.length ? `I don't see a ${said} tab. I have ${classes.classes.map((k) => classLabel(k)).join(", ")}. Tap the pencil to add it.` : "You don't have any class tabs yet. Say: my classes are, then list them.");
          return true;
        }
      }
      if (app === "study" && study && studyRef.current) {
        const s = studyRef.current;
        if (/^(next|next one|next problem|keep going|continue|go on)$/.test(t)) return s.next(), true;
        if (/^(hint|give me a hint|i'?m stuck)$/.test(t)) return s.hint(), true;
        if (/^(show me how|walk me through it|show (the )?(answer|steps|solution)|solve it|i give up)$/.test(t)) return s.show(), true;
        if (/^(again|replay|say that again|repeat)$/.test(t)) return s.replay(), true;
        if (/^(flip( it)?|turn it over)$/.test(t)) return s.show(), true;
        if (/^(easier|make it easier|an easier one|too hard)$/.test(t)) return s.easier(), true;
        if (/^(harder|make it harder|a harder one|too easy|challenge me)$/.test(t)) return s.harder(), true;
        // An answer: "the answer is 0.05", "i got 12", or just a number / short math.
        if (s.awaiting()) {
          const m = t.match(/^(?:(?:the )?answer is|i got|i get|my answer is|it equals|equals)\s+(.+)/);
          if (m) return s.answer(m[1]), true;
          if (/^[-+]?[\d.,/ ]+%?$|^[\d\s.+\-*/^()=x%]+$/.test(t)) return s.answer(text), true;
        }
      }
      if (app === "sheet" && table && sheetRef.current && /^((make it|switch to|change it to|turn it into) )?(a |an )?(histogram|box ?plot|bar (chart|graph)|line (chart|graph)|scatter ?plot|pie chart)$|^(more|fewer) bins$|^\d{1,2} bins$/.test(t)) {
        sheetRef.current.ask(text);
        return true;
      }
      return false;
    },
    /** The router decided this is for the open app. */
    gotoClass: (text) => {
      const m = clean(text).match(/^(?:go to|go into|open(?: up)?|switch to|pull up|bring up|show me|take me to)\s+(?:my |the )?(.+?)\s+(?:tab|class|folder)$/);
      const c = m ? matchClass(m[1], classes.classes) : null;
      if (!c) return false;
      if (!app) show(lastApp.current);
      switchClass(c.id);
      p.say(`Here's ${classLabel(c)}.`);
      return true;
    },
    direct: (text) => {
      if (!app) return false;
      const t = clean(text);
      if (fileTo(t)) return true; // "save this to English" moves what's open; it never makes something new
      if (app === "study") {
        const s = studyRef.current;
        if (study && s) {
          if (s.awaiting() && !/^(make|give|create|another|more|new|teach|flash|quiz|test|practice)\b/.test(t)) return s.answer(text), true;
          if (/^(another|more|one more|give me (another|more))\b/.test(t)) return s.more(), true;
          if (/^(hint|help)\b/.test(t)) return s.hint(), true;
          if (/^(show|explain|how|walk|solve)\b/.test(t)) return s.show(), true;
          if (/^next\b/.test(t)) return s.next(), true;
        }
        loadStudy(text);
        return true;
      }
      if (app === "sheet") {
        if (table && sheetRef.current) sheetRef.current.ask(text);
        else loadTable(text);
        return true;
      }
      if (app === "sketch") {
        loadSketch(sketch && !isNewSketch(text) ? editRequest(text) : text);
        return true;
      }
      if (app === "notes") {
        const n = notesRef.current?.current();
        if (n && /\b(quiz me|test me|flash ?cards|practice)\b/.test(t)) {
          studyNote(n, /flash ?cards/.test(t) ? "cards" : /test/.test(t) ? "test" : "practice");
          return true;
        }
        if (/^(add|put|write|note|append)\b/.test(t) && n) {
          const body = text.replace(/^(add|put|write|note|append)( that)?[:,]?\s*/i, "").replace(/\s*(to|in|into) (my |the |this )?notes?\.?$/i, "");
          notesRef.current?.appendToOpen(body).then((ok) => (ok ? p.say("Added.") : makeNote(text)));
          return true;
        }
        if (/^(what|when|where|who|how|why|did|do|does|which|find|search|is there)\b/.test(t) || /\?$/.test(text.trim())) askNotes(text);
        else makeNote(text);
        return true;
      }
      if (app === "planner") {
        loadPlan(text);
        return true;
      }
      return false;
    },
    describe: () => {
      if (!app) return "";
      if (lib) return `Milo's library of saved work (folder: ${lib.cls === "all" ? "all classes" : classLabel(classes.classes.find((c) => c.id === lib.cls))})`;
      const name = KIT_APPS.find((x) => x.id === app)!.name;
      const cls = activeClass ? ` (class: ${activeClass.name})` : "";
      if (app === "sheet" && table) return `Milo's Sheet${cls}, showing ${sheetRef.current?.describe() ?? `"${table.title}"`}`;
      if (app === "study" && study) return `Milo's Study app${cls}, ${study.mode} mode on "${study.set.title}"${studyRef.current?.awaiting() ? ", waiting for the student's answer" : ""}`;
      if (app === "sketch" && sketch) return `Milo's Sketch app${cls}, showing "${sketch.title}"`;
      if (app === "notes") return `Milo's Notes app${cls}${notesRef.current?.current() ? `, note "${notesRef.current.current()!.title}" open` : ""}`;
      if (app === "planner" && plan) return `Milo's Planner${cls}, showing "${plan.title}"`;
      return `Milo's ${name} app${cls}`;
    },
    hold: async () => {
      p.setBubble("Holding it…");
      const r = await window.milo.kit.hold();
      if (!r.ok) {
        p.setBubble(null);
        return void p.say(r.text);
      }
      setPocketV((v) => v + 1);
      p.setBubble(null);
      p.say("Got it. I'm holding it.");
    },
    drop: async (target) => {
      const items = await window.milo.kit.pocket();
      const it = items[0];
      if (!it) return void p.say("My pocket's empty. Select something and say hold this.");
      await window.milo.kit.pocketCopy(it.id);
      show(null);
      if (target && target.trim()) await p.runTask(`Paste what's on the clipboard into ${target}: click into its text box or the right spot, then press cmd+v. Don't send it.`);
      else await p.runTask(`switch to ${it.from && !/milo|electron/i.test(it.from) ? it.from : "the app I was just using"} and paste`);
    },
    setupClasses: (text) => {
      req.current++;
      setLoading(null);
      setError(null);
      setEditClasses({ seed: text && text.trim() ? text : undefined });
      if (!app) show("study");
    },
    saveToNotes: async (body, title) => {
      const n = await window.milo.kit.saveNote({ title: title || body.split(/[.\n]/)[0].slice(0, 60) || "Note", course: "General", body });
      setNotesFocus(n.id);
      show("notes");
      p.say("Saved to your notes.");
    },
  }));

  if (!app) return null;
  const meta = KIT_APPS.find((x) => x.id === app)!;
  const title =
    app === "study" && study ? study.set.title : app === "sketch" && sketch ? sketch.title : app === "sheet" && table ? table.title : app === "planner" && plan ? plan.title : meta.hint;

  let body: React.ReactNode;
  if (editClasses)
    body = (
      <ClassesEditor
        store={classes}
        seed={editClasses.seed}
        courses={[...new Set(p.briefItems().map((i) => i.course).filter(Boolean))]}
        say={(t) => void p.say(t)}
        onSave={(s2) => {
          setClasses(s2);
          setEditClasses(null);
        }}
      />
    );
  else if (lib)
    body = (
      <Library
        classes={classes}
        initialClass={lib.cls}
        initialFilter={lib.filter}
        onOpen={openItem}
        onOpenNote={(n) => {
          setLib(null);
          setNotesFocus(n.id);
          show("notes");
        }}
        onBack={() => setLib(null)}
      />
    );
  else if (loading) body = <KitLoading text={loading} />;
  else if (error) body = <div className="rp-error">{error}</div>;
  else if (app === "study") {
    body = study ? (
      <StudyDeck
        key={study.id}
        ref={studyRef}
        set={study.set}
        mode={study.mode}
        say={p.say}
        onMore={(r, m) => loadStudy(r, m)}
      />
    ) : (
      <>
        <StudyStart subject={subject} onGo={(r, m) => loadStudy(r, m)} />
        <RecentShelf app="study" cls={activeClass} onOpen={openItem} onAll={() => openLibrary("study")} />
      </>
    );
  } else if (app === "sketch") {
    body = sketch ? (
      <SketchView sketch={sketch} onAsk={(r) => loadSketch(editRequest(r))} />
    ) : (
      <>
        <AskBox placeholder={starters.sketchHint} onGo={loadSketch} />
        <Starters label={activeClass ? `For ${activeClass.code || activeClass.name}` : "Try"} items={starters.sketch} onGo={loadSketch} />
        <RecentShelf app="sketch" cls={activeClass} onOpen={openItem} onAll={() => openLibrary("sketch")} />
      </>
    );
  } else if (app === "sheet") {
    body = table ? (
      <SheetView
        key={tableKey}
        ref={sheetRef}
        table={table}
        onChange={(t: Table) => {
          if (!item || item.app !== "sheet") return;
          if (sheetSave.current) clearTimeout(sheetSave.current);
          sheetSave.current = setTimeout(() => void window.milo.lib.save({ id: item.id, app: "sheet", title: t.title, data: t }), 800);
        }}
        say={(t) => p.say(t)}
        needRoom={() => {
          if (p.size === "compact") p.onSize("half");
        }}
        onBig={(spec: GraphSpec, t: string) => {
          setSketch({ title: t, say: "Here's your data.", graph: spec, image_prompt: null });
          show("sketch");
          setItem(null);
          p.onSize("full");
        }}
      />
    ) : (
      <>
        <AskBox placeholder={starters.sheetHint} onGo={loadTable} />
        <Starters label={activeClass ? `For ${activeClass.code || activeClass.name}` : "Try"} items={starters.sheet} onGo={loadTable} />
        <RecentShelf app="sheet" cls={activeClass} onOpen={openItem} onAll={() => openLibrary("sheet")} />
      </>
    );
  } else if (app === "planner") {
    body = plan ? <PlannerView plan={plan} say={(t) => p.say(t)} onPractice={(topic) => loadStudy(`practice problems: ${topic}`, "practice")} onRebuild={() => loadPlan("Rebuild my study plan")} /> : (
      <>
        <AskBox placeholder="Plan my week for Exam 3 on Nov 25…" onGo={loadPlan} />
        <RecentShelf app="planner" cls={activeClass} onOpen={openItem} onAll={() => openLibrary("planner")} />
      </>
    );
  } else if (app === "notes") body = <NotesView ref={notesRef} cls={activeClass} focusId={notesFocus} answer={notesAnswer} say={(t) => p.say(t)} onStudy={studyNote} />;
  else body = <PocketView version={pocketV} onDrop={(it: PocketItem) => (async () => { await window.milo.kit.pocketCopy(it.id); show(null); await p.runTask(`switch to ${it.from && !/milo|electron/i.test(it.from) ? it.from : "the app I was just using"} and paste`); })()} />;

  return (
    <KitPanel
      app={app}
      kicker={editClasses ? "Your classes" : lib ? "Library" : `${meta.name}${activeClass ? ` · ${activeClass.code || activeClass.name}` : study && app === "study" ? ` · ${study.set.subject}` : ""}`}
      sub={
        editClasses || lib ? null : (
          <div className="kit-subrow">
            <ClassBar store={classes} onPick={switchClass} onEdit={() => setEditClasses({})} />
            {item && !lib && !loading && <SavedPill classes={classes.classes} classId={item.classId} fresh={item.fresh} onMove={(id) => void moveItem(id)} />}
          </div>
        )
      }
      actions={
        app !== "pocket" && !editClasses ? (
          <button className={`rp-icon ${lib ? "rp-icon--on" : ""}`} onClick={() => (lib ? setLib(null) : openLibrary(libFilterFor(app)))} title="Your saved work, by class">
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden>
              <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
            </svg>
          </button>
        ) : null
      }
      title={editClasses ? "Every app fits the class you pick" : lib ? "Your saved work" : stripMath(title)}
      working={!!loading}
      size={p.size}
      onSize={p.onSize}
      onClose={() => {
        req.current++;
        setLoading(null);
        setEditClasses(null);
        show(null);
      }}
      style={p.style}
      hover={p.hover}
    >
      {body}
    </KitPanel>
  );
});

function AskBox({ placeholder, onGo }: { placeholder: string; onGo: (q: string) => void }) {
  return (
    <form
      className="sd-input kit-ask"
      onSubmit={(e) => {
        e.preventDefault();
        const v = (e.currentTarget.elements.namedItem("q") as HTMLInputElement).value.trim();
        if (v) onGo(v);
      }}
    >
      <input name="q" placeholder={placeholder} autoFocus />
      <button className="kit-btn kit-btn--primary">Go</button>
    </form>
  );
}

function Starters({ label, items, onGo }: { label: string; items: { label: string; request: string }[]; onGo: (r: string) => void }) {
  if (!items.length) return null;
  return (
    <div className="kit-starters">
      <span className="kit-starters__lab">{label}</span>
      {items.map((it) => (
        <button key={it.label} className="kit-btn" onClick={() => onGo(it.request)}>
          {it.label}
        </button>
      ))}
    </div>
  );
}

function StudyStart({ onGo, subject }: { onGo: (q: string, mode?: StudyMode) => void; subject?: Subject }) {
  const st = startersFor(subject);
  return (
    <div className="sd-start">
      <AskBox placeholder={st.studyHint} onGo={(q) => onGo(q)} />
      <Starters label={subject ? SUBJECT_NAMES[subject] : "Try"} items={st.study} onGo={(r) => onGo(r)} />
      <div className="sd-quick">
        <button className="kit-btn" onClick={() => onGo("practice problems on what's on my screen", "practice")}>Problems from my screen</button>
        <button className="kit-btn" onClick={() => onGo("flashcards on what's on my screen", "cards")}>Flashcards from my screen</button>
        <button className="kit-btn" onClick={() => onGo("a practice test on what's on my screen", "test")}>Practice test</button>
        <button className="kit-btn" onClick={async () => {
          const weak = await window.milo.kit.weak();
          onGo(weak.length ? `practice: ${weak.slice(0, 4).map((w) => w.skill).join(", ")}` : "a mix of practice problems for my classes", "practice");
        }}>My weak spots</button>
      </div>
    </div>
  );
}

export default KitHost;
