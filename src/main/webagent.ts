// Web tasks the fast way: read the page through the Chrome extension, act on real elements.
// Falls back to screen mode (screenshots) for pages that can't be read, like Google Docs.

import { call, bridgeConnected } from "./bridge";
import { webActions, WebAction } from "./brain";
import { log as bb } from "./blackbox";
import { activateApp, quitApp } from "./hands";
import { detectBlocker } from "./blockers";
import { TURN_IN_LINE, turnsInGradedWork } from "./commit";
import { APPROVED, describeEl, fill, findEl, needsYes, recipeFor, RISKY, RStep, saveRecipe } from "./recipes";

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
  | { status: "done" | "ask" | "stopped"; text: string; replayed?: boolean }
  | { status: "blocked"; text: string; blocker: string }
  | { status: "need_screen"; text: string; history: string[] }
  | { status: "error"; text: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const CANVAS_SITES = /docs\.google\.com\/(document|spreadsheets|presentation)|canva\.com\/design|figma\.com\/(file|design)/;

function describe(raw: Snap, tabs: { id: number; title: string; url: string; active: boolean }[]) {
  // Chrome's own pages (new tab, settings) give a partial snapshot: never crash on a missing field.
  const s: Snap = { ...raw, elements: raw.elements ?? [], text: raw.text ?? "", scroll: raw.scroll ?? { y: 0, max: 0 }, title: raw.title ?? "", url: raw.url ?? "", total: raw.total ?? 0 };
  tabs = Array.isArray(tabs) ? tabs : [];
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
  if (!r || !s.frame) return null;
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
  // What he did, remembered by what each element IS, so it can be replayed next time (muscle memory).
  const trace: RStep[] = [];
  let traceOk = true;

  // Muscle memory: done this exact kind of task before and it worked? Just do it again, no AI.
  const mem = recipeFor(task);
  if (mem) {
    const r = await replay(task, mem.recipe.steps, mem.values, history, onStep, aborted, pressKeys);
    bb("web", "recipe_replay", { task: task.split("\n")[0].slice(0, 120), ok: r.ok, steps: mem.recipe.steps.length, stoppedAt: r.ok ? null : r.at, why: r.ok ? "" : r.why });
    if (r.ok) return { status: "done", text: "Done.", replayed: true };
    if (r.why === "stopped") return { status: "stopped", text: "Stopped!" };
    if (r.why === "blocked") return { status: "blocked", text: r.text ?? "I need your help with this page.", blocker: "login" };
    history.push(`(Did the first ${r.at} steps from memory; the page changed after that. Look at the page and finish the rest.)`);
  }
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
    // Sign-ins, 2-step codes and "are you human" checks are the student's to do: stop and ask.
    const blk = detectBlocker(snap);
    if (blk) {
      bb("web", "blocked", { kind: blk.kind, site: blk.site, url: snap.url });
      return { status: "blocked", text: blk.text, blocker: blk.kind };
    }
    if (CANVAS_SITES.test(snap.url) || (snap.canvasHeavy && snap.elements.length < 8)) {
      bb("web", "canvas_page_use_screen", { url: snap.url });
      return { status: "need_screen", text: "canvas page", history: [...history, `(Browser is on ${snap.url}; it's a canvas editor, so use the screen.)`] };
    }
    const r = await webActions(task, describe(snap, tabs), history);
    if (aborted()) return { status: "stopped", text: "Stopped!" };
    if (!r.ok) return { status: "error", text: r.text };
    bb("web", "plan", { step, url: snap.url, steps: r.data.map((x) => `${x.action}${x.id ? " [" + x.id + "]" : ""}${x.keys ? " " + x.keys : ""}${x.url ? " " + x.url : ""}`) });

    for (const a of r.data) {
      if (aborted()) return { status: "stopped", text: "Stopped!" };
      if (a.action === "done") {
        const risky = trace.some((t) => RISKY.test(t.el?.label ?? ""));
        if (traceOk && trace.length && (!risky || APPROVED.test(task))) saveRecipe(task, trace);
        return { status: "done", text: a.text || a.say || "Done." };
      }
      if (a.action === "ask") return { status: "ask", text: a.text || a.say || "Should I go ahead?" };
      if (a.action === "use_screen") return { status: "need_screen", text: a.text || "", history };

      const sig = `${a.action}|${a.id ?? ""}|${a.text ?? ""}|${a.url ?? ""}|${a.keys ?? ""}`;
      if (sig === lastSig && a.action !== "scroll" && a.action !== "wait") {
        if (++repeats >= 2) return { status: "need_screen", text: "stuck", history: [...history, "(Element mode got stuck repeating itself.)"] };
        history.push(`(You already did exactly that: ${a.action} ${a.id ?? ""}. It's done; check the page and do the next thing.)`);
        break;
      }
      lastSig = sig;
      const el = a.id ? snap.elements.find((e) => e.id === a.id) : undefined;
      // Graded work: never turned in by Milo, even with a yes. The student clicks that button.
      if (a.action === "click" && el && turnsInGradedWork(el.label, snap.url)) {
        bb("web", "graded_turn_in_held", { label: el.label.slice(0, 40), url: snap.url.slice(0, 80) });
        return { status: "ask", text: TURN_IN_LINE };
      }
      // Hard stop before anything that can't be taken back (Save on a calendar, Send, Submit, Buy...).
      const commit = a.action === "click" && el && !APPROVED.test(task) ? needsYes(el.label, snap.url) : null;
      if (commit) {
        bb("web", "held_for_yes", { label: el!.label, url: snap.url });
        const what = commit === "send" ? "send it" : commit === "save" || commit === "add" || commit === "create" || commit === "schedule" ? "save it" : `click "${el!.label.slice(0, 30)}"`;
        return { status: "ask", text: `It's all filled in. Want me to ${what}?` };
      }
      onStep({ say: a.say, action: a.action === "type" ? "typing" : a.action, screenPt: screenPoint(snap, el?.rect) });

      let newPage = false;
      try {
        switch (a.action) {
          case "click": {
            const res = await call<{ navigates?: boolean }>("click", { tabId: snap.tabId, id: a.id }, 12000);
            history.push(`Clicked [${a.id}] "${el?.label ?? ""}"`);
            if (el) trace.push({ action: "click", el: describeEl(el) });
            else traceOk = false;
            newPage = !!res?.navigates;
            break;
          }
          case "type": {
            const res = await call<{ value?: string }>("type", { tabId: snap.tabId, id: a.id, text: a.text ?? "", clear: !!a.clear }, 8000);
            history.push(`Typed "${(a.text ?? "").slice(0, 80)}" into [${a.id}] "${el?.label ?? ""}" (box now ends with: "${(res?.value ?? "").slice(-60)}")`);
            if (el) trace.push({ action: "type", el: describeEl(el), text: a.text ?? "", clear: !!a.clear });
            else traceOk = false;
            break;
          }
          case "key":
            // Enter inside a form submits it. Never do that by accident (it sent J1's form half-filled, without asking).
            if (/^(enter|return)$/i.test((a.keys ?? "enter").trim()) && !APPROVED.test(task)) {
              const foc = snap.elements.find((e) => e.id === (snap.focused ?? a.id));
              const isSearch = !!foc && (foc.type === "search" || /search|find|ask|message|chat|prompt|query/i.test(`${foc.label} ${foc.placeholder ?? ""}`));
              const formy = snap.elements.some((e) => /^(submit|sign ?up|register|join|send|save|place order|apply|enroll|finish)$/i.test((e.label ?? "").trim()));
              if (foc && !isSearch && formy) {
                history.push(`(Did NOT press Enter in "${foc.label}": on this form Enter would submit it. Pick options and click buttons instead; submitting needs the student's yes.)`);
                bb("web", "enter_blocked", { field: foc.label });
                break;
              }
            }
            // Quitting the browser isn't something a page can do: quit it natively (instant, and checked).
            if (/^cmd\+q$/i.test((a.keys ?? "").trim())) {
              await quitApp("Google Chrome");
              history.push("Quit Chrome");
              bb("web", "quit_native", {});
              return { status: "done" as const, text: "Closed Chrome." };
            }
            // Real keystrokes so sites react (Enter to search/send, shortcuts). Chrome must be the ACTIVE app,
            // not just the front window, or the keys land in whatever app was in front.
            await call("focus_window", { tabId: snap.tabId }, 4000).catch(() => {});
            await activateApp("Google Chrome");
            if (snap.focused == null && el) await call("focus", { tabId: snap.tabId, id: el.id }, 4000).catch(() => {});
            await pressKeys(a.keys ?? "enter");
            history.push(`Pressed ${a.keys}`);
            trace.push({ action: "key", keys: a.keys ?? "enter", el: el ? describeEl(el) : undefined });
            newPage = /^(enter|return|cmd\+(t|w|l)|ctrl\+tab|cmd\+shift\+t)$/i.test((a.keys ?? "enter").trim());
            await sleep(newPage ? 800 : 150);
            break;
          case "navigate":
            if (!a.url || !/^https?:\/\//.test(a.url)) throw new Error("Bad URL");
            await call("navigate", { tabId: snap.tabId, url: a.url }, 15000);
            history.push(`Went to ${a.url}`);
            trace.push({ action: "navigate", url: a.url });
            newPage = true;
            break;
          case "new_tab":
            await call("new_tab", { url: a.url && /^https?:\/\//.test(a.url) ? a.url : undefined }, 15000);
            history.push(`Opened a new tab${a.url ? " at " + a.url : ""}`);
            trace.push({ action: "new_tab", url: a.url });
            newPage = true;
            break;
          case "switch_tab":
            await call("switch_tab", { tabId: a.tab }, 5000);
            history.push(`Switched to tab ${a.tab}`);
            traceOk = false; // tab ids change every session
            newPage = true;
            break;
          case "back":
            await call("back", { tabId: snap.tabId }, 8000);
            history.push("Went back");
            trace.push({ action: "back" });
            newPage = true;
            break;
          case "scroll":
            await call("scroll", { tabId: snap.tabId, direction: a.direction ?? "down" }, 5000);
            history.push(`Scrolled ${a.direction ?? "down"}`);
            trace.push({ action: "scroll", direction: a.direction ?? "down" });
            newPage = true; // new elements came into view
            break;
          case "wait":
            await sleep(1000);
            history.push("Waited for the page");
            trace.push({ action: "wait" });
            newPage = true;
            break;
        }
      } catch (e) {
        history.push(`(That didn't work: ${(e as Error).message}. Try something else.)`);
        bb("web", "action_failed", { action: a.action, error: (e as Error).message });
        break; // re-read the page before trying anything else
      }
      if (newPage) break; // element ids belong to the old page: read it again
    }
    await sleep(150);
  }
  return { status: "done", text: "I took a bunch of steps. Check if that's what you wanted!" };
}

// ---------- muscle memory replay ----------
type Replay = { ok: true } | { ok: false; at: number; why: "stopped" | "missing" | "risky" | "blocked" | "error"; text?: string };
async function snapNow(): Promise<Snap | null> {
  try {
    return await call<Snap>("snapshot", {}, 8000);
  } catch {
    return null;
  }
}
/** Find the remembered element on the current page (pages load at their own speed: look a few times). */
async function waitFor(d: NonNullable<RStep["el"]>): Promise<{ snap: Snap; el: El } | null> {
  for (let i = 0; i < 6; i++) {
    const snap = await snapNow();
    if (snap) {
      const el = findEl(snap.elements ?? [], d);
      if (el) return { snap, el };
    }
    await sleep(350);
  }
  return null;
}
async function replay(
  task: string,
  steps: RStep[],
  values: string[],
  history: string[],
  onStep: (s: WebStep) => void,
  aborted: () => boolean,
  pressKeys: (keys: string) => Promise<void>
): Promise<Replay> {
  const approved = APPROVED.test(task);
  for (let i = 0; i < steps.length; i++) {
    if (aborted()) return { ok: false, at: i, why: "stopped" };
    const st = steps[i];
    // never submit / send / buy from memory without the student's yes
    if (st.el && RISKY.test(st.el.label) && !approved) return { ok: false, at: i, why: "risky" };
    try {
      if (st.action === "navigate" || st.action === "new_tab") {
        const url = fill(st.url ?? "", values);
        if (!/^https?:\/\//.test(url)) return { ok: false, at: i, why: "error" };
        onStep({ say: "Opening it", action: st.action, screenPt: null });
        if (st.action === "new_tab") await call("new_tab", { url }, 15000);
        else {
          const s0 = await snapNow();
          if (!s0) return { ok: false, at: i, why: "error" };
          await call("navigate", { tabId: s0.tabId, url }, 15000);
        }
        history.push(`Went to ${url} (from memory)`);
        await sleep(500);
        continue;
      }
      if (st.action === "wait") {
        await sleep(1000);
        continue;
      }
      if (st.action === "back" || st.action === "scroll") {
        const s0 = await snapNow();
        if (!s0) return { ok: false, at: i, why: "error" };
        if (st.action === "back") await call("back", { tabId: s0.tabId }, 8000);
        else await call("scroll", { tabId: s0.tabId, direction: st.direction ?? "down" }, 5000);
        history.push(st.action === "back" ? "Went back (from memory)" : `Scrolled ${st.direction} (from memory)`);
        await sleep(300);
        continue;
      }
      if (st.action === "key" && !st.el) {
        await activateApp("Google Chrome");
        await pressKeys(st.keys ?? "enter");
        history.push(`Pressed ${st.keys} (from memory)`);
        await sleep(600);
        continue;
      }
      // click / type / key-on-element: find the same element on this page
      const found = await waitFor(st.el!);
      if (!found) return { ok: false, at: i, why: "missing" };
      const blk = detectBlocker(found.snap);
      if (blk) return { ok: false, at: i, why: "blocked", text: blk.text };
      const { snap, el } = found;
      onStep({ say: st.action === "type" ? "Typing" : "Clicking", action: st.action === "type" ? "typing" : st.action, screenPt: screenPoint(snap, el.rect) });
      if (st.action === "click") {
        await call("click", { tabId: snap.tabId, id: el.id }, 12000);
        history.push(`Clicked "${el.label}" (from memory)`);
        await sleep(250);
      } else if (st.action === "type") {
        const text = fill(st.text ?? "", values);
        await call("type", { tabId: snap.tabId, id: el.id, text, clear: !!st.clear }, 8000);
        history.push(`Typed "${text.slice(0, 80)}" into "${el.label}" (from memory)`);
      } else if (st.action === "key") {
        await call("focus_window", { tabId: snap.tabId }, 4000).catch(() => {});
        await activateApp("Google Chrome");
        await call("focus", { tabId: snap.tabId, id: el.id }, 4000).catch(() => {});
        await pressKeys(st.keys ?? "enter");
        history.push(`Pressed ${st.keys} (from memory)`);
        await sleep(600);
      }
    } catch (e) {
      bb("web", "recipe_step_failed", { at: i, error: (e as Error).message });
      return { ok: false, at: i, why: "error" };
    }
  }
  return { ok: true };
}
