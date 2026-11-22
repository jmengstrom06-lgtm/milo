// What Milo remembers about the student: classes, goals, what they find hard, how they like to learn.
// Saved on the Mac always, and synced to their account when signed in (so it follows them to a new Mac).
// Facts are pulled out of conversations by the fast model in the background, a few turns at a time.

import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { rest, userId } from "./account";
import { log as bb } from "./blackbox";
import type { ChatMessage } from "./brain";

const MAX = 40;
let facts: string[] | null = null;
const file = () => path.join(app.getPath("userData"), "memories.json");

function loadLocal(): string[] {
  if (facts) return facts;
  try {
    facts = (JSON.parse(fs.readFileSync(file(), "utf8")) as string[]).filter((f) => typeof f === "string");
  } catch {
    facts = [];
  }
  return facts;
}
function saveLocal() {
  try {
    fs.writeFileSync(file(), JSON.stringify(facts ?? []), { mode: 0o600 });
  } catch {
    /* disk full or similar: memory is best effort */
  }
}

/** Pull the account's memories down (call after sign-in and at launch). */
export async function syncMemories() {
  if (!userId()) return;
  const rows = (await rest("memories?select=fact&order=created_at.desc&limit=60")) as { fact: string }[] | null;
  if (!rows) return;
  const merged = [...new Set([...rows.map((r) => r.fact), ...loadLocal()])].slice(0, MAX);
  facts = merged;
  saveLocal();
  bb("memory", "synced", { count: merged.length });
}

export function memories(): string[] {
  return loadLocal().slice(0, MAX);
}

/** A short block for the system prompt. Empty when Milo doesn't know anything yet. */
export function memoryPrompt(): string {
  const m = memories().slice(0, 20);
  if (!m.length) return "";
  return `\nWhat you remember about this student (use it naturally when it helps, never recite it):\n- ${m.join("\n- ")}`;
}

/** Told when Milo learns something new (the timeline logs it, with Undo). */
let onLearn: ((fact: string, how: "asked" | "learned") => void) | null = null;
export const onRemember = (fn: typeof onLearn) => (onLearn = fn);

export async function remember(fact: string, how: "asked" | "learned" = "asked") {
  const f = fact.trim().replace(/\s+/g, " ").slice(0, 300);
  if (!f) return;
  const all = loadLocal();
  if (all.some((x) => x.toLowerCase() === f.toLowerCase())) return;
  onLearn?.(f, how);
  facts = [f, ...all].slice(0, MAX);
  saveLocal();
  if (userId()) await rest("memories", { method: "POST", body: { fact: f }, prefer: "return=minimal" });
}

/** Forget one fact (Undo for something Milo learned). */
export async function forget(fact: string) {
  const f = fact.trim().toLowerCase();
  facts = loadLocal().filter((x) => x.toLowerCase() !== f);
  saveLocal();
  if (userId()) await rest(`memories?fact=eq.${encodeURIComponent(fact.trim())}`, { method: "DELETE" });
}

export async function forgetAll() {
  facts = [];
  saveLocal();
  const uid = userId();
  if (uid) await rest(`memories?user_id=eq.${uid}`, { method: "DELETE" });
}

// ---- learning from chats ----------------------------------------------------------------

let turnsSince = 0;
let learning = false;

/**
 * Every few turns, ask the fast model what's worth remembering. Runs in the background;
 * never slows down a reply. `extract` is passed in to avoid a circular import with brain.ts.
 */
export function noteTurn(history: ChatMessage[], extract: (chat: string, known: string[]) => Promise<string[]>) {
  if (++turnsSince < 4 || learning || process.env.MILO_NO_MEMORY === "1") return;
  turnsSince = 0;
  learning = true;
  const chat = history
    .slice(-10)
    .map((m) => `${m.role === "user" ? "Student" : "Milo"}: ${m.content}`)
    .join("\n")
    .slice(-6000);
  extract(chat, memories())
    .then(async (found) => {
      for (const f of found.slice(0, 5)) await remember(f, "learned");
      if (found.length) bb("memory", "learned", { count: found.length });
    })
    .catch((e) => bb("memory", "learn_failed", { error: (e as Error).message }))
    .finally(() => (learning = false));
}
