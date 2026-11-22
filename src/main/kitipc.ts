// IPC for Milo's Kit + its storage (notes, pocket, study memory) in the app's data folder.

import { app, clipboard, ipcMain, nativeImage } from "electron";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { log as bb } from "./blackbox";
import { bridgeConnected, call as ext } from "./bridge";
import { classFor, classLine, loadClasses, parseClasses, saveClasses, type Klass } from "./classes";
import { unfileMissing } from "./library";
import { askNotes, tableOps, checkStudy, generateImage, makeNote, makePlan, makeSketch, makeStudySet, makeTable, setClassCtx } from "./kit";

type Deps = {
  captureJpeg: () => Promise<string | null>;
  frontApp: () => Promise<string>;
  pressKeys: (k: string) => Promise<void>;
  setOverlayFocusable: (on: boolean) => void;
};

const dataFile = (name: string) => path.join(app.getPath("userData"), name);
function load<T>(name: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(dataFile(name), "utf8")) as T;
  } catch {
    return fallback;
  }
}
function save(name: string, v: unknown) {
  try {
    fs.mkdirSync(app.getPath("userData"), { recursive: true });
    fs.writeFileSync(dataFile(name), JSON.stringify(v, null, 1));
  } catch (e) {
    bb("kit", "save_failed", { name, error: (e as Error).message });
  }
}

export type Note = { id: string; title: string; course: string; body: string; created: number; updated: number };
/** Add a note from elsewhere in Milo (lecture notes). Returns it. */
export function addNote(n: { title: string; course: string; body: string }): Note {
  const notes = load<Note[]>("notes.json", []);
  const note: Note = { id: Date.now().toString(36), title: n.title.slice(0, 200), course: n.course.slice(0, 80) || "General", body: n.body.slice(0, 100000), created: Date.now(), updated: Date.now() };
  notes.unshift(note);
  save("notes.json", notes);
  return note;
}
export function setNoteCourse(id: string, course: string) {
  const notes = load<Note[]>("notes.json", []);
  const n = notes.find((x) => x.id === id);
  if (!n) return;
  n.course = course.slice(0, 80);
  n.updated = Date.now();
  save("notes.json", notes);
}
export function removeNote(id: string) {
  save("notes.json", load<Note[]>("notes.json", []).filter((x) => x.id !== id));
}
export type PocketItem = { id: string; text: string; from: string; at: number };
type Memory = { skills: Record<string, { right: number; wrong: number; last: number }> };

const REFERS_TO_SCREEN = /\b(this|these|that|screen|page|on here|my notes|the notes|lecture|slides?|chapter|reading|pdf|from (my|the) (screen|page|class)|what'?s open|d2l|canvas)\b/i;

export function registerKit(d: Deps) {
  /** Every Kit request is tailored to its class: the one it names ("for my English class"), else the active one. */
  const handle = (ch: string, fn: (e: Electron.IpcMainInvokeEvent, ...a: any[]) => unknown) =>
    ipcMain.handle(ch, (e, ...a) => {
      const c = classFor(typeof a[0] === "string" ? a[0] : "");
      setClassCtx(classLine(c));
      if (c) bb("kit", "class", { ch, class: c.name });
      return fn(e, ...a);
    });

  /** Page text (via the Chrome extension) + a screenshot, when the request is about what's on screen. */
  async function screen(request: string, force = false) {
    if (!force && !REFERS_TO_SCREEN.test(request)) return {};
    const front = await d.frontApp().catch(() => "");
    let pageText: string | undefined;
    if (bridgeConnected() && /Google Chrome|Electron|Milo/i.test(front)) {
      const snap = await ext<{ text?: string; canvasHeavy?: boolean }>("snapshot", { max: 10 }, 8000).catch(() => null);
      if (snap?.text && !snap.canvasHeavy) pageText = snap.text;
    }
    const jpeg = (await d.captureJpeg()) ?? undefined;
    return { pageText, jpeg };
  }

  // ---- Study Deck
  handle("kit:study", async (_e, request: string, mode: "worked" | "practice" | "cards" | "test" | "learn", count: number, context?: string) => {
    const mem = load<Memory>("study-memory.json", { skills: {} });
    const weak = Object.entries(mem.skills)
      .filter(([, s]) => s.wrong > s.right * 0.5)
      .sort((a, b) => b[1].wrong - a[1].wrong)
      .slice(0, 4)
      .map(([k]) => k);
    const src = context ? {} : await screen(String(request ?? ""));
    const n = Math.max(1, Math.min(20, Number(count) || (mode === "worked" ? 1 : mode === "test" ? 8 : mode === "learn" ? 3 : 5)));
    return makeStudySet(String(request ?? ""), { mode, count: n, weak, ...src, context: typeof context === "string" ? context : undefined });
  });
  handle("kit:check", async (_e, item: { prompt: string; answer: string; skill?: string }, student: string) => {
    const r = await checkStudy(item, String(student ?? ""));
    if (r.ok && item.skill) {
      const mem = load<Memory>("study-memory.json", { skills: {} });
      const s = (mem.skills[item.skill] ??= { right: 0, wrong: 0, last: 0 });
      if (r.data.correct) s.right++;
      else s.wrong++;
      s.last = Date.now();
      save("study-memory.json", mem);
    }
    return r;
  });
  handle("kit:mark", (_e, skill: string, correct: boolean) => {
    const mem = load<Memory>("study-memory.json", { skills: {} });
    const s = (mem.skills[String(skill)] ??= { right: 0, wrong: 0, last: 0 });
    if (correct) s.right++;
    else s.wrong++;
    s.last = Date.now();
    save("study-memory.json", mem);
    return true;
  });
  handle("kit:mastery", () => load<Memory>("study-memory.json", { skills: {} }).skills);
  handle("kit:weak", () => {
    const mem = load<Memory>("study-memory.json", { skills: {} });
    return Object.entries(mem.skills)
      .filter(([, s]) => s.wrong > 0)
      .sort((a, b) => b[1].wrong - b[1].right - (a[1].wrong - a[1].right))
      .slice(0, 8)
      .map(([skill, s]) => ({ skill, ...s }));
  });

  // ---- Sketch
  handle("kit:sketch", async (_e, request: string) => {
    const src = await screen(String(request ?? ""));
    return makeSketch(String(request ?? ""), src.pageText ?? "");
  });
  handle("kit:image", (_e, prompt: string) => generateImage(String(prompt ?? "")));
  handle("kit:has-images", () => !!process.env.OPENAI_API_KEY);

  // ---- Sheet
  const COPIED_T = /\b(copied|clipboard|what i copied|pasted?)\b/i;
  handle("kit:table", async (_e, request: string) => {
    const q = String(request ?? "");
    if (COPIED_T.test(q)) return makeTable(q, clipboard.readText().slice(0, 8000));
    const src = await screen(q);
    return makeTable(q, src.pageText ?? "");
  });

  const COPIED = /\b(copied|clipboard|i copied|what i copied|pasted?)\b/i;
  handle("kit:table-ops", async (_e, request: string, t: { columns: string[]; rows: (string | number)[][] }, stats: string) => {
    const q = String(request ?? "");
    let extra = COPIED.test(q) ? clipboard.readText().slice(0, 8000) : "";
    if (!extra && /\b(screen|this page|on here|from (the|my) (page|screen))\b/i.test(q)) extra = (await screen(q, true)).pageText ?? "";
    return tableOps(q, { columns: Array.isArray(t?.columns) ? t.columns.slice(0, 30) : [], rows: Array.isArray(t?.rows) ? t.rows.slice(0, 500) : [] }, String(stats ?? "").slice(0, 3000), extra);
  });

  // ---- Charts out of Milo: copy as an image (paste into Docs, Word, Slides) or save a PNG.
  handle("kit:copy-image", (_e, dataUrl: string) => {
    const img = nativeImage.createFromDataURL(String(dataUrl ?? ""));
    if (img.isEmpty()) return false;
    clipboard.writeImage(img);
    return true;
  });
  handle("kit:save-image", (_e, dataUrl: string, name: string) => {
    const img = nativeImage.createFromDataURL(String(dataUrl ?? ""));
    if (img.isEmpty()) return null;
    const safe = String(name || "Milo chart").replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 80) || "Milo chart";
    const file = path.join(app.getPath("downloads"), `${safe}.png`);
    fs.writeFileSync(file, img.toPNG());
    execFile("open", ["-R", file]);
    return file;
  });
  // Open the table in Excel / Numbers (CSV in Downloads, opened with the default app).
  handle("kit:open-csv", (_e, title: string, columns: string[], rows: (string | number)[][]) => {
    const cell = (v: unknown) => {
      const t = String(v ?? "");
      return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };
    const csv = [columns, ...rows].map((r) => (r ?? []).map(cell).join(",")).join("\n");
    const safe = String(title || "Milo sheet").replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 80) || "Milo sheet";
    const file = path.join(app.getPath("downloads"), `${safe}.csv`);
    fs.writeFileSync(file, csv);
    return new Promise((resolve) => execFile("open", [file], (err) => resolve(!err)));
  });

  // ---- Your classes
  ipcMain.handle("kit:classes", () => loadClasses());
  ipcMain.handle("kit:classes-save", (_e, classes: Klass[], active: string | null) => {
    const saved = saveClasses({ classes: Array.isArray(classes) ? classes : [], active: active ?? null });
    unfileMissing(saved.classes.map((c) => c.id)); // a removed class's work stays, just unfiled
    return saved;
  });
  ipcMain.handle("kit:class-active", (_e, id: string | null) => {
    const s = loadClasses();
    return saveClasses({ ...s, active: id || null });
  });
  ipcMain.handle("kit:class-for", (_e, text: string) => classFor(String(text ?? "")));
  ipcMain.handle("kit:classes-parse", async (_e, text: string, useScreen: boolean) => {
    let t = String(text ?? "");
    if (useScreen) {
      const src = await screen(t, true);
      if (src.pageText) t += `\n\nOn their screen (course list):\n${src.pageText.slice(0, 6000)}`;
    }
    return parseClasses(t);
  });

  // ---- Notes (saved in the app's data folder)
  handle("kit:notes", () => load<Note[]>("notes.json", []));
  handle("kit:note-save", (_e, n: Note) => {
    const notes = load<Note[]>("notes.json", []);
    const clean: Note = {
      id: String(n.id || Date.now().toString(36)),
      title: String(n.title ?? "Untitled").slice(0, 200),
      course: String(n.course ?? "General").slice(0, 80),
      body: String(n.body ?? "").slice(0, 100000),
      created: Number(n.created) || Date.now(),
      updated: Date.now(),
    };
    const i = notes.findIndex((x) => x.id === clean.id);
    if (i >= 0) notes[i] = clean;
    else notes.unshift(clean);
    save("notes.json", notes);
    return clean;
  });
  handle("kit:note-delete", (_e, id: string) => {
    save("notes.json", load<Note[]>("notes.json", []).filter((x) => x.id !== id));
    return true;
  });
  handle("kit:note-make", async (_e, request: string) => {
    const notes = load<Note[]>("notes.json", []);
    const src = await screen(String(request ?? ""), /\b(summar|notes? (on|from|about) (this|my screen|the page))/i.test(String(request)));
    const classes = loadClasses().classes.map((c) => c.name);
    return makeNote(String(request ?? ""), { ...src, existingCourses: [...new Set([...classes, ...notes.map((n) => n.course)])] });
  });
  handle("kit:notes-ask", (_e, q: string) => askNotes(String(q ?? ""), load<Note[]>("notes.json", [])));
  handle("kit:note-export", (_e, n: Note) => {
    // Copy into Apple Notes (a real note the student keeps).
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;").replace(/\\/g, "\\\\");
    const html = `<h1>${esc(n.title)}</h1>` + esc(n.body).split("\n").map((l) => `<div>${l || "<br>"}</div>`).join("");
    return new Promise((resolve) =>
      execFile("osascript", ["-e", `tell application "Notes" to make new note with properties {body:"${html}"}`], (err) => resolve(!err))
    );
  });

  // ---- Pocket: "hold this" / "drop it"
  handle("kit:pocket", () => load<PocketItem[]>("pocket.json", []));
  handle("kit:hold", async (_e, text?: string) => {
    let t = typeof text === "string" ? text : "";
    let from = "Milo";
    if (!t) {
      // Copy whatever is selected in the app you're using.
      from = await d.frontApp().catch(() => "");
      const before = clipboard.readText();
      clipboard.writeText("");
      d.setOverlayFocusable(false);
      await d.pressKeys("cmd+c");
      await new Promise((r) => setTimeout(r, 250));
      t = clipboard.readText();
      d.setOverlayFocusable(true);
      if (!t) clipboard.writeText(before); // nothing was selected: leave the clipboard as it was
    }
    if (!t.trim()) return { ok: false, text: "Select something first, then tell me to hold it." };
    const items = load<PocketItem[]>("pocket.json", []);
    const item: PocketItem = { id: Date.now().toString(36), text: t.slice(0, 20000), from, at: Date.now() };
    save("pocket.json", [item, ...items].slice(0, 12));
    return { ok: true, item };
  });
  handle("kit:pocket-copy", (_e, id: string) => {
    const it = load<PocketItem[]>("pocket.json", []).find((x) => x.id === id);
    if (!it) return false;
    clipboard.writeText(it.text);
    return true;
  });
  handle("kit:pocket-remove", (_e, id: string) => {
    save("pocket.json", load<PocketItem[]>("pocket.json", []).filter((x) => x.id !== id));
    return true;
  });

  // ---- Planner
  handle("kit:plan", async (_e, request: string, items: { title: string; course: string; due: string }[]) => {
    const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
    const src = await screen(String(request ?? ""));
    return makePlan(String(request ?? ""), today, Array.isArray(items) ? items.slice(0, 40) : [], src.pageText ?? "");
  });

  // Study plan -> Apple Calendar: write an .ics file and open it (Calendar asks which calendar to add to).
  handle("kit:plan-ics", async (_e, plan: { title: string; days: { date: string; tasks: { text: string; kind: string; minutes?: number }[] }[] }) => {
    const esc = (t: string) => String(t).replace(/\\/g, "\\\\").replace(/[,;]/g, (m) => "\\" + m).replace(/\n/g, "\\n");
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Milo//Study Plan//EN", "CALSCALE:GREGORIAN"];
    let n = 0;
    for (const d of Array.isArray(plan?.days) ? plan.days : []) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) continue;
      const day = d.date.replace(/-/g, "");
      let startMin = 19 * 60; // study blocks start at 7 PM, back to back
      for (const t of d.tasks ?? []) {
        lines.push("BEGIN:VEVENT", `UID:milo-${day}-${n++}@milo.app`, `DTSTAMP:${stamp}`);
        if (t.kind === "exam" || t.kind === "due") {
          const next = new Date(d.date + "T12:00:00Z");
          next.setUTCDate(next.getUTCDate() + 1);
          lines.push(`DTSTART;VALUE=DATE:${day}`, `DTEND;VALUE=DATE:${next.toISOString().slice(0, 10).replace(/-/g, "")}`, `SUMMARY:${esc((t.kind === "exam" ? "EXAM: " : "Due: ") + t.text)}`);
        } else {
          const len = Math.max(15, Math.min(180, Number(t.minutes) || 30));
          const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}${String(m % 60).padStart(2, "0")}00`;
          lines.push(`DTSTART:${day}T${hm(startMin)}`, `DTEND:${day}T${hm(startMin + len)}`, `SUMMARY:${esc("Study: " + t.text)}`, "BEGIN:VALARM", "TRIGGER:-PT10M", "ACTION:DISPLAY", "DESCRIPTION:Study time with Milo", "END:VALARM");
          startMin += len + 10;
        }
        lines.push("END:VEVENT");
      }
    }
    lines.push("END:VCALENDAR");
    const file = path.join(app.getPath("downloads"), "Milo Study Plan.ics");
    fs.writeFileSync(file, lines.join("\r\n"));
    return new Promise((resolve) => execFile("open", [file], (err) => resolve(!err)));
  });

  // ---- copy any text (tables as TSV paste straight into Excel / Google Sheets)
  handle("kit:copy", (_e, text: string) => {
    clipboard.writeText(String(text ?? ""));
    return true;
  });
}
