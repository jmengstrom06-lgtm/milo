// Instant computer commands (no AI): the right thing, every time.
import { describe, expect, it } from "vitest";
import { plan } from "../src/main/quick";

const first = (t: string) => plan(t)?.steps?.[0] as Record<string, unknown> | undefined;

describe("quick plan", () => {
  it("Milo's own apps are never launched as Mac apps or Google sites", () => {
    for (const t of ["open sheets", "open up sheets", "open the sheet", "open a new sheet", "open your notes", "open your sketch pad", "open study", "open planner"]) {
      expect(plan(t)?.steps ?? [], t).toHaveLength(0);
    }
  });
  it("Google products only when named", () => {
    expect(first("open google sheets")?.url).toContain("docs.google.com/spreadsheets");
    expect(first("open a new google sheet")?.url).toBe("https://sheets.new");
    expect(first("open google docs")?.url).toContain("docs.google.com/document");
  });
  it("sites and apps", () => {
    expect(first("open youtube")?.url).toContain("youtube.com");
    expect(String(first("could you please open youtube for me")?.url)).toContain("youtube.com");
  });
});

// Real failures from Nov 20: long, natural ways of saying "quit Chrome" must quit it natively.
describe("quit the whole app, however it's said", () => {
  const quit = (t: string) => plan(t).steps[0];
  it.each([
    "I meant, like, my... like, I want you to close the entire Chrome application open.",
    "No. Milo, I want you to close the entire Chrome with the... both the tabs open. Get it off my screen.",
    "close chrome completely",
    "quit the whole chrome app",
    "get chrome off my screen",
    "close both tabs and the entire chrome",
  ])("%s", (t) => expect(quit(t)).toMatchObject({ kind: "quit", app: "Google Chrome" }));
  it("still leaves tab-only requests to the tab logic", () => {
    expect(quit("close this tab")).toMatchObject({ kind: "keys", keys: "cmd+w" });
  });
});

describe("quit any app, not just the known ones", () => {
  const quit = (t: string) => plan(t).steps[0];
  it.each([
    ["close the entire calculator application", "Calculator"],
    ["I meant, like, I want you to close the whole calculator app", "Calculator"],
    ["No. Milo, close the entire calculator. Get it off my screen.", "Calculator"],
    ["get dictionary off my screen", "Dictionary"],
  ])("%s", (t, app) => expect(quit(t)).toMatchObject({ kind: "quit", app }));
  it("never quits 'the whole thing' or a tab", () => {
    expect(quit("close the whole thing")?.kind).not.toBe("quit");
    expect(quit("close all the tabs")?.kind).not.toBe("quit");
  });
});
