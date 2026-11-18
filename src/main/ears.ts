import { log as bb } from "./blackbox";
import { limited } from "./limiter";

// Milo's ears: ElevenLabs speech-to-text. Audio arrives from the renderer as a 16 kHz mono WAV.

type Heard = { ok: true; text: string } | { ok: false; text: string };

/** Never let one slow transcription block every command after it. */
function withTimeout(p: Promise<Heard>, ms: number): Promise<Heard> {
  return Promise.race([
    p,
    new Promise<Heard>((resolve) =>
      setTimeout(() => {
        bb("ears", "transcribe_timeout", { ms });
        resolve({ ok: false, text: "busy" });
      }, ms)
    ),
  ]);
}

export function transcribe(audio: ArrayBuffer | Uint8Array): Promise<Heard> {
  // Deepgram when it's set up (fast, and keeps ElevenLabs credits for Milo's voice), else ElevenLabs.
  return withTimeout(process.env.DEEPGRAM_API_KEY ? deepgram(audio) : elevenlabs(audio), 12000);
}

async function deepgram(audio: ArrayBuffer | Uint8Array): Promise<Heard> {
  try {
    const res = await fetch("https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&language=en&keyterm=Milo", {
      method: "POST",
      headers: { Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`, "content-type": "audio/wav" },
      body: Buffer.from(audio as ArrayBuffer),
    });
    if (!res.ok) {
      const detail = await res.text();
      bb("ears", "deepgram_error", { status: res.status, detail: detail.slice(0, 400) });
      if (res.status === 401 || res.status === 403) return { ok: false, text: "Deepgram rejected my key. Run npm run setkey -- deepgram with your key copied." };
      return elevenlabs(audio); // try the other service
    }
    const data = (await res.json()) as { results?: { channels?: { alternatives?: { transcript?: string }[] }[] } };
    return { ok: true, text: (data.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "").trim() };
  } catch (err) {
    bb("ears", "deepgram_network_error", { error: (err as Error).message });
    return elevenlabs(audio);
  }
}

async function elevenlabs(audio: ArrayBuffer | Uint8Array): Promise<Heard> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return { ok: false, text: "I need an ElevenLabs key to hear you. Run npm run setkey with it copied." };

  try {
    const bytes = Buffer.from(audio as ArrayBuffer);
    const res = await limited(2, () => {
      const form = new FormData(); // rebuilt per attempt (a sent body can't be reused)
      form.append("model_id", process.env.MILO_STT_MODEL || "scribe_v1");
      form.append("language_code", "en");
      form.append("tag_audio_events", "false");
      form.append("file", new Blob([bytes], { type: "audio/wav" }), "speech.wav");
      return fetch("https://api.elevenlabs.io/v1/speech-to-text", { method: "POST", headers: { "xi-api-key": key }, body: form });
    });
    if (!res.ok) {
      const detail = await res.text();
      console.warn(`[ears] ElevenLabs ${res.status}: ${detail.slice(0, 200)}`);
      bb("ears", "elevenlabs_error", { status: res.status, detail: detail.slice(0, 400) });
      if (/quota_exceeded|credits|quota/i.test(detail)) {
        return { ok: false, text: "I'm out of ElevenLabs credits, so I can't hear you right now. Type to me in the chat, or top up ElevenLabs." };
      }
      if (res.status === 401 || res.status === 403) {
        return { ok: false, text: "ElevenLabs rejected my key. Check the ELEVENLABS_API_KEY in .env (it needs Speech to Text access)." };
      }
      if (res.status === 429) return { ok: false, text: "busy" };
      return { ok: false, text: `I couldn't hear that (${res.status}). Try again?` };
    }
    const data = (await res.json()) as { text?: string };
    return { ok: true, text: (data.text ?? "").trim() };
  } catch (err) {
    return { ok: false, text: `I couldn't hear that: ${(err as Error).message}` };
  }
}
