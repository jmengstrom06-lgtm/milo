import { describe, it, expect, vi } from "vitest";
vi.mock("../src/main/blackbox", () => ({ log: () => {} }));
import { bestMatch, nameScore } from "../src/main/assignmentOpen";

describe("finding the assignment the calendar named", () => {
  const folders = ["Journaling/Research Assignment", "Journal Entry 3", "Research Paper Final Draft", "Team Charter"];
  it.each([
    ["Journaling/Research Assignment", "Journaling/Research Assignment"],
    ["journaling research assignment", "Journaling/Research Assignment"],
    ["Journaling/Research Assignment - Due", "Journaling/Research Assignment"],
    ["team charter", "Team Charter"],
  ])("%s -> %s", (want, got) => expect(bestMatch(want, folders, (x) => x)).toBe(got));
  it("something that isn't there = nothing (no wrong guess)", () => expect(bestMatch("Lab Report 4", folders, (x) => x)).toBeNull());
  it("exact beats partial", () => expect(nameScore("Team Charter", "Team Charter")).toBeGreaterThan(nameScore("Team Charter", "Team Charter Peer Review")));
});
