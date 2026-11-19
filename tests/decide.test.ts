// Every instant decision Milo makes without his brain. Rule: only WHOLE short commands match.
// Each real bug Jake hit is a test here, so it can't come back.
import { describe, expect, it } from "vitest";
import { fastDecide, stripFiller, type DecideState } from "../src/renderer/decide";

const NOTHING: DecideState = { kitOpen: null, researchOpen: false, toolOpen: false, lessonOpen: false, hasLastAnswer: false };
const SHEET: DecideState = { ...NOTHING, kitOpen: "sheet" };
const STUDY: DecideState = { ...NOTHING, kitOpen: "study" };
const RESEARCH: DecideState = { ...NOTHING, researchOpen: true };
const d = (t: string, s = NOTHING) => fastDecide(t, s);

describe("real bugs (from the logs) never come back", () => {
  it("'close that tab with the histogram' with the Sheet open goes to the brain, NOT Chrome", () => {
    expect(d("Milo, would you close that tab with the histogram on it for me?", SHEET)).toBeNull();
    expect(d("close the tab with the histogram on it and close the Chrome tab.", SHEET)).toBeNull();
  });
  it("'Uh, can you close that now and open up your notes...' closes the Sheet, then does the rest", () => {
    expect(d("Uh, can you close that now and open up your notes and then make a note that I have a flight", SHEET)).toEqual({
      do: "close_own",
      then: "open up your notes and then make a note that i have a flight",
    });
  });
  it("'close that Chrome browser. I meant one of the things you can do...' closes Chrome, then the rest", () => {
    const f = d("close that Chrome browser. I meant one of the things you can do for me. Like, open up the sheets", STUDY);
    expect(f?.do).toBe("close_chrome_then");
  });
  it("a long 'close…' sentence with an app open is never swallowed", () => {
    expect(d("close that Chrome browser and open my sheets", STUDY)).toBeNull();
  });
  it("'open up Sheets' = Milo's Sheet, never Google Sheets", () => {
    expect(d("open up Sheets.", STUDY)).toEqual({ do: "open_kit", app: "sheet" });
    expect(d("open sheets")).toEqual({ do: "open_kit", app: "sheet" });
    expect(d("open google sheets")).toBeNull();
  });
});

describe("filler", () => {
  it.each([
    ["Uh, cool, close that", "close that"],
    ["Okay, so, um, open sheets", "open sheets"],
    ["Milo, next", "next"],
    ["so what's the weather", "what's the weather"],
  ])("%s", (a, b) => expect(stripFiller(a)).toBe(b));
  it("doesn't eat real words", () => expect(stripFiller("solve this")).toBe("solve this"));
});

describe("Milo's own things", () => {
  it.each(["close that", "close it", "close the sheet", "cool, close the sheet", "get rid of this", "close this tab", "done", "thanks"])("%s closes the open app", (t) =>
    expect(d(t, SHEET)?.do).toBe("close_own")
  );
  it("close + then", () => expect(d("close the sheet and then open notes", SHEET)).toEqual({ do: "close_own", then: "open notes" }));
  it("research box: 'close this tab' is the box", () => expect(d("close this tab", RESEARCH)?.do).toBe("close_own"));
  it("resize", () => {
    expect(d("make it full screen", SHEET)).toEqual({ do: "resize", size: "full" });
    expect(d("smaller", SHEET)).toEqual({ do: "resize", size: "compact" });
  });
  it("'close chrome' with an app open is NOT Milo's app", () => expect(d("close chrome", SHEET)).toBeNull());
});

describe("computer shortcuts only when the whole command is one", () => {
  it.each(["copy", "paste that", "undo", "select all", "close this tab", "close the window", "new tab", "open a new chrome tab", "next tab", "zoom in", "refresh", "go back", "scroll down", "quit spotify"])(
    "%s",
    (t) => expect(d(t)?.do).toBe("shortcut")
  );
  it.each([
    "close that tab with the histogram on it",
    "copy the story and paste it into my notes",
    "make a note that my bio exam is friday",
    "new tab and search for tcu basketball",
    "save that to my notes",
    "go back to the sheet",
  ])("%s -> brain", (t) => expect(d(t)?.do === "shortcut").toBe(false));
  it("no shortcuts during a homework lesson", () => expect(d("copy", { ...NOTHING, lessonOpen: true })).toBeNull());
});

describe("kit instants", () => {
  it("menu, classes, pocket", () => {
    expect(d("what can you do?")?.do).toBe("kit_menu");
    expect(d("my classes are stats, english and bio")).toEqual({ do: "classes", text: "stats, english and bio" });
    expect(d("hold this")?.do).toBe("hold");
    expect(d("drop it in ChatGPT")).toEqual({ do: "drop", target: "chatgpt" });
    expect(d("save that to my notes")).toBeNull(); // nothing to save yet
    expect(d("save that to my notes", { ...NOTHING, hasLastAnswer: true })?.do).toBe("save_notes");
  });
  it.each([
    ["open notes", "notes"],
    ["open your sketch pad", "sketch"],
    ["pull up the planner", "planner"],
    ["open excel", "sheet"],
    ["open the spreadsheet", "sheet"],
  ])("%s", (t, app) => expect(d(t)).toEqual({ do: "open_kit", app }));
});

describe("misheard commands", () => {
  it.each([
    ["Milo closed the message tab.", "close the message tab."],
    ["Milo, closed messages", "close messages"],
    ["opened sketch", "open sketch"],
  ])("%s", (a, b) => expect(stripFiller(a)).toBe(b));
  it("leaves normal sentences alone", () => {
    expect(stripFiller("the store closed early")).toBe("the store closed early");
    expect(stripFiller("I opened it already")).toBe("I opened it already");
  });
});
