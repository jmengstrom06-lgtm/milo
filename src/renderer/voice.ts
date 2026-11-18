// Plays Milo's lines. ElevenLabs audio when available (prefetched so there are no gaps),
// otherwise the best built-in Mac voice at a natural pitch and speed.

type Clip = { ok: true; url: string } | { ok: false };
const cache = new Map<string, Promise<Clip>>();
let current: HTMLAudioElement | null = null;
let elevenDownUntil = 0; // pause ElevenLabs after it fails (no key, out of credits…), then try again
const elevenDown = () => Date.now() < elevenDownUntil;
/** Called once when ElevenLabs stops working (e.g. out of credits), so Milo can say so. */
export let onVoiceTrouble: (reason: "quota" | "key") => void = () => {};
export function setVoiceTroubleHandler(fn: (reason: "quota" | "key") => void) {
  onVoiceTrouble = fn;
}

function b64ToUrl(b64: string) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: "audio/mpeg" }));
}

/** Start generating audio for a line now, so it's ready when Milo needs it. */
export function prefetch(text: string, urgent = false): Promise<Clip> {
  const key = text.trim();
  if (!key || elevenDown()) return Promise.resolve({ ok: false });
  let p = cache.get(key);
  if (!p) {
    p = window.milo.tts(key, urgent).then((r) => {
      if (r.ok) return { ok: true as const, url: b64ToUrl(r.audio) };
      if (r.text === "no-key") elevenDownUntil = Date.now() + 10 * 60_000;
      else if (r.text === "quota") {
        if (!elevenDown()) onVoiceTrouble("quota");
        elevenDownUntil = Date.now() + 5 * 60_000; // check again in a few minutes
      } else if (r.text === "voice-error-401" || r.text === "voice-error-403") {
        if (!elevenDown()) onVoiceTrouble("key");
        elevenDownUntil = Date.now() + 60_000;
      }
      cache.delete(key); // don't keep a failed line around
      return { ok: false as const };
    });
    cache.set(key, p);
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

function systemSpeak(text: string, onStart: () => void): Promise<void> {
  return new Promise((resolve) => {
    const synth = window.speechSynthesis;
    if (!synth) return resolve();
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    if (bestVoice) u.voice = bestVoice;
    u.rate = 1.0; // natural speed (pitch/rate tweaks made the old voice choppy)
    u.pitch = 1.0;
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        resolve();
      }
    };
    u.onstart = onStart;
    u.onend = finish;
    u.onerror = finish;
    setTimeout(finish, 2000 + text.length * 90);
    synth.speak(u);
  });
}

/** Speak a line. Resolves when Milo finishes talking. */
export async function play(text: string, onStart: () => void): Promise<void> {
  stop();
  const clip = await prefetch(text, true);
  if (clip.ok) {
    await new Promise<void>((resolve) => {
      const a = new Audio(clip.url);
      current = a;
      let done = false;
      const finish = () => {
        if (!done) {
          done = true;
          if (current === a) current = null;
          resolve();
        }
      };
      a.onplaying = onStart;
      a.onended = finish;
      a.onerror = finish;
      a.onpause = finish; // stop() pauses
      a.play().catch(finish);
    });
    return;
  }
  await systemSpeak(text, onStart);
}

export function stop() {
  if (current) {
    current.pause();
    current = null;
  }
  window.speechSynthesis?.cancel();
}
