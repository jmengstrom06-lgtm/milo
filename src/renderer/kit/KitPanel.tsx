// The shell every kit app lives in: same glass, header, sizes and close as the research box.

import type { PanelSize } from "../ResearchPanel";
import { KitIcon } from "./icons";
import type { KitApp } from "./types";

export default function KitPanel({
  app,
  kicker,
  title,
  working,
  size,
  onSize,
  onClose,
  style,
  hover,
  actions,
  sub,
  children,
}: {
  app: KitApp;
  kicker: string;
  title: string;
  working?: boolean;
  size: PanelSize;
  onSize: (s: PanelSize) => void;
  onClose: () => void;
  style: React.CSSProperties;
  hover: (on: boolean) => void;
  actions?: React.ReactNode;
  sub?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className={`rp kit kit--${app} rp--${size} ${working ? "rp--working" : ""}`} style={style} onMouseEnter={() => hover(true)} onMouseMove={() => hover(true)} onMouseLeave={() => hover(false)}>
      <div className="rp-inner">
        <div className="rp-head">
          <span className="kit-badge">
            <KitIcon app={app} />
          </span>
          <div className="rp-title">
            <div className="rp-kicker">{kicker}</div>
            <div className="rp-q" title={title}>
              {title}
            </div>
          </div>
          <div className="rp-tools">
            {actions}
            {(["compact", "half", "full"] as PanelSize[]).map((s) => (
              <button key={s} className={`rp-icon ${size === s ? "rp-icon--on" : ""}`} onClick={() => onSize(s)} title={s === "compact" ? "Compact" : s === "half" ? "Half screen" : "Full screen"}>
                <svg viewBox="0 0 16 16" width="13" height="13">
                  <rect x="2" y="2" width="12" height="12" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
                  {s === "compact" && <rect x="8" y="8" width="4" height="4" rx="1" fill="currentColor" />}
                  {s === "half" && <rect x="8" y="3.5" width="4.5" height="9" rx="1" fill="currentColor" />}
                  {s === "full" && <rect x="4" y="4" width="8" height="8" rx="1" fill="currentColor" />}
                </svg>
              </button>
            ))}
            <button className="rp-icon" onClick={onClose} title="Close (Esc)">
              <svg viewBox="0 0 16 16" width="12" height="12">
                <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>
        {sub}
        <div className="rp-body kit-body">{children}</div>
      </div>
    </div>
  );
}

/** Shimmering "Milo is making it" state, shared by every kit app. */
export function KitLoading({ text }: { text: string }) {
  return (
    <div className="kit-loading">
      <span className="rp-spin" />
      <span className="rp-shimmer">{text}…</span>
    </div>
  );
}
