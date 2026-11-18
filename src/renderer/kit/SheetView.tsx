// Sheet: a small editable table with live stats per column. Copies straight into Excel / Google Sheets.

import { useEffect, useMemo, useState } from "react";
import type { GraphSpec, Table } from "./types";

function stats(nums: number[]) {
  const n = nums.length;
  if (!n) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mean = nums.reduce((a, b) => a + b, 0) / n;
  const med = n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  const sd = n > 1 ? Math.sqrt(nums.reduce((a, x) => a + (x - mean) ** 2, 0) / (n - 1)) : 0;
  return { n, mean, med, sd, min: s[0], max: s[n - 1], sum: nums.reduce((a, b) => a + b, 0) };
}
const f = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(3).replace(/\.?0+$/, ""));

export default function SheetView({ table, onGraph, say }: { table: Table; onGraph: (spec: GraphSpec, title: string) => void; say: (t: string) => Promise<void> }) {
  const [cols, setCols] = useState<string[]>(table.columns);
  const [rows, setRows] = useState<(string | number)[][]>(table.rows);
  const [toast, setToast] = useState("");
  useEffect(() => {
    setCols(table.columns);
    setRows(table.rows);
  }, [table]);

  const numeric = useMemo(
    () =>
      cols.map((_, c) => {
        const vals = rows.map((r) => r[c]).filter((v) => v !== "" && v !== undefined && v !== null);
        const nums = vals.map((v) => Number(String(v).replace(/[$,%]/g, ""))).filter(Number.isFinite);
        return vals.length > 0 && nums.length === vals.length ? nums : null;
      }),
    [cols, rows]
  );

  const set = (r: number, c: number, v: string) => setRows((rs) => rs.map((row, k) => (k === r ? row.map((x, j) => (j === c ? v : x)) : row)));
  const flash = (t: string) => {
    setToast(t);
    setTimeout(() => setToast(""), 1600);
  };
  const tsv = () => [cols.join("\t"), ...rows.map((r) => r.join("\t"))].join("\n");

  const graphIt = () => {
    const c = numeric.findIndex(Boolean);
    if (c < 0) return say("I need a column of numbers to graph.");
    const labelCol = cols.findIndex((_, k) => !numeric[k]);
    const nums = numeric[c]!;
    if (labelCol >= 0) onGraph({ type: "bar", labels: rows.map((r) => String(r[labelCol])), values: nums, ylabel: cols[c] }, `${cols[c]} by ${cols[labelCol]}`);
    else if (numeric.filter(Boolean).length >= 2) {
      const c2 = numeric.findIndex((x, k) => x && k !== c);
      onGraph({ type: "scatter", points: nums.map((x, k) => ({ x, y: numeric[c2]![k] })), fit: true, xlabel: cols[c], ylabel: cols[c2] }, `${cols[c2]} vs ${cols[c]}`);
    } else onGraph({ type: "histogram", values: nums, xlabel: cols[c] }, `Distribution of ${cols[c]}`);
  };

  return (
    <div className="sh">
      <div className="sh-scroll">
        <table className="sh-table">
          <thead>
            <tr>
              <th className="sh-rownum" />
              {cols.map((c, k) => (
                <th key={k}>
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
                  <td key={c} className={numeric[c] ? "sh-num" : ""}>
                    <input value={String(r[c] ?? "")} onChange={(e) => set(i, c, e.target.value)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            {(["mean", "med", "sd", "min", "max", "sum"] as const).map((k) => (
              <tr key={k} className="sh-stat">
                <td className="sh-rownum">{k === "med" ? "median" : k === "sd" ? "std dev" : k}</td>
                {cols.map((_, c) => {
                  const st = numeric[c] ? stats(numeric[c]!) : null;
                  return <td key={c}>{st ? f(st[k]) : ""}</td>;
                })}
              </tr>
            ))}
          </tfoot>
        </table>
      </div>
      <div className="sd-actions">
        <button className="kit-btn" onClick={() => setRows((rs) => [...rs, cols.map(() => "")])}>Add row</button>
        <button className="kit-btn" onClick={graphIt}>Graph it</button>
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
}
