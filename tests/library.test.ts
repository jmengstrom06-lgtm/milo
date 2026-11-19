import { describe, it, expect, vi, beforeEach } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "milo-lib-"));
vi.mock("electron", () => ({ app: { getPath: () => dir }, ipcMain: { handle: () => {} } }));

import { matchClass, parseBrowse, noteInClass } from "../src/renderer/kit/Library";
import * as lib from "../src/main/library";

const classes = [
  { id: "m", name: "Calculus I", code: "MATH 1324", subject: "math", color: "#f00" },
  { id: "b", name: "Intro Biology", code: "BIOL 1305", subject: "science", color: "#0f0" },
  { id: "e", name: "English Composition", code: "ENGL 1301", subject: "english", color: "#00f" },
  { id: "s", name: "Statistics", code: "STAT 2023", subject: "stats", color: "#ff0" },
] as any;

describe("matchClass", () => {
  it("finds by code, name, word and subject", () => {
    expect(matchClass("save this to math 1324", classes)?.id).toBe("m");
    expect(matchClass("put it in calculus i", classes)?.id).toBe("m");
    expect(matchClass("move it to my bio class", classes)?.id).toBe("b");
    expect(matchClass("show my english folder", classes)?.id).toBe("e");
    expect(matchClass("what did I save for stats", classes)?.id).toBe("s");
    expect(matchClass("open my math sketches", classes)?.id).toBe("m");
  });
  it("returns null when no class is named", () => {
    expect(matchClass("draw a cell", classes)).toBeNull();
  });
});

describe("parseBrowse", () => {
  it("spots browse requests", () => {
    expect(parseBrowse("show my math sketches")).toEqual({ filter: "sketch", latest: false });
    expect(parseBrowse("open my bio folder")?.filter).toBe("all");
    expect(parseBrowse("what did I save for stats")).not.toBeNull();
    expect(parseBrowse("open my last drawing")).toEqual({ filter: "sketch", latest: true });
    expect(parseBrowse("show me my flashcards")?.filter).toBe("study");
  });
  it("ignores make requests", () => {
    expect(parseBrowse("draw a plant cell")).toBeNull();
    expect(parseBrowse("make a table of the planets")).toBeNull();
    expect(parseBrowse("graph y = x^2")).toBeNull();
  });
});

describe("noteInClass", () => {
  it("matches course names", () => {
    expect(noteInClass({ course: "Calculus I" } as any, classes[0])).toBe(true);
    expect(noteInClass({ course: "MATH 1324" } as any, classes[0])).toBe(true);
    expect(noteInClass({ course: "Biology" } as any, classes[0])).toBe(false);
  });
});

describe("library storage", () => {
  it("saves, updates, moves, lists and deletes", () => {
    const a = lib.saveItem({ app: "sketch", title: "Cell", data: { svg: "<svg/>" }, classId: "b" })!;
    const b = lib.saveItem({ app: "sheet", title: "Data", data: { rows: [] }, classId: "m" })!;
    expect(lib.listItems({ classId: "b" }).map((x) => x.id)).toEqual([a.id]);
    lib.saveItem({ id: a.id, app: "sketch", title: "Plant cell", data: {} });
    expect(lib.listItems({ classId: "b" })[0].title).toBe("Plant cell");
    expect(lib.listItems({ classId: "b" })[0].classId).toBe("b");
    lib.moveItem(a.id, "m");
    expect(lib.listItems({ classId: "m" }).length).toBe(2);
    expect(lib.listItems({ classId: "all", app: "sheet" }).map((x) => x.id)).toEqual([b.id]);
    lib.unfileMissing(["b"]);
    expect(lib.listItems({ classId: null as any }).length).toBe(2);
    lib.deleteItem(a.id);
    expect(lib.listItems({ classId: "all" }).length).toBe(1);
  });
});
