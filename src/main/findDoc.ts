// Finding "my paper": every Google Doc open in any browser on this Mac (every window, every tab),
// plus a doc link on the clipboard, then the one the student means (named > front tab > only one).
// Logged in detail, so a miss in the field says exactly why.

import { execFile } from "node:child_process";
import { clipboard } from "electron";
import { log as bb } from "./blackbox";
import { bridgeConnected, call as ext } from "./bridge";
import { docIdFrom } from "./docEdit";

export type DocTab = { id: string; title: string; browser: string; frontWindow: boolean; active: boolean };

const CHROMIUM = ["Google Chrome", "Arc", "Brave Browser", "Microsoft Edge", "Dia", "Chromium", "Vivaldi"];

function osa(script: string, timeout = 6000, lang: "AppleScript" | "JavaScript" = "JavaScript"): Promise<{ out: string; err: string }> {
  return new Promise((resolve) =>
    execFile("osascript", ["-l", lang, "-e", script], { timeout }, (err, out, se) => resolve({ out: String(out ?? "").trim(), err: err ? String(se || err.message).slice(0, 160) : "" }))
  );
}

/** JavaScript for Automation (not AppleScript: AppleScript can't even compile for a browser that isn't installed,
 *  and "tab" means a browser tab inside a tell block). Lists Google Docs tabs without launching anything.
 *  One line per tab: window number, active?, url, title. */
export function tabScript(app: string): string {
  const safari = app === "Safari";
  return `(() => {
  let a;
  try { a = Application(${JSON.stringify(app)}); if (!a.running()) return ""; } catch (e) { return ""; }
  const out = [];
  a.windows().forEach((w, wi) => {
    let ai = 0;
    try { ai = ${safari ? "w.currentTab().index()" : "w.activeTabIndex()"}; } catch (e) {}
    let tabs = [];
    try { tabs = w.tabs(); } catch (e) {}
    tabs.forEach((t, ti) => {
      let u = "";
      try { u = t.url() || ""; } catch (e) {}
      if (u.indexOf("docs.google.com/document/") < 0) return;
      let name = "";
      try { name = ${safari ? "t.name()" : "t.title()"} || ""; } catch (e) {}
      out.push([wi + 1, ti + 1 === ai, u, name].join("\\t"));
    });
  });
  return out.join("\\n");
})()`;
}

/** Any window, in any app, whose title says Google Docs (the doc is open somewhere we can't read tabs from,
 *  like a browser built into another app). Returns "App: title" lines. */
const WINDOW_SCRIPT = `(() => {
  const se = Application("System Events");
  const out = [];
  se.processes.whose({ backgroundOnly: false })().forEach((p) => {
    let names = [];
    try { names = p.windows.name(); } catch (e) {}
    names.forEach((n) => { if (n && /Google Docs/.test(n)) out.push(p.name() + "\\t" + n); });
  });
  return out.join("\\n");
})()`;

/** Parse the script's lines. (pure) */
export function parseTabs(browser: string, out: string): DocTab[] {
  const tabs: DocTab[] = [];
  for (const line of out.split(/\r?\n/)) {
    const [w, act, url, ...rest] = line.split("\t");
    const id = docIdFrom(url ?? "");
    if (!id) continue;
    tabs.push({ id, title: rest.join("\t").replace(/ - Google Docs$/, "").trim(), browser, frontWindow: w === "1", active: act === "true" });
  }
  return tabs;
}

const STOP = new Set("milo hey please the and that this with into open opened google docs doc document paper essay draft screen bottom left right top corner look through find grammar mistakes make sound better fix edit want have from about called named it's its my your just could would can you".split(" "));
/** Which doc they mean. Named words in the title win, then the tab in front, then the only one. (pure) */
export function pickDoc(tabs: DocTab[], said: string): { pick: DocTab | null; choices: DocTab[]; why: string } {
  const uniq = [...new Map(tabs.map((t) => [t.id, t])).values()];
  if (!uniq.length) return { pick: null, choices: [], why: "none open" };
  if (uniq.length === 1) return { pick: uniq[0], choices: uniq, why: "only one" };
  const words = said.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
  const score = (t: DocTab) => words.filter((w) => t.title.toLowerCase().includes(w)).length;
  const ranked = [...uniq].sort((a, b) => score(b) - score(a));
  if (score(ranked[0]) > 0 && score(ranked[0]) > score(ranked[1])) return { pick: ranked[0], choices: uniq, why: "named" };
  const named = score(ranked[0]) > 0 ? ranked.filter((t) => score(t) === score(ranked[0])) : uniq;
  const front = named.find((t) => t.active && t.frontWindow) ?? (named.filter((t) => t.active).length === 1 ? named.find((t) => t.active) : undefined);
  if (front) return { pick: front, choices: uniq, why: "front tab" };
  return { pick: null, choices: named, why: "several" };
}

/** Every open Google Doc + the clipboard link, then the one they mean. */
export async function findDoc(said: string): Promise<{ doc: DocTab | null; choices: DocTab[]; why: string; elsewhere?: string }> {
  const tabs: DocTab[] = [];
  const errors: Record<string, string> = {};
  await Promise.all(
    [...CHROMIUM, "Safari"].map(async (b) => {
      const r = await osa(tabScript(b));
      if (r.err) errors[b] = r.err;
      tabs.push(...parseTabs(b, r.out));
    })
  );
  // Chrome's extension sees tabs even when macOS hasn't allowed Milo to ask Chrome directly
  if (bridgeConnected()) {
    const xs = (await ext<{ title: string; url: string; active: boolean }[]>("tabs", {}, 3000).catch(() => [])) ?? [];
    for (const t of xs) {
      const id = docIdFrom(t.url ?? "");
      if (id && !tabs.some((x) => x.id === id)) tabs.push({ id, title: (t.title ?? "").replace(/ - Google Docs$/, ""), browser: "Chrome (extension)", frontWindow: true, active: !!t.active });
    }
  }
  const clipId = docIdFrom(clipboard.readText().trim());
  if (clipId && !tabs.some((x) => x.id === clipId)) tabs.push({ id: clipId, title: "the doc link you copied", browser: "clipboard", frontWindow: false, active: false });
  const r = pickDoc(tabs, said);
  // Nothing in a browser: is a Google Doc open somewhere else (another app's built-in browser)? Say where.
  let elsewhere: string | undefined;
  if (!r.pick && !r.choices.length) {
    const w = await osa(WINDOW_SCRIPT, 5000);
    if (w.err) errors["windows"] = w.err;
    const first = w.out.split("\n").find(Boolean);
    if (first) elsewhere = first.split("\t")[0];
  }
  bb("writing", "doc_lookup", { found: tabs.length, why: r.why, pick: r.pick?.title?.slice(0, 60) ?? null, browsers: [...new Set(tabs.map((t) => t.browser))], elsewhere: elsewhere ?? null, errors });
  return { doc: r.pick, choices: r.choices, why: r.why, elsewhere };
}
