// "Milo, what can you do?": his tools fan out around him in a half ring.
// In open space it's a half ring; in corners and at edges it becomes a neat grid beside him. It reports its outline so Milo's speech bubble can sit cleanly above (or below) it, never on top.

import { KitIcon } from "./icons";
import { KIT_APPS, type KitApp } from "./types";

const BTN = 64; // button size
const MIN_R = 126; // closest the ring gets to Milo
const EDGE = 14; // keep this far from the screen edges

export type RingLayout = {
  points: { x: number; y: number }[];
  dir: "up" | "down";
  box: { left: number; right: number; top: number; bottom: number }; // outline of the buttons
};

/**
 * Where each button goes for Milo centered at (cx, cy) on a W x H screen. Two clean layouts:
 * - open space: a half ring over his head (or under it, near the top of the screen)
 * - corners and edges: a tidy 3 x 2 grid of tiles beside him on the open side, lined up with him
 * Nothing ever leaves the screen or covers Milo.
 */
export function ringLayout(center: { x: number; y: number }, W: number, H: number): RingLayout {
  const half = BTN / 2;
  const n = KIT_APPS.length;
  const fits = (pts: { x: number; y: number }[]) =>
    pts.every((p) => p.x - half >= EDGE && p.x + half <= W - EDGE && p.y - half >= EDGE && p.y + half <= H - EDGE);
  const outline = (pts: { x: number; y: number }[]) => {
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    return { left: Math.min(...xs) - half, right: Math.max(...xs) + half, top: Math.min(...ys) - half, bottom: Math.max(...ys) + half };
  };
  const halfRing = (down: boolean) =>
    Array.from({ length: n }, (_, k) => {
      const a = ((180 + (180 * k) / (n - 1)) * Math.PI) / 180;
      return { x: center.x + Math.cos(a) * MIN_R, y: center.y + Math.sin(a) * MIN_R * (down ? -1 : 1) };
    });

  for (const down of [false, true]) {
    const pts = halfRing(down);
    if (fits(pts)) return { points: pts, dir: down ? "down" : "up", box: outline(pts) };
  }

  // Grid beside Milo, on whichever side has more room.
  const COLS = 3;
  const ROWS = Math.ceil(n / COLS);
  const STEP = BTN + 12;
  const gw = COLS * STEP - 12;
  const gh = ROWS * STEP - 12;
  const MILO_HALF_W = 60;
  const roomLeft = center.x - MILO_HALF_W - EDGE;
  const roomRight = W - (center.x + MILO_HALF_W) - EDGE;
  const left = roomLeft >= roomRight ? center.x - MILO_HALF_W - 14 - gw : center.x + MILO_HALF_W + 14;
  const top = Math.max(EDGE, Math.min(H - EDGE - gh, center.y - gh / 2));
  const pts = Array.from({ length: n }, (_, k) => ({
    x: left + (k % COLS) * STEP + half,
    y: top + Math.floor(k / COLS) * STEP + half,
  }));
  return { points: pts, dir: top > 110 ? "up" : "down", box: outline(pts) };
}

export default function KitRing({
  center,
  onPick,
  onClose,
  hover,
}: {
  center: { x: number; y: number };
  onPick: (app: KitApp) => void;
  onClose: () => void;
  hover: (on: boolean) => void;
}) {
  const L = ringLayout(center, window.innerWidth, window.innerHeight);
  return (
    <div className="kit-ring" onMouseEnter={() => hover(true)} onMouseLeave={() => hover(false)}>
      <button className="kit-ring__scrim" onClick={onClose} aria-label="Close" />
      {KIT_APPS.map((a, k) => (
        <button
          key={a.id}
          className="kit-ring__btn"
          style={{ left: L.points[k].x, top: L.points[k].y, animationDelay: `${k * 45}ms` }}
          onClick={() => onPick(a.id)}
          title={a.hint}
        >
          <KitIcon app={a.id} size={20} />
          <span>{a.name}</span>
        </button>
      ))}
    </div>
  );
}
