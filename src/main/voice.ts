import { log as bb } from "./blackbox";
import { limited } from "./limiter";
import { account, backend } from "./account";

// Milo's voice: ElevenLabs text-to-speech, called from the main process so the key stays private.
// Falls back (in the renderer) to the Mac's built-in voice if there's no key or the call fails.

const DEFAULT_VOICE = "bIHbv24MWmeRgasZH58o"; // ElevenLabs premade "Will": young, upbeat, conversational

/**
 * One line of speech as MP3. `around` = the sentences before/after this one, so a line split into
 * sentences still sounds like one smooth thought.
 */
export async function speak(
  text: string,
  urgent = false,
  around: { previous?: string; next?: string } = {}
): Promise<{ ok: true; audio: string } | { ok: false; text: string }> {
  const key = process.env.ELEVENLABS_API_KEY;
  const signedIn = account().signedIn;
  if (!key && !signedIn) return { ok: false, text: "no-key" };

  const voice = process.env.MILO_VOICE_ID || DEFAULT_VOICE;
  try {
    const payload: Record<string, unknown> = {
      text,
      model_id: process.env.MILO_VOICE_MODEL || "eleven_flash_v2_5",
      voice_settings: { stability: 0.4, similarity_boost: 0.8, style: 0.35, use_speaker_boost: true, speed: 1.05 },
    };
    if (around.previous) payload.previous_text = around.previous.slice(-500);
    if (around.next) payload.next_text = around.next.slice(0, 500);
    const direct = () =>
      fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
        method: "POST",
        headers: { "xi-api-key": key!, "content-type": "application/json", accept: "audio/mpeg" },
        body: JSON.stringify(payload),
      });
    const res = await limited(urgent ? 1 : 0, async () => {
      if (signedIn) {
        const r = await backend("tts", { body: JSON.stringify({ ...payload, voice }) }).catch(() => null);
        if (r && !(r.status === 503 && key)) return r;
      }
      if (!key) return new Response(JSON.stringify({ error: "signed_out" }), { status: 401 });
      return direct();
    });
    if (!res.ok) {
      const detail = await res.text();
      console.warn(`[voice] ElevenLabs ${res.status}: ${detail.slice(0, 200)}`);
      bb("voice", "elevenlabs_error", { status: res.status, detail: detail.slice(0, 400) });
      if (/quota_exceeded|credits|quota|"limit"/i.test(detail)) return { ok: false, text: "quota" };
      return { ok: false, text: `voice-error-${res.status}` };
    }
    const buf = Buffer.from(await res.arrayBuffer());
    return { ok: true, audio: buf.toString("base64") };
  } catch (err) {
    console.warn(`[voice] ${(err as Error).message}`);
    return { ok: false, text: "voice-network" };
  }
}
