import { describe, expect, it } from "vitest";
import { lectureCommand, minutesText, notesText } from "../src/main/lectureNotes";

describe("lecture voice commands", () => {
  it.each([
    ["listen to my stats lecture", "stats"],
    ["Listen to the lecture", ""],
    ["record class", ""],
    ["take notes on this lecture", ""],
    ["start recording my biology class", "biology"],
    ["lecture mode", ""],
  ])("start: %s", (t, course) => expect(lectureCommand(t)).toEqual({ do: "start", course }));
  it.each(["class is over", "Stop listening", "stop recording", "lecture's over", "the lecture ended", "I'm done with class"])("stop: %s", (t) =>
    expect(lectureCommand(t)).toEqual({ do: "stop" })
  );
  it.each(["listen to this song", "record my screen", "what did we learn in class", "stop"])("neither: %s", (t) => expect(lectureCommand(t)).toBeNull());
});

describe("lecture notes", () => {
  it("minutes", () => {
    expect(minutesText(52 * 60000)).toBe("52 min");
    expect(minutesText(75 * 60000)).toBe("1 hr 15 min");
    expect(minutesText(10000)).toBe("1 min");
  });
  it("note text has the flagged items first and the transcript last", () => {
    const t = notesText(
      { title: "Z-scores", summary: "How far from the mean.", sections: [{ heading: "Formula", points: ["z = (x - mean) / sd"] }], key_terms: [{ term: "z-score", definition: "standard deviations from the mean" }], exam_alerts: ["Know the formula for Friday's quiz"], flashcards: [], questions: ["Why divide by sd?"] },
      { course: "Stats", date: "Mon, Nov 23", length: "52 min" },
      "Today we talk about z-scores."
    );
    expect(t.indexOf("FLAGGED")).toBeLessThan(t.indexOf("FORMULA"));
    expect(t.trim().endsWith("Today we talk about z-scores.")).toBe(true);
    expect(t.split("\n")[0]).toBe("Stats · Mon, Nov 23 · 52 min");
  });
});
