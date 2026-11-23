import { describe, expect, it, vi } from "vitest";
const started: string[] = [];
vi.mock("electron", () => ({
  Notification: Object.assign(class { show() { started.push("shown"); } on() {} }, { isSupported: () => true }),
  powerMonitor: { getSystemIdleTime: () => 300 },
  powerSaveBlocker: { start: (k: string) => (started.push("awake:" + k), 7), stop: () => started.push("asleep-ok") },
}));
vi.mock("../src/main/blackbox", () => ({ log: () => {} }));
// Notification settings: on, no quiet hours, so the test passes at any time of day.
vi.mock("../src/main/prefs", () => ({ prefs: () => ({ notifyAway: true, quiet: false, quietFrom: 23, quietTo: 8 }), inQuiet: () => false }));
import { awayWatch, notice } from "../src/main/away";
const job = (status: string, extra = {}) => ({ id: "j1", goal: "Fill out the survey", steps: [], status, createdAt: 0, updatedAt: 0, replans: 0, approved: false, actions: 0, ...extra }) as never;

describe("away mode", () => {
  it("keeps the Mac awake while working, lets it sleep after", () => {
    awayWatch(job("running"), () => {});
    expect(started).toContain("awake:prevent-app-suspension");
    awayWatch(job("done", { summary: "All 4 pages done." }), () => {});
    expect(started).toContain("asleep-ok");
    expect(started).toContain("shown"); // you were away 5 minutes: notified
  });
  it("says the right thing", () => {
    expect(notice(job("done", { summary: "Order placed." }))).toEqual({ title: "Milo finished", body: "Order placed." });
    expect(notice(job("needs_you", { question: "Submit it?" }))?.title).toBe("Milo needs your OK");
    expect(notice(job("running"))).toBeNull();
  });
});
