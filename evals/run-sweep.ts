// `npm run eval:sweep` : the worksheet test bench. 10 worksheets (different subjects AND layouts) in a real
// browser, the real AI planning, and the SAME sweep loop the Mac app runs (src/main/sweepCore.ts).
// Each page grades itself. Passes when 95%+ of all answers land in the right box and are right.
// Needs ANTHROPIC_API_KEY. SWEEP_ONLY=stats-basic,chem-table runs a few.
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { chromium, type Page } from "playwright";
import { findOption, sweepPlan } from "../src/main/brain";
import { sweepCore, sweepSummary } from "../src/main/sweepCore";
import { SHEETS, renderSheet } from "./worksheets";
import { HARD } from "./hardSheets";

dotenv.config({ path: path.join(__dirname, "..", ".env") });
const W = 1280;
const H = 800;
const BAR = 0.95;

type Item = { label: string; answer: string; kind: "type" | "choose" | "select" | "none"; later?: boolean; x?: number; y?: number };

let trace: string[] = [];
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
  trace.push(`plan skip=[${skip}] -> ${items.map((i) => `${i.label}:${i.kind}${i.later ? "(later)" : ""}@${Math.round(i.x ?? -1)},${Math.round(i.y ?? -1)}=${i.answer}`).join(" ")}${r.data.next_button ? " NEXT" : ""} more=${r.data.more_below}`);
  return { ok: true as const, items, more: !!r.data.more_below, next: r.data.next_button, area: r.data.scroll_area };
}

async function fill(page: Page, it: Item) {
  if (it.kind === "none" || it.x === undefined || it.y === undefined) return false;
  await page.mouse.click(it.x, it.y);
  await page.waitForTimeout(it.kind === "type" ? 100 : 180);
  if (it.kind === "select") {
    // same order as the app: a real menu jumps to what you type and Return picks it; a custom-drawn list
    // ignores typing and stays open, so then find the option on screen and click it
    await page.keyboard.type(it.answer);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(250);
    const b64 = (await page.screenshot({ type: "jpeg", quality: 85 })).toString("base64");
    const at = await findOption(b64, { width: W, height: H }, it.answer);
    trace.push(`select ${it.label}: ${at ? "clicked option" : "typed"}`);
    if (at) await page.mouse.click(at.x, at.y);
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
  const all = [...SHEETS.map((s) => ({ id: s.id, ask: s.ask, html: renderSheet(s) })), ...HARD.map((h) => ({ id: h.id, ask: h.ask, html: h.html }))];
  const repeat = Math.max(1, Number(process.env.SWEEP_REPEAT ?? 1));
  const sheets = all.filter((s) => !only.length || only.includes(s.id)).flatMap((s) => Array.from({ length: repeat }, () => s));
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const dir = path.join(__dirname, "results", "sweep");
  fs.mkdirSync(dir, { recursive: true });
  let right = 0;
  let total = 0;
  const rows: Record<string, unknown>[] = [];
  for (const s of sheets) {
    const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    await page.setContent(s.html, { waitUntil: "load" });
    // embedded frames (srcdoc) load after the page: wait until every frame has its questions
    await page.waitForFunction(() => [...document.querySelectorAll("iframe")].every((f) => f.contentDocument?.readyState === "complete" && !!f.contentDocument.body?.children.length), null, { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(300);
    const t0 = Date.now();
    trace = [];
    const out = await sweepCore<Item>(
      {
        plan: (skip) => plan(page, skip, s.ask),
        fill: (it) => fill(page, it),
        scroll: async (area) => {
          const ar = (area as { x: number; y: number; width: number; height: number } | undefined) ?? { x: 0, y: 0, width: W, height: H };
          trace.push(`scroll${area ? " frame" : ""}`);
          const a = await page.screenshot({ type: "jpeg", quality: 30 });
          await page.mouse.move(ar.x + ar.width / 2, ar.y + ar.height / 2);
          await page.mouse.wheel(0, Math.round(Math.max(150, ar.height * 0.55)));
          await page.waitForTimeout(400);
          const b = await page.screenshot({ type: "jpeg", quality: 30 });
          return !a.equals(b);
        },
        top: async () => {
          // the page and any frame under the middle of the screen
          await page.mouse.move(W / 2, H / 2);
          await page.mouse.wheel(0, -30000);
          await page.mouse.move(W / 2, 80);
          await page.mouse.wheel(0, -30000);
          await page.waitForTimeout(250);
        },
        next: async (at) => {
          const p = at as { x: number; y: number };
          await page.mouse.click(p.x, p.y);
          await page.waitForTimeout(500);
        },
        stopped: () => false,
      },
      { fill: true }
    );
    const g = (await page.evaluate("window.__grade()")) as { right: number; total: number; wrong: string[]; blank: string[] };
    right += g.right;
    total += g.total;
    const said = out.error ? `ERROR: ${out.error}` : out.empty ? "EMPTY: found no questions" : sweepSummary(out, true);
    // honest: if anything is blank or wrong, Milo must not have said "All filled"
    const honest = g.blank.length === 0 || !/^Done\. All/.test(said);
    const mark = g.right === g.total ? "✓" : "✗";
    console.log(`${mark} ${s.id.padEnd(16)} ${g.right}/${g.total}  ${((Date.now() - t0) / 1000).toFixed(0)}s  wrong=[${g.wrong}] blank=[${g.blank}]  ${honest ? "" : "DISHONEST "}"${said}"`);
    if (g.right !== g.total) for (const line of trace) console.log("      " + line);
    await page.screenshot({ path: path.join(dir, `${s.id}${repeat > 1 ? "-" + rows.filter((r) => r.id === s.id).length : ""}.png`), fullPage: true });
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
