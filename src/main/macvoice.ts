// Free voice, rendered to audio with the Mac's own `say` so it plays through Milo's audio
// (that lets echo cancelling remove it from the mic, and avoids Chromium's speech glitches).

import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { log as bb } from "./blackbox";

let voice: string | null | undefined; // undefined = not picked yet, null = use the system default

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile(cmd, args, { timeout: 20000, maxBuffer: 4 * 1024 * 1024 }, (err, out) => (err ? reject(err) : resolve(String(out))))
  );
}

async function pickVoice(): Promise<string | null> {
  if (voice !== undefined) return voice;
  try {
    const out = await run("say", ["-v", "?"]);
    const voices = out
      .split("\n")
      .map((l) => l.match(/^(.+?)\s{2,}([a-z]{2}_[A-Z]{2})\s/))
      .filter((m): m is RegExpMatchArray => !!m)
      .map((m) => ({ name: m[1].trim(), lang: m[2] }))
      .filter((v) => v.lang.startsWith("en_"));
    const score = (v: { name: string; lang: string }) =>
      (/premium/i.test(v.name) ? 40 : 0) +
      (/enhanced/i.test(v.name) ? 30 : 0) +
      (/^(zoe|ava|evan|nathan|tom|samantha|alex|daniel|allison|susan)\b/i.test(v.name) ? 15 : 0) +
      (v.lang === "en_US" ? 5 : 0) -
      (/(bad news|bells|bubbles|cellos|whisper|zarvox|trinoids|jester|organ|superstar|wobble|boing|albert|bahh|fred|junior|ralph|kathy|good news|eddy|flo|grandma|grandpa|reed|rocko|sandy|shelley)/i.test(v.name) ? 100 : 0);
    voice = voices.sort((a, b) => score(b) - score(a))[0]?.name ?? null;
  } catch {
    voice = null;
  }
  bb("voice", "mac_voice_picked", { voice });
  return voice;
}

/** Returns base64 WAV audio of `text` in the best installed Mac voice. */
export async function macSpeak(text: string): Promise<{ ok: true; audio: string } | { ok: false; text: string }> {
  if (process.platform !== "darwin") return { ok: false, text: "not-mac" };
  const v = await pickVoice();
  const file = path.join(os.tmpdir(), `milo-say-${process.pid}-${Date.now()}.wav`);
  try {
    await run("say", [...(v ? ["-v", v] : []), "-r", "185", "-o", file, "--file-format=WAVE", "--data-format=LEI16@22050", "--", text.slice(0, 3000)]);
    const audio = fs.readFileSync(file).toString("base64");
    return { ok: true, audio };
  } catch (e) {
    bb("voice", "mac_say_failed", { error: (e as Error).message });
    return { ok: false, text: "say-failed" };
  } finally {
    fs.rm(file, { force: true }, () => {});
  }
}
