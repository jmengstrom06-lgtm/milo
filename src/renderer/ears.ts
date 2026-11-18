// Milo's microphone: captures audio, detects when you start and stop talking (voice activity
// detection), and hands each finished utterance over as a 16 kHz WAV.
//
// Modes:
//   "off"    mic closed
//   "once"   listen for one thing you say (push-to-talk / follow-up), then close
//   "always" hands-free: keep listening; the app only acts on lines that start with "Milo"

export type EarMode = "off" | "once" | "always";
export type EarState = "off" | "waiting" | "hearing" | "timeout";

const RATE = 16000;
const FRAME = 1024; // 64 ms per frame at 16 kHz
const PRE_ROLL = 6; // ~380 ms kept from before speech starts
const START_FRAMES = 4; // ~256 ms of voice to count as speech
const MIN_VOICED_S = 0.5; // shorter than this is a cough/click, not words
const VOICE_RATIO = 0.45; // share of energy that must sit in the human-voice band (300-3400 Hz)
const END_SILENCE = 14; // ~900 ms of quiet ends the utterance (plain quiet room)
const END_NO_VOICE = 24; // ~1.5 s without YOUR voice ends it, even if other people keep talking
const MAX_FRAMES = Math.round((15 * RATE) / FRAME); // 15 s cap (push-to-talk)
const MAX_FRAMES_HF = Math.round((10 * RATE) / FRAME); // 8 s cap in hands-free so background chatter can't hang him
const ONCE_TIMEOUT = Math.round((7 * RATE) / FRAME); // give up after 7 s of nothing

export class Ears {
  mode: EarMode = "off";
  private muted = false;
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private proc: ScriptProcessorNode | null = null;

  private ring: Float32Array[] = [];
  private speech: Float32Array[] = [];
  private speaking = false;
  private loudRun = 0;
  private quietRun = 0;
  private idleFrames = 0;
  private floor = 0.008;
  private uttEnergy: number[] = []; // per-frame loudness of the current utterance
  private uttPeak = 0; // how loud the current speaker is (slowly decaying peak)
  private noVoiceRun = 0; // frames since the speaker's own voice was last heard
  voicedFrames = 0; // voiced length of the last utterance (frames)
  private lastLevel = 0; // loudness of the last finished utterance
  /** How loud YOU are when you talk to Milo (learned). Quieter, farther voices are ignored in hands-free. */
  private userLevel = Number(localStorage.getItem("milo.userLevel") || 0);

  onLevel: (level: number) => void = () => {};
  onState: (s: EarState) => void = () => {};
  /** 0..1 while waiting for you to finish (drives the "sending…" bar). */
  onPause: (progress: number) => void = () => {};
  onUtterance: (wav: ArrayBuffer, pushToTalk: boolean) => void = () => {};

  async setMode(mode: EarMode) {
    this.mode = mode;
    this.resetUtterance();
    this.idleFrames = 0;
    if (mode === "off") {
      this.close();
      this.onState("off");
      return;
    }
    await this.open();
    this.onState("waiting");
  }

  /** Ignore the mic while Milo is talking so he doesn't hear himself. */
  mute(on: boolean) {
    this.muted = on;
    if (on) this.resetUtterance();
  }

  private async open() {
    if (this.stream) return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    this.ctx = new AudioContext({ sampleRate: RATE });
    const src = this.ctx.createMediaStreamSource(this.stream);
    // Channel 0: raw mic. Channel 1: the same audio through a human-voice band filter.
    const hp = this.ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 300;
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 3400;
    const merge = this.ctx.createChannelMerger(2);
    src.connect(merge, 0, 0);
    src.connect(hp).connect(lp).connect(merge, 0, 1);
    this.proc = this.ctx.createScriptProcessor(FRAME, 2, 1);
    this.proc.onaudioprocess = (e) => this.frame(e.inputBuffer.getChannelData(0), e.inputBuffer.getChannelData(1));
    merge.connect(this.proc);
    this.proc.connect(this.ctx.destination); // outputs silence; needed to keep the processor running
  }

  private close() {
    this.proc?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close().catch(() => {});
    this.proc = null;
    this.stream = null;
    this.ctx = null;
  }

  /** Call when an utterance turned out to be the student talking to Milo, so he learns their voice level. */
  learnVoice() {
    if (!this.lastLevel) return;
    this.userLevel = this.userLevel ? this.userLevel * 0.7 + this.lastLevel * 0.3 : this.lastLevel;
    try {
      localStorage.setItem("milo.userLevel", String(this.userLevel));
    } catch {
      /* ignore */
    }
  }

  /** Push-to-talk: "I'm done talking", send what we have now. */
  flush() {
    if (this.speaking && this.speech.length > 4) this.finish();
    else if (this.mode === "once") this.setMode("off");
  }

  private resetUtterance() {
    this.noVoiceRun = 0;
    this.onPause(0);
    this.uttPeak = 0;
    this.uttEnergy = [];
    this.speech = [];
    this.speaking = false;
    this.loudRun = 0;
    this.quietRun = 0;
  }

  private frame(input: Float32Array, band: Float32Array) {
    if (this.mode === "off") return;
    const data = new Float32Array(input); // copy: the browser reuses the buffer
    let sum = 0;
    let bsum = 0;
    for (let i = 0; i < data.length; i++) {
      sum += data[i] * data[i];
      bsum += band[i] * band[i];
    }
    const rawRms = Math.sqrt(sum / data.length);
    const bandRms = Math.sqrt(bsum / data.length);
    // Only energy in the voice band counts. Hum, fans, thumps and hiss mostly fall outside it.
    const voicey = rawRms > 0 && bandRms / rawRms > VOICE_RATIO;
    const rms = voicey ? bandRms : bandRms * 0.4;
    this.onLevel(this.muted ? 0 : Math.min(1, rms * 12));

    if (this.muted) {
      this.ring = [];
      return;
    }

    // Hands-free is stricter: you have to be clearly louder than the room (close to the mic).
    const strict = this.mode === "always";
    let on = Math.max(strict ? 0.028 : 0.018, this.floor * (strict ? 4 : 3));
    // Once Milo knows how loud you are, quieter voices (other people, the TV) can't start a recording.
    if (strict && this.userLevel > 0) on = Math.max(on, this.userLevel * 0.5);
    // End of your sentence = when it drops well below YOUR level, even if others keep talking.
    const off = Math.max(0.011, this.floor * 1.8, this.uttPeak * 0.35);

    if (!this.speaking) {
      this.ring.push(data);
      if (this.ring.length > PRE_ROLL) this.ring.shift();
      if (rms > on) this.loudRun++;
      else {
        this.loudRun = 0;
        this.floor = this.floor * 0.95 + rms * 0.05; // learn the room's background noise
      }
      if (this.loudRun >= START_FRAMES) {
        this.speaking = true;
        this.speech = [...this.ring];
        this.ring = [];
        this.quietRun = 0;
        this.onState("hearing");
      } else if (this.mode === "once" && ++this.idleFrames > ONCE_TIMEOUT) {
        this.setMode("off");
        this.onState("timeout");
      }
      return;
    }

    this.speech.push(data);
    this.uttEnergy.push(rms);
    this.uttPeak = Math.max(this.uttPeak * 0.985, rms);
    this.quietRun = rms < off ? this.quietRun + 1 : 0;
    // "Your voice" = clearly as loud as you were talking. Other people, quieter, don't reset the timer.
    const yours = rms > Math.max(off * 1.3, this.uttPeak * 0.5);
    this.noVoiceRun = yours ? 0 : this.noVoiceRun + 1;
    if (this.noVoiceRun > 4) this.onPause(Math.min(1, (this.noVoiceRun - 4) / (END_NO_VOICE - 4)));
    else this.onPause(0);
    const cap = this.mode === "always" ? MAX_FRAMES_HF : MAX_FRAMES;
    if (this.quietRun >= END_SILENCE || this.noVoiceRun >= END_NO_VOICE || this.speech.length >= cap) this.finish();
  }

  private finish() {
    const frames = this.speech;
    const energy = this.uttEnergy.filter((e) => e > 0.011).sort((a, b) => a - b);
    this.resetUtterance();
    const voiced = energy.length;
    // Typical loudness while talking (upper-middle of the voiced frames).
    const level = voiced ? energy[Math.floor(voiced * 0.7)] : 0;
    this.voicedFrames = voiced;
    this.lastLevel = level;
    const tooShort = voiced * FRAME < RATE * MIN_VOICED_S;
    // Voice focus: in hands-free, ignore voices much quieter than yours (TV, people across the room).
    const tooFar = this.mode === "always" && this.userLevel > 0 && level < this.userLevel * 0.45;
    if (tooShort || tooFar) {
      // too short to be words; keep listening
      this.onState("waiting");
      return;
    }
    const wav = encodeWav(frames, RATE);
    const once = this.mode === "once";
    if (once) this.setMode("off");
    else this.onState("waiting");
    this.onUtterance(wav, once);
  }
}

function encodeWav(frames: Float32Array[], rate: number): ArrayBuffer {
  const n = frames.reduce((a, f) => a + f.length, 0);
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + n * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, n * 2, true);
  let o = 44;
  for (const f of frames) {
    for (let i = 0; i < f.length; i++, o += 2) {
      const s = Math.max(-1, Math.min(1, f[i]));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
  }
  return buf;
}
