import React from "react";
import { createRoot } from "react-dom/client";
import "katex/dist/katex.min.css";

// Send crashes in Milo's windows to crash reports (no screen content, just the error).
const report = (e: unknown) => {
  const err = e instanceof Error ? e : new Error(String(e));
  try {
    window.milo.reportError({ name: err.name, message: err.message, stack: err.stack });
  } catch {
    /* preload not ready */
  }
};
window.addEventListener("error", (ev) => report(ev.error ?? ev.message));
window.addEventListener("unhandledrejection", (ev) => report(ev.reason));

const root = createRoot(document.getElementById("root")!);
// One codebase, two windows: the frog's see-through overlay, and Home base (#home).
if (location.hash === "#home") {
  void Promise.all([
    import("./home/HomeApp"),
    import("@fontsource/plus-jakarta-sans/400.css"),
    import("@fontsource/plus-jakarta-sans/500.css"),
    import("@fontsource/plus-jakarta-sans/600.css"),
    import("@fontsource/plus-jakarta-sans/700.css"),
    import("@fontsource/plus-jakarta-sans/800.css"),
    import("./home/home.css"),
  ]).then(([m]) =>
    root.render(
      <React.StrictMode>
        <m.default />
      </React.StrictMode>
    )
  );
} else {
  void Promise.all([
    import("./App"),
    import("@fontsource/caveat/500.css"),
    import("@fontsource/caveat/700.css"),
    import("@fontsource/plus-jakarta-sans/500.css"),
    import("@fontsource/plus-jakarta-sans/600.css"),
    import("@fontsource/plus-jakarta-sans/700.css"),
    import("./styles.css"),
  ]).then(([m]) =>
    root.render(
      <React.StrictMode>
        <m.default />
      </React.StrictMode>
    )
  );
}
