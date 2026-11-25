import { describe, it, expect } from "vitest";
import { parseTabs, pickDoc, tabScript, type DocTab } from "../src/main/findDoc";

const D = (id: string, title: string, o: Partial<DocTab> = {}): DocTab => ({ id, title, browser: "Google Chrome", frontWindow: false, active: false, ...o });
const ID1 = "1hYLwIQORMFQzn2dmJ8y0xRhnZY_pIM4_aNEIKKCLPYo";

describe("finding the paper", () => {
  it("reads every tab line from the browser", () => {
    const out = `1\ttrue\thttps://docs.google.com/document/d/${ID1}/edit\tMilo Test Paper - Should College Students Work Part-Time - Google Docs\n2\tfalse\thttps://docs.google.com/document/d/abcdefghijklmnopqrstuvwxyz1234/edit\tBio Lab Report - Google Docs\n`;
    const t = parseTabs("Google Chrome", out);
    expect(t.length).toBe(2);
    expect(t[0]).toMatchObject({ id: ID1, title: "Milo Test Paper - Should College Students Work Part-Time", frontWindow: true, active: true });
  });
  it("never launches a browser that isn't open", () => expect(tabScript("Safari")).toMatch(/if \(!a.running\(\)\) return ""/));
  it("one doc open = that one, wherever it is", () => expect(pickDoc([D("a", "Essay", { browser: "Safari" })], "edit my paper").pick?.id).toBe("a"));
  it("the one they named wins", () => {
    const r = pickDoc([D("a", "Bio Lab Report", { active: true, frontWindow: true }), D("b", "Milo Test Paper - Should College Students Work")], "I have a Google Doc paper open, it's a Milo test paper, fix grammar");
    expect(r.pick?.id).toBe("b");
  });
  it("nothing named = the tab in front", () => expect(pickDoc([D("a", "Lab Report"), D("b", "History Essay", { active: true, frontWindow: true })], "edit my paper").pick?.id).toBe("b"));
  it("a doc in front in Safari AND Chrome: the browser you were last in wins", () => {
    const tabs = [D("a", "Milo test 5:37", { active: true, frontWindow: true, browser: "Safari" }), D("b", "Milo test 5:37", { active: true, frontWindow: true })];
    expect(pickDoc(tabs, "look through my essay", ["Milo", "Google Chrome", "Safari", "Finder"]).pick?.id).toBe("b");
    expect(pickDoc(tabs, "look through my essay", ["Safari", "Google Chrome"]).pick?.id).toBe("a");
  });
  it("two browsers, no idea which is in front = asks", () => {
    const r = pickDoc([D("a", "Lab Report", { active: true, frontWindow: true, browser: "Safari" }), D("b", "History Essay", { active: true, frontWindow: true })], "edit my paper");
    expect(r.pick).toBeNull();
    expect(r.choices.length).toBe(2);
  });
  it("two background docs, nothing named = asks", () => {
    const r = pickDoc([D("a", "Lab Report"), D("b", "History Essay")], "edit my paper");
    expect(r.pick).toBeNull();
    expect(r.choices.length).toBe(2);
  });
  it("the same doc in two tabs counts once", () => expect(pickDoc([D("a", "Essay"), D("a", "Essay", { browser: "Safari" })], "").pick?.id).toBe("a"));
});

describe("the browser script really runs", () => {
  const fake = (running: boolean) => () => ({
    running: () => running,
    windows: () => [
      { activeTabIndex: () => 2, currentTab: () => ({ index: () => 2 }), tabs: () => [
        { url: () => "https://example.com", title: () => "x", name: () => "x" },
        { url: () => `https://docs.google.com/document/d/${ID1}/edit`, title: () => "Milo Test Paper - Google Docs", name: () => "Milo Test Paper - Google Docs" },
      ] },
    ],
  });
  for (const b of ["Google Chrome", "Safari"]) {
    it(b, () => {
      // eslint-disable-next-line no-new-func
      const out = new Function("Application", `return ${tabScript(b)}`)(fake(true)) as string;
      expect(parseTabs(b, out)).toEqual([{ id: ID1, title: "Milo Test Paper", browser: b, frontWindow: true, active: true }]);
      expect(new Function("Application", `return ${tabScript(b)}`)(fake(false))).toBe("");
      expect(new Function("Application", `return ${tabScript(b)}`)(() => { throw new Error("not installed"); })).toBe("");
    });
  }
});
