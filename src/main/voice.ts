// Milo's voice: ElevenLabs text-to-speech, called from the main process so the key stays private.
// Falls back (in the renderer) to the Mac's built-in voice if there's no key or the call fails.

const DEFAULT_VOICE = "bIHbv24MWmeRgasZH58o"; // ElevenLabs premade "Will": young, upbeat, conversational

export async function speak(text: string): Promise<{ ok: true; audio: string } | { ok: false; text: string }> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return { ok: false, text: "no-key" };

  const voice = process.env.MILO_VOICE_ID || DEFAULT_VOICE;
  try {
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: { "xi-api-key": key, "content-type": "application/json", accept: "audio/mpeg" },
        body: JSON.stringify({
          text,
          model_id: process.env.MILO_VOICE_MODEL || "eleven_flash_v2_5",
          voice_settings: { stability: 0.4, similarity_boost: 0.8, style: 0.35, use_speaker_boost: true, speed: 1.05 },
        }),
      }
    );
    if (!res.ok) {
      const detail = await res.text();
      console.warn(`[voice] ElevenLabs ${res.status}: ${detail.slice(0, 200)}`);
      return { ok: false, text: `voice-error-${res.status}` };
    }
    const buf = Buffer.from(await res.arrayBuffer());
    return { ok: true, audio: buf.toString("base64") };
  } catch (err) {
    console.warn(`[voice] ${(err as Error).message}`);
    return { ok: false, text: "voice-network" };
  }
}
