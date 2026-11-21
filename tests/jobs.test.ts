import { describe, expect, it, vi } from "vitest";
vi.mock("electron", () => ({ app: { getPath: () => "/tmp/milo-jobs-test" } }));
vi.mock("../src/main/blackbox", () => ({ log: () => {} }));
vi.mock("../src/main/brain", () => ({ callTool: async () => ({ ok: false, text: "x" }), persona: () => "" }));
import { isJob } from "../src/main/jobs";

describe("isJob", () => {
  it("quick stuff stays quick", () => {
    for (const t of ["open chrome", "close the entire chrome application", "search TCU on google", "what's 2 plus 2", "open notes and make a new note"]) expect(isJob(t), t).toBe(false);
  });
  it("long multi-part stuff becomes a job", () => {
    for (const t of [
      "go to the store site, add a blue notebook and 2 pencils to the cart, then check out with pickup and place the order",
      "fill out the study club sign up form with my name and email and submit it",
      "go through every page of the survey and answer all the questions",
      "research the three cheapest flights to Austin and then make a note comparing them",
    ])
      expect(isJob(t), t).toBe(true);
  });
});

describe("isJob, more quick stuff", () => {
  it("doesn't turn normal requests into jobs", () => {
    for (const t of ["open spotify and play my study playlist", "type hello into the search box", "find my stats notes", "make a flashcard set on chapter 3", "open chrome and go to d2l"]) expect(isJob(t), t).toBe(false);
  });
});
