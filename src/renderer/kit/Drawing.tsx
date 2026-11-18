// Milo draws an SVG illustration live: outlines trace in, fills wash in, labels appear last.
// The SVG comes from the AI, so it's cleaned first: only shapes and text survive.

import { useEffect, useMemo, useRef } from "react";

const ALLOWED = new Set(["svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text", "tspan", "defs", "lineargradient", "radialgradient", "stop", "title"]);

export function cleanSvg(raw: string): string | null {
  try {
    const doc = new DOMParser().parseFromString(raw, "image/svg+xml");
    const root = doc.documentElement;
    if (!root || root.nodeName.toLowerCase() !== "svg" || doc.getElementsByTagName("parsererror").length) return null;
    const walk = (el: Element) => {
      for (const child of [...el.children]) {
        if (!ALLOWED.has(child.nodeName.toLowerCase())) {
          child.remove();
          continue;
        }
        for (const a of [...child.attributes]) {
          const n = a.name.toLowerCase();
          const v = a.value.trim().toLowerCase();
          if (n.startsWith("on") || n === "style" && /url\(|expression|javascript/.test(v) || ((n === "href" || n === "xlink:href") && !v.startsWith("#"))) child.removeAttribute(a.name);
        }
        walk(child);
      }
    };
    for (const a of [...root.attributes]) if (a.name.toLowerCase().startsWith("on")) root.removeAttribute(a.name);
    walk(root);
    root.removeAttribute("width");
    root.removeAttribute("height");
    if (!root.getAttribute("viewBox")) root.setAttribute("viewBox", "0 0 800 500");
    root.setAttribute("class", "drawing__svg");
    return new XMLSerializer().serializeToString(root);
  } catch {
    return null;
  }
}

export default function Drawing({ svg }: { svg: string }) {
  const box = useRef<HTMLDivElement>(null);
  const clean = useMemo(() => cleanSvg(svg), [svg]);

  useEffect(() => {
    const el = box.current;
    if (!el || !clean) return;
    const shapes = [...el.querySelectorAll<SVGGeometryElement>("path,rect,circle,ellipse,line,polyline,polygon")];
    const texts = [...el.querySelectorAll<SVGTextElement>("text")];
    const total = 2600; // whole drawing in under ~3 seconds
    const step = Math.min(110, total / Math.max(1, shapes.length));
    shapes.forEach((s, k) => {
      const delay = k * step;
      const hasStroke = getComputedStyle(s).stroke !== "none";
      let len = 0;
      try {
        len = s.getTotalLength();
      } catch {
        /* some shapes can't measure */
      }
      if (hasStroke && len > 0) {
        s.style.strokeDasharray = `${len}`;
        s.style.strokeDashoffset = `${len}`;
        s.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }], { duration: Math.min(900, 250 + len * 0.6), delay, easing: "cubic-bezier(.4,.1,.2,1)", fill: "forwards" });
      }
      s.animate([{ fillOpacity: 0 }, { fillOpacity: getComputedStyle(s).fillOpacity || "1" }], { duration: 500, delay: delay + 250, fill: "backwards" });
    });
    const textStart = shapes.length * step + 200;
    texts.forEach((t, k) => {
      t.animate([{ opacity: 0, transform: "translateY(4px)" }, { opacity: 1, transform: "none" }], { duration: 320, delay: textStart + k * 70, fill: "backwards" });
    });
  }, [clean]);

  if (!clean) return <div className="rp-error">That drawing came out garbled. Ask me to draw it again.</div>;
  return <div ref={box} className="drawing" dangerouslySetInnerHTML={{ __html: clean }} />;
}
