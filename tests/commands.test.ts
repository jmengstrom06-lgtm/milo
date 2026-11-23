import { describe, expect, it } from "vitest";
import { isBareGo, parse, soundsUnfinished } from "../src/renderer/commands";

describe("go words", () => {
  it.each(["go", "Go.", "go ahead", "okay go", "do it", "send it", "let's go"])("%s", (t) => expect(isBareGo(t)).toBe(true));
  it("not go", () => expect(isBareGo("go to the bottom left")).toBe(false));
});
describe("unfinished sentences", () => {
  it("dangling words", () => {
    expect(soundsUnfinished("open chrome and")).toBe(true);
    expect(soundsUnfinished("open chrome and find the TCU game")).toBe(false);
  });
});

// Real failure from Nov 20: a long sentence that starts with "No." is a new command, not "no, don't".
describe("yes/no only when that's the whole answer", () => {
  const ctx = { inLesson: false, awaitingAnswer: false, pendingAsk: true };
  it("bare answers", () => {
    expect(parse("no", ctx).kind).toBe("no");
    expect(parse("nope, don't", ctx).kind).toBe("no");
    expect(parse("yes go ahead", ctx).kind).toBe("yes");
  });
  it("a new command is not a no", () => {
    expect(parse("No. Milo, I want you to close the entire Chrome with the both tabs open. Get it off my screen.", ctx).kind).not.toBe("no");
  });
});

describe("what Milo did + undo", () => {
  const ctx = { inLesson: false, awaitingAnswer: false, pendingAsk: false };
  it.each(["undo", "undo that", "Undo that.", "take that back", "undo the last thing"])("%s = undo", (t) => expect(parse(t, ctx).kind).toBe("undo"));
  it.each(["open home", "open my home base", "show me the dashboard", "pull up home base", "home base"])("%s = home", (t) => expect(parse(t, ctx).kind).toBe("home"));
  it.each(["what's next", "What's next?", "fix my week", "get my week under control", "I'm behind", "plan my week", "get me back on track", "what should I work on now"])("%s = week", (t) => expect(parse(t, ctx).kind).toBe("week"));
  it.each(["what's next on the syllabus for bio", "next slide"])("%s is not the week planner", (t) => expect(parse(t, ctx).kind).not.toBe("week"));
  it.each(["what did you do", "what did you do while I was gone", "show me what you did", "what happened while I was away"])("%s = activity", (t) =>
    expect(parse(t, ctx).kind).toBe("activity")
  );
  it("not undo", () => expect(parse("undo the formatting in my doc", ctx).kind).not.toBe("undo"));
});

describe("feedback", () => {
  const ctx = { inLesson: false, awaitingAnswer: false, pendingAsk: false };
  it("opens with their words", () => expect(parse("tell Jake that the calendar added the wrong day", ctx)).toEqual({ kind: "feedback", text: "the calendar added the wrong day" }));
  it("bare", () => expect(parse("report a bug", ctx)).toEqual({ kind: "feedback", text: "" }));
});

import { stripGo } from "../src/renderer/commands";
describe("go words never eat the meaning", () => {
  it("class is over stays", () => expect(stripGo("Class is over")).toBe("Class is over"));
  it("lecture's over stays", () => expect(stripGo("the lecture's over")).toBe("the lecture's over"));
  it("radio-style over still goes", () => expect(stripGo("open chrome over")).toBe("open chrome"));
});

describe("handle this", () => {
  const c = { inLesson: false, awaitingAnswer: false, pendingAsk: false };
  it.each(["handle this", "Milo, handle this", "help me with this", "help with this", "what can you do here", "take care of this", "what do I do here"])("%s = handle", (t) => expect(parse(t, c).kind).toBe("handle"));
  it.each(["help me with my stats homework", "handle this email to my professor by saying no"])("%s is specific, not handle", (t) => expect(parse(t, c).kind).not.toBe("handle"));
});

describe("check this", () => {
  const c = { inLesson: false, awaitingAnswer: false, pendingAsk: false };
  it.each(["check this", "Milo, check this", "check this before I submit", "check my essay against the rubric", "preflight", "does this meet the rubric"])("%s = checkwork", (t) => expect(parse(t, c).kind).toBe("checkwork"));
});
