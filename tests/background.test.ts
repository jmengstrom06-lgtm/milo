import { describe, expect, it } from "vitest";
import { looksLikeBackground } from "../src/renderer/decide";

describe("room chatter vs talking to Milo", () => {
  it("ignores chatter", () => {
    expect(looksLikeBackground("Keep grinding up the crackers. Throw it in his beggar. I don't know if it's steel.")).toBe(true);
    expect(looksLikeBackground("I'm gonna run to Target. I need to get some more flour. And then I'm gonna go... Michael, what?")).toBe(true);
    expect(looksLikeBackground("Mike, we're gonna go to Lowe's.")).toBe(true);
  });
  it("keeps real follow-ups", () => {
    for (const t of ["What's due this week?", "Yes do it", "Open the first one", "No, I meant stats", "Thanks", "What about econ?", "Can you explain step two?", "Make it shorter. Then save it.", "my student ID is 12345", "Milo, stop"])
      expect(looksLikeBackground(t), t).toBe(false);
  });
});
