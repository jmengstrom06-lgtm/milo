// Sheet math must be exact: students compare it to their textbook / calculator.
import { describe, expect, it } from "vitest";
import { applyOps, buildChart, colStats, kindIn, numberList, sampleValues } from "../src/renderer/kit/SheetView";
import { quantile } from "../src/renderer/kit/Graph";

const scores = [72, 85, 90, 64, 81, 77, 93, 58, 88, 70];

describe("stats", () => {
  it("mean, median, sample sd", () => {
    const s = colStats(scores)!;
    expect(s.mean).toBeCloseTo(77.8, 6);
    expect(s.median).toBe(79);
    expect(s.sd).toBeCloseTo(11.66, 2); // sqrt(1223.6 / 9), checked by hand
  });
  it("quartiles match Excel QUARTILE.INC", () => {
    const s = [...scores].sort((a, b) => a - b);
    expect(quantile(s, 0.25)).toBeCloseTo(70.5, 6);
    expect(quantile(s, 0.75)).toBeCloseTo(87.25, 6);
  });
  it("z-score column", () => {
    const out = applyOps(["Name", "Score"], scores.map((v, i) => [`S${i}`, v]), [{ op: "add_column", name: "z", expr: "(c1 - mean_c1)/sd_c1" }]);
    const z = out.rows.map((r) => Number(r[2]));
    expect(z.reduce((a, b) => a + b, 0)).toBeCloseTo(0, 3);
    expect(z[0]).toBeCloseTo((72 - 77.8) / 11.66, 2);
  });
});

describe("charts", () => {
  it("box plot five-number summary", () => {
    const c = buildChart({ kind: "box", y: "Score" }, ["Score"], scores.map((v) => [v]))!;
    expect(c.read).toContain("58, 70.5, 79, 87.25, 93");
  });
  it("scatter r", () => {
    const c = buildChart({ kind: "scatter", x: "H", y: "S" }, ["H", "S"], [[1, 60], [2, 65], [3, 71], [4, 75], [5, 82], [6, 85]])!;
    expect(c.read).toMatch(/Strong positive/);
  });
  it("pie groups extra slices into Other, refuses one-slice-per-row", () => {
    const rows = Array.from({ length: 12 }, (_, i) => [`c${i}`, i + 1]);
    const c = buildChart({ kind: "pie", x: "Cat", y: "N" }, ["Cat", "N"], rows)!;
    expect((c.spec as { labels: string[] }).labels).toHaveLength(8);
    expect(buildChart({ kind: "pie", y: "Name" }, ["Name"], Array.from({ length: 20 }, (_, i) => [`S${i}`]))).toBeNull();
  });
  it("empty sheet + example data + chart", () => {
    const out = applyOps(["A", "B"], [["", ""], ["", ""]], [{ op: "sample", name: "Score", dist: "normal", n: 40, mean: 75, sd: 8 }, { op: "graph", kind: "histogram", y: "Score" }]);
    expect(out.rows).toHaveLength(40);
    expect(out.chart?.kind).toBe("histogram");
    expect(buildChart(out.chart!, out.cols, out.rows)?.read).toMatch(/symmetric|skewed/i);
  });
  it("generated samples hit the requested mean", () => {
    const v = sampleValues({ dist: "normal", n: 500, mean: 70, sd: 5 });
    expect(colStats(v)!.mean).toBeCloseTo(70, 0);
  });
});

describe("spoken input", () => {
  it("number lists", () => {
    expect(numberList("here are my scores 72 85 90 64 81 make a histogram")).toEqual([72, 85, 90, 64, 81]);
    expect(numberList("make me an example histogram")).toBeNull();
  });
  it("chart words", () => {
    expect(kindIn("make it a box plot")).toBe("box");
    expect(kindIn("switch to scatter")).toBe("scatter");
    expect(kindIn("pie chart")).toBe("pie");
  });
});
