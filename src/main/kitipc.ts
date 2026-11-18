// IPC for Milo's Kit + its storage (notes, pocket, study memory) in the app's data folder.

import { app, clipboard, ipcMain } from "electron";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { log as bb } from "./blackbox";
import { bridgeConnected, call as ext } from "./bridge";
import { checkStudy, generateImage, makeNote, makePlan, makeSketch, makeStudySet, makeTable } from "./kit";

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
export type PocketItem = { id: string; text: string; from: string; at: number };
type Memory = { skills: Record<string, { right: number; wrong: number; last: number }> };

const REFERS_TO_SCREEN = /\b(this|these|that|screen|page|on here|my notes|the notes|lecture|slides?|chapter|reading|pdf|from (my|the) (screen|page|class)|what'?s open|d2l|canvas)\b/i;

export function registerKit(d: Deps) {
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
  ipcMain.handle("kit:study", async (_e, request: string, mode: "worked" | "practice" | "cards" | "test", count: number) => {
    const mem = load<Memory>("study-memory.json", { skills: {} });
    const weak = Object.entries(mem.skills)
      .filter(([, s]) => s.wrong > s.right * 0.5)
      .sort((a, b) => b[1].wrong - a[1].wrong)
      .slice(0, 4)
      .map(([k]) => k);
    const src = await screen(String(request ?? ""));
    const n = Math.max(1, Math.min(20, Number(count) || (mode === "worked" ? 1 : mode === "test" ? 8 : 5)));
    return makeStudySet(String(request ?? ""), { mode, count: n, weak, ...src });
  });
  ipcMain.handle("kit:check", async (_e, item: { prompt: string; answer: string; skill?: string }, student: string) => {
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
  ipcMain.handle("kit:mark", (_e, skill: string, correct: boolean) => {
    const mem = load<Memory>("study-memory.json", { skills: {} });
    const s = (mem.skills[String(skill)] ??= { right: 0, wrong: 0, last: 0 });
    if (correct) s.right++;
    else s.wrong++;
    s.last = Date.now();
    save("study-memory.json", mem);
    return true;
  });
  ipcMain.handle("kit:weak", () => {
    const mem = load<Memory>("study-memory.json", { skills: {} });
    return Object.entries(mem.skills)
      .filter(([, s]) => s.wrong > 0)
      .sort((a, b) => b[1].wrong - b[1].right - (a[1].wrong - a[1].right))
      .slice(0, 8)
      .map(([skill, s]) => ({ skill, ...s }));
  });

  // ---- Sketch
  ipcMain.handle("kit:sketch", async (_e, request: string) => {
    const src = await screen(String(request ?? ""));
    return makeSketch(String(request ?? ""), src.pageText ?? "");
  });
  ipcMain.handle("kit:image", (_e, prompt: string) => generateImage(String(prompt ?? "")));
  ipcMain.handle("kit:has-images", () => !!process.env.OPENAI_API_KEY);

  // ---- Sheet
  ipcMain.handle("kit:table", async (_e, request: string) => {
    const src = await screen(String(request ?? ""));
    return makeTable(String(request ?? ""), src.pageText ?? "");
  });

  // ---- Notes (saved in the app's data folder)
  ipcMain.handle("kit:notes", () => load<Note[]>("notes.json", []));
  ipcMain.handle("kit:note-save", (_e, n: Note) => {
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
  ipcMain.handle("kit:note-delete", (_e, id: string) => {
    save("notes.json", load<Note[]>("notes.json", []).filter((x) => x.id !== id));
    return true;
  });
  ipcMain.handle("kit:note-make", async (_e, request: string) => {
    const notes = load<Note[]>("notes.json", []);
    const src = await screen(String(request ?? ""), /\b(summar|notes? (on|from|about) (this|my screen|the page))/i.test(String(request)));
    return makeNote(String(request ?? ""), { ...src, existingCourses: [...new Set(notes.map((n) => n.course))] });
  });
  ipcMain.handle("kit:note-export", (_e, n: Note) => {
    // Copy into Apple Notes (a real note the student keeps).
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;").replace(/\\/g, "\\\\");
    const html = `<h1>${esc(n.title)}</h1>` + esc(n.body).split("\n").map((l) => `<div>${l || "<br>"}</div>`).join("");
    return new Promise((resolve) =>
      execFile("osascript", ["-e", `tell application "Notes" to make new note with properties {body:"${html}"}`], (err) => resolve(!err))
    );
  });

  // ---- Pocket: "hold this" / "drop it"
  ipcMain.handle("kit:pocket", () => load<PocketItem[]>("pocket.json", []));
  ipcMain.handle("kit:hold", async (_e, text?: string) => {
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
  ipcMain.handle("kit:pocket-copy", (_e, id: string) => {
    const it = load<PocketItem[]>("pocket.json", []).find((x) => x.id === id);
    if (!it) return false;
    clipboard.writeText(it.text);
    return true;
  });
  ipcMain.handle("kit:pocket-remove", (_e, id: string) => {
    save("pocket.json", load<PocketItem[]>("pocket.json", []).filter((x) => x.id !== id));
    return true;
  });

  // ---- Planner
  ipcMain.handle("kit:plan", async (_e, request: string, items: { title: string; course: string; due: string }[]) => {
    const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
    const src = await screen(String(request ?? ""));
    return makePlan(String(request ?? ""), today, Array.isArray(items) ? items.slice(0, 40) : [], src.pageText ?? "");
  });

  // ---- copy any text (tables as TSV paste straight into Excel / Google Sheets)
  ipcMain.handle("kit:copy", (_e, text: string) => {
    clipboard.writeText(String(text ?? ""));
    return true;
  });
}
