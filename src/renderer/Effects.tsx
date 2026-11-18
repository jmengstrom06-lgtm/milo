import { useMemo } from "react";

// Glowing marker ring that draws itself around the target, plus a soft spotlight.
export function Highlight({ box, dim }: { box: MiloBox; dim: boolean }) {
  const pad = 10;
  const w = box.width + pad * 2;
  const h = box.height + pad * 2;
  const perim = 2 * (w + h);
  return (
    <div
      className={`hl ${dim ? "hl--dim" : ""}`}
      style={{ left: box.x - pad, top: box.y - pad, width: w, height: h }}
    >
      <svg width={w} height={h} className="hl__svg">
        <rect
          x={3}
          y={3}
          width={w - 6}
          height={h - 6}
          rx={14}
          className="hl__ring"
          style={{ strokeDasharray: perim, strokeDashoffset: perim }}
        />
      </svg>
    </div>
  );
}

// Confetti burst from a point.
export function Confetti({ x, y, seed }: { x: number; y: number; seed: number }) {
  const bits = useMemo(() => {
    const colors = ["#ffcf3f", "#ff6b6b", "#4dabf7", "#51cf66", "#b197fc", "#ff922b"];
    return Array.from({ length: 70 }).map((_, i) => {
      const angle = Math.random() * Math.PI * 2;
      const dist = 120 + Math.random() * 260;
      return {
        id: `${seed}-${i}`,
        dx: Math.cos(angle) * dist,
        dy: Math.sin(angle) * dist - 120,
        rot: Math.random() * 720 - 360,
        color: colors[i % colors.length],
        delay: Math.random() * 0.08,
        w: 6 + Math.random() * 6,
      };
    });
  }, [seed]);

  return (
    <div className="confetti" style={{ left: x, top: y }}>
      {bits.map((b) => (
        <span
          key={b.id}
          style={
            {
              background: b.color,
              width: b.w,
              height: b.w * 0.45,
              animationDelay: `${b.delay}s`,
              "--dx": `${b.dx}px`,
              "--dy": `${b.dy}px`,
              "--rot": `${b.rot}deg`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}

// Comic-style speech bubble above Milo.
export function Bubble({ text, x, y }: { text: string; x: number; y: number }) {
  return (
    <div className="bubble-say" style={{ left: x, top: y }}>
      {text}
    </div>
  );
}
