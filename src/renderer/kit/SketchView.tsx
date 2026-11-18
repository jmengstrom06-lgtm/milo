// Sketch: graphs Milo draws in code, or an image when it's a picture of a thing.

import { useEffect, useState } from "react";
import Graph from "./Graph";
import { KitLoading } from "./KitPanel";
import type { Sketch } from "./types";

export default function SketchView({ sketch, onAsk }: { sketch: Sketch; onAsk: (request: string) => void }) {
  const [img, setImg] = useState<string | null>(null);
  const [imgErr, setImgErr] = useState<string | null>(null);

  useEffect(() => {
    setImg(null);
    setImgErr(null);
    if (sketch.graph || !sketch.image_prompt) return;
    let alive = true;
    window.milo.kit.image(sketch.image_prompt).then((r) => {
      if (!alive) return;
      if (r.ok) setImg(`data:image/png;base64,${r.b64}`);
      else setImgErr(r.text === "no-key" ? "Images need an OpenAI key. Copy it, then run npm run setkey -- openai." : r.text);
    });
    return () => {
      alive = false;
    };
  }, [sketch]);

  return (
    <div className="sk">
      {sketch.graph ? (
        <div className="sk-graph">
          <Graph spec={sketch.graph} />
        </div>
      ) : img ? (
        <img className="sk-img" src={img} alt={sketch.title} />
      ) : imgErr ? (
        <div className="rp-error">{imgErr}</div>
      ) : (
        <div className="sk-painting">
          <KitLoading text="Drawing it" />
        </div>
      )}
      <p className="sk-say">{sketch.say}</p>
      <form
        className="sd-input"
        onSubmit={(e) => {
          e.preventDefault();
          const v = (e.currentTarget.elements.namedItem("q") as HTMLInputElement).value.trim();
          if (v) onAsk(v);
        }}
      >
        <input name="q" placeholder={sketch.graph ? "Change it: shade above 80, add y = x^2…" : "Draw something else…"} />
        <button className="kit-btn kit-btn--primary">Draw</button>
      </form>
    </div>
  );
}
