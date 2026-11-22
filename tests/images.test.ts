// 2026-11-18: "what's due" sent a PNG screenshot labeled as JPEG -> the AI rejected it (400).
import { describe, expect, it } from "vitest";
import { fixImageTypes, sniffImageType } from "../src/main/brain";

describe("screenshots always get their real type", () => {
  it("sniffs", () => {
    expect(sniffImageType("iVBORw0KGgo")).toBe("image/png");
    expect(sniffImageType("/9j/4AAQ")).toBe("image/jpeg");
    expect(sniffImageType("xyz")).toBeNull();
  });
  it("fixes a mislabeled PNG", () => {
    const body = { messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: "iVBORw0KGgoAAA" } }, { type: "text", text: "hi" }] }] };
    fixImageTypes(body);
    expect(body.messages[0].content[0].source!.media_type).toBe("image/png");
  });
  it("leaves text-only messages alone", () => {
    const body = { messages: [{ role: "user", content: "hello" }] };
    expect(() => fixImageTypes(body)).not.toThrow();
  });
});
