// Runs Milo's Kit: opens the right app, loads what you asked for, and handles voice inside each app.

import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import type { PanelSize } from "../ResearchPanel";
import { stripMath } from "../MathText";
import KitPanel, { KitLoading } from "./KitPanel";
import NotesView, { type NotesHandle } from "./NotesView";
import PlannerView from "./PlannerView";
import PocketView from "./PocketView";
import SheetView from "./SheetView";
import SketchView from "./SketchView";
import StudyDeck, { type StudyHandle } from "./StudyDeck";
import { KIT_APPS, type GraphSpec, type KitApp, type Plan, type PocketItem, type Sketch, type StudyMode, type StudySet, type Table } from "./types";

export type KitHandle = {
  open: (app: KitApp, request?: string) => void;
  close: () => void;
  current: () => KitApp | null;
  /** Speech while a kit app is open. Returns true if the app handled it. */
  voice: (text: string) => boolean;
  /** "hold this" */
  hold: () => Promise<void>;
  /** "drop it" / "drop it in ChatGPT" */
  drop: (target?: string) => Promise<void>;
  /** "save that to my notes" */
  saveToNotes: (body: string, title?: string) => Promise<void>;
};

const NUM: Record<string, number> = { one: 1, a: 1, an: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, fifteen: 15, twenty: 20 };
export function studyModeFor(req: string): { mode: StudyMode; count: number } {
  const t = req.toLowerCase();
  const n = t.match(/\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen|twenty)\b(?=\s+(?:\w+\s+){0,3}(problems?|questions?|cards?|flashcards?|examples?))/);
  const count = n ? Number(n[1]) || NUM[n[1]] || 0 : 0;
  if (/flash ?cards?|\bcards\b/.test(t)) return { mode: "cards", count: count || 10 };
  if (/practice (test|exam)|mock (test|exam)|test me|exam prep/.test(t)) return { mode: "test", count: count || 8 };
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
  const [plan, setPlan] = useState<Plan | null>(null);
  const [notesFocus, setNotesFocus] = useState<string | null>(null);
  const [pocketV, setPocketV] = useState(0);
  const studyRef = useRef<StudyHandle>(null);
  const notesRef = useRef<NotesHandle>(null);
  const req = useRef(0);

  const show = (a: KitApp | null) => {
    setApp(a);
    p.onOpenChange(a);
  };
  const begin = (a: KitApp, text: string) => {
    show(a);
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

  const loadStudy = async (request: string, forced?: StudyMode) => {
    const { mode, count } = studyModeFor(request);
    const m = forced ?? mode;
    const id = begin("study", m === "worked" ? "Writing a problem" : m === "cards" ? "Making flashcards" : m === "test" ? "Building your practice test" : "Writing practice problems");
    const r = await window.milo.kit.study(request, m, forced && forced !== mode ? (m === "worked" ? 1 : 5) : count);
    if (id !== req.current) return;
    if (!r.ok || !r.data.items.length) return fail(id, r.ok ? "No problems came back." : r.text);
    setLoading(null);
    setStudy({ set: r.data, mode: m, id: Date.now() });
  };
  const loadSketch = async (request: string) => {
    const id = begin("sketch", "Sketching it");
    const r = await window.milo.kit.sketch(request);
    if (id !== req.current) return;
    if (!r.ok) return fail(id, r.text);
    setLoading(null);
    setSketch(r.data);
    p.say(r.data.say);
  };
  const loadTable = async (request: string) => {
    const id = begin("sheet", "Building the table");
    const r = await window.milo.kit.table(request);
    if (id !== req.current) return;
    if (!r.ok) return fail(id, r.text);
    setLoading(null);
    setTable(r.data);
    p.say(r.data.say);
  };
  const loadPlan = async (request: string) => {
    const id = begin("planner", "Planning your week");
    const r = await window.milo.kit.plan(request, p.briefItems());
    if (id !== req.current) return;
    if (!r.ok) return fail(id, r.text);
    setLoading(null);
    setPlan(r.data);
    p.say(r.data.say);
  };
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
    else if (a === "notes") makeNote(r);
    else show(a);
  };

  useImperativeHandle(ref, () => ({
    open,
    close: () => {
      req.current++;
      setLoading(null);
      show(null);
    },
    current: () => app,
    voice: (text) => {
      if (!app) return false;
      const t = text.toLowerCase().replace(/[.!?]+$/, "").trim();
      if (app === "study" && study && studyRef.current) {
        const s = studyRef.current;
        if (/^(next|next one|next problem|keep going|continue|go on)$/.test(t)) return s.next(), true;
        if (/^(hint|give me a hint|i'?m stuck|help)$/.test(t)) return s.hint(), true;
        if (/^(show me|show me how|how do (i|you) do (it|this)|explain( it)?|walk me through it|show (the )?(answer|steps|solution)|solve it|i give up)$/.test(t)) return s.show(), true;
        if (/^(again|replay|say that again|one more time|repeat)$/.test(t)) return s.replay(), true;
        if (/^(another( one)?|more|more like this|one more|try one like this|give me (another|more))( one| problem| like (this|that))?$/.test(t)) return s.more(), true;
        if (/^(flip( it)?|turn it over)$/.test(t)) return s.show(), true;
        if (s.awaiting()) {
          const m = t.match(/^(?:(?:the )?answer is|i got|i get|is it|it'?s|it is|i think it'?s|my answer is|that'?s|equals)\s+(.+)/);
          if (m || /\d/.test(t) || t.split(/\s+/).length <= 6) return s.answer(m ? m[1] : text), true;
        }
      }
      if (app === "notes" && /^(add|put|write)\b.*\b(to|in|into) (my |the )?notes?$|^(add|note)( that)?[: ]/.test(t)) {
        const body = text.replace(/^(add|put|write|note)( that)?[:,]?\s*/i, "").replace(/\s*(to|in|into) (my |the )?notes?\.?$/i, "");
        notesRef.current?.appendToOpen(body).then((ok) => (ok ? p.say("Added.") : makeNote(text)));
        return true;
      }
      return false;
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
  if (loading) body = <KitLoading text={loading} />;
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
      <StudyStart onGo={(r, m) => loadStudy(r, m)} />
    );
  } else if (app === "sketch") {
    body = sketch ? <SketchView sketch={sketch} onAsk={(r) => loadSketch(sketch.graph ? `${r} (change this graph: ${sketch.title}, ${JSON.stringify(sketch.graph)})` : r)} /> : <AskBox placeholder="Graph y = x^2, shade P(X > 75) for N(70, 5), show a plant cell…" onGo={loadSketch} />;
  } else if (app === "sheet") {
    body = table ? (
      <SheetView
        table={table}
        say={(t) => p.say(t)}
        onGraph={(spec: GraphSpec, t: string) => {
          setSketch({ title: t, say: "Here's your data.", graph: spec, image_prompt: null });
          show("sketch");
        }}
      />
    ) : (
      <AskBox placeholder="Put these test scores in a table: 72, 85, 90, 64…" onGo={loadTable} />
    );
  } else if (app === "planner") {
    body = plan ? <PlannerView plan={plan} onPractice={(topic) => loadStudy(`practice problems: ${topic}`, "practice")} onRebuild={() => loadPlan("Rebuild my study plan")} /> : <AskBox placeholder="Plan my week for Exam 3 on Nov 25…" onGo={loadPlan} />;
  } else if (app === "notes") body = <NotesView ref={notesRef} focusId={notesFocus} say={(t) => p.say(t)} />;
  else body = <PocketView version={pocketV} onDrop={(it: PocketItem) => (async () => { await window.milo.kit.pocketCopy(it.id); show(null); await p.runTask(`switch to ${it.from && !/milo|electron/i.test(it.from) ? it.from : "the app I was just using"} and paste`); })()} />;

  return (
    <KitPanel
      app={app}
      kicker={study && app === "study" ? `Study · ${study.set.subject}` : meta.name}
      title={stripMath(title)}
      working={!!loading}
      size={p.size}
      onSize={p.onSize}
      onClose={() => {
        req.current++;
        setLoading(null);
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

function StudyStart({ onGo }: { onGo: (q: string, mode?: StudyMode) => void }) {
  return (
    <div className="sd-start">
      <AskBox placeholder="Stats: normal distribution problems, Bio 101 flashcards…" onGo={(q) => onGo(q)} />
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
