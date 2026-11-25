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

function osa(script: string, timeout = 6000): Promise<{ out: string; err: string }> {
  return new Promise((resolve) =>
    execFile("osascript", ["-e", script], { timeout }, (err, out, se) => resolve({ out: String(out ?? "").trim(), err: err ? String(se || err.message).slice(0, 160) : "" }))
  );
}

/** AppleScript that lists Google Docs tabs without launching the browser. One line per tab: window, active, url, title. */
export function tabScript(app: string): string {
  const safari = app === "Safari";
  return `if application "${app}" is running then
  tell application "${app}"
    set out to ""
    set wi to 0
    repeat with w in windows
      set wi to wi + 1
      try
        ${safari ? "set ai to index of current tab of w" : "set ai to active tab index of w"}
      on error
        set ai to 0
      end try
      set ti to 0
      repeat with t in tabs of w
        set ti to ti + 1
        set u to URL of t
        if u contains "docs.google.com/document/" then set out to out & wi & tab & (ti = ai) & tab & u & tab & (${safari ? "name" : "title"} of t) & linefeed
      end repeat
    end repeat
    return out
  end tell
end if`;
}

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
export async function findDoc(said: string): Promise<{ doc: DocTab | null; choices: DocTab[]; why: string }> {
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
  bb("writing", "doc_lookup", { found: tabs.length, why: r.why, pick: r.pick?.title?.slice(0, 60) ?? null, browsers: [...new Set(tabs.map((t) => t.browser))], errors });
  return { doc: r.pick, choices: r.choices, why: r.why };
}
