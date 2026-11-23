import { describe, expect, it, vi } from "vitest";
vi.mock("electron", () => ({ app: { getPath: () => "/tmp" } }));
import { inQuiet, setPrefs } from "../src/main/prefs";

describe("quiet hours", () => {
  it("handles ranges across midnight", () => {
    expect(inQuiet(23, 23, 8)).toBe(true);
    expect(inQuiet(2, 23, 8)).toBe(true);
    expect(inQuiet(8, 23, 8)).toBe(false);
    expect(inQuiet(15, 23, 8)).toBe(false);
  });
  it("handles same-day ranges and off", () => {
    expect(inQuiet(14, 13, 15)).toBe(true);
    expect(inQuiet(15, 13, 15)).toBe(false);
    expect(inQuiet(3, 5, 5)).toBe(false);
  });

  it("keeps a clean never-record list of classes", () => {
    const p = setPrefs({ noRecord: ["stat", "stat", "", 3 as unknown as string, "engl"] });
    expect(p.noRecord).toEqual(["stat", "engl"]);
    expect(setPrefs({ quiet: false }).noRecord).toEqual(["stat", "engl"]);
  });
});
