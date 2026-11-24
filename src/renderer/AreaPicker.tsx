import { useEffect, useRef, useState } from "react";

// "Pick an area": the screen dims, a box appears, drag it over what you need help with and resize it by the
// corners or edges. Go = Milo looks only inside it (and keeps using it until you switch apps).

type Box = { x: number; y: number; width: number; height: number };
type Drag = { mode: "move" | "new" | string; x0: number; y0: number; b0: Box } | null;
const MIN = 40;

export default function AreaPicker({ onDone, onCancel, hover }: { onDone: (b: Box) => void; onCancel: () => void; hover: (on: boolean) => void }) {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const [box, setBox] = useState<Box>(() => ({ x: Math.round(W * 0.25), y: Math.round(H * 0.2), width: Math.round(W * 0.5), height: Math.round(H * 0.5) }));
  const drag = useRef<Drag>(null);

  useEffect(() => {
    hover(true);
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter") onDone(box);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [box, hover, onCancel, onDone]);

  const start = (mode: string) => (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    drag.current = { mode, x0: e.clientX, y0: e.clientY, b0: box };
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x0;
    const dy = e.clientY - d.y0;
    const b = { ...d.b0 };
    if (d.mode === "new") {
      // drew a fresh box from where they pressed
      const x = Math.min(d.x0, e.clientX);
      const y = Math.min(d.y0, e.clientY);
      return setBox({ x, y, width: Math.max(MIN, Math.abs(dx)), height: Math.max(MIN, Math.abs(dy)) });
    }
    if (d.mode === "move") {
      b.x = Math.max(0, Math.min(W - b.width, b.x + dx));
      b.y = Math.max(0, Math.min(H - b.height, b.y + dy));
      return setBox(b);
    }
    if (d.mode.includes("w")) {
      const nx = Math.max(0, Math.min(b.x + b.width - MIN, b.x + dx));
      b.width += b.x - nx;
      b.x = nx;
    }
    if (d.mode.includes("e")) b.width = Math.max(MIN, Math.min(W - b.x, b.width + dx));
    if (d.mode.includes("n")) {
      const ny = Math.max(0, Math.min(b.y + b.height - MIN, b.y + dy));
      b.height += b.y - ny;
      b.y = ny;
    }
    if (d.mode.includes("s")) b.height = Math.max(MIN, Math.min(H - b.y, b.height + dy));
    setBox(b);
  };
  const end = () => (drag.current = null);

  const barTop = box.y + box.height + 10 + 44 < H ? box.y + box.height + 10 : Math.max(8, box.y - 54);
  return (
    <div className="ap" onPointerDown={start("new")} onPointerMove={move} onPointerUp={end} role="dialog" aria-label="Pick an area">
      {/* four dark panels around the box, so the inside stays clear */}
      <div className="ap__shade" style={{ left: 0, top: 0, width: W, height: box.y }} />
      <div className="ap__shade" style={{ left: 0, top: box.y + box.height, width: W, height: H - box.y - box.height }} />
      <div className="ap__shade" style={{ left: 0, top: box.y, width: box.x, height: box.height }} />
      <div className="ap__shade" style={{ left: box.x + box.width, top: box.y, width: W - box.x - box.width, height: box.height }} />
      <div className="ap__box" style={{ left: box.x, top: box.y, width: box.width, height: box.height }} onPointerDown={start("move")}>
        {["n", "s", "e", "w", "ne", "nw", "se", "sw"].map((h) => (
          <i key={h} className={`ap__h ap__h--${h}`} onPointerDown={start(h)} />
        ))}
      </div>
      {box.y > 60 && <div className="ap__tip" style={{ left: box.x, top: box.y - 34 }}>Drag the box over what you need help with</div>}
      <div className="ap__bar" style={{ left: Math.min(Math.max(8, box.x + box.width - 196), W - 204), top: barTop }} onPointerDown={(e) => e.stopPropagation()}>
        <button className="ap__cancel" onClick={onCancel}>
          Cancel
        </button>
        <button className="ap__go" onClick={() => onDone(box)}>
          Look here
        </button>
      </div>
    </div>
  );
}

/** A quick outline: what Milo picked when you named it ("Algebra (right)"), or your saved area. */
export function AreaFlash({ box, label }: { box: Box; label?: string }) {
  return (
    <div className="ap-flash" style={{ left: box.x, top: box.y, width: box.width, height: box.height }} aria-hidden="true">
      {label && <span>{label}</span>}
    </div>
  );
}
