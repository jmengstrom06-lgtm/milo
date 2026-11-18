// Sketch: graphs (with sliders), drawings Milo makes himself, or a photo-real image when you ask for one.

import { useEffect, useState } from "react";
import Drawing from "./Drawing";
import Graph from "./Graph";
import { KitLoading } from "./KitPanel";
import type { Sketch } from "./types";

export default function SketchView({ sketch, onAsk }: { sketch: Sketch; onAsk: (request: string) => void }) {
  const [img, setImg] = useState<string | null>(null);
  const [imgState, setImgState] = useState<"none" | "loading" | "failed">("none");

  useEffect(() => {
    setImg(null);
    setImgState("none");
    if (sketch.graph || !sketch.image_prompt) return;
    let alive = true;
    window.milo.kit.hasImages().then((has) => {
      if (!has || !alive) return; // no image service: Milo's own drawing is shown instead
      setImgState("loading");
      window.milo.kit.image(sketch.image_prompt!).then((r) => {
        if (!alive) return;
        if (r.ok) setImg(`data:image/png;base64,${r.b64}`);
        else setImgState("failed");
      });
    });
    return () => {
      alive = false;
    };
  }, [sketch]);

  return (
    <div className="sk">
      {sketch.graph ? (
        <div className="sk-graph">
          <Graph spec={sketch.graph} interactive />
        </div>
      ) : img ? (
        <img className="sk-img" src={img} alt={sketch.title} />
      ) : imgState === "loading" ? (
        <div className="sk-painting">
          <KitLoading text="Painting it" />
        </div>
      ) : sketch.svg ? (
        <div className="sk-graph">
          <Drawing svg={sketch.svg} />
        </div>
      ) : (
        <div className="rp-error">I couldn't draw that one. Try describing it a little differently.</div>
      )}
      <p className="sk-say">{sketch.say}</p>
      <form
        className="sd-input"
        onSubmit={(e) => {
          e.preventDefault();
          const input = e.currentTarget.elements.namedItem("q") as HTMLInputElement;
          const v = input.value.trim();
          if (v) {
            onAsk(v);
            input.value = "";
          }
        }}
      >
        <input name="q" placeholder={sketch.graph ? "Change it: shade above 80, add y = 2x…" : "Change it: add labels, show the roots, zoom in…"} />
        <button className="kit-btn kit-btn--primary">Draw</button>
      </form>
    </div>
  );
}
