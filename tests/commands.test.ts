import { describe, expect, it } from "vitest";
import { isBareGo, soundsUnfinished } from "../src/renderer/commands";

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
