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
const START_FRAMES = 3; // ~190 ms of voice to count as speech
const END_SILENCE = 14; // ~900 ms of quiet ends the utterance
const MAX_FRAMES = Math.round((15 * RATE) / FRAME); // 15 s cap
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

  onLevel: (level: number) => void = () => {};
  onState: (s: EarState) => void = () => {};
  onUtterance: (wav: ArrayBuffer) => void = () => {};

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
    this.proc = this.ctx.createScriptProcessor(FRAME, 1, 1);
    this.proc.onaudioprocess = (e) => this.frame(e.inputBuffer.getChannelData(0));
    src.connect(this.proc);
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

  private resetUtterance() {
    this.speech = [];
    this.speaking = false;
    this.loudRun = 0;
    this.quietRun = 0;
  }

  private frame(input: Float32Array) {
    if (this.mode === "off") return;
    const data = new Float32Array(input); // copy: the browser reuses the buffer
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
    const rms = Math.sqrt(sum / data.length);
    this.onLevel(this.muted ? 0 : Math.min(1, rms * 12));

    if (this.muted) {
      this.ring = [];
      return;
    }

    const on = Math.max(0.018, this.floor * 3);
    const off = Math.max(0.011, this.floor * 1.8);

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
    this.quietRun = rms < off ? this.quietRun + 1 : 0;
    if (this.quietRun >= END_SILENCE || this.speech.length >= MAX_FRAMES) this.finish();
  }

  private finish() {
    const frames = this.speech;
    this.resetUtterance();
    const voiced = frames.length - END_SILENCE;
    if (voiced * FRAME < RATE * 0.35) {
      // too short to be words; keep listening
      this.onState("waiting");
      return;
    }
    const wav = encodeWav(frames, RATE);
    if (this.mode === "once") this.setMode("off");
    else this.onState("waiting");
    this.onUtterance(wav);
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
