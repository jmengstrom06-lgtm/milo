// Instant computer commands (no AI): the right thing, every time.
import { describe, expect, it } from "vitest";
import { plan } from "../src/main/quick";

const first = (t: string) => plan(t)?.steps?.[0] as Record<string, unknown> | undefined;

describe("quick plan", () => {
  it("Milo's own apps are never launched as Mac apps or Google sites", () => {
    for (const t of ["open sheets", "open up sheets", "open the sheet", "open a new sheet", "open your notes", "open your sketch pad", "open study", "open planner"]) {
      expect(plan(t)?.steps ?? [], t).toHaveLength(0);
    }
  });
  it("Google products only when named", () => {
    expect(first("open google sheets")?.url).toContain("docs.google.com/spreadsheets");
    expect(first("open a new google sheet")?.url).toBe("https://sheets.new");
    expect(first("open google docs")?.url).toContain("docs.google.com/document");
  });
  it("sites and apps", () => {
    expect(first("open youtube")?.url).toContain("youtube.com");
    expect(String(first("could you please open youtube for me")?.url)).toContain("youtube.com");
  });
});
