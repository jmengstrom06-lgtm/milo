// Records a class from the Mac's mic: 16 kHz mono, handed to Milo every CHUNK seconds as a WAV
// (Milo saves it to disk right away). Settings are tuned for a far-away voice: no noise suppression
// (it treats a distant professor as noise), automatic gain on.

const RATE = 16000;
export const CHUNK_SECONDS = 120;

export class LectureRecorder {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: ScriptProcessorNode | null = null;
  private frames: Float32Array[] = [];
  private samples = 0;
  private n = 0;
  levels: number[] = [];
  constructor(
    private id: string,
    private send: (id: string, n: number, wav: ArrayBuffer) => void,
    private onLevel: (rms: number) => void
  ) {}

  async start(deviceId?: string) {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: deviceId ? { exact: deviceId } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: true, channelCount: 1 },
    });
    this.ctx = new AudioContext({ sampleRate: RATE });
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.node = this.ctx.createScriptProcessor(4096, 1, 1);
    let acc = 0;
    let count = 0;
    this.node.onaudioprocess = (e) => {
      const f = new Float32Array(e.inputBuffer.getChannelData(0));
      this.frames.push(f);
      this.samples += f.length;
      for (let i = 0; i < f.length; i++) acc += f[i] * f[i];
      count += f.length;
      if (count >= RATE / 4) {
        const rms = Math.sqrt(acc / count);
        this.levels.push(rms);
        if (this.levels.length > 4 * 60 * 5) this.levels.shift();
        this.onLevel(rms);
        acc = 0;
        count = 0;
      }
      if (this.samples >= RATE * CHUNK_SECONDS) this.flush();
    };
    src.connect(this.node);
    this.node.connect(this.ctx.destination); // (required for onaudioprocess to run; outputs silence)
  }

  /** Hand over what's been recorded so far as one WAV. */
  flush() {
    if (!this.samples) return;
    const wav = encodeWav(this.frames, RATE);
    this.frames = [];
    this.samples = 0;
    this.send(this.id, this.n++, wav);
  }

  async stop() {
    this.flush();
    this.node?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    await this.ctx?.close().catch(() => {});
    this.node = null;
    this.stream = null;
    this.ctx = null;
  }

  /** Too quiet to transcribe well? (median level over the last minute) */
  tooQuiet(): boolean {
    const last = this.levels.slice(-240);
    if (last.length < 120) return false;
    const sorted = [...last].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length * 0.75)] < 0.008; // even the louder moments are faint
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
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, n * 2, true);
  let o = 44;
  for (const f of frames)
    for (let i = 0; i < f.length; i++, o += 2) {
      const s = Math.max(-1, Math.min(1, f[i]));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
  return buf;
}
