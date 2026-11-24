// The checkup: is everything Milo needs actually working, right now? Run at launch and every few hours.
// Each item says what's wrong in plain words and offers a one-tap fix, so a task never fails halfway
// because a connection was quietly broken. The decisions here are pure (tested); main.ts does the probing.

export type CheckId = "ai" | "account" | "d2l" | "google" | "chrome" | "screen" | "hands" | "mic";
export type FixKind = "sign-in" | "d2l" | "google" | "chrome" | "screen" | "hands" | "mic" | "retry";
export type CheckItem = {
  id: CheckId;
  label: string;
  /** true = working; false = broken; null = not set up yet (optional) */
  ok: boolean | null;
  detail: string;
  fix?: { kind: FixKind; label: string };
};

export type Probe = {
  devKey: boolean; // a developer's own AI key on this Mac
  signedIn: boolean;
  aiServer: boolean | null; // null = couldn't reach Milo's server
  portal: string;
  d2l: { ok: boolean; signin: boolean } | null; // null = not checked (no portal)
  google: { ready: boolean; connected: boolean; works: boolean | null; reconnect: boolean };
  chrome: { running: boolean; extension: boolean };
  perms: { screen: boolean; hands: boolean; mic: boolean };
};

/** Turn raw probe results into the checklist the student sees. (pure) */
export function checklist(p: Probe): CheckItem[] {
  const out: CheckItem[] = [];
  // the brain
  if (p.devKey) out.push({ id: "ai", label: "Milo's brain", ok: true, detail: "Using this Mac's developer key." });
  else if (!p.signedIn) out.push({ id: "ai", label: "Milo's brain", ok: false, detail: "Sign in to Milo so he can think.", fix: { kind: "sign-in", label: "Sign in" } });
  else if (p.aiServer === null) out.push({ id: "ai", label: "Milo's brain", ok: false, detail: "Can't reach Milo's server. Check your wifi.", fix: { kind: "retry", label: "Try again" } });
  else out.push({ id: "ai", label: "Milo's brain", ok: p.aiServer, detail: p.aiServer ? "Connected." : "Milo's server is down right now. Jake has been told.", fix: p.aiServer ? undefined : { kind: "retry", label: "Try again" } });
  out.push({ id: "account", label: "Your Milo account", ok: p.signedIn, detail: p.signedIn ? "Signed in." : "Not signed in.", fix: p.signedIn ? undefined : { kind: "sign-in", label: "Sign in" } });
  // school
  if (!p.portal) out.push({ id: "d2l", label: "D2L", ok: null, detail: "Not connected yet. Milo can't see what's due.", fix: { kind: "d2l", label: "Connect D2L" } });
  else if (!p.d2l) out.push({ id: "d2l", label: "D2L", ok: null, detail: "Not checked yet." });
  else out.push({ id: "d2l", label: "D2L", ok: p.d2l.ok, detail: p.d2l.ok ? "Signed in." : p.d2l.signin ? "Your D2L sign-in ran out." : "Can't reach D2L right now.", fix: p.d2l.ok ? undefined : { kind: p.d2l.signin ? "d2l" : "retry", label: p.d2l.signin ? "Sign in to D2L" : "Try again" } });
  // google
  const g = p.google;
  if (!g.ready) out.push({ id: "google", label: "Google (Calendar, Docs)", ok: null, detail: "Not available in this copy of Milo yet." });
  else if (!g.connected) out.push({ id: "google", label: "Google (Calendar, Docs)", ok: null, detail: "Not connected. Connect it so Milo can plan your week and make docs.", fix: { kind: "google", label: "Connect Google" } });
  else if (g.works === false) out.push({ id: "google", label: "Google (Calendar, Docs)", ok: false, detail: g.reconnect ? "Google needs you to reconnect." : "Google isn't answering right now.", fix: { kind: g.reconnect ? "google" : "retry", label: g.reconnect ? "Reconnect Google" : "Try again" } });
  else out.push({ id: "google", label: "Google (Calendar, Docs)", ok: true, detail: "Connected." });
  // hands on the web
  out.push(
    p.chrome.extension
      ? { id: "chrome", label: "Chrome helper", ok: true, detail: "Connected. Milo can work in Chrome." }
      : p.chrome.running
        ? { id: "chrome", label: "Chrome helper", ok: false, detail: "Chrome is open but Milo's helper isn't connected, so he can't work on websites.", fix: { kind: "chrome", label: "Fix it" } }
        : { id: "chrome", label: "Chrome helper", ok: null, detail: "Chrome isn't open. Milo connects when it is.", fix: { kind: "chrome", label: "Open Chrome" } }
  );
  // the Mac
  out.push({ id: "screen", label: "Seeing your screen", ok: p.perms.screen, detail: p.perms.screen ? "Allowed." : "Off. Milo can't see what you're working on.", fix: p.perms.screen ? undefined : { kind: "screen", label: "Turn on" } });
  out.push({ id: "hands", label: "Clicking and typing", ok: p.perms.hands, detail: p.perms.hands ? "Allowed." : "Off. Milo can't do things for you.", fix: p.perms.hands ? undefined : { kind: "hands", label: "Turn on" } });
  out.push({ id: "mic", label: "Microphone", ok: p.perms.mic, detail: p.perms.mic ? "Allowed." : "Off. Milo can't hear you.", fix: p.perms.mic ? undefined : { kind: "mic", label: "Turn on" } });
  return out;
}

/** Broken things that stop most of Milo working, first. */
const ORDER: CheckId[] = ["ai", "account", "screen", "hands", "d2l", "google", "chrome", "mic"];
export function problems(items: CheckItem[]): CheckItem[] {
  return items.filter((i) => i.ok === false).sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));
}

/** What the frog says when something broke since last time (empty = nothing worth interrupting for). (pure) */
export function checkupLine(items: CheckItem[], lastProblems: string[]): string {
  const now = problems(items);
  const fresh = now.filter((p) => !lastProblems.includes(p.id));
  if (!fresh.length) return "";
  const first = fresh[0];
  return fresh.length === 1 ? `Heads up: ${first.label}: ${first.detail}` : `Heads up: ${fresh.length} things need you. ${first.label}: ${first.detail}`;
}
