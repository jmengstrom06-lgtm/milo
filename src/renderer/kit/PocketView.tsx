// Pocket: things you asked Milo to hold. Copy one back, or tell him where to drop it.

import { useEffect, useState } from "react";
import type { PocketItem } from "./types";

export default function PocketView({ version, onDrop }: { version: number; onDrop: (item: PocketItem) => void }) {
  const [items, setItems] = useState<PocketItem[]>([]);
  const [toast, setToast] = useState("");
  const refresh = () => window.milo.kit.pocket().then(setItems);
  useEffect(() => {
    refresh();
  }, [version]);

  return (
    <div className="pk">
      {items.length === 0 ? (
        <div className="kit-empty">
          <p>Your pocket is empty.</p>
          <p className="kit-sub">Select some text anywhere and say “Milo, hold this.” Then “drop it in ChatGPT” or “paste it here.”</p>
        </div>
      ) : (
        items.map((it, k) => (
          <div key={it.id} className="pk-item" style={{ animationDelay: `${k * 40}ms` }}>
            <div className="pk-meta">
              {k === 0 && <span className="pk-latest">Latest</span>}
              <span>{it.from || "Milo"}</span>
              <span>{new Date(it.at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</span>
            </div>
            <div className="pk-text">{it.text.length > 400 ? it.text.slice(0, 400) + "…" : it.text}</div>
            <div className="pk-actions">
              <button
                className="kit-btn kit-btn--sm"
                onClick={async () => {
                  await window.milo.kit.pocketCopy(it.id);
                  setToast("Copied");
                  setTimeout(() => setToast(""), 1400);
                }}
              >
                Copy
              </button>
              <button className="kit-btn kit-btn--sm kit-btn--primary" onClick={() => onDrop(it)}>
                Paste where I was
              </button>
              <button
                className="kit-btn kit-btn--sm"
                onClick={async () => {
                  await window.milo.kit.pocketRemove(it.id);
                  refresh();
                }}
              >
                Remove
              </button>
            </div>
          </div>
        ))
      )}
      {toast && <div className="kit-toast">{toast}</div>}
    </div>
  );
}
