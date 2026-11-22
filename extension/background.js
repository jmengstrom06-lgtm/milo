// Milo's Chrome extension. Connects to the Milo app on this Mac (127.0.0.1 only, with a secret
// that changes every launch) and lets Milo read pages and click / type by element instead of
// guessing from screenshots.

let ws = null;
let connecting = false;

function askMilo() {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendNativeMessage("app.milo.bridge", { hello: 1 }, (res) => {
        if (chrome.runtime.lastError || !res?.port || !res?.token) reject(new Error(chrome.runtime.lastError?.message || "Milo isn't running"));
        else resolve(res);
      });
    } catch (e) {
      reject(e);
    }
  });
}

async function connect() {
  if (connecting || (ws && ws.readyState <= 1)) return;
  connecting = true;
  try {
    // Where's Milo? Ask the Milo app through Chrome's native messaging (the Chrome Web Store version),
    // or read the file Milo writes into this folder (the copy you load by hand while building).
    const cfg = await askMilo().catch(() => fetch(chrome.runtime.getURL("config.json"), { cache: "no-store" }).then((r) => r.json()));
    if (!cfg?.port || !cfg?.token) throw new Error("no config yet");
    const sock = new WebSocket(`ws://127.0.0.1:${cfg.port}/?token=${encodeURIComponent(cfg.token)}`);
    sock.onopen = () => {
      ws = sock;
      // Talking every 20 s keeps Chrome from putting this worker to sleep (which drops the connection).
      clearInterval(self.miloBeat);
      self.miloBeat = setInterval(() => sock.readyState === 1 && sock.send(JSON.stringify({ beat: Date.now() })), 20000);
      chrome.action.setBadgeText({ text: "" });
      chrome.action.setTitle({ title: "Milo: connected" });
    };
    sock.onmessage = async (msg) => {
      let req;
      try {
        req = JSON.parse(msg.data);
      } catch {
        return;
      }
      if (req.cmd === "ping") return sock.send(JSON.stringify({ id: req.id, ok: true, data: "pong" }));
      try {
        const data = await run(req.cmd, req.args || {});
        sock.send(JSON.stringify({ id: req.id, ok: true, data }));
      } catch (e) {
        sock.send(JSON.stringify({ id: req.id, ok: false, error: String(e?.message || e) }));
      }
    };
    sock.onclose = () => {
      if (ws === sock) ws = null;
      chrome.action.setBadgeText({ text: "off" });
      chrome.action.setBadgeBackgroundColor({ color: "#6b7280" });
      chrome.action.setTitle({ title: "Milo: not running" });
      setTimeout(connect, 1500);
    };
  } catch {
    setTimeout(connect, 2000);
  } finally {
    connecting = false;
  }
}

chrome.runtime.onStartup.addListener(connect);
chrome.runtime.onInstalled.addListener(connect);
chrome.alarms.create("milo-keepalive", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(connect);
connect();

// ---------------------------------------------------------------------------------------------

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab || null;
}

async function tabFor(args) {
  if (args.tabId) return chrome.tabs.get(args.tabId);
  const t = await activeTab();
  if (!t) throw new Error("No Chrome tab is open");
  return t;
}

async function exec(tabId, func, args = []) {
  const [res] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
  return res?.result;
}

function waitForLoad(tabId, ms = 8000) {
  return new Promise((resolve) => {
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      chrome.tabs.onUpdated.removeListener(on);
      setTimeout(resolve, 350); // let scripts draw the page
    }
    function on(id, info) {
      if (id === tabId && info.status === "complete") done();
    }
    chrome.tabs.onUpdated.addListener(on);
    chrome.tabs.get(tabId).then((tab) => tab.status === "complete" && done()).catch(done);
  });
}

async function run(cmd, args) {
  switch (cmd) {
    case "status":
      return { version: chrome.runtime.getManifest().version, d2l: true };
    case "d2l_fetch": {
      // Read the student's D2L with the sign-in they already have in Chrome. Only D2L's own addresses
      // (https, a /d2l/ or course-file /content/ path), only reading (GET). Never anything else, never sending anything.
      const u = new URL(String(args.url || ""));
      if (u.protocol !== "https:" || !/^\/(d2l|content)\//.test(u.pathname)) throw new Error("Only D2L pages");
      const r = await fetch(u.href, { method: "GET", credentials: "include", headers: { Accept: args.binary || args.text ? "*/*" : "application/json" }, redirect: "follow" });
      const type = r.headers.get("content-type") || "";
      if (!args.binary) return { s: r.status, t: type, b: (await r.text()).slice(0, 4e6), url: r.url };
      if (!r.ok) return { s: r.status, t: type, b: null, url: r.url };
      const buf = new Uint8Array(await r.arrayBuffer());
      if (buf.length > (args.maxBytes || 12e6)) return { s: 413, t: type, b: null, url: r.url };
      let bin = "";
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
      return { s: r.status, t: type, b: btoa(bin), url: r.url };
    }
    case "tabs": {
      const tabs = await chrome.tabs.query({ lastFocusedWindow: true });
      return tabs.map((t) => ({ id: t.id, title: t.title, url: t.url, active: t.active }));
    }
    case "active": {
      const t = await activeTab();
      return t ? { id: t.id, title: t.title, url: t.url, windowId: t.windowId } : null;
    }
    case "snapshot": {
      const tab = await tabFor(args);
      if (!/^https?:|^file:/.test(tab.url || "")) return { url: tab.url, title: tab.title, restricted: true, elements: [], text: "" };
      const snap = await exec(tab.id, snapshotPage, [args.max || 220]);
      return { tabId: tab.id, ...snap };
    }
    case "click": {
      const tab = await tabFor(args);
      const r = await exec(tab.id, clickEl, [String(args.id)]);
      if (!r?.ok) throw new Error(r?.error || "click failed");
      if (r.navigates) await waitForLoad(tab.id, 6000);
      else await new Promise((res) => setTimeout(res, 350));
      return r;
    }
    case "type": {
      const tab = await tabFor(args);
      const r = await exec(tab.id, typeEl, [String(args.id), String(args.text ?? ""), !!args.clear]);
      if (!r?.ok) throw new Error(r?.error || "type failed");
      return r;
    }
    case "focus": {
      const tab = await tabFor(args);
      return exec(tab.id, focusEl, [String(args.id)]);
    }
    case "navigate": {
      const tab = await tabFor(args);
      await chrome.tabs.update(tab.id, { url: args.url, active: true });
      await waitForLoad(tab.id);
      return { ok: true };
    }
    case "new_tab": {
      const tab = await chrome.tabs.create({ url: args.url || "chrome://newtab", active: true });
      if (args.url) await waitForLoad(tab.id);
      return { ok: true, tabId: tab.id };
    }
    case "switch_tab": {
      const tab = await chrome.tabs.update(args.tabId, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
      return { ok: true };
    }
    case "back": {
      const tab = await tabFor(args);
      await chrome.tabs.goBack(tab.id);
      await waitForLoad(tab.id, 5000);
      return { ok: true };
    }
    case "scroll": {
      const tab = await tabFor(args);
      return exec(tab.id, (dir) => {
        const h = window.innerHeight * 0.8;
        window.scrollBy({ top: dir === "up" ? -h : dir === "top" ? -1e9 : dir === "bottom" ? 1e9 : h, behavior: "instant" });
        return { ok: true, y: Math.round(window.scrollY) };
      }, [args.direction || "down"]);
    }
    case "focus_window": {
      const tab = await tabFor(args);
      await chrome.windows.update(tab.windowId, { focused: true });
      return { ok: true };
    }
    default:
      throw new Error(`Unknown command ${cmd}`);
  }
}

// ---------- functions below run INSIDE the web page ---------------------------------------------

function snapshotPage(max) {
  const SEL =
    'a[href], button, input:not([type=hidden]), textarea, select, summary, [role=button], [role=link], [role=tab], [role=menuitem], [role=option], [role=checkbox], [role=radio], [role=switch], [role=textbox], [role=combobox], [role=searchbox], [contenteditable=""], [contenteditable="true"], [onclick]';
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let next = Number(document.documentElement.dataset.miloNext || 1);
  const visible = (el, r) => {
    if (r.width < 2 || r.height < 2) return false;
    const s = getComputedStyle(el);
    return s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0.05;
  };
  const labelOf = (el) => {
    const t = (x) => (x || "").replace(/\s+/g, " ").trim();
    let l = t(el.getAttribute("aria-label")) || t(el.getAttribute("title"));
    if (!l && el.id) {
      const lab = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (lab) l = t(lab.innerText);
    }
    if (!l && el.getAttribute("aria-labelledby")) {
      l = el.getAttribute("aria-labelledby").split(/\s+/).map((id) => t(document.getElementById(id)?.innerText)).join(" ");
    }
    if (!l) l = t(el.innerText || el.textContent);
    if (!l) l = t(el.getAttribute("placeholder")) || t(el.getAttribute("alt")) || t(el.getAttribute("name"));
    if (!l && el.isContentEditable)
      l = t(el.getAttribute("aria-placeholder")) || t(el.getAttribute("data-placeholder")) ||
        t(el.querySelector("[data-placeholder]")?.getAttribute("data-placeholder")) || (el.id ? `text box #${el.id}` : "text box");
    if (!l) {
      const img = el.querySelector("img[alt], svg[aria-label]");
      if (img) l = t(img.getAttribute("alt") || img.getAttribute("aria-label"));
    }
    return l.slice(0, 90);
  };
  const out = [];
  for (const el of document.querySelectorAll(SEL)) {
    const r = el.getBoundingClientRect();
    if (!visible(el, r)) continue;
    if (el.closest("[aria-hidden=true]")) continue;
    if (!el.dataset.miloId) el.dataset.miloId = String(next++);
    const tag = el.tagName.toLowerCase();
    const inView = r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw;
    const item = {
      id: el.dataset.miloId,
      tag,
      role: el.getAttribute("role") || undefined,
      type: el.getAttribute("type") || undefined,
      label: labelOf(el),
      inView,
      rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
    };
    if (tag === "input" || tag === "textarea" || tag === "select") {
      item.value = String(el.value ?? "").slice(0, 120);
      item.placeholder = el.getAttribute("placeholder") || undefined;
      if (el.type === "checkbox" || el.type === "radio") item.checked = el.checked;
    }
    if (el.isContentEditable) {
      item.editable = true;
      item.value = (el.innerText || "").slice(0, 120);
    }
    if (tag === "a") item.href = (el.getAttribute("href") || "").slice(0, 120);
    if (el.disabled || el.getAttribute("aria-disabled") === "true") item.disabled = true;
    out.push(item);
  }
  document.documentElement.dataset.miloNext = String(next);
  // Prefer what's on screen; keep the list a reasonable size.
  out.sort((a, b) => Number(b.inView) - Number(a.inView) || a.rect.y - b.rect.y);
  const elements = out.slice(0, max);
  const main = document.querySelector("main, [role=main], article") || document.body;
  const text = (main.innerText || "").replace(/\n{3,}/g, "\n\n").slice(0, 7000);
  const canvasHeavy = !!document.querySelector(".kix-appview-editor, .docs-texteventtarget-iframe, canvas.kix-canvas-tile-content") ||
    (document.querySelectorAll("canvas").length > 0 && out.length < 8);
  return {
    url: location.href,
    title: document.title,
    elements,
    total: out.length,
    text,
    canvasHeavy,
    focused: document.activeElement?.dataset?.miloId || null,
    scroll: { y: Math.round(window.scrollY), max: Math.round(document.documentElement.scrollHeight - vh) },
    // Where the page sits on screen (so Milo can hop next to what he's about to click).
    frame: { screenX: window.screenX, screenY: window.screenY, top: window.outerHeight - window.innerHeight, zoom: window.devicePixelRatio || 1 },
  };
}

function findEl(id) {
  return document.querySelector(`[data-milo-id="${CSS.escape(id)}"]`);
}

function clickEl(id) {
  const el = document.querySelector(`[data-milo-id="${CSS.escape(id)}"]`);
  if (!el) return { ok: false, error: "That element isn't on the page anymore" };
  el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
  const r = el.getBoundingClientRect();
  const a = el.closest("a[href]");
  const navigates = !!a && !a.target && !/^#|^javascript:/i.test(a.getAttribute("href") || "");
  const opts = { bubbles: true, cancelable: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
  el.dispatchEvent(new PointerEvent("pointerdown", opts));
  el.dispatchEvent(new MouseEvent("mousedown", opts));
  el.focus?.();
  el.dispatchEvent(new PointerEvent("pointerup", opts));
  el.dispatchEvent(new MouseEvent("mouseup", opts));
  el.click();
  return { ok: true, navigates, rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) } };
}

function focusEl(id) {
  const el = document.querySelector(`[data-milo-id="${CSS.escape(id)}"]`);
  if (!el) return { ok: false };
  el.scrollIntoView({ block: "center", behavior: "instant" });
  el.focus?.();
  return { ok: true };
}

function typeEl(id, text, clear) {
  const el = document.querySelector(`[data-milo-id="${CSS.escape(id)}"]`);
  if (!el) return { ok: false, error: "That text box isn't on the page anymore" };
  el.scrollIntoView({ block: "center", behavior: "instant" });
  el.focus();
  const r = el.getBoundingClientRect();
  if (el.isContentEditable) {
    // Rich editors (ChatGPT, Notion, Slack...): insertText goes through their own handlers.
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    if (!clear) range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
    const ok = document.execCommand("insertText", false, text);
    if (!ok) el.textContent = (clear ? "" : el.textContent) + text;
    el.dispatchEvent(new InputEvent("input", { bubbles: true, data: text, inputType: "insertText" }));
    return { ok: true, value: (el.innerText || "").slice(-120), rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) } };
  }
  if (el.tagName === "SELECT") {
    const opt = [...el.options].find((o) => o.text.trim().toLowerCase() === text.trim().toLowerCase() || o.value === text);
    if (!opt) return { ok: false, error: `No option "${text}"` };
    el.value = opt.value;
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true, value: opt.text };
  }
  // Inputs/textareas: use the native setter so React/Vue/etc. notice the change.
  const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  const value = clear ? text : (el.value || "") + text;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new InputEvent("input", { bubbles: true, data: text, inputType: "insertText" }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return { ok: true, value: String(el.value).slice(-120), rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) } };
}
