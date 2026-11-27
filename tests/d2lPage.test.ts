// Jake's log, Nov 27: Chrome's extension wasn't connected, so Milo read D2L through his own hidden page.
// One class had no final grade yet (D2L answers 404), Milo treated that as "sign-in trouble" and reopened the
// hidden page, killing it under the other classes' requests, so Home's grades never came back.
import { describe, it, expect, vi, beforeEach } from "vitest";

const pages: FakeWin[] = [];
class FakeWin {
  destroyed = false;
  webContents = {
    setAudioMuted: () => {},
    loadURL: async () => {},
    getURL: () => "https://tcu.brightspace.com/d2l/home",
    getTitle: () => "Homepage",
    isLoading: () => false,
    executeJavaScript: async (js: string) => {
      if (this.destroyed) return new Promise(() => {}); // a destroyed page never answers
      await new Promise((r) => setTimeout(r, 30));
      if (/whoami/.test(js) && /then\(\(r\) => r\.status\)/.test(js)) return 200;
      const url = js.match(/fetch\("([^"]+)"/)?.[1] ?? "";
      if (/final\/values\/myGradeValue/.test(url) && /\/111\//.test(url)) return { s: 404, t: "text/html", b: "<html>", at: "tcu" };
      if (/final\/values\/myGradeValue/.test(url)) return { s: 200, t: "application/json", b: JSON.stringify({ DisplayedGrade: "91.5 %" }), at: "tcu" };
      if (/\/grades\/categories\//.test(url)) return { s: 200, t: "application/json", b: "[]", at: "tcu" };
      if (/\/grades\/values\/myGradeValues\//.test(url)) return { s: 200, t: "application/json", b: JSON.stringify([{ GradeObjectIdentifier: "1", PointsNumerator: 9, PointsDenominator: 10 }]), at: "tcu" };
      if (/\/grades\/$/.test(url)) return { s: 200, t: "application/json", b: JSON.stringify([{ Id: 1, Name: "HW", Weight: 100, MaxPoints: 10, CategoryId: 0 }]), at: "tcu" };
      return { s: 200, t: "application/json", b: "{}", at: "tcu" };
    },
  };
  constructor() {
    pages.push(this);
  }
  loadURL = async () => {};
  isDestroyed() {
    return this.destroyed;
  }
  destroy() {
    this.destroyed = true;
  }
}
vi.mock("electron", () => ({ BrowserWindow: FakeWin, app: { getPath: () => "/tmp", on: () => {} }, session: { fromPartition: () => ({ cookies: { flushStore: async () => {} } }) } }));
vi.mock("../src/main/bridge", () => ({ bridgeConnected: () => false, call: async () => null }));
vi.mock("../src/main/blackbox", () => ({ log: () => {} }));

describe("reading D2L through Milo's own page (Chrome closed)", () => {
  beforeEach(() => void (pages.length = 0));
  it("a class with no final grade doesn't break the other classes", async () => {
    const { gradeSheet } = await import("../src/main/d2l");
    const C = (id: number) => ({ id, name: `Class ${id}`, short: `Class ${id}`, code: "", subject: "" });
    const t0 = Date.now();
    const out = await Promise.all([111, 222, 333, 444, 555].map((id) => gradeSheet("https://tcu.brightspace.com/d2l/home", C(id)).catch((e) => `error ${e.message}`)));
    // every class answered, fast (no 5-second wait for Chrome per request, no hang)
    expect(Date.now() - t0).toBeLessThan(15000);
    expect(out.slice(1).map((x) => (typeof x === "object" && x ? x.sheet.current_percent : x))).toEqual([91.5, 91.5, 91.5, 91.5]);
    expect(typeof out[0] === "object" && out[0]?.sheet.current_percent).toBeNull(); // no final grade: null, not an error
    expect(pages.length).toBe(1); // the 404 didn't reopen (and kill) the page
    expect(pages[0].destroyed).toBe(false);
  }, 30000);
});
