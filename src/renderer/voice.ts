// Plays Milo's lines. ElevenLabs audio when available (prefetched so there are no gaps),
// otherwise the best Mac voice, rendered to audio. EVERYTHING plays through this page's own audio
// (Web Audio), so the mic's echo cancelling can remove Milo's voice and he doesn't hear himself.

type Clip = { ok: true; bytes: Uint8Array; engine: "elevenlabs" | "mac" } | { ok: false };
const cache = new Map<string, Promise<Clip>>();
let current: AudioBufferSourceNode | null = null;
let ctx: AudioContext | null = null;
const audioCtx = () => (ctx ??= new AudioContext());
let elevenDownUntil = 0; // pause ElevenLabs after it fails (no key, out of credits…), then try again
const elevenDown = () => freeVoice || Date.now() < elevenDownUntil;
/** Free voice: Milo speaks with the Mac's built-in voice (no ElevenLabs credits). Listening is unchanged. */
let freeVoice = (() => { try { return localStorage.getItem("milo.freeVoice") === "1"; } catch { return false; } })();
export const isFreeVoice = () => freeVoice;
export function setFreeVoice(on: boolean) {
  freeVoice = on;
  try { localStorage.setItem("milo.freeVoice", on ? "1" : "0"); } catch {}
  if (on) cache.clear();
}
/** Called once when ElevenLabs stops working (e.g. out of credits), so Milo can say so. */
export let onVoiceTrouble: (reason: "quota" | "key") => void = () => {};
export function setVoiceTroubleHandler(fn: (reason: "quota" | "key") => void) {
  onVoiceTrouble = fn;
}

function b64ToBytes(b64: string) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** The free voice: the Mac renders the line to audio (no credits, no glitches). */
function macClip(key: string): Promise<Clip> {
  return window.milo
    .macSay(key)
    .then((r): Clip => (r.ok ? { ok: true, bytes: b64ToBytes(r.audio), engine: "mac" } : { ok: false }))
    .catch((): Clip => ({ ok: false }));
}

/** Start generating audio for a line now, so it's ready when Milo needs it. */
export function prefetch(text: string, urgent = false, around?: { previous?: string; next?: string }): Promise<Clip> {
  const key = text.trim();
  if (!key) return Promise.resolve({ ok: false });
  const useMac = elevenDown();
  const ck = (useMac ? "mac:" : "el:") + key;
  let p = cache.get(ck);
  if (!p) {
    p = useMac ? macClip(key) : window.milo.tts(key, urgent, around).then((r): Clip | Promise<Clip> => {
      if (r.ok) return { ok: true, bytes: b64ToBytes(r.audio), engine: "elevenlabs" };
      if (r.text === "no-key") elevenDownUntil = Date.now() + 10 * 60_000;
      else if (r.text === "quota") {
        if (!elevenDown()) onVoiceTrouble("quota");
        elevenDownUntil = Date.now() + 5 * 60_000; // check again in a few minutes
      } else if (r.text === "voice-error-401" || r.text === "voice-error-403") {
        if (!elevenDown()) onVoiceTrouble("key");
        elevenDownUntil = Date.now() + 60_000;
      }
      window.milo.log("voice", "natural_voice_failed", { reason: r.text, text: key.slice(0, 80) });
      cache.delete(ck); // don't keep a failed line around
      return macClip(key); // say it in the free voice instead
    });
    p.then((c) => {
      if (!c.ok) cache.delete(ck);
    });
    cache.set(ck, p);
    if (cache.size > 60) cache.delete(cache.keys().next().value as string);
  }
  return p;
}

// ---- built-in voice fallback ---------------------------------------------------
let bestVoice: SpeechSynthesisVoice | null = null;
function pickVoice() {
  const voices = window.speechSynthesis?.getVoices() ?? [];
  const en = voices.filter((v) => v.lang.startsWith("en"));
  const score = (v: SpeechSynthesisVoice) =>
    (/premium/i.test(v.name) ? 40 : 0) +
    (/enhanced/i.test(v.name) ? 30 : 0) +
    (/(samantha|ava|zoe|evan|nathan|tom|alex|daniel)/i.test(v.name) ? 15 : 0) +
    (v.lang === "en-US" ? 5 : 0) +
    (v.localService ? 2 : 0) -
    (/(bad news|bells|bubbles|cellos|whisper|zarvox|trinoids|jester|organ|superstar|wobble|boing|albert|bahh|fred|junior|ralph|kathy|good news)/i.test(v.name) ? 100 : 0);
  bestVoice = en.sort((a, b) => score(b) - score(a))[0] ?? null;
}
if (window.speechSynthesis) {
  pickVoice();
  window.speechSynthesis.onvoiceschanged = pickVoice;
}

// Chromium's speech has known glitches: an utterance can be garbage-collected mid-line (it just stops and
// "end" never fires), speak() right after cancel() is often dropped, and long lines cut off after ~15s.
// So: keep references, give cancel a beat, speak sentence by sentence, and poll for the real end.
const live: SpeechSynthesisUtterance[] = [];
let speakToken = 0;

function splitSentences(text: string): string[] {
  const parts = text.replace(/\s+/g, " ").trim().match(/[^.!?;:]+[.!?;:]*["')\]]*\s*/g) ?? [text];
  const out: string[] = [];
  for (const p of parts) {
    const t = p.trim();
    if (!t) continue;
    if (out.length && (t.length < 12 || out[out.length - 1].length < 12)) out[out.length - 1] += " " + t;
    else out.push(t);
  }
  return out.length ? out : [text];
}

function speakOne(text: string, token: number, onStart: () => void): Promise<void> {
  return new Promise((resolve) => {
    const synth = window.speechSynthesis;
    const u = new SpeechSynthesisUtterance(text);
    if (bestVoice) u.voice = bestVoice;
    u.rate = 1.0;
    u.pitch = 1.0;
    live.push(u); // keep it alive until it's done
    let done = false;
    let started = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearInterval(poll);
      clearTimeout(cap);
      const i = live.indexOf(u);
      if (i >= 0) live.splice(i, 1);
      resolve();
    };
    const begin = () => {
      if (!started) {
        started = true;
        onStart();
      }
    };
    u.onstart = begin;
    u.onend = finish;
    u.onerror = finish;
    // Backup end check: once it has started, "not speaking anymore" means done.
    let quiet = 0;
    const poll = setInterval(() => {
      if (token !== speakToken) return finish();
      if (synth.speaking) {
        begin();
        quiet = 0;
      } else if (started && ++quiet >= 2) finish();
    }, 150);
    const cap = setTimeout(() => {
      if (!done) window.milo.log("voice", "mac_voice_timeout", { started, text: text.slice(0, 80) });
      finish();
    }, 4000 + text.length * 120);
    synth.speak(u);
  });
}

async function systemSpeak(text: string, onStart: () => void): Promise<void> {
  const synth = window.speechSynthesis;
  if (!synth) return;
  const token = ++speakToken;
  if (synth.speaking || synth.pending) {
    synth.cancel();
    await new Promise((r) => setTimeout(r, 80)); // speak() right after cancel() gets dropped
  }
  let first = true;
  for (const part of splitSentences(text)) {
    if (token !== speakToken) return;
    await speakOne(part, token, () => {
      if (first) {
        first = false;
        onStart();
      }
    });
  }
}

/** Play rendered audio through this page (so echo cancelling knows about it). */
async function playBytes(bytes: Uint8Array, onStart: () => void): Promise<boolean> {
  const c = audioCtx();
  if (c.state === "suspended") await c.resume().catch(() => {});
  let buf: AudioBuffer;
  try {
    buf = await c.decodeAudioData(bytes.slice().buffer);
  } catch {
    return false;
  }
  await new Promise<void>((resolve) => {
    const src = c.createBufferSource();
    src.buffer = buf;
    src.connect(c.destination);
    current = src;
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        if (current === src) current = null;
        resolve();
      }
    };
    src.onended = finish; // also fires on stop()
    setTimeout(finish, buf.duration * 1000 + 1500); // never hang
    src.start();
    onStart();
  });
  return true;
}

/** Is this exact line already being made (someone prefetched it)? */
const alreadyFetching = (text: string) => {
  const k = text.trim();
  return cache.has("el:" + k) || cache.has("mac:" + k);
};

/** Sentences grouped into chunks: a short first one (so Milo starts fast), then fuller ones. */
function speechChunks(text: string): string[] {
  const sentences = splitSentences(text);
  const out: string[] = [];
  for (const s of sentences) {
    const last = out[out.length - 1];
    if (out.length >= 1 && last.length < 60) out[out.length - 1] = `${last} ${s}`;
    else if (out.length >= 2 && last.length + s.length < 220) out[out.length - 1] = `${last} ${s}`;
    else out.push(s);
  }
  return out;
}

/**
 * Speak a line. Resolves when Milo finishes talking.
 * Long lines are split into sentences: the first one is made and played right away while the rest
 * are made in the background, so Milo starts talking in a fraction of the time.
 */
export async function play(text: string, onStart: () => void): Promise<void> {
  stop();
  const token = speakToken;
  const parts = text.length > 140 && !alreadyFetching(text) && !elevenDown() ? speechChunks(text) : [text];

  if (parts.length > 1) {
    let begun = false;
    const begin = () => {
      if (!begun) {
        begun = true;
        onStart();
      }
    };
    const clips = parts.map((p, i) => prefetch(p, i === 0, { previous: parts[i - 1], next: parts[i + 1] }));
    window.milo.log("voice", "play", { engine: "elevenlabs_chunks", chunks: parts.length, chars: text.length });
    for (let i = 0; i < parts.length; i++) {
      const clip = await clips[i];
      if (token !== speakToken) return;
      if (!clip.ok || !(await playBytes(clip.bytes, begin))) {
        await systemSpeak(parts.slice(i).join(" "), begin);
        return;
      }
      if (token !== speakToken) return;
    }
    return;
  }

  const clip = await prefetch(text, true);
  if (token !== speakToken) return; // stopped while it was loading
  window.milo.log("voice", "play", { engine: clip.ok ? clip.engine : "chromium_speech", free: freeVoice, chars: text.length });
  if (clip.ok && (await playBytes(clip.bytes, onStart))) return;
  await systemSpeak(text, onStart); // last resort
}

export function stop() {
  speakToken++;
  if (current) {
    try {
      current.stop();
    } catch {
      /* already stopped */
    }
    current = null;
  }
  window.speechSynthesis?.cancel();
}
