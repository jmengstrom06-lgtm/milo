// Sheet: an editable table with live stats. Talk to it: "add a z-score column", "sort by score",
// "only show scores above the mean", "graph hours vs score", "who's above average?".
// The AI picks the operations; every number is computed right here.

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import Graph, { compile, quantile, svgToPng } from "./Graph";
import { KitLoading } from "./KitPanel";
import type { ChartKind, ChartPick, GraphSpec, Table, TableOp } from "./types";

type Cell = string | number;
type Stats = { n: number; mean: number; median: number; sd: number; min: number; max: number; sum: number };

export function colStats(nums: number[]): Stats | null {
  const n = nums.length;
  if (!n) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mean = nums.reduce((a, b) => a + b, 0) / n;
  const median = n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  const sd = n > 1 ? Math.sqrt(nums.reduce((a, x) => a + (x - mean) ** 2, 0) / (n - 1)) : 0;
  return { n, mean, median, sd, min: s[0], max: s[n - 1], sum: nums.reduce((a, b) => a + b, 0) };
}
const num = (v: Cell) => (typeof v === "number" ? v : Number(String(v).replace(/[$,%\s]/g, "")));
const isNumCol = (rows: Cell[][], c: number) => {
  const vals = rows.map((r) => r[c]).filter((v) => v !== "" && v !== undefined && v !== null);
  return vals.length > 0 && vals.every((v) => Number.isFinite(num(v)));
};
const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(3).replace(/\.?0+$/, ""));

// ---- example data Milo generates himself (exact, instant, any shape) --------------------------
function gauss() {
  let u = 0, v = 0;
  while (!u) u = Math.random();
  while (!v) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
export function sampleValues(o: { dist: string; n: number; mean?: number; sd?: number; min?: number; max?: number; decimals?: number }): number[] {
  const n = Math.max(3, Math.min(500, Math.round(o.n) || 30));
  let raw: number[];
  if (o.dist === "uniform") {
    const lo = o.min ?? (o.mean !== undefined ? o.mean - (o.sd ?? 10) * 1.7 : 0), hi = o.max ?? (o.mean !== undefined ? o.mean + (o.sd ?? 10) * 1.7 : 100);
    raw = Array.from({ length: n }, () => lo + Math.random() * (hi - lo));
  } else {
    const base = Array.from({ length: n }, () => {
      const z = gauss();
      if (o.dist === "skewed_right") return Math.exp(0.65 * z);
      if (o.dist === "skewed_left") return -Math.exp(0.65 * z);
      if (o.dist === "bimodal") return (Math.random() < 0.5 ? -1.4 : 1.4) + 0.55 * z;
      return z;
    });
    // rescale to the mean / sd they asked for (or fit min..max)
    const m = base.reduce((a, b) => a + b, 0) / n;
    const sd = Math.sqrt(base.reduce((a, x) => a + (x - m) ** 2, 0) / (n - 1)) || 1;
    const tm = o.mean ?? (o.min !== undefined && o.max !== undefined ? (o.min + o.max) / 2 : 70);
    const ts = o.sd ?? (o.min !== undefined && o.max !== undefined ? (o.max - o.min) / 6 : 10);
    raw = base.map((x) => tm + ((x - m) / sd) * ts);
  }
  const d = o.decimals ?? (Math.abs(o.mean ?? 70) >= 20 ? 0 : 1);
  return raw.map((x) => {
    let v = x;
    if (o.min !== undefined) v = Math.max(o.min, v);
    if (o.max !== undefined) v = Math.min(o.max, v);
    return +v.toFixed(Math.max(0, Math.min(4, d)));
  });
}

const blank = (rows: Cell[][]) => rows.every((r) => r.every((v) => v === "" || v === null || v === undefined));

/** Apply the AI's operations to the table. Every number is computed here. */
export function applyOps(cols: string[], rows: Cell[][], ops: TableOp[]): { cols: string[]; rows: Cell[][]; chart: ChartPick | null; title?: string; error?: string } {
  let C = [...cols];
  let R = rows.map((r) => [...r]);
  let chart: ChartPick | null = null;
  let title: string | undefined;
  const idx = (name: string) => colIndex(C, name);
  const aggScope = () => {
    const sc: Record<string, number> = {};
    C.forEach((_, k) => {
      if (!isNumCol(R, k)) return;
      const st = colStats(R.map((r) => num(r[k])));
      if (!st) return;
      Object.assign(sc, { [`mean_c${k}`]: st.mean, [`sd_c${k}`]: st.sd, [`median_c${k}`]: st.median, [`min_c${k}`]: st.min, [`max_c${k}`]: st.max, [`sum_c${k}`]: st.sum, [`n_c${k}`]: st.n });
    });
    return sc;
  };
  for (const o of ops) {
    if (o.op === "set_table") {
      if (!Array.isArray(o.columns) || !o.columns.length) continue;
      C = o.columns.map(String);
      R = (Array.isArray(o.rows) ? o.rows : []).slice(0, 500).map((r) => C.map((_, k) => (r?.[k] ?? "") as Cell));
      if (o.title) title = o.title;
    } else if (o.op === "sample") {
      const fresh = blank(R) || !R.length;
      const vals = sampleValues({ ...o, n: fresh ? o.n : R.length });
      if (fresh) {
        C = [o.name || "Value"];
        R = vals.map((v) => [v]);
      } else {
        C = [...C, o.name || "Value"];
        R = R.map((r, i) => [...r, vals[i]]);
      }
    } else if (o.op === "add_column") {
      const base = aggScope();
      const row: Record<string, number> = { ...base };
      C.forEach((_, k) => (row[`c${k}`] = 0));
      const f = compile(o.expr, row);
      if (!f) return { cols: C, rows: R, chart, title, error: `I couldn't work out "${o.expr}".` };
      C = [...C, o.name || "New"];
      R = R.map((r) => {
        C.slice(0, -1).forEach((_, k) => (row[`c${k}`] = num(r[k])));
        const v = f(0);
        return [...r, Number.isFinite(v) ? +v.toFixed(4) : ""];
      });
    } else if (o.op === "sort") {
      const k = idx(o.column);
      if (k < 0) continue;
      const numeric = isNumCol(R, k);
      R.sort((a, b) => (numeric ? num(a[k]) - num(b[k]) : String(a[k]).localeCompare(String(b[k]))) * (o.desc ? -1 : 1));
    } else if (o.op === "filter") {
      const k = idx(o.column);
      if (k < 0) continue;
      const st = isNumCol(R, k) ? colStats(R.map((r) => num(r[k]))) : null;
      const raw = String(o.value).toLowerCase();
      const target = st && raw in st ? (st as unknown as Record<string, number>)[raw] : Number.isFinite(Number(o.value)) ? Number(o.value) : null;
      R = R.filter((r) => {
        const v = target !== null ? num(r[k]) : String(r[k]).toLowerCase();
        const t = target !== null ? target : raw;
        switch (o.cmp) {
          case ">": return v > t;
          case "<": return v < t;
          case ">=": return v >= t;
          case "<=": return v <= t;
          case "=": return v === t;
          case "!=": return v !== t;
        }
        return true;
      });
    } else if (o.op === "remove_column") {
      const k = idx(o.column);
      if (k < 0) continue;
      C = C.filter((_, j) => j !== k);
      R = R.map((r) => r.filter((_, j) => j !== k));
    } else if (o.op === "rename_column") {
      const k = idx(o.column);
      if (k >= 0) C[k] = o.to;
    } else if (o.op === "add_row") {
      R = [...(blank(R) ? [] : R), C.map((_, k) => o.values?.[k] ?? "")];
    } else if (o.op === "graph") {
      chart = { kind: o.kind, y: o.y, x: o.x, bins: o.bins };
    }
  }
  return { cols: C, rows: R, chart, title };
}

function colIndex(C: string[], name?: string) {
  if (!name) return -1;
  const n = String(name).toLowerCase();
  const k = C.findIndex((c) => c.toLowerCase() === n);
  return k >= 0 ? k : C.findIndex((c) => c.toLowerCase().includes(n) || n.includes(c.toLowerCase()));
}

// ---- turn a chart pick into a drawn chart + a one-line read of it ---------------------------
export function buildChart(pick: ChartPick, C: string[], R: Cell[][]): { spec: GraphSpec; title: string; read: string } | null {
  const rows = R.filter((r) => r.some((v) => v !== "" && v !== null && v !== undefined));
  if (!rows.length) return null;
  let y = colIndex(C, pick.y);
  let x = colIndex(C, pick.x);
  const numCols = C.map((_, k) => k).filter((k) => isNumCol(rows, k));
  const textCols = C.map((_, k) => k).filter((k) => !isNumCol(rows, k));
  if (y < 0) y = pick.kind === "pie" || pick.kind === "bar" ? (numCols[0] ?? textCols[0] ?? 0) : (numCols[0] ?? -1);
  if (y < 0) return null;
  const f = (v: number) => fmt(+v.toFixed(2));
  const numsOf = (k: number) => rows.map((r) => num(r[k])).filter(Number.isFinite);

  if (pick.kind === "histogram") {
    if (!isNumCol(rows, y)) return null;
    const v = numsOf(y);
    const st = colStats(v)!;
    const s = [...v].sort((a, b) => a - b);
    const q1 = quantile(s, 0.25), q3 = quantile(s, 0.75), iqr = q3 - q1;
    const out = s.filter((a) => a < q1 - 1.5 * iqr || a > q3 + 1.5 * iqr).length;
    const skew = st.sd ? (3 * (st.mean - st.median)) / st.sd : 0;
    const shape = Math.abs(skew) < 0.25 ? "Roughly symmetric" : `${Math.abs(skew) < 0.6 ? "Slightly skewed" : "Skewed"} ${skew > 0 ? "right" : "left"}`;
    const why = skew > 0.25 ? ` (mean ${f(st.mean)} > median ${f(st.median)})` : skew < -0.25 ? ` (mean ${f(st.mean)} < median ${f(st.median)})` : ` (mean ${f(st.mean)} ≈ median ${f(st.median)})`;
    return {
      spec: { type: "histogram", values: v, bins: pick.bins, xlabel: C[y], stats: true },
      title: `Distribution of ${C[y]}`,
      read: `${shape}${why}. Center ${f(st.median)}, spread sd ${f(st.sd)}, range ${f(st.min)} to ${f(st.max)}.${out ? ` ${out} outlier${out > 1 ? "s" : ""} by the 1.5×IQR rule.` : " No outliers."}`,
    };
  }
  if (pick.kind === "box") {
    if (!isNumCol(rows, y)) return null;
    const g = x >= 0 && !isNumCol(rows, x) ? x : -1;
    const groups = g >= 0
      ? [...new Set(rows.map((r) => String(r[g])))].slice(0, 8).map((label) => ({ label, values: rows.filter((r) => String(r[g]) === label).map((r) => num(r[y])).filter(Number.isFinite) }))
      : [{ label: C[y], values: numsOf(y) }];
    const s = [...groups[0].values].sort((a, b) => a - b);
    const q1 = quantile(s, 0.25), q3 = quantile(s, 0.75);
    return {
      spec: { type: "box", groups, xlabel: g >= 0 ? C[g] : undefined },
      title: g >= 0 ? `${C[y]} by ${C[g]}` : `Box plot of ${C[y]}`,
      read: g >= 0
        ? groups.map((gr) => `${gr.label}: median ${f(quantile([...gr.values].sort((a, b) => a - b), 0.5))}`).join(" · ")
        : `Five-number summary: ${f(s[0])}, ${f(q1)}, ${f(quantile(s, 0.5))}, ${f(q3)}, ${f(s[s.length - 1])}. IQR = ${f(q3 - q1)}.`,
    };
  }
  if (pick.kind === "scatter") {
    if (x < 0 || !isNumCol(rows, x)) x = numCols.find((k) => k !== y) ?? -1;
    if (x < 0 || !isNumCol(rows, y)) return null;
    const pts = rows.map((r) => ({ x: num(r[x]), y: num(r[y]) })).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
    const n = pts.length, mx = pts.reduce((a, p) => a + p.x, 0) / n, my = pts.reduce((a, p) => a + p.y, 0) / n;
    const sxy = pts.reduce((a, p) => a + (p.x - mx) * (p.y - my), 0), sxx = pts.reduce((a, p) => a + (p.x - mx) ** 2, 0), syy = pts.reduce((a, p) => a + (p.y - my) ** 2, 0);
    const r = sxy / Math.sqrt(sxx * syy || 1);
    const strength = Math.abs(r) > 0.8 ? "strong" : Math.abs(r) > 0.5 ? "moderate" : Math.abs(r) > 0.25 ? "weak" : "almost no";
    return {
      spec: { type: "scatter", points: pts, fit: true, xlabel: C[x], ylabel: C[y] },
      title: `${C[y]} vs ${C[x]}`,
      read: `${strength[0].toUpperCase() + strength.slice(1)} ${r >= 0 ? "positive" : "negative"} relationship (r = ${r.toFixed(3)}, r² = ${(r * r).toFixed(3)}). Each extra unit of ${C[x]} goes with ${f(sxy / (sxx || 1))} ${C[y]}.`,
    };
  }
  // bar / line / pie: labels + values. A text column as y = count each category.
  let labels: string[];
  let values: number[];
  if (!isNumCol(rows, y)) {
    const counts = new Map<string, number>();
    rows.forEach((r) => counts.set(String(r[y]), (counts.get(String(r[y])) ?? 0) + 1));
    labels = [...counts.keys()];
    values = [...counts.values()];
  } else {
    if (x < 0) x = textCols[0] ?? -1;
    labels = rows.map((r, i) => (x >= 0 ? String(r[x]) : String(i + 1)));
    values = rows.map((r) => num(r[y]));
  }
  // A category per row (names, IDs) makes a useless pie/bar of 1s: that's not a fit.
  if (!isNumCol(rows, y) && labels.length > 12 && values.every((v) => v === 1)) return null;
  if (pick.kind === "pie" && labels.length > 8) {
    const order = labels.map((l, i) => ({ l, v: values[i] })).sort((a, b) => b.v - a.v);
    const rest = order.slice(7).reduce((a, b) => a + (Number.isFinite(b.v) ? b.v : 0), 0);
    labels = [...order.slice(0, 7).map((o) => o.l), "Other"];
    values = [...order.slice(0, 7).map((o) => o.v), rest];
  }
  const top = values.indexOf(Math.max(...values));
  const total = values.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
  const read =
    pick.kind === "pie"
      ? `${labels[top]} is the biggest slice at ${((values[top] / (total || 1)) * 100).toFixed(0)}%.`
      : pick.kind === "line"
        ? `From ${f(values[0])} to ${f(values[values.length - 1])} (${values[values.length - 1] >= values[0] ? "up" : "down"} ${f(Math.abs(values[values.length - 1] - values[0]))}). Peak: ${labels[top]} at ${f(values[top])}.`
        : `Highest: ${labels[top]} at ${f(values[top])}. Total ${f(total)}.`;
  const name = isNumCol(rows, y) ? C[y] : `Count of ${C[y]}`;
  return {
    spec: pick.kind === "pie" ? { type: "pie", labels, values } : { type: pick.kind === "line" ? "line" : "bar", labels, values, ylabel: name, xlabel: x >= 0 && isNumCol(rows, y) ? C[x] : undefined },
    title: x >= 0 && isNumCol(rows, y) ? `${name} by ${C[x]}` : name,
    read,
  };
}

const KINDS: { id: ChartKind; name: string }[] = [
  { id: "histogram", name: "Histogram" },
  { id: "box", name: "Box plot" },
  { id: "bar", name: "Bar" },
  { id: "line", name: "Line" },
  { id: "scatter", name: "Scatter" },
  { id: "pie", name: "Pie" },
];
const KIND_WORDS: [RegExp, ChartKind][] = [
  [/histogram/, "histogram"],
  [/box ?(and whisker )?plot|box chart|whisker/, "box"],
  [/bar (chart|graph)|bar$/, "bar"],
  [/line (chart|graph)|line$/, "line"],
  [/scatter ?(plot|chart)?/, "scatter"],
  [/pie( chart)?/, "pie"],
];
export const kindIn = (t: string): ChartKind | null => KIND_WORDS.find(([re]) => re.test(t))?.[1] ?? null;

/** "72 85 90 64 81 ..." -> numbers, when the text is basically just a list of numbers. */
export function numberList(t: string): number[] | null {
  const nums = (t.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  const words = t.replace(/-?\d+(?:\.\d+)?/g, " ").split(/[^a-z]+/i).filter((w) => w.length > 1);
  return nums.length >= 4 && words.length <= 14 ? nums : null;
}

export type SheetHandle = { ask: (text: string) => void; describe: () => string };

const SheetView = forwardRef<SheetHandle, {
  table: Table;
  onBig: (spec: GraphSpec, title: string) => void;
  say: (t: string) => Promise<void>;
  needRoom: () => void;
  className?: string;
}>(function SheetView({ table, onBig, say, needRoom }, ref) {
  const [title, setTitle] = useState(table.title);
  const [cols, setCols] = useState<string[]>(table.columns);
  const [rows, setRows] = useState<Cell[][]>(table.rows);
  const [chart, setChart] = useState<ChartPick | null>(table.chart ?? null);
  const [history, setHistory] = useState<{ cols: string[]; rows: Cell[][]; chart: ChartPick | null }[]>([]);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [answer, setAnswer] = useState("");
  const [fresh, setFresh] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  useEffect(() => {
    setTitle(table.title);
    setCols(table.columns);
    setRows(table.rows);
    setChart(table.chart ?? null);
    setHistory([]);
    if (table.chart) needRoom();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table]);

  const numeric = useMemo(() => cols.map((_, c) => (isNumCol(rows, c) ? rows.map((r) => num(r[c])) : null)), [cols, rows]);
  // The chart is LIVE: it's rebuilt from the cells, so editing a number redraws it.
  const drawn = useMemo(() => (chart ? buildChart(chart, cols, rows) : null), [chart, cols, rows]);
  const set = (r: number, c: number, v: string) => setRows((rs) => rs.map((row, k) => (k === r ? row.map((x, j) => (j === c ? v : x)) : row)));
  const flash = (t: string) => {
    setToast(t);
    setTimeout(() => setToast(""), 1800);
  };
  const remember = () => setHistory((h) => [...h, { cols, rows, chart }].slice(-12));
  const tsv = () => [cols.join("\t"), ...rows.map((r) => r.join("\t"))].join("\n");
  const statsText = () =>
    cols
      .map((c, k) => {
        const st = numeric[k] ? colStats(numeric[k]!) : null;
        return st ? `${c}: n=${st.n}, mean=${fmt(st.mean)}, median=${fmt(st.median)}, sd=${fmt(st.sd)}, min=${fmt(st.min)}, max=${fmt(st.max)}` : `${c}: text`;
      })
      .join("; ");
  const showChart = (pick: ChartPick | null) => {
    setChart(pick);
    if (pick) needRoom();
  };

  /** Things Milo can do instantly, without asking the AI. */
  const local = (text: string): string | null => {
    const t = text.toLowerCase().replace(/[.!?]+$/, "").trim();
    const nums = numberList(text);
    if (nums && (blank(rows) || /\b(new|these|here are|my numbers|use)\b/.test(t))) {
      remember();
      const name = t.match(/\b(scores?|grades?|heights?|weights?|ages?|times?|prices?|temps?|temperatures?|minutes|hours|points)\b/)?.[1];
      const col = name ? name[0].toUpperCase() + name.slice(1) : "Value";
      setCols([col]);
      setRows(nums.map((n) => [n]));
      setTitle(name ? `Your ${name}` : "Your numbers");
      setFresh(0);
      const k = kindIn(t);
      if (k) showChart({ kind: k, y: col });
      return `Got ${nums.length} numbers${k ? ` and made your ${KINDS.find((x) => x.id === k)!.name.toLowerCase()}` : ""}.`;
    }
    if (chart || !blank(rows)) {
      const k = kindIn(t);
      // Only a bare "make it a box plot" / "pie chart" / "switch to scatter" changes the chart here.
      const rest = t
        .replace(/^(now |ok(ay)? |and )?(make (it|that|this)( into)?|switch( it| that)?( to)?|change (it|that|this)?( to| into)?|show (it|that|this)( as)?|turn (it|that|this) into|do|try|use)?\s*/, "")
        .replace(/^(a|an)\s+/, "")
        .replace(/\s*(instead|please|now)$/, "");
      const justKind = k && /^(histogram|box( and whisker)? ?plot|box chart|bar (chart|graph)|bar|line (chart|graph)|line|scatter ?(plot|chart)?|pie( chart)?)$/.test(rest);
      if (k && justKind) {
        const base = chart ?? { kind: k, y: cols[numeric.findIndex(Boolean)] ?? cols[0] };
        showChart({ ...base, kind: k, bins: k === "histogram" ? base.bins : undefined });
        return null;
      }
      const b = t.match(/\b(\d{1,2})\s+bins?\b/);
      if (chart?.kind === "histogram" && (b || /\b(more|fewer|less) bins\b/.test(t))) {
        const cur = chart.bins ?? Math.max(5, Math.ceil(Math.log2(Math.max(1, rows.length))) + 1);
        setChart({ ...chart, bins: b ? Number(b[1]) : /more/.test(t) ? cur + 2 : Math.max(3, cur - 2) });
        return null;
      }
    }
    return "";
  };

  const ask = async (text: string) => {
    const quick = local(text);
    if (quick !== "") {
      if (quick) {
        setAnswer(quick);
        say(quick);
      }
      return;
    }
    setBusy(true);
    setAnswer("");
    const r = await window.milo.kit.tableOps(text, { columns: cols, rows }, statsText());
    setBusy(false);
    if (!r.ok) return void say("I couldn't do that one. Try saying it another way.");
    if (r.data.ops.length) {
      const out = applyOps(cols, rows, r.data.ops);
      if (out.error) return void say(out.error);
      remember();
      if (out.cols.length > cols.length) setFresh(out.cols.length - 1);
      setCols(out.cols);
      setRows(out.rows);
      if (out.title) setTitle(out.title);
      if (out.chart) showChart(out.chart);
    }
    setAnswer(r.data.say);
    say(r.data.say);
  };
  useImperativeHandle(ref, () => ({
    ask,
    describe: () =>
      `"${title}": ${blank(rows) ? "an empty sheet" : `${rows.length} rows, columns ${cols.join(", ")}`}${chart ? `, with a ${chart.kind} of ${chart.y}` : ""}`,
  }));

  const png = async () => (svgRef.current ? svgToPng(svgRef.current, drawn?.title ?? "") : null);

  return (
    <div className="sh">
      {chart && (
        <div className="sh-chart">
          <div className="sh-chart__bar">
            <div className="sh-kinds">
              {KINDS.map((k) => (
                <button key={k.id} className={`sh-kind ${chart.kind === k.id ? "sh-kind--on" : ""}`} onClick={() => setChart({ ...chart, kind: k.id })}>
                  {k.name}
                </button>
              ))}
            </div>
            <select
              className="sh-col"
              value={drawn ? colIndex(cols, chart.y) : -1}
              onChange={(e) => setChart({ ...chart, y: cols[Number(e.target.value)] })}
              title="Column"
            >
              {cols.map((c, k) => (
                <option key={k} value={k}>{c}</option>
              ))}
            </select>
            <button className="rp-icon" title="Remove chart" onClick={() => setChart(null)}>
              <svg viewBox="0 0 16 16" width="11" height="11"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
            </button>
          </div>
          {drawn ? (
            <>
              <div className="sh-chart__title">{drawn.title}</div>
              <Graph key={`${chart.kind}-${chart.y}-${chart.x ?? ""}`} spec={drawn.spec} svgRef={svgRef} />
              {chart.kind === "histogram" && (
                <label className="gr-slider sh-bins">
                  <span className="gr-slider__name">bins</span>
                  <input type="range" min={3} max={25} step={1} value={chart.bins ?? Math.max(5, Math.ceil(Math.log2(Math.max(1, rows.length))) + 1)} onChange={(e) => setChart({ ...chart, bins: Number(e.target.value) })} />
                  <span className="gr-slider__val">{chart.bins ?? Math.max(5, Math.ceil(Math.log2(Math.max(1, rows.length))) + 1)}</span>
                </label>
              )}
              <div className="sh-read">{drawn.read}</div>
              <div className="sd-actions">
                <button
                  className="kit-btn kit-btn--primary"
                  onClick={async () => {
                    const d = await png();
                    if (d && (await window.milo.kit.copyImage(d))) flash("Chart copied. Paste it into Docs, Word or Slides.");
                  }}
                >
                  Copy chart
                </button>
                <button
                  className="kit-btn"
                  onClick={async () => {
                    const d = await png();
                    if (d && (await window.milo.kit.saveImage(d, drawn.title))) flash("Saved to Downloads.");
                  }}
                >
                  Save image
                </button>
                <button className="kit-btn" onClick={() => onBig(drawn.spec, drawn.title)}>Open big</button>
              </div>
            </>
          ) : (
            <div className="sh-read">{chart.kind === "scatter" ? "A scatter plot needs two number columns." : chart.kind === "histogram" || chart.kind === "box" ? "That chart needs a column of numbers." : "That column doesn't fit this chart."} Pick a column above or try another chart.</div>
          )}
        </div>
      )}

      <div className={`sh-scroll ${chart ? "sh-scroll--short" : ""}`}>
        <table className="sh-table">
          <thead>
            <tr>
              <th className="sh-rownum" />
              {cols.map((c, k) => (
                <th key={k} className={fresh === k ? "sh-fresh" : ""}>
                  <input value={c} onChange={(e) => setCols((cs) => cs.map((x, j) => (j === k ? e.target.value : x)))} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} style={{ animationDelay: `${Math.min(i, 20) * 25}ms` }}>
                <td className="sh-rownum">{i + 1}</td>
                {cols.map((_, c) => (
                  <td key={c} className={`${numeric[c] ? "sh-num" : ""} ${fresh === c ? "sh-fresh" : ""}`}>
                    <input value={String(r[c] ?? "")} onChange={(e) => set(i, c, e.target.value)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            {(["mean", "median", "sd", "min", "max", "sum"] as const).map((k) => (
              <tr key={k} className="sh-stat">
                <td className="sh-rownum">{k === "sd" ? "std dev" : k}</td>
                {cols.map((_, c) => {
                  const st = numeric[c] ? colStats(numeric[c]!) : null;
                  return <td key={c}>{st ? fmt(st[k]) : ""}</td>;
                })}
              </tr>
            ))}
          </tfoot>
        </table>
      </div>

      {busy && <KitLoading text="Working on it" />}
      {answer && !busy && <div className="nt-answer">{answer}</div>}
      <form
        className="sd-input"
        onSubmit={(e) => {
          e.preventDefault();
          const input = e.currentTarget.elements.namedItem("q") as HTMLInputElement;
          if (input.value.trim()) {
            ask(input.value.trim());
            input.value = "";
          }
        }}
      >
        <input name="q" placeholder={blank(rows) ? "Make an example histogram, or paste your numbers…" : "Make a histogram, add a z-score column, who's above average?…"} disabled={busy} />
        <button className="kit-btn kit-btn--primary" disabled={busy}>Do it</button>
      </form>
      <div className="sd-actions">
        {!chart && !blank(rows) && <button className="kit-btn kit-btn--primary" onClick={() => ask("Chart this data in the most useful way")}>Chart it</button>}
        {blank(rows) && <button className="kit-btn kit-btn--primary" onClick={() => ask("Make me a realistic example data set for my class and chart it")}>Example data</button>}
        <button className="kit-btn" onClick={() => setRows((rs) => [...rs, cols.map(() => "")])}>Add row</button>
        {history.length > 0 && (
          <button
            className="kit-btn"
            onClick={() => {
              const last = history[history.length - 1];
              setCols(last.cols);
              setRows(last.rows);
              setChart(last.chart);
              setHistory((h) => h.slice(0, -1));
            }}
          >
            Undo
          </button>
        )}
        {!blank(rows) && <button className="kit-btn" onClick={() => ask("What stands out in this data? One insight.")}>What does it say?</button>}
        <button
          className="kit-btn"
          onClick={() => {
            window.milo.kit.copy(tsv());
            flash("Copied. Paste into Excel or Google Sheets.");
          }}
        >
          Copy table
        </button>
        <button className="kit-btn" onClick={() => window.milo.kit.openCsv(title, cols, rows).then((ok) => flash(ok ? "Opened in your spreadsheet app." : "Couldn't open it."))}>Open in Excel</button>
      </div>
      {toast && <div className="kit-toast">{toast}</div>}
    </div>
  );
});

export default SheetView;
