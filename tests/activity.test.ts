import { describe, expect, it } from "vitest";
import { makeActivity, sayActivity, type ActEntry } from "../src/main/activity";

function mk() {
  let saved: ActEntry[] = [];
  let t = 1000;
  const a = makeActivity({ load: () => saved, save: (x) => (saved = JSON.parse(JSON.stringify(x))) }, { now: () => t++ });
  return { a, saved: () => saved };
}

describe("What Milo did", () => {
  it("records newest first and saves", () => {
    const { a, saved } = mk();
    a.record({ kind: "app", title: "Opened Spotify" });
    a.record({ kind: "calendar", title: "Added Study group" });
    expect(a.list().map((e) => e.title)).toEqual(["Added Study group", "Opened Spotify"]);
    expect(saved()).toHaveLength(2);
  });

  it("undoes with the right handler and marks it undone", async () => {
    const { a } = mk();
    const gone: string[] = [];
    a.onUndo("calendar_delete", async (d) => void gone.push(String(d.id)));
    const id = a.record({ kind: "calendar", title: "Added X", undo: { type: "calendar_delete", data: { id: "ev1" } } });
    const r = await a.undo(id);
    expect(r.ok).toBe(true);
    expect(gone).toEqual(["ev1"]);
    expect(a.list()[0].undone).toBeTruthy();
    expect((await a.undo(id)).text).toMatch(/already/);
    expect(gone).toEqual(["ev1"]); // never runs twice
  });

  it("explains why something can't be undone", async () => {
    const { a } = mk();
    const id = a.record({ kind: "email_sent", title: "Sent an email", noUndo: "Sent emails can't be unsent." });
    expect(await a.undo(id)).toEqual({ ok: false, text: "Sent emails can't be unsent." });
  });

  it("keeps the entry when undo fails, with the reason", async () => {
    const { a } = mk();
    a.onUndo("draft_delete", async () => {
      throw new Error("Google said 500");
    });
    const id = a.record({ kind: "email_draft", title: "Wrote an email", undo: { type: "draft_delete", data: { draftId: "d" } } });
    const r = await a.undo(id);
    expect(r.ok).toBe(false);
    expect(a.list()[0].undone).toBeUndefined();
    expect(a.list()[0].undoError).toMatch(/500/);
  });

  it("undo last skips things that can't be undone", async () => {
    const { a } = mk();
    const undone: string[] = [];
    a.onUndo("memory_forget", async (d) => void undone.push(String(d.fact)));
    a.record({ kind: "memory", title: "Learned: likes stats", undo: { type: "memory_forget", data: { fact: "likes stats" } } });
    a.record({ kind: "job", title: "Did: fill the form", noUndo: "web" });
    expect((await a.undoLast()).ok).toBe(true);
    expect(undone).toEqual(["likes stats"]);
    expect((await a.undoLast()).ok).toBe(false);
  });

  it("a sent draft loses its undo", async () => {
    const { a } = mk();
    a.onUndo("draft_delete", async () => {});
    const id = a.record({ kind: "email_draft", title: "Wrote an email", undo: { type: "draft_delete", data: { draftId: "d" } } });
    a.update(id, { kind: "email_sent", undo: undefined, noUndo: "Sent emails can't be unsent." });
    expect(a.canUndo(a.list()[0])).toBe(false);
  });

  it("says it simply", () => {
    expect(sayActivity([])).toMatch(/haven't done anything/);
    const e = (title: string): ActEntry => ({ id: title, at: 1, kind: "app", title });
    expect(sayActivity([e("Opened Spotify")])).toBe("Today I did one thing: Opened Spotify. They're all in What I did, with Undo.");
    expect(sayActivity([e("a"), e("b"), e("c"), e("d")])).toMatch(/did 4 things: a; b; c, and 1 more/);
  });
});
