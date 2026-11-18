import { limited } from "./limiter";

// Milo's ears: ElevenLabs speech-to-text. Audio arrives from the renderer as a 16 kHz mono WAV.

export async function transcribe(audio: ArrayBuffer | Uint8Array): Promise<{ ok: true; text: string } | { ok: false; text: string }> {
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
