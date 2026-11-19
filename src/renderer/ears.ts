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
const PRE_ROLL = 12; // ~770 ms kept from before speech starts (so soft first words aren't lost)
const WARMUP_FRAMES = 13; // ~830 ms at the start of each line: just learn Milo's own loudness
const BARGE_FRAMES = 4; // ~260 ms of you talking over him to interrupt (a quick "stop" is ~300 ms)
const BARGE_FRAMES_LOUD = 3; // ~190 ms if you're clearly louder than usual
const START_FRAMES = 4; // ~256 ms of voice to count as speech
const MIN_VOICED_S = 0.5; // shorter than this is a cough/click, not words
const VOICE_RATIO = 0.45; // share of energy that must sit in the human-voice band (300-3400 Hz)
const END_SILENCE = 28; // ~1.8 s of quiet ends the utterance (plain quiet room)
const END_NO_VOICE = 38; // ~2.4 s without YOUR voice ends it, even if other people keep talking
const MAX_FRAMES = Math.round((25 * RATE) / FRAME); // 25 s cap (push-to-talk)
const MAX_FRAMES_HF = Math.round((20 * RATE) / FRAME); // 20 s cap in hands-free so background chatter can't hang him
const FOLLOW_FRAMES = Math.round((5 * RATE) / FRAME); // after you finish a sentence, keep listening 5 s more for the rest
const ONCE_TIMEOUT = Math.round((7 * RATE) / FRAME); // give up after 7 s of nothing
// Smart ears (Deepgram Flux): the mic still notices when you START talking (so we only stream, and pay,
// while you're talking), but Flux decides when you're DONE from what you said.
const STREAM_IDLE = Math.round((6 * RATE) / FRAME); // close the stream after 6 s with nobody talking
const FLUX_NUDGE = Math.round((3.2 * RATE) / FRAME); // ~3 s of real quiet and Flux still hasn't ended it: ask Flux to finish now
const FLUX_WAIT = Math.round((2.5 * RATE) / FRAME); // after asking, give Flux this long to send the words back

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
  private userLevel = (() => {
    try {
      // v2: older builds could learn Milo's OWN voice as yours (too loud), so start fresh once.
      if (localStorage.getItem("milo.userLevelV") !== "2") {
        localStorage.removeItem("milo.userLevel");
        localStorage.setItem("milo.userLevelV", "2");
      }
      return Math.min(0.12, Number(localStorage.getItem("milo.userLevel") || 0));
    } catch {
      return 0;
    }
  })();

  onLevel: (level: number) => void = () => {};
  onState: (s: EarState) => void = () => {};
  /** 0..1 while waiting for you to finish (drives the "sending…" bar). */
  onPause: (progress: number) => void = () => {};
  /** You started talking over Milo: he should stop and listen. */
  onBargeIn: () => void = () => {};
  /** Black-box log hook: why recordings started/ended, interruptions, dropped sounds. */
  onDebug: (ev: string, data: Record<string, unknown>) => void = () => {};
  private echo = 0.01; // how loud Milo's own voice is in the mic while he talks (peak-tracked)
  private warmup = 0;
  private bargeOk = true;
  private bargeRun = 0;
  onUtterance: (wav: ArrayBuffer, pushToTalk: boolean, forced: boolean) => void = () => {};
  /** Smart ears: a finished turn, already transcribed (plus the audio, for the log). */
  onTranscript: (text: string, pushToTalk: boolean, forced: boolean, wav: ArrayBuffer) => void = () => {};
  /** Smart ears: your words so far, live, while you talk. */
  onPartial: (text: string) => void = () => {};
  private smart = false;
  private streaming = false;
  private streamIdle = 0;
  private forcing = false;
  private forcedAtFrame = 0;
  private fallbackAt = 0; // we finished a turn ourselves: ignore Flux's late copy of it

  /** Turn smart ears (Deepgram Flux) on or off. Off = the built-in pause detection. */
  setSmart(on: boolean) {
    this.smart = on;
    if (!on) this.stopStream();
    this.onDebug("smart_ears", { on });
  }
  get isSmart() {
    return this.smart;
  }

  private startStream() {
    if (this.streaming || !this.smart) return;
    this.streaming = true;
    this.streamIdle = 0;
    window.milo.fluxOpen().then((ok) => {
      if (!ok && this.streaming) {
        this.onDebug("flux_open_failed", {});
        this.streaming = false; // the built-in pause detection takes over for this one
        this.quietRun = 0;
        this.noVoiceRun = 0;
      }
    });
  }
  private stopStream() {
    if (!this.streaming) return;
    this.streaming = false;
    window.milo.fluxClose();
  }
  private send(frames: Float32Array[]) {
    if (!this.streaming) return;
    for (const f of frames) {
      const pcm = new Int16Array(f.length);
      for (let i = 0; i < f.length; i++) {
        const x = Math.max(-1, Math.min(1, f[i]));
        pcm[i] = x < 0 ? x * 0x8000 : x * 0x7fff;
      }
      window.milo.fluxAudio(pcm.buffer);
    }
  }

  /** Events from Deepgram Flux (forwarded by the app). */
  handleFlux(ev: MiloFluxEvent) {
    switch (ev.type) {
      case "start":
        if (!this.muted && !this.speaking && this.streaming) {
          this.speaking = true;
          this.speech = [...this.ring];
          this.ring = [];
          this.quietRun = 0;
          this.onState("hearing");
        }
        break;
      case "update":
        if (!this.muted) this.onPartial(ev.text);
        break;
      case "end":
        if (Date.now() - this.fallbackAt < 4000) break;
        this.finishSmart(ev.text, this.pttSend);
        break;
      case "error":
        if (ev.text === "key") this.setSmart(false);
      // falls through
      case "closed":
        if (this.streaming) {
          this.streaming = false;
          // Stream dropped mid-sentence (Deepgram hiccup): DON'T cut you off. Keep recording with the
          // built-in pause detection and transcribe the whole thing when you actually stop.
          if (this.speaking) {
            this.quietRun = 0;
            this.noVoiceRun = 0;
            this.onDebug("flux_dropped_keep_listening", { seconds: +((this.speech.length * FRAME) / RATE).toFixed(2) });
          }
        }
        break;
    }
  }

  private pttSend = false; // you pressed the talk key again = "send it now"
  private finishSmart(text: string, forced: boolean) {
    this.forcing = false;
    this.pttSend = false;
    const frames = this.speech;
    const energy = this.uttEnergy.filter((e) => e > 0.011).sort((a, b) => a - b);
    const seconds = +((frames.length * FRAME) / RATE).toFixed(2);
    this.resetUtterance();
    this.streamIdle = 0; // keep the stream open a bit: you might keep going
    const voiced = energy.length;
    const level = voiced ? energy[Math.floor(voiced * 0.7)] : 0;
    this.voicedFrames = Math.max(voiced, Math.round((text.split(/\s+/).length * 0.35 * RATE) / FRAME));
    this.lastLevel = level;
    const tooFar = this.mode === "always" && this.userLevel > 0 && voiced > 0 && level < this.userLevel * 0.45;
    this.onDebug("end", { reason: forced ? "flux_forced" : "flux_end_of_turn", seconds, level: +level.toFixed(4), userLevel: +this.userLevel.toFixed(4), mode: this.mode, text });
    if (!text.trim() || tooFar) {
      this.onDebug("dropped", { why: !text.trim() ? "no_words" : "too_quiet_not_you", seconds });
      this.onState("waiting");
      return;
    }
    const once = this.mode === "once";
    if (once) this.idleFrames = Math.max(0, ONCE_TIMEOUT - FOLLOW_FRAMES);
    this.onState("waiting");
    this.onTranscript(text.trim(), once, forced, encodeWav(frames, RATE));
  }

  async setMode(mode: EarMode) {
    this.mode = mode;
    this.resetUtterance();
    this.idleFrames = 0;
    if (mode === "off") {
      this.stopStream();
      this.close();
      this.onLevel(0); // a closed mic is silent: never leave the last loud reading behind
      this.onState("off");
      return;
    }
    await this.open();
    this.onState("waiting");
  }

  /** Ignore the mic while Milo is talking so he doesn't hear himself.
   *  The first ~0.8s of each line only measures how loud his own voice is in the mic; after that,
   *  you have to be clearly louder than him to interrupt. allowBargeIn=false turns interrupting off for this line. */
  mute(on: boolean, allowBargeIn = true) {
    if (on && this.speaking) return; // already listening to you (you talked over Milo): don't cut that off
    this.muted = on;
    this.bargeRun = 0;
    this.bargeOk = allowBargeIn;
    if (on) {
      this.stopStream();
      this.echo = 0.01;
      this.warmup = 1e9; // no interrupting until his voice actually starts (see started())
      this.resetUtterance();
    }
  }
  /** Milo's audio just started playing: measure his loudness for a moment, then allow interrupting. */
  started() {
    if (this.muted) this.warmup = WARMUP_FRAMES;
  }
  /** True right after you interrupted Milo (so the app can check it wasn't just his own voice). */
  bargedAt = 0;

  private opening: Promise<void> | null = null;
  private async open() {
    if (this.stream) return;
    // Two quick setMode calls used to open the mic TWICE, so every frame was processed (and streamed) twice.
    if (!this.opening) this.opening = this.openOnce().finally(() => (this.opening = null));
    return this.opening;
  }
  private async openOnce() {
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
    const lvl = Math.min(0.12, this.lastLevel); // cap so one loud moment can't make him deaf to normal talking
    this.userLevel = this.userLevel ? this.userLevel * 0.7 + lvl * 0.3 : lvl;
    try {
      localStorage.setItem("milo.userLevel", String(this.userLevel));
    } catch {
      /* ignore */
    }
  }

  /** Push-to-talk: "I'm done talking", send what we have now. */
  flush() {
    if (this.speaking && this.streaming) {
      this.forcing = true;
      this.pttSend = true;
      this.forcedAtFrame = this.speech.length;
      window.milo.fluxForce(); // Flux ends the turn on what it has and sends the words back
    } else if (this.speaking && this.speech.length > 4) this.finish(true, "push_to_talk_send");
    else if (this.mode === "once") this.setMode("off");
  }

  private resetUtterance() {
    this.forcing = false;
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
      // Milo is talking. Keep a quiet ear open: if YOU talk over him (clearly louder than his own voice
      // leaking into the mic), stop him and start listening.
      this.ring.push(data);
      if (this.ring.length > 6) this.ring.shift();
      if (this.warmup > 0) {
        this.warmup--;
        this.echo = Math.max(this.echo, rms); // his loudest so far
        if (this.warmup === 0) this.onDebug("echo_measured", { echo: +this.echo.toFixed(4), userLevel: +this.userLevel.toFixed(4) });
        return;
      }
      if (!this.bargeOk) return;
      // You have to be clearly louder than his own voice in the mic, and about as loud as you normally talk.
      const thresh = Math.max(0.05, this.echo * 2.2, this.userLevel * 0.7);
      if (rms > thresh) this.bargeRun++;
      else {
        this.bargeRun = 0;
        this.echo = Math.max(this.echo * 0.997, rms); // keep tracking his peaks, slowly forget
      }
      if (this.bargeRun >= BARGE_FRAMES || (this.bargeRun >= BARGE_FRAMES_LOUD && rms > thresh * 1.6)) {
        this.onDebug("barge_in", { rms: +rms.toFixed(4), thresh: +thresh.toFixed(4), echo: +this.echo.toFixed(4), userLevel: +this.userLevel.toFixed(4) });
        this.bargedAt = Date.now();
        this.bargeRun = 0;
        this.muted = false;
        this.onBargeIn();
        this.speaking = true;
        this.speech = [...this.ring];
        this.ring = [];
        this.quietRun = 0;
        if (this.smart) {
          this.startStream();
          this.send(this.speech);
        }
        this.onState("hearing");
      }
      return;
    }

    // Hands-free is stricter: you have to be clearly louder than the room (close to the mic).
    const strict = this.mode === "always";
    let on = Math.max(strict ? 0.028 : 0.018, this.floor * (strict ? 4 : 3));
    // Once Milo knows how loud you are, quieter voices (other people, the TV) can't start a recording.
    if (strict && this.userLevel > 0) on = Math.max(on, this.userLevel * 0.5);
    // End of your sentence = when it drops well below YOUR level, even if others keep talking.
    const off = Math.max(0.011, this.floor * 1.8, this.uttPeak * 0.2); // only real quiet ends it, not a softer phrase

    if (!this.speaking) {
      this.ring.push(data);
      if (this.ring.length > PRE_ROLL) this.ring.shift();
      if (this.streaming) {
        this.send([data]); // keep Flux hearing the room so it can catch the start of your next turn
        if (++this.streamIdle > STREAM_IDLE) this.stopStream();
      }
      if (rms > on) this.loudRun++;
      else {
        this.loudRun = 0;
        this.floor = this.floor * 0.95 + rms * 0.05; // learn the room's background noise
      }
      if (this.loudRun >= START_FRAMES) {
        this.onDebug("start", { mode: this.mode, rms: +rms.toFixed(4), on: +on.toFixed(4), floor: +this.floor.toFixed(4), smart: this.smart });
        this.speaking = true;
        this.speech = [...this.ring];
        if (this.smart && !this.streaming) {
          this.startStream();
          this.send(this.speech); // the ~0.8 s before you were "loud enough", so first words aren't lost
        }
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
    if (this.smart && this.streaming) {
      // Flux decides when you're done. We only step in if it goes quiet for a long time or runs too long.
      this.send([data]);
      this.streamIdle = 0;
      this.onPause(0);
      const capS = this.mode === "always" ? MAX_FRAMES_HF : MAX_FRAMES;
      if (!this.forcing && (this.speech.length >= capS || this.quietRun >= FLUX_NUDGE || this.noVoiceRun >= FLUX_NUDGE + 8)) {
        // Flux is still waiting (other voices in the room, a trailing "um"...). Ask it to end the turn
        // on what it has: it sends back the words right away.
        this.forcing = true;
        this.forcedAtFrame = this.speech.length;
        this.onDebug("flux_nudge", { quietS: +((this.quietRun * FRAME) / RATE).toFixed(1), seconds: +((this.speech.length * FRAME) / RATE).toFixed(1) });
        window.milo.fluxForce();
      } else if (this.forcing && this.speech.length - this.forcedAtFrame >= FLUX_WAIT) {
        // Flux didn't answer at all: last resort, transcribe the recording ourselves.
        this.onDebug("flux_no_end", { quietS: +((this.quietRun * FRAME) / RATE).toFixed(1) });
        this.stopStream();
        this.finish(false, "flux_silent_fallback");
      }
      return;
    }
    // "Your voice" = clearly as loud as you were talking. Other people, quieter, don't reset the timer.
    const yours = rms > Math.max(off * 1.3, this.uttPeak * 0.3);
    this.noVoiceRun = yours ? 0 : this.noVoiceRun + 1;
    const quietP = this.quietRun / END_SILENCE;
    const voiceP = this.noVoiceRun / END_NO_VOICE;
    const p = Math.max(quietP, voiceP);
    if (p > 0.25) this.onPause(Math.min(1, (p - 0.25) / 0.75));
    else this.onPause(0);
    const cap = this.mode === "always" ? MAX_FRAMES_HF : MAX_FRAMES;
    if (this.quietRun >= END_SILENCE) this.finish(false, "silence");
    else if (this.noVoiceRun >= END_NO_VOICE) this.finish(false, "your_voice_stopped");
    else if (this.speech.length >= cap) this.finish(false, "too_long_cap");
  }

  private finish(forced = false, reason = "silence") {
    if (this.smart) this.fallbackAt = Date.now();
    const frames = this.speech;
    const seconds = +((frames.length * FRAME) / RATE).toFixed(2);
    const peak = +this.uttPeak.toFixed(4);
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
    this.onDebug("end", { reason, seconds, voicedS: +((voiced * FRAME) / RATE).toFixed(2), level: +level.toFixed(4), peak, userLevel: +this.userLevel.toFixed(4), floor: +this.floor.toFixed(4), mode: this.mode });
    if (tooShort || tooFar) {
      this.onDebug("dropped", { why: tooShort ? "too_short" : "too_quiet_not_you", seconds });
      // too short to be words; keep listening
      this.onState("waiting");
      return;
    }
    const wav = encodeWav(frames, RATE);
    const once = this.mode === "once";
    // Push-to-talk: DON'T close the mic yet. Keep it open a few more seconds in case you keep going.
    if (once) this.idleFrames = Math.max(0, ONCE_TIMEOUT - FOLLOW_FRAMES);
    this.onState("waiting");
    this.onUtterance(wav, once, forced);
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
