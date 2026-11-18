// `npm run eval` : scores Milo's router against every case in router.cases.ts using the REAL AI.
// Needs ANTHROPIC_API_KEY (from .env locally, or the GitHub secret in CI). Exit code 1 if below the bar.

import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { classify } from "../src/main/brain";
import { CASES, type Case } from "./router.cases";

dotenv.config({ path: path.join(__dirname, "..", ".env") });
const BAR = Number(process.env.EVAL_BAR ?? 0.95);
const CONCURRENCY = Number(process.env.EVAL_CONCURRENCY ?? 5);
const filter = process.env.EVAL_FILTER ? new RegExp(process.env.EVAL_FILTER, "i") : null;

type Out = { c: Case; got: Record<string, unknown>; ok: boolean; why: string; ms: number };

function judge(c: Case, got: Record<string, unknown>): { ok: boolean; why: string } {
  if (got.failed) return { ok: false, why: "router failed (API error / no decision)" };
  const kinds = Array.isArray(c.expect.kind) ? c.expect.kind : [c.expect.kind];
  if (!kinds.includes(String(got.kind))) return { ok: false, why: `kind ${got.kind}, wanted ${kinds.join("|")}` };
  if (c.expect.app && got.kind === "kit" && got.app !== c.expect.app) return { ok: false, why: `app ${got.app}, wanted ${c.expect.app}` };
  if (c.expect.after && !String(got.after ?? "").trim()) return { ok: false, why: "dropped the rest of the request (no 'after')" };
  return { ok: true, why: "" };
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("No ANTHROPIC_API_KEY: skipping router evals.");
    return;
  }
  const cases = CASES.filter((c) => !filter || filter.test(c.say));
  const results: Out[] = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (i < cases.length) {
        const c = cases[i++];
        const t0 = Date.now();
        const got = (await classify(c.say, c.ctx ?? {})) as Record<string, unknown>;
        results.push({ c, got, ms: Date.now() - t0, ...judge(c, got) });
      }
    })
  );
  results.sort((a, b) => cases.indexOf(a.c) - cases.indexOf(b.c));
  const pass = results.filter((r) => r.ok).length;
  const rate = pass / results.length;
  const ms = results.map((r) => r.ms).sort((a, b) => a - b);
  for (const r of results.filter((x) => !x.ok)) {
    const where = r.c.ctx?.kitOpen ? ` [${r.c.ctx.kitOpen.split(",")[0]}]` : r.c.ctx?.researchOpen ? " [research box]" : "";
    console.log(`FAIL ${JSON.stringify(r.c.say)}${where}\n     ${r.why}  -> ${JSON.stringify(r.got)}`);
  }
  console.log(`\nRouter: ${pass}/${results.length} = ${(rate * 100).toFixed(1)}%  (bar ${(BAR * 100).toFixed(0)}%)  median ${ms[Math.floor(ms.length / 2)]}ms, slowest ${ms[ms.length - 1]}ms`);
  fs.mkdirSync(path.join(__dirname, "results"), { recursive: true });
  fs.writeFileSync(path.join(__dirname, "results", "router-last.json"), JSON.stringify({ at: new Date().toISOString(), rate, pass, total: results.length, results: results.map((r) => ({ say: r.c.say, ok: r.ok, why: r.why, got: r.got, ms: r.ms })) }, null, 1));
  if (rate < BAR) process.exit(1);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
