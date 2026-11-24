import { describe, expect, it } from "vitest";
import { checklist, checkupLine, problems, type Probe } from "../src/main/checkup";

const good: Probe = {
  devKey: false,
  signedIn: true,
  aiServer: true,
  portal: "d2l.tcu.edu",
  d2l: { ok: true, signin: false },
  google: { ready: true, connected: true, works: true, reconnect: false },
  chrome: { running: true, extension: true },
  perms: { screen: true, hands: true, mic: true },
};
const by = (p: Probe, id: string) => checklist(p).find((i) => i.id === id)!;

describe("checkup", () => {
  it("all green when everything works", () => {
    const items = checklist(good);
    expect(items.every((i) => i.ok === true)).toBe(true);
    expect(problems(items)).toEqual([]);
    expect(items.some((i) => i.fix)).toBe(false);
  });

  it("expired D2L sign-in offers a sign-in fix", () => {
    const i = by({ ...good, d2l: { ok: false, signin: true } }, "d2l");
    expect(i.ok).toBe(false);
    expect(i.fix?.kind).toBe("d2l");
  });

  it("D2L unreachable (not a sign-in issue) offers retry", () => {
    expect(by({ ...good, d2l: { ok: false, signin: false } }, "d2l").fix?.kind).toBe("retry");
  });

  it("no portal is optional, not broken", () => {
    const i = by({ ...good, portal: "", d2l: null }, "d2l");
    expect(i.ok).toBeNull();
    expect(i.fix?.kind).toBe("d2l");
  });

  it("revoked Google says reconnect", () => {
    const i = by({ ...good, google: { ready: true, connected: true, works: false, reconnect: true } }, "google");
    expect(i.ok).toBe(false);
    expect(i.fix).toEqual({ kind: "google", label: "Reconnect Google" });
  });

  it("Google not connected is optional", () => {
    expect(by({ ...good, google: { ready: true, connected: false, works: null, reconnect: false } }, "google").ok).toBeNull();
  });

  it("signed out breaks the brain and account", () => {
    const items = checklist({ ...good, signedIn: false, aiServer: null });
    expect(problems(items).map((i) => i.id)).toEqual(["ai", "account"]);
  });

  it("developer key counts as a working brain even signed out", () => {
    expect(by({ ...good, devKey: true, signedIn: false, aiServer: null }, "ai").ok).toBe(true);
  });

  it("offline server says check wifi", () => {
    expect(by({ ...good, aiServer: null }, "ai").detail).toMatch(/wifi/);
  });

  it("Chrome open without helper is broken; Chrome closed is not", () => {
    expect(by({ ...good, chrome: { running: true, extension: false } }, "chrome").ok).toBe(false);
    expect(by({ ...good, chrome: { running: false, extension: false } }, "chrome").ok).toBeNull();
  });

  it("permissions off offer turn-on fixes, most important first", () => {
    const items = checklist({ ...good, perms: { screen: false, hands: false, mic: false } });
    expect(problems(items).map((i) => i.id)).toEqual(["screen", "hands", "mic"]);
    expect(problems(items)[0].fix?.kind).toBe("screen");
  });

  it("frog only speaks about newly broken things", () => {
    const items = checklist({ ...good, d2l: { ok: false, signin: true } });
    expect(checkupLine(items, [])).toMatch(/D2L/);
    expect(checkupLine(items, ["d2l"])).toBe("");
    expect(checkupLine(checklist(good), [])).toBe("");
  });

  it("counts multiple fresh problems", () => {
    const items = checklist({ ...good, perms: { screen: false, hands: true, mic: false } });
    expect(checkupLine(items, [])).toMatch(/2 things/);
  });

  it("paused is the first problem, with a turn-on fix", () => {
    const items = checklist({ ...good, paused: true });
    expect(problems(items)[0]).toMatchObject({ id: "paused", fix: { kind: "unpause" } });
  });

  it("Chrome running with no windows isn't a problem", () => {
    expect(by({ ...good, chrome: { running: true, extension: false, windows: 0 } }, "chrome").ok).toBeNull();
    expect(by({ ...good, chrome: { running: true, extension: false, windows: 2 } }, "chrome").ok).toBe(false);
  });
});
