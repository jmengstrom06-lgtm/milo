// Milo's graphs, drawn as SVG: normal curves with shading, function plots, bar/line/scatter/histograms.
// The curve traces itself in and shaded areas fade in, so it feels like Milo is drawing it.

import { useEffect, useMemo, useState } from "react";
import type { GraphSpec } from "./types";

const W = 560;
const H = 300;
const PAD = { l: 46, r: 16, t: 14, b: 38 };
const IW = W - PAD.l - PAD.r;
const IH = H - PAD.t - PAD.b;
const COLORS = ["#a78bfa", "#38bdf8", "#f472b6", "#34d399"];

// ---- tiny safe math parser (no eval) ------------------------------------------------------
type Fn = (x: number) => number;
export function compile(expr: string, scope: Record<string, number> = {}): Fn | null {
  const names = Object.keys(scope).sort((a, b) => b.length - a.length);
  const src = expr.replace(/\s+/g, "").replace(/\*\*/g, "^").replace(/π/g, "pi");
  let i = 0;
  const peek = () => src[i];
  const eat = (c: string) => (src[i] === c ? (i++, true) : false);
  const FUNCS: Record<string, (v: number) => number> = {
    sin: Math.sin, cos: Math.cos, tan: Math.tan, sqrt: Math.sqrt, abs: Math.abs, exp: Math.exp,
    ln: Math.log, log: Math.log10, asin: Math.asin, acos: Math.acos, atan: Math.atan,
  };
  // Grammar: expr = term (('+'|'-') term)* ; term = factor (('*'|'/'|implicit) factor)* ; factor = unary ('^' factor)? ; unary = '-' unary | atom
  function expr_(): Fn {
    let f = term();
    for (;;) {
      if (eat("+")) { const a = f, b = term(); f = (x) => a(x) + b(x); }
      else if (eat("-")) { const a = f, b = term(); f = (x) => a(x) - b(x); }
      else return f;
    }
  }
  function term(): Fn {
    let f = factor();
    for (;;) {
      if (eat("*")) { const a = f, b = factor(); f = (x) => a(x) * b(x); }
      else if (eat("/")) { const a = f, b = factor(); f = (x) => a(x) / b(x); }
      else if (peek() && /[a-z(0-9.]/i.test(peek()!) ) { const a = f, b = factor(); f = (x) => a(x) * b(x); } // 2x, 3(x+1)
      else return f;
    }
  }
  function factor(): Fn {
    const base = unary();
    if (eat("^")) { const e = factor(); return (x) => Math.pow(base(x), e(x)); }
    return base;
  }
  function unary(): Fn {
    if (eat("-")) { const u = unary(); return (x) => -u(x); }
    if (eat("+")) return unary();
    return atom();
  }
  function atom(): Fn {
    if (eat("(")) { const e = expr_(); if (!eat(")")) throw new Error(")"); return e; }
    const num = src.slice(i).match(/^\d*\.?\d+(e[+-]?\d+)?/i);
    if (num) { i += num[0].length; const v = Number(num[0]); return () => v; }
    const ident = src.slice(i).match(/^[a-z_][a-z0-9_]*/i)?.[0];
    if (ident && Object.prototype.hasOwnProperty.call(scope, ident)) {
      i += ident.length;
      return () => scope[ident];
    }
    const word = src.slice(i).match(/^[a-z]+/i)?.[0];
    if (word) {
      const w = word.toLowerCase();
      for (const name of Object.keys(FUNCS).sort((a, b) => b.length - a.length)) {
        if (w.startsWith(name) && src[i + name.length] === "(") { i += name.length; const g = FUNCS[name]; const a = atom(); return (x) => g(a(x)); }
      }
      for (const n of names) {
        if (w.startsWith(n.toLowerCase())) { i += n.length; return () => scope[n]; }
      }
      if (w.startsWith("pi")) { i += 2; return () => Math.PI; }
      if (w[0] === "x") { i += 1; return (x) => x; }
      if (w[0] === "e") { i += 1; return () => Math.E; }
    }
    throw new Error(`Unexpected "${src.slice(i, i + 6)}"`);
  }
  try {
    const f = expr_();
    if (i !== src.length) return null;
    return f;
  } catch {
    return null;
  }
}

// ---- helpers ----------------------------------------------------------------------------------
function niceTicks(lo: number, hi: number, n = 6) {
  const span = hi - lo || 1;
  const step0 = span / n;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= n) ?? step0;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}
const fmt = (v: number) => (Math.abs(v) >= 1000 ? v.toLocaleString() : +v.toFixed(Math.abs(v) < 1 ? 3 : 2) + "");
const pdf = (x: number, m: number, s: number) => Math.exp(-0.5 * ((x - m) / s) ** 2) / (s * Math.sqrt(2 * Math.PI));
function erf(x: number) {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
}
export const normCdf = (x: number, m: number, s: number) => 0.5 * (1 + erf((x - m) / (s * Math.SQRT2)));
/** Quantile of a sorted array (linear interpolation, like Excel's QUARTILE.INC). */
export function quantile(sorted: number[], q: number) {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

const KEEP = ["fill", "fill-opacity", "stroke", "stroke-width", "stroke-opacity", "stroke-linecap", "stroke-linejoin", "opacity", "font-size", "font-family", "font-weight", "text-anchor"];
/** Turn a drawn chart into a PNG (dark background, 2x) for copying or saving. */
export async function svgToPng(svg: SVGSVGElement, title = ""): Promise<string> {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const src = svg.querySelectorAll("*"), dst = clone.querySelectorAll("*");
  src.forEach((el, i) => {
    const cs = getComputedStyle(el);
    const out = dst[i] as SVGElement;
    out.removeAttribute("class");
    const style = KEEP.map((k) => `${k}:${cs.getPropertyValue(k)}`).join(";");
    const dash = el.classList.contains("gr-dash") || el.classList.contains("gr-zero") || el.classList.contains("gr-median") ? `;stroke-dasharray:${cs.getPropertyValue("stroke-dasharray")}` : ";stroke-dasharray:none";
    out.setAttribute("style", `${style}${dash};animation:none${el.hasAttribute("transform") ? "" : ";transform:none"}`);
  });
  const vb = svg.viewBox.baseVal;
  const top = title ? 34 : 0;
  const w = vb.width, h = vb.height + top;
  clone.setAttribute("width", String(w));
  clone.setAttribute("height", String(vb.height));
  const xml = new XMLSerializer().serializeToString(clone);
  const img = new Image();
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml);
  await img.decode();
  const k = 2;
  const c = document.createElement("canvas");
  c.width = w * k;
  c.height = h * k;
  const g = c.getContext("2d")!;
  g.scale(k, k);
  g.fillStyle = "#17131f";
  g.fillRect(0, 0, w, h);
  if (title) {
    g.fillStyle = "#ece9f5";
    g.font = "600 16px Inter, -apple-system, sans-serif";
    g.fillText(title, 16, 24);
  }
  g.drawImage(img, 0, top, w, vb.height);
  return c.toDataURL("image/png");
}

function Axes({ x0, x1, y0, y1, xl, yl, xticks, yticks, xLabels }: { x0: number; x1: number; y0: number; y1: number; xl?: string; yl?: string; xticks: number[]; yticks: number[]; xLabels?: string[] }) {
  const sx = (v: number) => PAD.l + ((v - x0) / (x1 - x0 || 1)) * IW;
  const sy = (v: number) => PAD.t + IH - ((v - y0) / (y1 - y0 || 1)) * IH;
  return (
    <g className="gr-axes">
      {yticks.map((t) => (
        <g key={`y${t}`}>
          <line x1={PAD.l} x2={W - PAD.r} y1={sy(t)} y2={sy(t)} className="gr-grid" />
          <text x={PAD.l - 6} y={sy(t) + 4} textAnchor="end">{fmt(t)}</text>
        </g>
      ))}
      {xLabels
        ? xLabels.map((l, i) => (
            <text key={`x${i}`} x={PAD.l + ((i + 0.5) / xLabels.length) * IW} y={H - PAD.b + 16} textAnchor="middle">{l.length > 10 ? l.slice(0, 9) + "…" : l}</text>
          ))
        : xticks.map((t) => (
            <text key={`x${t}`} x={sx(t)} y={H - PAD.b + 16} textAnchor="middle">{fmt(t)}</text>
          ))}
      <line x1={PAD.l} x2={W - PAD.r} y1={PAD.t + IH} y2={PAD.t + IH} className="gr-axis" />
      {xl && <text x={PAD.l + IW / 2} y={H - 4} textAnchor="middle" className="gr-label">{xl}</text>}
      {yl && <text x={12} y={PAD.t + IH / 2} textAnchor="middle" className="gr-label" transform={`rotate(-90 12 ${PAD.t + IH / 2})`}>{yl}</text>}
    </g>
  );
}

// ---- the graph ---------------------------------------------------------------------------
type Slider = { key: string; label: string; min: number; max: number; step: number; value: number };

function slidersFor(spec: GraphSpec): Slider[] {
  if (spec.type === "normal") {
    const s = spec.sd;
    const out: Slider[] = [
      { key: "mean", label: "mean μ", min: spec.mean - 3 * s, max: spec.mean + 3 * s, step: s / 20, value: spec.mean },
      { key: "sd", label: "std dev σ", min: s / 4, max: s * 3, step: s / 40, value: s },
    ];
    if (spec.shadeFrom != null) out.push({ key: "shadeFrom", label: "from", min: spec.mean - 4 * s, max: spec.mean + 4 * s, step: s / 20, value: spec.shadeFrom });
    if (spec.shadeTo != null) out.push({ key: "shadeTo", label: "to", min: spec.mean - 4 * s, max: spec.mean + 4 * s, step: s / 20, value: spec.shadeTo });
    return out;
  }
  if (spec.type === "function" && spec.params?.length) {
    return spec.params.map((p) => ({ key: p.name, label: p.name, min: p.min, max: p.max, step: (p.max - p.min) / 100 || 0.1, value: p.value }));
  }
  return [];
}

export default function Graph({ spec, animate = true, interactive = false, svgRef }: { spec: GraphSpec; animate?: boolean; interactive?: boolean; svgRef?: React.Ref<SVGSVGElement> }) {
  const sliders = useMemo(() => (interactive ? slidersFor(spec) : []), [spec, interactive]);
  const [vals, setVals] = useState<Record<string, number>>({});
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    setVals(Object.fromEntries(sliders.map((s) => [s.key, s.value])));
    setTouched(false);
  }, [sliders]);
  const live: GraphSpec = useMemo(() => {
    if (!sliders.length) return spec;
    if (spec.type === "normal") return { ...spec, ...vals } as GraphSpec;
    return spec;
  }, [spec, vals, sliders]);
  const scope = spec.type === "function" ? vals : undefined;
  const body = useMemo(() => render(live, scope), [live, scope]);
  return (
    <div className="graph-wrap">
      <svg ref={svgRef} className={`graph ${animate && !touched ? "graph--draw" : ""}`} viewBox={`0 0 ${W} ${H}`} role="img">
        {body ?? <text x={W / 2} y={H / 2} textAnchor="middle" className="gr-label">Couldn't draw that one.</text>}
      </svg>
      {sliders.length > 0 && (
        <div className="gr-sliders">
          {sliders.map((s) => (
            <label key={s.key} className="gr-slider">
              <span className="gr-slider__name">{s.label}</span>
              <input
                type="range"
                min={s.min}
                max={s.max}
                step={s.step}
                value={vals[s.key] ?? s.value}
                onChange={(e) => {
                  setTouched(true);
                  setVals((v) => ({ ...v, [s.key]: Number(e.target.value) }));
                }}
              />
              <span className="gr-slider__val">{fmt(vals[s.key] ?? s.value)}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function render(spec: GraphSpec, scope: Record<string, number> = {}): JSX.Element | null {
  try {
    switch (spec.type) {
      case "normal": {
        const { mean: m, sd: s } = spec;
        if (!(s > 0)) return null;
        const x0 = m - 4 * s, x1 = m + 4 * s, top = pdf(m, m, s) * 1.12;
        const sx = (v: number) => PAD.l + ((v - x0) / (x1 - x0)) * IW;
        const sy = (v: number) => PAD.t + IH - (v / top) * IH;
        const N = 200;
        const pts = Array.from({ length: N + 1 }, (_, k) => x0 + ((x1 - x0) * k) / N);
        const curve = pts.map((x, k) => `${k ? "L" : "M"}${sx(x).toFixed(1)},${sy(pdf(x, m, s)).toFixed(1)}`).join("");
        const a = spec.shadeFrom ?? null, b = spec.shadeTo ?? null;
        const hasShade = a !== null || b !== null;
        const lo = Math.max(x0, a ?? x0), hi = Math.min(x1, b ?? x1);
        const shadePts = pts.filter((x) => x >= lo && x <= hi);
        const shade = hasShade && shadePts.length
          ? `M${sx(lo)},${sy(0)}` + [lo, ...shadePts, hi].map((x) => `L${sx(x).toFixed(1)},${sy(pdf(x, m, s)).toFixed(1)}`).join("") + `L${sx(hi)},${sy(0)}Z`
          : "";
        const area = hasShade ? normCdf(b ?? Infinity, m, s) - normCdf(a ?? -Infinity, m, s) : 0;
        const ticks = [-3, -2, -1, 0, 1, 2, 3].map((z) => m + z * s);
        return (
          <>
            <Axes x0={x0} x1={x1} y0={0} y1={top} xl={spec.xlabel} xticks={ticks} yticks={[]} />
            {shade && <path d={shade} className="gr-shade" />}
            <path d={curve} className="gr-line" pathLength={1} />
            {[a, b].filter((v): v is number => v !== null && v > x0 && v < x1).map((v) => (
              <g key={v} className="gr-marker">
                <line x1={sx(v)} x2={sx(v)} y1={sy(0)} y2={sy(pdf(v, m, s))} />
                <text x={sx(v)} y={sy(pdf(v, m, s)) - 8} textAnchor="middle">{fmt(v)}</text>
              </g>
            ))}
            {(spec.markers ?? []).map((v) => (
              <line key={`m${v}`} x1={sx(v)} x2={sx(v)} y1={PAD.t} y2={sy(0)} className="gr-dash" />
            ))}
            {hasShade && (
              <text x={W - PAD.r - 4} y={PAD.t + 16} textAnchor="end" className="gr-area">
                area = {area.toFixed(4)}
              </text>
            )}
          </>
        );
      }
      case "function": {
        const fns = spec.exprs.map((e) => compile(e, { ...Object.fromEntries((spec.params ?? []).map((p) => [p.name, p.value])), ...scope }));
        if (fns.some((f) => !f)) return null;
        const x0 = spec.xmin, x1 = spec.xmax;
        const N = 300;
        const series = fns.map((f) => Array.from({ length: N + 1 }, (_, k) => { const x = x0 + ((x1 - x0) * k) / N; return [x, f!(x)] as [number, number]; }));
        const ys = series.flat().map((p) => p[1]).filter((v) => Number.isFinite(v));
        let y0 = spec.ymin ?? Math.min(0, ...ys), y1 = spec.ymax ?? Math.max(0, ...ys);
        // With sliders, keep the frame steady (based on the starting curve) so you can SEE it move.
        if (spec.params?.length && spec.ymin === undefined && spec.ymax === undefined) {
          const base = spec.exprs.map((e) => compile(e, Object.fromEntries(spec.params!.map((p) => [p.name, p.value]))));
          const bys = base.flatMap((f) => Array.from({ length: 101 }, (_, k) => f!(x0 + ((x1 - x0) * k) / 100))).filter(Number.isFinite);
          const spread = Math.max(...bys) - Math.min(...bys) || 2;
          y0 = Math.min(...bys) - spread * 0.6;
          y1 = Math.max(...bys) + spread * 0.6;
        } else if (spec.ymin === undefined || spec.ymax === undefined) {
          // keep asymptotes from flattening everything
          const sorted = [...ys].sort((p, q) => p - q);
          if (spec.ymin === undefined) y0 = Math.min(0, sorted[Math.floor(sorted.length * 0.02)] ?? y0);
          if (spec.ymax === undefined) y1 = Math.max(0, sorted[Math.floor(sorted.length * 0.98)] ?? y1);
        }
        if (y1 - y0 < 1e-9) { y0 -= 1; y1 += 1; }
        const pad = (y1 - y0) * 0.08;
        y0 -= pad; y1 += pad;
        const sx = (v: number) => PAD.l + ((v - x0) / (x1 - x0)) * IW;
        const sy = (v: number) => PAD.t + IH - ((v - y0) / (y1 - y0)) * IH;
        const path = (s: [number, number][]) => {
          let d = "", pen = false;
          for (const [x, y] of s) {
            if (!Number.isFinite(y) || y < y0 - (y1 - y0) || y > y1 + (y1 - y0)) { pen = false; continue; }
            d += `${pen ? "L" : "M"}${sx(x).toFixed(1)},${sy(y).toFixed(1)}`;
            pen = true;
          }
          return d;
        };
        return (
          <>
            <Axes x0={x0} x1={x1} y0={y0} y1={y1} xticks={niceTicks(x0, x1)} yticks={niceTicks(y0, y1, 5)} />
            {y0 < 0 && y1 > 0 && <line x1={PAD.l} x2={W - PAD.r} y1={sy(0)} y2={sy(0)} className="gr-zero" />}
            {x0 < 0 && x1 > 0 && <line x1={sx(0)} x2={sx(0)} y1={PAD.t} y2={PAD.t + IH} className="gr-zero" />}
            {series.map((s, k) => (
              <path key={k} d={path(s)} className="gr-line" style={{ stroke: COLORS[k % COLORS.length] }} pathLength={1} />
            ))}
            {(spec.points ?? []).map((p, k) => (
              <g key={`p${k}`} className="gr-point">
                <circle cx={sx(p.x)} cy={sy(p.y)} r={4} />
                {p.label && <text x={sx(p.x) + 7} y={sy(p.y) - 7}>{p.label}</text>}
              </g>
            ))}
            {spec.exprs.length > 1 &&
              spec.exprs.map((e, k) => (
                <text key={`l${k}`} x={W - PAD.r - 4} y={PAD.t + 14 + k * 16} textAnchor="end" className="gr-legend" style={{ fill: COLORS[k % COLORS.length] }}>y = {e}</text>
              ))}
          </>
        );
      }
      case "bar":
      case "line": {
        const vals = spec.values.map(Number);
        const y1 = Math.max(0, ...vals) * 1.12 || 1, y0 = Math.min(0, ...vals);
        const n = vals.length;
        const sy = (v: number) => PAD.t + IH - ((v - y0) / (y1 - y0)) * IH;
        const cx = (i: number) => PAD.l + ((i + 0.5) / n) * IW;
        const bw = (IW / n) * 0.62;
        return (
          <>
            <Axes x0={0} x1={1} y0={y0} y1={y1} xl={spec.xlabel} yl={spec.ylabel} xticks={[]} yticks={niceTicks(y0, y1, 5)} xLabels={spec.labels} />
            {spec.type === "bar"
              ? vals.map((v, i) => (
                  <g key={i} className="gr-bar" style={{ animationDelay: `${i * 60}ms` }}>
                    <rect x={cx(i) - bw / 2} y={Math.min(sy(v), sy(0))} width={bw} height={Math.abs(sy(v) - sy(0))} rx={4} />
                    <text x={cx(i)} y={sy(v) - 6} textAnchor="middle">{fmt(v)}</text>
                  </g>
                ))
              : (
                <>
                  <path d={vals.map((v, i) => `${i ? "L" : "M"}${cx(i)},${sy(v)}`).join("")} className="gr-line" pathLength={1} />
                  {vals.map((v, i) => <circle key={i} cx={cx(i)} cy={sy(v)} r={3.5} className="gr-dot" />)}
                </>
              )}
          </>
        );
      }
      case "scatter": {
        const xs = spec.points.map((p) => p.x), ys = spec.points.map((p) => p.y);
        const [x0, x1] = [Math.min(...xs), Math.max(...xs)], [ya, yb] = [Math.min(...ys), Math.max(...ys)];
        const px = (x1 - x0) * 0.08 || 1, py = (yb - ya) * 0.1 || 1;
        const X0 = x0 - px, X1 = x1 + px, Y0 = ya - py, Y1 = yb + py;
        const sx = (v: number) => PAD.l + ((v - X0) / (X1 - X0)) * IW;
        const sy = (v: number) => PAD.t + IH - ((v - Y0) / (Y1 - Y0)) * IH;
        let fit: JSX.Element | null = null;
        if (spec.fit && xs.length > 1) {
          const n = xs.length, mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
          const b1 = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / (xs.reduce((a, x) => a + (x - mx) ** 2, 0) || 1);
          const b0 = my - b1 * mx;
          const r = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) /
            Math.sqrt(xs.reduce((a, x) => a + (x - mx) ** 2, 0) * ys.reduce((a, y) => a + (y - my) ** 2, 0) || 1);
          fit = (
            <>
              <path d={`M${sx(X0)},${sy(b0 + b1 * X0)}L${sx(X1)},${sy(b0 + b1 * X1)}`} className="gr-line" pathLength={1} />
              <text x={W - PAD.r - 4} y={PAD.t + 14} textAnchor="end" className="gr-area">ŷ = {fmt(b0)} + {fmt(b1)}x · r = {r.toFixed(3)}</text>
            </>
          );
        }
        return (
          <>
            <Axes x0={X0} x1={X1} y0={Y0} y1={Y1} xl={spec.xlabel} yl={spec.ylabel} xticks={niceTicks(X0, X1)} yticks={niceTicks(Y0, Y1, 5)} />
            {spec.points.map((p, i) => <circle key={i} cx={sx(p.x)} cy={sy(p.y)} r={4} className="gr-dot gr-pop" style={{ animationDelay: `${i * 25}ms` }} />)}
            {fit}
          </>
        );
      }
      case "histogram": {
        const v = spec.values.map(Number).filter(Number.isFinite);
        if (!v.length) return null;
        // Clean bin edges (40, 50, 60... not 41, 54.3, 67.6) like a textbook histogram.
        const want = Math.max(3, Math.min(30, spec.bins ?? Math.max(5, Math.ceil(Math.log2(v.length)) + 1)));
        const vmin = Math.min(...v), vmax = Math.max(...v);
        const rawW = (vmax - vmin) / want || 1;
        const mag = Math.pow(10, Math.floor(Math.log10(rawW)));
        const w = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((x) => x >= rawW * 0.92) ?? 10 * mag;
        const lo = Math.floor(vmin / w) * w;
        const bins = Math.max(1, Math.floor((vmax - lo) / w + 1e-9) + 1);
        const hi = lo + bins * w;
        const counts = Array(bins).fill(0);
        v.forEach((x) => counts[Math.min(bins - 1, Math.floor((x - lo) / w + 1e-9))]++);
        const top = Math.max(...counts) * 1.25;
        const sx = (x: number) => PAD.l + ((x - lo) / (hi - lo || 1)) * IW;
        const sy = (c: number) => PAD.t + IH - (c / top) * IH;
        const sorted = [...v].sort((a, b) => a - b);
        const mean = v.reduce((a, b) => a + b, 0) / v.length;
        const median = quantile(sorted, 0.5);
        return (
          <>
            <Axes x0={lo} x1={hi} y0={0} y1={top} xl={spec.xlabel} yl="count" xticks={bins <= 12 ? Array.from({ length: bins + 1 }, (_, k) => +(lo + k * w).toFixed(6)) : niceTicks(lo, hi)} yticks={niceTicks(0, top, 4)} />
            {counts.map((c, i) => (
              <g key={i}>
                <rect className="gr-bar" style={{ animationDelay: `${i * 40}ms` }} x={sx(lo + i * w) + 1} y={sy(c)} width={Math.max(1, sx(lo + (i + 1) * w) - sx(lo + i * w) - 2)} height={sy(0) - sy(c)} rx={2} />
                {c > 0 && bins <= 16 && <text className="gr-count" x={(sx(lo + i * w) + sx(lo + (i + 1) * w)) / 2} y={sy(c) - 5} textAnchor="middle">{c}</text>}
              </g>
            ))}
            {spec.stats && (
              <>
                <line x1={sx(mean)} x2={sx(mean)} y1={PAD.t + 24} y2={sy(0)} className="gr-mean" />
                <line x1={sx(median)} x2={sx(median)} y1={PAD.t + 24} y2={sy(0)} className="gr-median" />
                <text x={W - PAD.r - 4} y={PAD.t + 10} textAnchor="end" className="gr-key"><tspan className="gr-key-mean">— mean {fmt(+mean.toFixed(2))}</tspan>   <tspan className="gr-key-median">┆ median {fmt(+median.toFixed(2))}</tspan></text>
              </>
            )}
          </>
        );
      }
      case "box": {
        const groups = spec.groups.map((g) => ({ label: g.label, v: g.values.map(Number).filter(Number.isFinite).sort((a, b) => a - b) })).filter((g) => g.v.length);
        if (!groups.length) return null;
        const all = groups.flatMap((g) => g.v);
        const lo = Math.min(...all), hi = Math.max(...all), pad = (hi - lo) * 0.08 || 1;
        const y0 = lo - pad, y1 = hi + pad;
        const sy = (x: number) => PAD.t + IH - ((x - y0) / (y1 - y0)) * IH;
        const n = groups.length;
        const cx = (i: number) => PAD.l + ((i + 0.5) / n) * IW;
        const bw = Math.min(110, (IW / n) * 0.45);
        return (
          <>
            <Axes x0={0} x1={1} y0={y0} y1={y1} xl={spec.xlabel} xticks={[]} yticks={niceTicks(y0, y1, 5)} xLabels={n > 1 ? groups.map((g) => g.label) : [groups[0].label]} />
            {groups.map((g, i) => {
              const q1 = quantile(g.v, 0.25), q2 = quantile(g.v, 0.5), q3 = quantile(g.v, 0.75), iqr = q3 - q1;
              const fenceLo = q1 - 1.5 * iqr, fenceHi = q3 + 1.5 * iqr;
              const inside = g.v.filter((x) => x >= fenceLo && x <= fenceHi);
              const wLo = Math.min(...inside), wHi = Math.max(...inside);
              const outliers = g.v.filter((x) => x < fenceLo || x > fenceHi);
              const x = cx(i);
              return (
                <g key={i} className="gr-box" style={{ animationDelay: `${i * 90}ms` }}>
                  <line x1={x} x2={x} y1={sy(wLo)} y2={sy(q1)} />
                  <line x1={x} x2={x} y1={sy(q3)} y2={sy(wHi)} />
                  <line x1={x - bw / 4} x2={x + bw / 4} y1={sy(wLo)} y2={sy(wLo)} />
                  <line x1={x - bw / 4} x2={x + bw / 4} y1={sy(wHi)} y2={sy(wHi)} />
                  <rect x={x - bw / 2} y={sy(q3)} width={bw} height={Math.max(1, sy(q1) - sy(q3))} rx={4} />
                  <line x1={x - bw / 2} x2={x + bw / 2} y1={sy(q2)} y2={sy(q2)} className="gr-box-med" />
                  {outliers.map((o, k) => <circle key={k} cx={x} cy={sy(o)} r={4} className="gr-outlier" />)}
                  {n === 1 && (
                    <g className="gr-box-labels">
                      {[["min", wLo], ["Q1", q1], ["median", q2], ["Q3", q3], ["max", wHi]].map(([l, val]) => (
                        <text key={l as string} x={x + bw / 2 + 10} y={sy(val as number) + 4}>{l} {fmt(+(val as number).toFixed(2))}</text>
                      ))}
                      {outliers.length > 0 && <text x={x - bw / 2 - 10} y={sy(outliers[0]) + 4} textAnchor="end">outlier{outliers.length > 1 ? "s" : ""}</text>}
                    </g>
                  )}
                </g>
              );
            })}
          </>
        );
      }
      case "pie": {
        const vals = spec.values.map(Number).map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
        const total = vals.reduce((a, b) => a + b, 0);
        if (!total) return null;
        const cx = W * 0.36, cy = H / 2, r = H * 0.4;
        const PIE = ["#a78bfa", "#38bdf8", "#34d399", "#f472b6", "#fbbf24", "#fb923c", "#60a5fa", "#c084fc", "#2dd4bf", "#f87171"];
        let a0 = -Math.PI / 2;
        return (
          <>
            {vals.map((v, i) => {
              const a1 = a0 + (v / total) * Math.PI * 2;
              const large = a1 - a0 > Math.PI ? 1 : 0;
              const d = vals.filter((x) => x > 0).length === 1
                ? `M${cx},${cy - r}A${r},${r} 0 1 1 ${cx - 0.01},${cy - r}Z`
                : `M${cx},${cy}L${cx + r * Math.cos(a0)},${cy + r * Math.sin(a0)}A${r},${r} 0 ${large} 1 ${cx + r * Math.cos(a1)},${cy + r * Math.sin(a1)}Z`;
              const mid = (a0 + a1) / 2;
              a0 = a1;
              const pct = (v / total) * 100;
              return (
                <g key={i} className="gr-slice" style={{ animationDelay: `${Math.min(i, 10) * 60}ms` }}>
                  <path d={d} style={{ fill: PIE[i % PIE.length] }} />
                  {pct >= 6 && <text x={cx + r * 0.64 * Math.cos(mid)} y={cy + r * 0.64 * Math.sin(mid) + 4} textAnchor="middle" className="gr-slice-pct">{pct.toFixed(0)}%</text>}
                </g>
              );
            })}
            {spec.labels.slice(0, 10).map((l, i) => (
              <g key={`k${i}`} className="gr-pie-key">
                <rect x={W * 0.7} y={PAD.t + 10 + i * 24} width={12} height={12} rx={3} style={{ fill: PIE[i % PIE.length] }} />
                <text x={W * 0.7 + 20} y={PAD.t + 21 + i * 24}>{l.length > 18 ? l.slice(0, 17) + "…" : l} · {fmt(vals[i])}</text>
              </g>
            ))}
          </>
        );
      }
    }
  } catch {
    return null;
  }
  return null;
}
