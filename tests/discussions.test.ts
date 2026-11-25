import { describe, it, expect } from "vitest";
import { pickTopic, requirementsOf } from "../src/main/discussions";
import { mergeNotes, type ReadingNotes } from "../src/main/reading";

const T = (topicId: number, name: string, due: string | null, extra: Partial<{ locked: boolean; end: string | null; forum: string }> = {}) => ({
  forumId: 1, topicId, forum: extra.forum ?? "Discussions", name, prompt: "", due, end: extra.end ?? null, locked: extra.locked ?? false,
});
const NOW = Date.parse("2026-11-25T12:00:00Z");
const topics = [
  T(1, "Week 4: Memory", "2026-11-10T00:00:00Z"),
  T(2, "Week 5: Learning", "2026-11-27T00:00:00Z"),
  T(3, "Week 6: Conformity", "2026-12-04T00:00:00Z"),
  T(4, "Week 3: Sleep", null, { locked: true }),
  T(5, "Introductions", null, { end: "2026-09-01T00:00:00Z" }),
];

describe("pickTopic", () => {
  it("picks the week the student names", () => expect(pickTopic(topics, new Set(), "do the week 6 discussion", NOW)?.topicId).toBe(3));
  it("picks a topic by its name", () => expect(pickTopic(topics, new Set(), "the conformity discussion post", NOW)?.topicId).toBe(3));
  it("otherwise picks the soonest one not posted yet", () => expect(pickTopic(topics, new Set([1]), "do my discussion post", NOW)?.topicId).toBe(2));
  it("skips locked and closed topics", () => expect(pickTopic(topics, new Set([1, 2, 3]), "", NOW)?.topicId).not.toBe(4));
  it("common words don't fake a match", () => expect(pickTopic(topics, new Set([1]), "can you help me answer this discussion for class", NOW)?.topicId).toBe(2));
  it("nothing open = null", () => expect(pickTopic([T(9, "Old", null, { locked: true })], new Set(), "", NOW)).toBeNull());
});

describe("requirementsOf", () => {
  it.each([
    ["Your post must be at least 250 words. Reply to two classmates.", 250, 2],
    ["Write 250-300 words and respond to at least 2 of your peers", 250, 2],
    ["Minimum of 150 words. Comment on one classmate's post.", 150, 1],
    ["Respond to three other students", 0, 3],
    ["Share your thoughts in 200 to 300 words.", 200, 0],
    ["Answer the question below.", 0, 0],
  ])("%s", (p, w, r) => expect(requirementsOf(p)).toEqual({ minWords: w, replies: r }));
});

describe("mergeNotes", () => {
  const part = (n: number, terms: string[]): ReadingNotes => ({
    title: `Ch 4 (pages ${n})`,
    summary: `Part ${n}.`,
    sections: [{ heading: `S${n}`, points: ["p"] }],
    key_terms: terms.map((t) => ({ term: t, definition: "d" })),
    exam_alerts: ["a"],
    flashcards: Array.from({ length: 30 }, (_, i) => ({ front: `${n}-${i}`, back: "b" })),
    quiz: Array.from({ length: 8 }, (_, i) => ({ q: `${n}-${i}`, choices: ["a", "b", "c", "d"], correct: 0, why: "" })),
  });
  const m = mergeNotes([part(1, ["Osmosis", "ATP"]), part(2, ["osmosis", "Tonicity"])]);
  it("one title, no part label", () => expect(m.title).toBe("Ch 4"));
  it("drops duplicate terms", () => expect(m.key_terms.map((k) => k.term)).toEqual(["Osmosis", "ATP", "Tonicity"]));
  it("caps flashcards and spreads the quiz over every part", () => {
    expect(m.flashcards.length).toBe(40);
    expect(m.quiz.length).toBe(10);
    expect(m.quiz.some((q) => q.q.startsWith("2-"))).toBe(true);
  });
});
