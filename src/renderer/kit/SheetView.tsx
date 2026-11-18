// Sheet: an editable table with live stats. Talk to it: "add a z-score column", "sort by score",
// "only show scores above the mean", "graph hours vs score", "who's above average?".
// The AI picks the operations; every number is computed right here.

import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from "react";
import { compile } from "./Graph";
import { KitLoading } from "./KitPanel";
import type { GraphSpec, Table, TableOp } from "./types";

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

/** Apply the AI's operations to the table. Returns the new table and an optional graph. */
export function applyOps(cols: string[], rows: Cell[][], ops: TableOp[]): { cols: string[]; rows: Cell[][]; graph: { spec: GraphSpec; title: string } | null; error?: string } {
  let C = [...cols];
  let R = rows.map((r) => [...r]);
  let graph: { spec: GraphSpec; title: string } | null = null;
  const idx = (name: string) => {
    const k = C.findIndex((c) => c.toLowerCase() === String(name).toLowerCase());
    return k >= 0 ? k : C.findIndex((c) => c.toLowerCase().includes(String(name).toLowerCase()));
  };
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
    if (o.op === "add_column") {
      const base = aggScope();
      const row: Record<string, number> = { ...base };
      C.forEach((_, k) => (row[`c${k}`] = 0));
      const f = compile(o.expr, row);
      if (!f) return { cols: C, rows: R, graph, error: `I couldn't work out "${o.expr}".` };
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
      const target = st && (raw in st) ? (st as unknown as Record<string, number>)[raw] : Number.isFinite(Number(o.value)) ? Number(o.value) : null;
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
      R = [...R, C.map((_, k) => o.values?.[k] ?? "")];
    } else if (o.op === "graph") {
      const y = idx(o.y);
      const x = o.x ? idx(o.x) : -1;
      if (y < 0) continue;
      const ys = R.map((r) => num(r[y]));
      if (o.kind === "scatter" && x >= 0) graph = { spec: { type: "scatter", points: R.map((r) => ({ x: num(r[x]), y: num(r[y]) })), fit: true, xlabel: C[x], ylabel: C[y] }, title: `${C[y]} vs ${C[x]}` };
      else if (o.kind === "histogram") graph = { spec: { type: "histogram", values: ys, xlabel: C[y] }, title: `Distribution of ${C[y]}` };
      else graph = { spec: { type: o.kind === "line" ? "line" : "bar", labels: R.map((r, i) => (x >= 0 ? String(r[x]) : String(i + 1))), values: ys, ylabel: C[y] }, title: `${C[y]}${x >= 0 ? ` by ${C[x]}` : ""}` };
    }
  }
  return { cols: C, rows: R, graph };
}

export type SheetHandle = { ask: (text: string) => void };

const SheetView = forwardRef<SheetHandle, { table: Table; onGraph: (spec: GraphSpec, title: string) => void; say: (t: string) => Promise<void> }>(function SheetView({ table, onGraph, say }, ref) {
  const [cols, setCols] = useState<string[]>(table.columns);
  const [rows, setRows] = useState<Cell[][]>(table.rows);
  const [history, setHistory] = useState<{ cols: string[]; rows: Cell[][] }[]>([]);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [answer, setAnswer] = useState("");
  const [fresh, setFresh] = useState<number | null>(null);
  useEffect(() => {
    setCols(table.columns);
    setRows(table.rows);
    setHistory([]);
  }, [table]);

  const numeric = useMemo(() => cols.map((_, c) => (isNumCol(rows, c) ? rows.map((r) => num(r[c])) : null)), [cols, rows]);
  const set = (r: number, c: number, v: string) => setRows((rs) => rs.map((row, k) => (k === r ? row.map((x, j) => (j === c ? v : x)) : row)));
  const flash = (t: string) => {
    setToast(t);
    setTimeout(() => setToast(""), 1600);
  };
  const tsv = () => [cols.join("\t"), ...rows.map((r) => r.join("\t"))].join("\n");
  const statsText = () =>
    cols
      .map((c, k) => {
        const st = numeric[k] ? colStats(numeric[k]!) : null;
        return st ? `${c}: n=${st.n}, mean=${fmt(st.mean)}, median=${fmt(st.median)}, sd=${fmt(st.sd)}, min=${fmt(st.min)}, max=${fmt(st.max)}` : `${c}: text`;
      })
      .join("; ");

  const ask = async (text: string) => {
    setBusy(true);
    setAnswer("");
    const r = await window.milo.kit.tableOps(text, { columns: cols, rows }, statsText());
    setBusy(false);
    if (!r.ok) return void say("I couldn't do that one. Try saying it another way.");
    if (r.data.ops.length) {
      const out = applyOps(cols, rows, r.data.ops);
      if (out.error) return void say(out.error);
      setHistory((h) => [...h, { cols, rows }].slice(-10));
      if (out.cols.length > cols.length) setFresh(out.cols.length - 1);
      setCols(out.cols);
      setRows(out.rows);
      if (out.graph) onGraph(out.graph.spec, out.graph.title);
    }
    setAnswer(r.data.say);
    say(r.data.say);
  };
  useImperativeHandle(ref, () => ({ ask }));

  return (
    <div className="sh">
      <div className="sh-scroll">
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
        <input name="q" placeholder="Add a z-score column, sort by score, who's above average?…" disabled={busy} />
        <button className="kit-btn kit-btn--primary" disabled={busy}>Do it</button>
      </form>
      <div className="sd-actions">
        <button className="kit-btn" onClick={() => setRows((rs) => [...rs, cols.map(() => "")])}>Add row</button>
        {history.length > 0 && (
          <button
            className="kit-btn"
            onClick={() => {
              const last = history[history.length - 1];
              setCols(last.cols);
              setRows(last.rows);
              setHistory((h) => h.slice(0, -1));
            }}
          >
            Undo
          </button>
        )}
        <button className="kit-btn" onClick={() => ask("What stands out in this data? One insight.")}>What does it say?</button>
        <button className="kit-btn" onClick={() => ask("Graph this data in the most useful way")}>Graph it</button>
        <button
          className="kit-btn kit-btn--primary"
          onClick={() => {
            window.milo.kit.copy(tsv());
            flash("Copied. Paste into Excel or Google Sheets.");
          }}
        >
          Copy for Excel
        </button>
      </div>
      {toast && <div className="kit-toast">{toast}</div>}
    </div>
  );
});

export default SheetView;
