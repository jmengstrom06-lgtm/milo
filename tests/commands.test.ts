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
