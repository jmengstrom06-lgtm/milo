import { describe, expect, it } from "vitest";
import { judge, parseLockIn, planBlocks } from "../src/main/focusRules";

describe("lock-in: what counts as a distraction", () => {
  it("flags time-sink sites in any browser", () => {
    expect(judge("Google Chrome", "https://www.tiktok.com/@someone", "TikTok")).toEqual({ status: "distracted", label: "TikTok" });
    expect(judge("Safari", "https://instagram.com/reels", "")).toEqual({ status: "distracted", label: "Instagram" });
    expect(judge("Arc", "https://old.reddit.com/r/cfb", "")).toEqual({ status: "distracted", label: "Reddit" });
  });
  it("lets study pages through", () => {
    expect(judge("Google Chrome", "https://docs.google.com/document/d/abc", "Essay draft").status).toBe("work");
    expect(judge("Google Chrome", "https://d2l.tcu.edu/d2l/home", "D2L").status).toBe("work");
    expect(judge("Microsoft Word").status).toBe("work");
  });
  it("lets obvious class videos on YouTube through, but not Shorts", () => {
    expect(judge("Google Chrome", "https://www.youtube.com/watch?v=1", "Hypothesis Testing Explained - YouTube").status).toBe("work");
    expect(judge("Google Chrome", "https://www.youtube.com/shorts/xyz", "lecture").status).toBe("distracted");
    expect(judge("Google Chrome", "https://www.youtube.com/watch?v=2", "Funniest fails 2026").status).toBe("distracted");
  });
  it("flags distracting Mac apps", () => {
    expect(judge("Messages")).toEqual({ status: "distracted", label: "Messages" });
    expect(judge("Discord")).toEqual({ status: "distracted", label: "Discord" });
  });
  it("never counts Milo himself or the Mac's plumbing", () => {
    expect(judge("Electron").status).toBe("neutral");
    expect(judge("Finder").status).toBe("neutral");
    expect(judge("").status).toBe("neutral");
  });
  it("respects 'it's for school' for the session", () => {
    expect(judge("Google Chrome", "https://youtube.com/watch?v=3", "anything", new Set(["YouTube"])).status).toBe("work");
  });
});

describe("lock-in: understanding the request", () => {
  it.each([
    ["lock in for 45 minutes on stats", { minutes: 45, topic: "stats" }],
    ["lock in on biology for an hour", { minutes: 60, topic: "biology" }],
    ["lock in for an hour and a half on calc", { minutes: 90, topic: "calc" }],
    ["focus mode for half an hour", { minutes: 30 }],
    ["pomodoro", { minutes: 25 }],
    ["help me focus on my english essay", { topic: "english essay" }],
    ["let's lock in for 90 min", { minutes: 90 }],
    ["study chemistry for 30 minutes", { minutes: 30, topic: "chemistry" }],
    ["lock in", {}],
    // speech-to-text writes numbers as words
    ["Milo, lock in for ten minutes.", { minutes: 10 }],
    ["lock in for forty five minutes on stats", { minutes: 45, topic: "stats" }],
    ["lock in for forty-five minutes", { minutes: 45 }],
    ["lock in for fifteen minutes on bio", { minutes: 15, topic: "bio" }],
    ["lock in for two hours", { minutes: 120 }],
    ["lock in for ninety minutes", { minutes: 90 }],
  ])("%s", (said, want) => {
    expect(parseLockIn(said)).toEqual(want);
  });
});

describe("lock-in: session plan", () => {
  it("keeps short sessions as one block", () => {
    expect(planBlocks(25)).toEqual([{ focus: 25, rest: 0 }]);
  });
  it("breaks long sessions into 25/5 and never ends on a break", () => {
    expect(planBlocks(60)).toEqual([{ focus: 25, rest: 5 }, { focus: 30, rest: 0 }]);
    const p = planBlocks(90);
    expect(p[p.length - 1].rest).toBe(0);
    expect(p.reduce((a, b) => a + b.focus + b.rest, 0)).toBe(90);
  });
});
