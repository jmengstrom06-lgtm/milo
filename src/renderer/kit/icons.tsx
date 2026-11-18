// Simple line icons for Milo's kit apps (no emoji, no clip art).

import type { KitApp } from "./types";

export function KitIcon({ app, size = 16 }: { app: KitApp; size?: number }) {
  const p = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden>
      {app === "study" && (
        <>
          <path {...p} d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z" />
          <path {...p} d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5" />
          <path {...p} d="M9 8h7M9 12h5" />
        </>
      )}
      {app === "sketch" && (
        <>
          <path {...p} d="M3 20h18" />
          <path {...p} d="M4 18C7 18 8 6 12 6s5 12 8 12" />
        </>
      )}
      {app === "notes" && (
        <>
          <rect {...p} x="5" y="3" width="14" height="18" rx="2" />
          <path {...p} d="M9 8h6M9 12h6M9 16h4" />
        </>
      )}
      {app === "sheet" && (
        <>
          <rect {...p} x="3" y="4" width="18" height="16" rx="2" />
          <path {...p} d="M3 9h18M3 14h18M9 4v16M15 4v16" />
        </>
      )}
      {app === "planner" && (
        <>
          <rect {...p} x="3" y="5" width="18" height="16" rx="2" />
          <path {...p} d="M3 10h18M8 3v4M16 3v4M8 14h3" />
        </>
      )}
      {app === "pocket" && (
        <>
          <path {...p} d="M4 6h16v6a8 8 0 0 1-16 0z" />
          <path {...p} d="M9 11l3 3 3-3" />
        </>
      )}
    </svg>
  );
}
