// "What Milo did": a timeline of every real thing Milo did for the student, with Undo where it can be undone.
// This is the trust layer: testers only let Milo work alone if they can see (and take back) what he did.
// The core (makeActivity) is pure: storage and undo handlers are passed in, so it's easy to unit test.

export type ActKind = "calendar" | "email_draft" | "email_sent" | "doc" | "memory" | "job" | "app" | "web";
export type UndoSpec = { type: string; data: Record<string, unknown> };
export type ActEntry = {
  id: string;
  at: number;
  kind: ActKind;
  title: string; // "Added “Stats study group” to your calendar"
  detail?: string;
  link?: string;
  undo?: UndoSpec; // present = can be undone
  noUndo?: string; // why it can't be undone, in plain words
  undone?: number; // when it was undone
  undoError?: string;
};
export type UndoHandler = (data: Record<string, unknown>) => Promise<void>;
export type ActStore = { load: () => ActEntry[]; save: (all: ActEntry[]) => void };

const KEEP = 300;

export function makeActivity(store: ActStore, opts: { now?: () => number; onChange?: (all: ActEntry[]) => void } = {}) {
  const now = opts.now ?? Date.now;
  let entries: ActEntry[] | null = null;
  const handlers = new Map<string, UndoHandler>();
  const all = () => (entries ??= store.load().filter((e) => e && e.id && e.title));
  const changed = () => {
    entries = all().slice(0, KEEP);
    store.save(entries);
    opts.onChange?.(entries);
  };
  let n = 0;

  return {
    /** Log something Milo did. Returns its id (to update it later, e.g. a draft that got sent). */
    record(e: Omit<ActEntry, "id" | "at"> & { at?: number }): string {
      const id = `${now().toString(36)}-${(n++).toString(36)}`;
      all().unshift({ ...e, id, at: e.at ?? now() });
      changed();
      return id;
    },
    /** Change an entry (the draft was sent, so it can't be undone by deleting the draft anymore). */
    update(id: string, patch: Partial<Omit<ActEntry, "id">>) {
      const e = all().find((x) => x.id === id);
      if (!e) return;
      Object.assign(e, patch);
      changed();
    },
    list(limit = 100): ActEntry[] {
      return all().slice(0, limit);
    },
    /** Entries since a time (for "what did you do while I was gone?"). Oldest first. */
    since(t: number): ActEntry[] {
      return all().filter((e) => e.at >= t).reverse();
    },
    onUndo(type: string, fn: UndoHandler) {
      handlers.set(type, fn);
    },
    canUndo(e: ActEntry): boolean {
      return !!e.undo && !e.undone && handlers.has(e.undo.type);
    },
    async undo(id: string): Promise<{ ok: boolean; text: string }> {
      const e = all().find((x) => x.id === id);
      if (!e) return { ok: false, text: "I can't find that one anymore." };
      if (e.undone) return { ok: true, text: "That's already undone." };
      if (!e.undo) return { ok: false, text: e.noUndo || "That one can't be undone." };
      const h = handlers.get(e.undo.type);
      if (!h) return { ok: false, text: "That one can't be undone." };
      try {
        await h(e.undo.data);
        e.undone = now();
        delete e.undoError;
        changed();
        return { ok: true, text: `Undone: ${e.title}` };
      } catch (err) {
        e.undoError = (err as Error).message.slice(0, 160);
        changed();
        return { ok: false, text: `I couldn't undo that: ${e.undoError}` };
      }
    },
    /** "Undo that": the newest thing that can still be undone. */
    async undoLast(): Promise<{ ok: boolean; text: string }> {
      const e = all().find((x) => !!x.undo && !x.undone && handlers.has(x.undo.type));
      if (!e) return { ok: false, text: "There's nothing I can undo right now." };
      return this.undo(e.id);
    },
    clear() {
      entries = [];
      changed();
    },
  };
}
export type Activity = ReturnType<typeof makeActivity>;

/** One short spoken line for "what did you do?" (pure). */
export function sayActivity(list: ActEntry[], sinceLabel = "today"): string {
  const done = list.filter((e) => !e.undone);
  if (!done.length) return `I haven't done anything ${sinceLabel} yet.`;
  const top = done.slice(0, 3).map((e) => e.title.replace(/\.$/, ""));
  const more = done.length - top.length;
  return `${sinceLabel[0].toUpperCase()}${sinceLabel.slice(1)} I ${top.length === 1 ? "did one thing" : `did ${done.length} things`}: ${top.join("; ")}${more > 0 ? `, and ${more} more` : ""}. They're all in What I did, with Undo.`;
}
