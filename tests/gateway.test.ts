import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { getPath: () => "/tmp", getVersion: () => "0.0.0", isPackaged: false, getAppPath: () => "/tmp" } }));
import { withCache } from "../src/main/gateway";
import { chatTier } from "../src/main/brain";

describe("prompt caching", () => {
  it("marks a string system prompt as cacheable", () => {
    const out = withCache({ system: "You are Milo.", messages: [] });
    expect(out.system).toEqual([{ type: "text", text: "You are Milo.", cache_control: { type: "ephemeral" } }]);
  });
  it("marks the last block of a block system prompt", () => {
    const out = withCache({ system: [{ type: "text", text: "a" }, { type: "text", text: "b" }] }) as { system: Record<string, unknown>[] };
    expect(out.system[0].cache_control).toBeUndefined();
    expect(out.system[1].cache_control).toEqual({ type: "ephemeral" });
  });
  it("falls back to the last tool when there is no system prompt", () => {
    const out = withCache({ tools: [{ name: "a" }, { name: "b" }] }) as { tools: Record<string, unknown>[] };
    expect(out.tools[1].cache_control).toEqual({ type: "ephemeral" });
  });
  it("does not change the original request", () => {
    const body = { system: "x" };
    withCache(body);
    expect(body.system).toBe("x");
  });
});

describe("chat model routing", () => {
  const ask = (t: string) => chatTier([{ role: "user", content: t }]);
  it("sends quick chat to the fast model", () => {
    expect(ask("hey milo")).toBe("fast");
    expect(ask("thanks!")).toBe("fast");
    expect(ask("what time is my stats class")).toBe("fast");
  });
  it("sends real explaining to the smart model", () => {
    expect(ask("explain the central limit theorem")).toBe("smart");
    expect(ask("why does the derivative of x^2 equal 2x")).toBe("smart");
    expect(ask("how does photosynthesis work")).toBe("smart");
    expect(ask("x".repeat(200))).toBe("smart");
  });
});
