// `npm run eval:sweep` : the worksheet test bench. 10 worksheets (different subjects AND layouts) in a real
// browser, the real AI planning, and the SAME sweep loop the Mac app runs (src/main/sweepCore.ts).
// Each page grades itself. Passes when 95%+ of all answers land in the right box and are right.
// Needs ANTHROPIC_API_KEY. SWEEP_ONLY=stats-basic,chem-table runs a few.
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { chromium, type Page } from "playwright";
import { sweepPlan } from "../src/main/brain";
import { sweepCore, sweepSummary } from "../src/main/sweepCore";
import { SHEETS, renderSheet } from "./worksheets";

dotenv.config({ path: path.join(__dirname, "..", ".env") });
const W = 1280;
const H = 800;
const BAR = 0.95;

type Item = { label: string; answer: string; kind: "type" | "choose" | "select" | "none"; later?: boolean; x?: number; y?: number };

async function plan(page: Page, skip: string[], ask: string) {
  const b64 = (await page.screenshot({ type: "jpeg", quality: 85 })).toString("base64");
  const r = await sweepPlan(b64, { width: W, height: H }, skip, ask, "Jake");
  if (!r.ok) return { ok: false as const, text: r.text };
  const items: Item[] = (r.data.questions ?? [])
    .filter((q) => q && q.answer)
    .map((q) => {
      const has = q.input?.kind !== "none" && q.input?.x !== undefined && q.input?.y !== undefined;
      return { label: String(q.label ?? ""), answer: q.answer, kind: has ? q.input.kind : "none", x: q.input?.x, y: q.input?.y, later: has && (q.input.y ?? 0) > H - 70 };
    });
  return { ok: true as const, items, more: !!r.data.more_below };
}

async function fill(page: Page, it: Item) {
  if (it.kind === "none" || it.x === undefined || it.y === undefined) return false;
  await page.mouse.click(it.x, it.y);
  await page.waitForTimeout(it.kind === "type" ? 100 : 180);
  if (it.kind === "select") {
    await page.keyboard.type(it.answer);
    await page.keyboard.press("Enter");
  }
  if (it.kind === "type") {
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type(it.answer);
  }
  return true;
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) return console.log("No ANTHROPIC_API_KEY: skipping the worksheet bench.");
  const only = (process.env.SWEEP_ONLY ?? "").split(",").filter(Boolean);
  const sheets = SHEETS.filter((s) => !only.length || only.includes(s.id));
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const dir = path.join(__dirname, "results", "sweep");
  fs.mkdirSync(dir, { recursive: true });
  let right = 0;
  let total = 0;
  const rows: Record<string, unknown>[] = [];
  for (const s of sheets) {
    const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    await page.setContent(renderSheet(s));
    const t0 = Date.now();
    const out = await sweepCore<Item>(
      {
        plan: (skip) => plan(page, skip, s.ask),
        fill: (it) => fill(page, it),
        scroll: async () => {
          const y0 = await page.evaluate(() => scrollY);
          await page.mouse.move(W / 2, H / 2);
          await page.mouse.wheel(0, Math.round(H * 0.6));
          await page.waitForTimeout(350);
          return (await page.evaluate(() => scrollY)) !== y0;
        },
        top: async () => {
          await page.mouse.move(W / 2, H / 2);
          await page.mouse.wheel(0, -30000);
          await page.waitForTimeout(250);
        },
        stopped: () => false,
      },
      { fill: true }
    );
    const g = (await page.evaluate("window.__grade()")) as { right: number; total: number; wrong: string[]; blank: string[] };
    right += g.right;
    total += g.total;
    const said = sweepSummary(out, true);
    // honest: if anything is blank or wrong, Milo must not have said "All filled"
    const honest = g.blank.length === 0 || !/^Done\. All/.test(said);
    const mark = g.right === g.total ? "✓" : "✗";
    console.log(`${mark} ${s.id.padEnd(16)} ${g.right}/${g.total}  ${((Date.now() - t0) / 1000).toFixed(0)}s  wrong=[${g.wrong}] blank=[${g.blank}]  ${honest ? "" : "DISHONEST "}"${said}"`);
    await page.screenshot({ path: path.join(dir, `${s.id}.png`), fullPage: true });
    rows.push({ id: s.id, ...g, said, honest, missed: out.missed });
    await page.close();
  }
  await browser.close();
  const rate = total ? right / total : 0;
  console.log(`\nWorksheets: ${right}/${total} answers right and in place = ${(rate * 100).toFixed(1)}%  (bar ${BAR * 100}%)`);
  fs.writeFileSync(path.join(dir, "last.json"), JSON.stringify({ at: new Date().toISOString(), rate, right, total, rows }, null, 1));
  const dishonest = rows.filter((r) => !r.honest).length;
  if (dishonest) console.log(`${dishonest} sheet(s) said "all filled" with blanks left.`);
  if (rate < BAR || dishonest) process.exit(1);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
