// Subtle interface sounds, synthesized (no audio files). Short, quiet, professional.
let ctx: AudioContext | null = null;
let enabled = (() => {
  try {
    return localStorage.getItem("milo.sounds") !== "off";
  } catch {
    return true;
  }
})();

export const soundsOn = () => enabled;
export function setSounds(on: boolean) {
  enabled = on;
  try {
    localStorage.setItem("milo.sounds", on ? "on" : "off");
  } catch {
    /* ignore */
  }
}

function tone(freq: number, start: number, dur: number, vol = 0.06, type: OscillatorType = "sine") {
  ctx = ctx ?? new AudioContext();
  const t = ctx.currentTime + start;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function play(fn: () => void) {
  if (!enabled) return;
  try {
    fn();
  } catch {
    /* no audio */
  }
}

export const sfx = {
  /** "I'm listening" */
  chime: () => play(() => [880, 1320].forEach((f, i) => tone(f, i * 0.09, 0.16, 0.08))),
  /** Milo lands somewhere */
  hop: () => play(() => tone(520, 0, 0.09, 0.035, "triangle")),
  /** ring locks onto a question */
  lock: () => play(() => [1046, 1568].forEach((f, i) => tone(f, i * 0.05, 0.12, 0.045))),
  /** an answer was filled in */
  tick: () => play(() => tone(1760, 0, 0.07, 0.04)),
  /** finished something */
  success: () => play(() => [659, 831, 988].forEach((f, i) => tone(f, i * 0.07, 0.35, 0.05))),
  /** wrong / mistake spotted */
  alert: () => play(() => [440, 370].forEach((f, i) => tone(f, i * 0.1, 0.18, 0.05, "triangle"))),
};
