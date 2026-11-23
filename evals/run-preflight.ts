// `npm run eval:preflight` : the Preflight (Check this) gate. 20 synthetic assignments, real AI.
// Passes when high-confidence false warnings are under 5% and it catches most real problems.
// Needs ANTHROPIC_API_KEY. Not part of CI (it's slower and costs more); run it before turning Preflight on for students.
import path from "node:path";
import dotenv from "dotenv";
import { preflightCheck } from "../src/main/brain";
import { CASES } from "./preflight.cases";

dotenv.config({ path: path.join(__dirname, "..", ".env") });

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) return console.log("No ANTHROPIC_API_KEY: skipping Preflight evals.");
  let confirmed = 0;
  let falseWarn = 0;
  let shouldCatch = 0;
  let caught = 0;
  let errors = 0;
  for (const c of CASES) {
    const r = await preflightCheck({ work: c.work, rubric: c.rubric || undefined });
    if (!r.ok) {
      console.log(`✗ ${c.name}: ${r.text}`);
      errors++;
      continue;
    }
    const conf = r.data.items.filter((i) => i.status === "confirmed");
    const flagged = r.data.items.filter((i) => i.status !== "unknown").map((i) => `${i.text} ${i.quote}`);
    const fw = conf.filter((i) => c.met.some((m) => m.test(`${i.text} ${i.quote}`)) && !c.missing.some((m) => m.test(`${i.text} ${i.quote}`)));
    confirmed += conf.length;
    falseWarn += fw.length;
    shouldCatch += c.missing.length;
    const got = c.missing.filter((m) => flagged.some((f) => m.test(f))).length;
    caught += got;
    console.log(`${fw.length ? "✗" : "✓"} ${c.name}: ${conf.length} fix, ${r.data.items.length - conf.length} other, caught ${got}/${c.missing.length}${fw.length ? `  FALSE: ${fw.map((x) => x.text).join(" | ")}` : ""}`);
  }
  const fwRate = confirmed ? falseWarn / confirmed : 0;
  const recall = shouldCatch ? caught / shouldCatch : 1;
  console.log(`\nFalse warnings: ${(fwRate * 100).toFixed(1)}% of ${confirmed} 'fix' items (bar: under 5%)\nCaught: ${(recall * 100).toFixed(0)}% of ${shouldCatch} real problems (bar: 70%)`);
  if (errors) console.log(`${errors} case(s) errored: that's a fail.`);
  if (errors || fwRate >= 0.05 || recall < 0.7) process.exit(1);
}
void main();
