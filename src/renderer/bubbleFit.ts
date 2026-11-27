// Where Milo's speech bubble goes: next to Milo, never on top of him, and never over a card he has open
// (deadline radar, game plan, research or writing panels). Pure (tested).

import type React from "react";

export type Rect = { x: number; y: number; w: number; h: number };

/** A positioned card's box on screen, from its style (left/right/top/bottom + width/height/maxHeight). (pure) */
export function rectOf(s: React.CSSProperties, W: number, H: number, guessH = 300): Rect | null {
  const n = (v: unknown) => (typeof v === "number" ? v : null);
  const w = n(s.width) ?? 380;
  const h = n(s.height) ?? Math.min(n(s.maxHeight) ?? guessH, guessH);
  const x = n(s.left) ?? (n(s.right) != null ? W - n(s.right)! - w : null);
  const y = n(s.top) ?? (n(s.bottom) != null ? H - n(s.bottom)! - h : null);
  return x == null || y == null ? null : { x, y, w, h };
}

const overlap = (a: Rect, b: Rect, pad = 6) => a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;

/** About how big the bubble will be for this text (14px text, 1.4 line height, 12px padding). (pure) */
export function bubbleSize(text: string, maxW: number): { w: number; h: number } {
  const perLine = Math.max(8, Math.floor((maxW - 24) / 7.3));
  const lines = Math.max(1, Math.ceil(text.length / perLine));
  return { w: lines > 1 ? maxW : Math.min(maxW, 24 + text.length * 7.3), h: 18 + lines * 20 };
}

/** The first spot that fits on screen and clears every card: above Milo, then the side away from the
 *  cards, the other side, then below. If nothing clears, the spot that covers the least. (pure) */
export function fitBubble(milo: Rect, cards: Rect[], text: string, W: number, H: number, margin = 16, maxW = 280): React.CSSProperties {
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const { w, h } = bubbleSize(text, maxW);
  const cx = clamp(milo.x + milo.w / 2 - w / 2, margin, W - w - margin);
  const cardsLeft = cards.some((c) => c.x + c.w / 2 < milo.x + milo.w / 2);
  const side = (left: boolean) => {
    const x = left ? milo.x - 10 - w : milo.x + milo.w + 10;
    return { x, y: clamp(milo.y + 8, margin, H - h - margin) };
  };
  const spots: { x: number; y: number; style: React.CSSProperties }[] = [];
  const add = (p: { x: number; y: number }, style: React.CSSProperties) => spots.push({ ...p, style });
  add({ x: cx, y: milo.y - 4 - h }, { left: cx, bottom: H - milo.y + 4, maxWidth: maxW });
  for (const left of cardsLeft ? [false, true] : [true, false]) {
    const p = side(left);
    add(p, left ? { right: W - milo.x + 10, top: p.y, maxWidth: maxW } : { left: p.x, top: p.y, maxWidth: maxW });
  }
  add({ x: cx, y: milo.y + milo.h + 6 }, { left: cx, top: milo.y + milo.h + 6, maxWidth: maxW });
  // Milo in a corner with a card beside him: under Milo, just past the bottom of the card(s) in the way
  const inWay = cards.filter((c) => c.x < cx + w && cx < c.x + c.w);
  if (inWay.length) {
    const y = Math.max(milo.y + milo.h + 6, ...inWay.map((c) => c.y + c.h + 8));
    add({ x: cx, y }, { left: cx, top: y, maxWidth: maxW });
  }
  // or above them, when Milo is low on the screen
  if (inWay.length) {
    const y = Math.min(milo.y - 4, ...inWay.map((c) => c.y - 8)) - h;
    add({ x: cx, y }, { left: cx, top: y, maxWidth: maxW });
  }
  const onScreen = (r: Rect) => r.x >= margin - 1 && r.y >= margin - 1 && r.x + r.w <= W - margin + 1 && r.y + r.h <= H - margin + 1;
  const box = (s: { x: number; y: number }): Rect => ({ x: s.x, y: s.y, w, h });
  const clear = spots.find((s) => onScreen(box(s)) && !cards.some((c) => overlap(box(s), c)) && !overlap(box(s), milo, -2));
  if (clear) return clear.style;
  // nothing is fully clear: least covered card area, on screen
  const covered = (r: Rect) => cards.reduce((n, c) => n + Math.max(0, Math.min(r.x + r.w, c.x + c.w) - Math.max(r.x, c.x)) * Math.max(0, Math.min(r.y + r.h, c.y + c.h) - Math.max(r.y, c.y)), 0);
  const fits = spots.filter((s) => onScreen(box(s)));
  return (fits.length ? fits : spots).sort((a, b) => covered(box(a)) - covered(box(b)))[0].style;
}
