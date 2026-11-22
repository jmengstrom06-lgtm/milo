// The lecture listener. Reliability first:
//  1. Every few minutes of audio is SAVED TO DISK before anything else (nothing is lost if the internet drops).
//  2. Each piece is transcribed on its own, with retries; failures are retried at the end and at the next launch.
//  3. The Mac is kept awake while recording.
//  4. After class: one transcript, then notes, key terms, "the professor flagged" and flashcards, filed to the class.
// Audio is deleted once it's transcribed (unless the student keeps it). Milo never speaks during class.

import { app, powerSaveBlocker } from "electron";
import fs from "node:fs";
import path from "node:path";
import { account, backend } from "./account";
import { log as bb } from "./blackbox";
import { callTool, persona } from "./brain";
import { models } from "./gateway";
import { addNote, removeNote, setNoteCourse } from "./kitipc";
import { moveItem, saveItem } from "./library";
import { classById, classNamed } from "./classes";
import { calendarNow, googleStatus } from "./google";
import { minutesText, notesText, scheduleMatch, type LectureNotes } from "./lectureNotes";

type Meta = { id: string; course: string; classId: string | null; startedAt: number; endedAt?: number; chunks: number; done?: boolean; noteId?: string; studyId?: string; keepAudio?: boolean; how?: string };
const root = () => path.join(app.getPath("userData"), "lectures");
const dirOf = (id: string) => path.join(root(), id);
const pad = (n: number) => String(n).padStart(3, "0");
const readMeta = (id: string): Meta | null => {
  try {
    return JSON.parse(fs.readFileSync(path.join(dirOf(id), "meta.json"), "utf8"));
  } catch {
    return null;
  }
};
const writeMeta = (m: Meta) => fs.writeFileSync(path.join(dirOf(m.id), "meta.json"), JSON.stringify(m));

let current: Meta | null = null;
let awake: number | null = null;
let queue: Promise<void> = Promise.resolve();
export const lectureNow = () => (current ? { id: current.id, course: current.course, startedAt: current.startedAt, chunks: current.chunks } : null);

/** Which class is this? 1) the one they named 2) what's on their calendar right now 3) the class they had at this time last week. */
async function whichClass(said: string): Promise<{ cls: ReturnType<typeof classNamed>; how: string }> {
  const named = classNamed(said.replace(/\b(listen|record|lecture|class|lesson|notes?|take|start|my|the|this|to|on|for|mode)\b/gi, " "));
  if (named) return { cls: named, how: "named" };
  try {
    if (googleStatus().connected) {
      for (const ev of await calendarNow()) {
        const c = classNamed(ev.title);
        if (c) return { cls: c, how: "calendar" };
      }
    }
  } catch {
    /* calendar is a nice-to-have */
  }
  const past: { classId: string | null; startedAt: number }[] = [];
  try {
    for (const d of fs.readdirSync(root())) {
      const m = readMeta(d);
      if (m?.noteId) past.push({ classId: m.classId, startedAt: m.startedAt }); // only real lectures that made notes
    }
  } catch {
    /* first lecture */
  }
  const id = scheduleMatch(past, Date.now());
  if (id && classById(id)) return { cls: classById(id), how: "schedule" };
  return { cls: null, how: "unknown" };
}

export async function startLecture(said: string): Promise<Meta> {
  if (current) return current;
  const { cls, how } = await whichClass(said).catch(() => ({ cls: null, how: "unknown" }));
  const id = `lec-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`;
  fs.mkdirSync(dirOf(id), { recursive: true });
  current = { id, course: cls?.name ?? "", classId: cls?.id ?? null, startedAt: Date.now(), chunks: 0, how };
  writeMeta(current);
  // keep the Mac (and Milo) awake through the whole class
  awake = powerSaveBlocker.start("prevent-app-suspension");
  bb("lecture", "start", { course: current.course || null, how });
  return current;
}

/** A few minutes of audio (16 kHz mono WAV). Saved first, then transcribed in the background. */
export function addChunk(id: string, n: number, wav: ArrayBuffer) {
  const m = current?.id === id ? current : readMeta(id);
  if (!m) return false;
  const file = path.join(dirOf(id), `chunk-${pad(n)}.wav`);
  fs.writeFileSync(file, Buffer.from(wav));
  m.chunks = Math.max(m.chunks, n + 1);
  writeMeta(m);
  queue = queue.then(async () => void (await transcribeChunk(id, n))).catch(() => {});
  return true;
}

let grant: { token: string; until: number } | null = null;
/** A short-lived Deepgram pass from Milo's backend, so the audio goes straight to Deepgram (big uploads through the backend timed out). */
async function deepgramGrant(): Promise<string | null> {
  if (grant && Date.now() < grant.until) return grant.token;
  const res = await backend("deepgram-token", { body: "{}" }).catch(() => null);
  if (!res?.ok) return null;
  const d = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!d.access_token) return null;
  grant = { token: d.access_token, until: Date.now() + Math.max(60, (d.expires_in ?? 600) - 60) * 1000 };
  return grant.token;
}
async function hear(wav: Buffer): Promise<string | null> {
  // 1) a Deepgram key on this Mac (development)  2) signed in: a short-lived pass from the backend  3) the backend's own route
  let auth = process.env.DEEPGRAM_API_KEY ? `Token ${process.env.DEEPGRAM_API_KEY}` : null;
  if (!auth && account().signedIn) {
    const t = await deepgramGrant();
    if (t) auth = `Bearer ${t}`;
  }
  if (!auth) {
    if (!account().signedIn) throw new Error("no way to transcribe");
    const res = await backend("stt", { body: new Uint8Array(wav), contentType: "audio/wav", signal: AbortSignal.timeout(90000) }).catch(() => null);
    if (!res || !res.ok) throw new Error(`backend ${res?.status ?? "offline"}`);
    return (((await res.json()) as { text?: string }).text ?? "").trim();
  }
  const res = await fetch("https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&paragraphs=true&language=en", {
    method: "POST",
    headers: { Authorization: auth, "content-type": "audio/wav" },
    body: new Uint8Array(wav),
    signal: AbortSignal.timeout(90000),
  });
  if (res.status === 401 && auth.startsWith("Bearer")) grant = null; // expired pass: get a new one next try
  if (!res.ok) throw new Error(`deepgram ${res.status}`);
  const d = (await res.json()) as { results?: { channels?: { alternatives?: { transcript?: string; paragraphs?: { transcript?: string } }[] }[] } };
  const alt = d.results?.channels?.[0]?.alternatives?.[0];
  return (alt?.paragraphs?.transcript ?? alt?.transcript ?? "").trim();
}

async function transcribeChunk(id: string, n: number): Promise<boolean> {
  const wavFile = path.join(dirOf(id), `chunk-${pad(n)}.wav`);
  const txtFile = path.join(dirOf(id), `chunk-${pad(n)}.txt`);
  if (fs.existsSync(txtFile)) return true;
  if (!fs.existsSync(wavFile)) return false;
  const wav = fs.readFileSync(wavFile);
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const text = await hear(wav);
      fs.writeFileSync(txtFile, text ?? "");
      bb("lecture", "chunk_heard", { n, words: (text ?? "").split(/\s+/).filter(Boolean).length, attempt });
      return true;
    } catch (e) {
      bb("lecture", "chunk_failed", { n, attempt, error: (e as Error).message.slice(0, 80) });
      await new Promise((r) => setTimeout(r, attempt * 3000));
    }
  }
  return false;
}

const NOTES_TOOL = {
  name: "lecture_notes",
  description: "Study notes from a class lecture transcript.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "What the lecture was about, short (e.g. 'Z-scores and the normal curve')." },
      summary: { type: "string", description: "3 to 5 sentences: the big ideas." },
      sections: { type: "array", items: { type: "object", properties: { heading: { type: "string" }, points: { type: "array", items: { type: "string" } } }, required: ["heading", "points"] }, description: "The lecture in order, as topics with clear bullet points (definitions, formulas, examples, steps)." },
      key_terms: { type: "array", items: { type: "object", properties: { term: { type: "string" }, definition: { type: "string" } }, required: ["term", "definition"] } },
      exam_alerts: { type: "array", items: { type: "string" }, description: "Anything the professor said will be on a test/exam/quiz, said was important, repeated, or assigned (due dates, readings). Quote closely. Empty if none." },
      flashcards: { type: "array", items: { type: "object", properties: { q: { type: "string" }, a: { type: "string" } }, required: ["q", "a"] }, description: "8 to 20 flashcards on what was actually taught." },
      questions: { type: "array", items: { type: "string" }, description: "2 to 5 things worth reviewing or asking the professor about (unclear or skipped parts)." },
    },
    required: ["title", "summary", "sections", "key_terms", "exam_alerts", "flashcards", "questions"],
  },
};

/** Class is over: finish every transcript, make the notes and flashcards, file them, delete the audio. */
export async function finishLecture(id = current?.id): Promise<{ ok: boolean; text: string; lectureId?: string; needsClass?: boolean; noteId?: string; studyId?: string; minutes?: string; title?: string; flashcards?: number; alerts?: number }> {
  if (!id) return { ok: false, text: "I wasn't listening to a class." };
  const m = current?.id === id ? current : readMeta(id);
  if (!m) return { ok: false, text: "I couldn't find that lecture." };
  if (current?.id === id) {
    current = null;
    if (awake !== null && powerSaveBlocker.isStarted(awake)) powerSaveBlocker.stop(awake);
    awake = null;
  }
  m.endedAt = m.endedAt ?? Date.now();
  writeMeta(m);
  await queue; // whatever's still being heard
  let missing = 0;
  for (let n = 0; n < m.chunks; n++) if (!(await transcribeChunk(id, n))) missing++;
  const transcript = Array.from({ length: m.chunks }, (_, n) => {
    try {
      return fs.readFileSync(path.join(dirOf(id), `chunk-${pad(n)}.txt`), "utf8").trim();
    } catch {
      return "";
    }
  })
    .filter(Boolean)
    .join("\n\n");
  const words = transcript.split(/\s+/).filter(Boolean).length;
  const length = minutesText(m.endedAt - m.startedAt);
  bb("lecture", "transcript", { chunks: m.chunks, missing, words });
  if (missing) return { ok: false, text: `I saved the whole class, but couldn't turn ${missing} part${missing > 1 ? "s" : ""} into text yet (no internet?). I'll finish it when I can.` };
  if (words < 40) {
    m.done = true;
    writeMeta(m);
    return { ok: false, text: "I barely heard anything in that class. Next time, sit closer or use AirPods." };
  }

  const r = await callTool<LectureNotes>(
    {
      model: models.smart(),
      max_tokens: 8000,
      system: `${persona()}\nTurn a class lecture transcript into excellent study notes for a college student. Be accurate: only what was actually said. Keep formulas and numbers exact.${m.course ? ` The class is ${m.course}.` : ""}`,
      tools: [NOTES_TOOL],
      tool_choice: { type: "auto" },
      messages: [{ role: "user", content: `Lecture transcript (${length}):\n\n${transcript.slice(0, 180000)}` }],
    },
    NOTES_TOOL.name
  );
  if (!r.ok) return { ok: false, text: `I have the full transcript, but couldn't make notes yet: ${r.text}` };
  const n = { ...r.data, sections: r.data.sections ?? [], key_terms: r.data.key_terms ?? [], exam_alerts: r.data.exam_alerts ?? [], flashcards: r.data.flashcards ?? [], questions: r.data.questions ?? [] };
  const date = new Date(m.startedAt).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const note = addNote({ title: `${n.title}${m.course ? "" : ""}`, course: m.course || "General", body: notesText(n, { course: m.course, date, length }, transcript) });
  const study = !n.flashcards.length
    ? null
    : saveItem({
      app: "study",
      title: `${n.title}: flashcards`,
      classId: m.classId,
      data: {
        title: `${n.title}: flashcards`,
        subject: m.course || "",
        say: "",
        items: n.flashcards.map((c, i) => ({ id: `${id}-${i}`, kind: "card", skill: n.title, prompt: c.q, answer: c.a, hint: "", steps: [], graph: null })),
      },
    });
  m.done = true;
  m.noteId = note.id;
  m.studyId = study?.id;
  writeMeta(m);
  // the audio's job is done: delete it (the transcript is in the note)
  if (!m.keepAudio) for (let i = 0; i < m.chunks; i++) fs.rmSync(path.join(dirOf(id), `chunk-${pad(i)}.wav`), { force: true });
  bb("lecture", "notes", { sections: n.sections.length, terms: n.key_terms.length, alerts: n.exam_alerts.length, cards: n.flashcards.length, words });
  return { ok: true, text: "", lectureId: id, needsClass: !m.classId, noteId: note.id, studyId: study?.id, minutes: length, title: n.title, flashcards: n.flashcards.length, alerts: n.exam_alerts.length };
}
/** "Which class was that?" -> "stats": file the notes and flashcards there, and remember the time slot for next week. */
export function fileLecture(lectureId: string, said: string): string | null {
  const m = readMeta(lectureId);
  const c = classNamed(said);
  if (!m || !c) return null;
  m.course = c.name;
  m.classId = c.id;
  writeMeta(m);
  if (m.noteId) setNoteCourse(m.noteId, c.name);
  if (m.studyId) moveItem(m.studyId, c.id);
  bb("lecture", "filed", {});
  return c.name;
}
/** Remove a lecture completely (tests clean up after themselves, so they don't teach the time-slot guess). */
export const removeLecture = (id: string) => fs.rmSync(dirOf(id), { recursive: true, force: true });
export const forgetLectureNote = (noteId: string) => removeNote(noteId);

/** At launch: a class that ended without notes (Milo quit, no internet) gets finished now. */
export async function finishLeftovers(): Promise<number> {
  let fixed = 0;
  try {
    for (const id of fs.readdirSync(root())) {
      const m = readMeta(id);
      if (!m || m.done || current?.id === id) continue;
      const r = await finishLecture(id).catch(() => null);
      if (r?.ok) fixed++;
    }
  } catch {
    /* no lectures yet */
  }
  if (fixed) bb("lecture", "leftovers_finished", { fixed });
  return fixed;
}
