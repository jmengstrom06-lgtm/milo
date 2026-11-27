import { describe, it, expect } from "vitest";
import { fitBubble, rectOf, type Rect } from "../src/renderer/bubbleFit";

const W = 1470, H = 920;
const box = (s: React.CSSProperties, text: string): Rect => {
  const w = 280, lines = Math.ceil(text.length / 35), h = 18 + lines * 20;
  const x = typeof s.left === "number" ? s.left : W - (s.right as number) - w;
  const y = typeof s.top === "number" ? s.top : H - (s.bottom as number) - h;
  return { x, y, w, h };
};
const hits = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const TEXT = "Heads up: 2 things due Friday. Want me to spread the work out?";

describe("the speech bubble never covers an open card", () => {
  it("Jake's screenshot: Milo top-right, deadline radar to his left", () => {
    const milo = { x: 1300, y: 60, w: 120, h: 140 };
    const radar = rectOf({ left: 1300 - 384 - 14, top: 16, width: 384 }, W, H, 278)!;
    const b = box(fitBubble(milo, [radar], TEXT, W, H), TEXT);
    expect(hits(b, radar)).toBe(false);
    expect(hits(b, milo)).toBe(false);
    expect(b.x >= 16 && b.x + b.w <= W - 16 && b.y >= 16 && b.y + b.h <= H - 16).toBe(true);
  });
  it.each([
    ["bottom-left, card to the right", { x: 40, y: 760, w: 120, h: 140 }, { left: 174, top: 500, width: 384, height: 400 }],
    ["middle, card to the left", { x: 700, y: 400, w: 120, h: 140 }, { left: 302, top: 200, width: 384, height: 340 }],
    ["top-left, card to the right", { x: 30, y: 30, w: 120, h: 140 }, { left: 164, top: 16, width: 384, height: 300 }],
    ["bottom-right, card to the left", { x: 1330, y: 760, w: 120, h: 140 }, { left: 932, top: 500, width: 384, height: 400 }],
  ])("%s", (_n, milo, card) => {
    const c = rectOf(card, W, H)!;
    const b = box(fitBubble(milo, [c], TEXT, W, H), TEXT);
    expect(hits(b, c)).toBe(false);
    expect(hits(b, milo)).toBe(false);
  });
  it("no cards: above Milo as before", () => {
    const s = fitBubble({ x: 700, y: 400, w: 120, h: 140 }, [], TEXT, W, H);
    expect(s.bottom).toBe(H - 400 + 4);
  });
});
