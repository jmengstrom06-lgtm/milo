// Web tasks the fast way: read the page through the Chrome extension, act on real elements.
// Falls back to screen mode (screenshots) for pages that can't be read, like Google Docs.

import { call, bridgeConnected } from "./bridge";
import { webAction, WebAction } from "./brain";
import { log as bb } from "./blackbox";

type El = {
  id: string; tag: string; role?: string; type?: string; label: string; inView: boolean;
  rect: { x: number; y: number; w: number; h: number };
  value?: string; placeholder?: string; checked?: boolean; editable?: boolean; href?: string; disabled?: boolean;
};
type Snap = {
  tabId: number; url: string; title: string; elements: El[]; total: number; text: string; canvasHeavy: boolean;
  restricted?: boolean; focused: string | null; scroll: { y: number; max: number };
  frame: { screenX: number; screenY: number; top: number; zoom: number };
};
export type WebStep = { say: string; action: string; screenPt: { x: number; y: number } | null };
export type WebResult =
  | { status: "done" | "ask" | "stopped"; text: string }
  | { status: "need_screen"; text: string; history: string[] }
  | { status: "error"; text: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const CANVAS_SITES = /docs\.google\.com\/(document|spreadsheets|presentation)|canva\.com\/design|figma\.com\/(file|design)/;

function describe(s: Snap, tabs: { id: number; title: string; url: string; active: boolean }[]) {
  const els = s.elements
    .map((e) => {
      const kind = e.role || (e.tag === "input" ? `input${e.type ? ":" + e.type : ""}` : e.editable ? "editable" : e.tag);
      const bits = [`[${e.id}] ${kind}`, e.label ? `"${e.label}"` : ""];
      if (e.placeholder) bits.push(`placeholder="${e.placeholder}"`);
      if (e.value) bits.push(`value="${e.value}"`);
      if (e.checked !== undefined) bits.push(e.checked ? "checked" : "unchecked");
      if (e.href && e.tag === "a") bits.push(`→ ${e.href}`);
      if (e.disabled) bits.push("(disabled)");
      if (!e.inView) bits.push("(off-screen)");
      if (s.focused === e.id) bits.push("(FOCUSED)");
      return bits.filter(Boolean).join(" ");
    })
    .join("\n");
  const tabList = tabs.map((t) => `${t.active ? "*" : " "} tab ${t.id}: ${t.title} (${t.url})`).join("\n");
  return [
    `Current tab: ${s.title} — ${s.url}`,
    `Open tabs:\n${tabList}`,
    `Scroll: ${s.scroll.y} of ${s.scroll.max}px`,
    `Interactive elements (${s.elements.length}${s.total > s.elements.length ? ` of ${s.total}` : ""}):\n${els || "(none)"}`,
    `Page text (start):\n${s.text.slice(0, 5000)}`,
  ].join("\n\n");
}

/** Screen point (in macOS points) of an element, so Milo can hop next to it. Approximate. */
function screenPoint(s: Snap, r: El["rect"] | undefined) {
  if (!r) return null;
  return { x: s.frame.screenX + r.x + r.w / 2, y: s.frame.screenY + s.frame.top + r.y + r.h / 2 };
}

export async function runWebTask(
  task: string,
  history: string[],
  onStep: (s: WebStep) => void,
  aborted: () => boolean,
  pressKeys: (keys: string) => Promise<void>
): Promise<WebResult> {
  if (!bridgeConnected()) return { status: "need_screen", text: "extension not connected", history };
  let lastSig = "";
  let repeats = 0;
  for (let step = 0; step < 16; step++) {
    if (aborted()) return { status: "stopped", text: "Stopped!" };
    let snap: Snap;
    let tabs: { id: number; title: string; url: string; active: boolean }[] = [];
    try {
      [snap, tabs] = await Promise.all([call<Snap>("snapshot", {}, 8000), call("tabs", {}, 4000)]);
    } catch (e) {
      bb("web", "snapshot_failed", { error: (e as Error).message });
      return { status: "need_screen", text: (e as Error).message, history };
    }
    if (snap.restricted && step > 0) {
      // chrome:// pages can't be read; open a real page or hand over
    }
    if (CANVAS_SITES.test(snap.url) || (snap.canvasHeavy && snap.elements.length < 8)) {
      bb("web", "canvas_page_use_screen", { url: snap.url });
      return { status: "need_screen", text: "canvas page", history: [...history, `(Browser is on ${snap.url}; it's a canvas editor, so use the screen.)`] };
    }
    const r = await webAction(task, describe(snap, tabs), history);
    if (aborted()) return { status: "stopped", text: "Stopped!" };
    if (!r.ok) return { status: "error", text: r.text };
    const a: WebAction = r.data;
    bb("web", "action", { step, url: snap.url, ...a });
    if (a.action === "done") return { status: "done", text: a.text || a.say || "All done!" };
    if (a.action === "ask") return { status: "ask", text: a.text || a.say || "Should I go ahead?" };
    if (a.action === "use_screen") return { status: "need_screen", text: a.text || "", history };

    const sig = `${a.action}|${a.id ?? ""}|${a.text ?? ""}|${a.url ?? ""}|${a.keys ?? ""}`;
    if (sig === lastSig && a.action !== "scroll" && a.action !== "wait") {
      if (++repeats >= 2) return { status: "need_screen", text: "stuck", history: [...history, "(Element mode got stuck repeating itself.)"] };
      history.push(`(You already did exactly that: ${a.action} ${a.id ?? ""}. It's done; check the page and do the next thing.)`);
      continue;
    }
    lastSig = sig;
    const el = a.id ? snap.elements.find((e) => e.id === a.id) : undefined;
    onStep({ say: a.say, action: a.action === "type" ? "typing" : a.action, screenPt: screenPoint(snap, el?.rect) });

    try {
      switch (a.action) {
        case "click":
          await call("click", { tabId: snap.tabId, id: a.id }, 12000);
          history.push(`Clicked [${a.id}] "${el?.label ?? ""}"`);
          break;
        case "type": {
          const res = await call<{ value?: string }>("type", { tabId: snap.tabId, id: a.id, text: a.text ?? "", clear: !!a.clear }, 8000);
          history.push(`Typed "${(a.text ?? "").slice(0, 80)}" into [${a.id}] "${el?.label ?? ""}" (box now ends with: "${(res?.value ?? "").slice(-60)}")`);
          break;
        }
        case "key":
          // Real keystrokes so sites react (Enter to search/send, shortcuts). Chrome must be in front.
          await call("focus_window", { tabId: snap.tabId }, 4000).catch(() => {});
          if (snap.focused == null && el) await call("focus", { tabId: snap.tabId, id: el.id }, 4000).catch(() => {});
          await pressKeys(a.keys ?? "enter");
          await sleep(900);
          history.push(`Pressed ${a.keys}`);
          break;
        case "navigate":
          if (!a.url || !/^https?:\/\//.test(a.url)) throw new Error("Bad URL");
          await call("navigate", { tabId: snap.tabId, url: a.url }, 15000);
          history.push(`Went to ${a.url}`);
          break;
        case "new_tab":
          await call("new_tab", { url: a.url && /^https?:\/\//.test(a.url) ? a.url : undefined }, 15000);
          history.push(`Opened a new tab${a.url ? " at " + a.url : ""}`);
          break;
        case "switch_tab":
          await call("switch_tab", { tabId: a.tab }, 5000);
          history.push(`Switched to tab ${a.tab}`);
          break;
        case "back":
          await call("back", { tabId: snap.tabId }, 8000);
          history.push("Went back");
          break;
        case "scroll":
          await call("scroll", { tabId: snap.tabId, direction: a.direction ?? "down" }, 5000);
          history.push(`Scrolled ${a.direction ?? "down"}`);
          break;
        case "wait":
          await sleep(1200);
          history.push("Waited for the page");
          break;
      }
    } catch (e) {
      history.push(`(That didn't work: ${(e as Error).message}. Try something else.)`);
      bb("web", "action_failed", { action: a.action, error: (e as Error).message });
    }
    await sleep(300);
  }
  return { status: "done", text: "I took a bunch of steps. Check if that's what you wanted!" };
}
