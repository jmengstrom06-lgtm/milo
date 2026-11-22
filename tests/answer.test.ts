import { describe, expect, it } from "vitest";
import { parseAnswer } from "../src/renderer/decide";

describe("follow-up answers (Alexa-style)", () => {
  it("hears yes", () => {
    for (const t of ["Yes.", "yeah", "Yep!", "Sure", "Go ahead", "Do it", "Send it", "Okay", "Milo, yes.", "Hey Milo yes", "yes please", "sounds good", "That's right"]) expect(parseAnswer(t), t).toBe("yes");
  });
  it("hears no", () => {
    for (const t of ["No.", "Nope", "nah", "Don't", "Cancel", "Never mind", "Not yet", "Wait", "Milo, no."]) expect(parseAnswer(t), t).toBe("no");
  });
  it("ignores changes and other talk", () => {
    for (const t of ["yes but make it 4", "Actually change it to Friday", "are they gonna go to Tyler's", "Those procedure", "What's on my calendar this week and do I have any new emails today", ""]) expect(parseAnswer(t), t).toBeNull();
  });
});
