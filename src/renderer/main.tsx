import React from "react";
import { createRoot } from "react-dom/client";
import "katex/dist/katex.min.css";
import "@fontsource/caveat/500.css";
import "@fontsource/caveat/700.css";
import App from "./App";
import "./styles.css";

// Send crashes in Milo's window to crash reports (no screen content, just the error).
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

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
