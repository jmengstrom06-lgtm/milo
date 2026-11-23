// Share a Milo moment: a 9:16 card (TikTok / Stories size) with Milo and one real stat.
// Only shows what the student picks. No grades, class names, screenshots or notes, ever.

import { useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import MiloFrog, { type FrogMood, type FrogOutfit } from "./MiloFrog";

export type Moment = { id: string; kicker: string; big: string; small: string; mood: FrogMood; from: string; to: string };

const W = 1080;
const H = 1920;

/** Draws the card on a canvas and returns it as a PNG blob. */
async function drawCard(m: Moment, outfit: FrogOutfit): Promise<Blob> {
  await document.fonts.ready;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, W * 0.6, H);
  g.addColorStop(0, m.from);
  g.addColorStop(1, m.to);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  const svg = renderToStaticMarkup(<MiloFrog mood={m.mood} outfit={outfit} size={760} />).replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  ctx.drawImage(img, (W - 760) / 2, 440, 760, 760);

  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(255,255,255,0.78)";
  ctx.font = '700 40px "Plus Jakarta Sans", sans-serif';
  ctx.fillText(m.kicker.split("").join(String.fromCharCode(8202)), W / 2, 300);
  ctx.fillStyle = "#fff";
  ctx.font = '800 104px "Plus Jakarta Sans", sans-serif';
  ctx.fillText(m.big, W / 2, 1420, W - 120);
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.font = '600 44px "Plus Jakarta Sans", sans-serif';
  ctx.fillText(m.small, W / 2, 1520, W - 160);
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.font = '800 46px "Plus Jakarta Sans", sans-serif';
  ctx.fillText("milo · your study buddy", W / 2, 1800);

  return await new Promise<Blob>((ok, bad) => c.toBlob((b) => (b ? ok(b) : bad(new Error("no image"))), "image/png"));
}

export default function ShareSheet({ moments, outfit, onClose }: { moments: Moment[]; outfit: FrogOutfit; onClose: () => void }) {
  const [pick, setPick] = useState(moments[0]?.id ?? "");
  const [note, setNote] = useState<string | null>(null);
  const m = moments.find((x) => x.id === pick) ?? moments[0];
  if (!m) return null;

  const save = async () => {
    try {
      const url = URL.createObjectURL(await drawCard(m, outfit));
      const a = document.createElement("a");
      a.href = url;
      a.download = `milo-${m.id}.png`;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 5000);
      setNote("Saved. Post it from your phone or drop it in TikTok or Instagram.");
    } catch {
      setNote("Couldn't make the image. Try again?");
    }
  };
  const copy = async () => {
    try {
      const blob = await drawCard(m, outfit);
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      setNote("Copied. Paste it anywhere.");
    } catch {
      setNote("Couldn't copy it. Try Save instead.");
    }
  };

  return (
    <div className="hb-approve-wrap" onClick={onClose}>
      <section className="hb-share" role="dialog" aria-label="Share a Milo moment" onClick={(e) => e.stopPropagation()}>
        <div className="hb-share-cards" role="radiogroup" aria-label="Pick a moment">
          {moments.map((x) => (
            <button key={x.id} role="radio" aria-checked={x.id === m.id} className={`hb-share-card ${x.id === m.id ? "on" : ""}`} style={{ background: `linear-gradient(160deg, ${x.from}, ${x.to})` }} onClick={() => (setPick(x.id), setNote(null))}>
              <span className="hb-share-kick">{x.kicker}</span>
              <MiloFrog size={150} mood={x.mood} outfit={outfit} />
              <b>{x.big}</b>
              <span className="hb-share-small">{x.small}</span>
              <span className="hb-share-brand">milo · your study buddy</span>
            </button>
          ))}
        </div>
        <aside className="hb-share-side">
          <h2>Share a Milo moment</h2>
          <p className="hb-muted">Sized for TikTok and Stories. Only what you see on the card goes out: no grades, class names, screenshots or notes.</p>
          <button className="hb-primary hb-big" onClick={() => void save()}>
            Save image
          </button>
          <button className="hb-ghost" onClick={() => void copy()}>
            Copy image
          </button>
          {note && (
            <p className="hb-share-note" role="status">
              {note}
            </p>
          )}
          <button className="hb-link" onClick={onClose}>
            Close
          </button>
        </aside>
      </section>
    </div>
  );
}
