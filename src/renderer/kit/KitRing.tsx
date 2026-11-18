// "Milo, what can you do?": his tools fan out around him in a ring.

import { KitIcon } from "./icons";
import { KIT_APPS, type KitApp } from "./types";

export default function KitRing({ center, onPick, onClose, hover }: { center: { x: number; y: number }; onPick: (app: KitApp) => void; onClose: () => void; hover: (on: boolean) => void }) {
  const R = 118;
  // Fan upward so it never runs off the bottom of the screen.
  const start = -200, end = 20;
  return (
    <div className="kit-ring" onMouseEnter={() => hover(true)} onMouseLeave={() => hover(false)}>
      <button className="kit-ring__scrim" onClick={onClose} aria-label="Close" />
      {KIT_APPS.map((a, k) => {
        const ang = ((start + ((end - start) * k) / (KIT_APPS.length - 1)) * Math.PI) / 180;
        const x = center.x + Math.cos(ang) * R;
        const y = center.y + Math.sin(ang) * R;
        return (
          <button
            key={a.id}
            className="kit-ring__btn"
            style={{ left: x, top: y, animationDelay: `${k * 45}ms` }}
            onClick={() => onPick(a.id)}
            title={a.hint}
          >
            <KitIcon app={a.id} size={20} />
            <span>{a.name}</span>
          </button>
        );
      })}
    </div>
  );
}
