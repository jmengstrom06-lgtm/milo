// The numbers that tell us if Milo works (see the January blueprint):
//   first_value  : how long from install until Milo did something real for the student (target: minutes, not days)
//   active_day   : one event per day used, with day number since install → week-2 / week-4 return
//   job_end      : every agent job's outcome → success rate (target 95%+)
//   cost_snapshot: AI spend today → cost per student per week
// Only counts and kinds leave the Mac (same rules as telemetry.ts). The core is pure, so it's tested.

export type MetricsState = { installAt: number; firstValueAt?: number; days: string[] };
export type MetricsStore = { load: () => MetricsState | null; save: (s: MetricsState) => void };
type Track = (event: string, props?: Record<string, unknown>) => void;

const DAY = 86400e3;
const dayKey = (t: number) => new Date(t).toISOString().slice(0, 10);

export function makeMetrics(store: MetricsStore, track: Track, now: () => number = Date.now) {
  let s: MetricsState = store.load() ?? { installAt: now(), days: [] };
  if (!store.load()) store.save(s);
  const since = (t: number) => Math.max(0, Math.floor((t - s.installAt) / DAY));
  return {
    /** Call when the app starts and every so often: counts each calendar day once. */
    active() {
      const t = now();
      const k = dayKey(t);
      if (s.days.includes(k)) return false;
      s = { ...s, days: [...s.days, k].slice(-120) };
      store.save(s);
      track("active_day", { day_n: since(t), week_n: Math.floor(since(t) / 7), days_used: s.days.length });
      return true;
    },
    /** Milo did something real. The first time is "first value". */
    value(kind: string) {
      const t = now();
      if (!s.firstValueAt) {
        s = { ...s, firstValueAt: t };
        store.save(s);
        track("first_value", { kind, seconds: Math.round((t - s.installAt) / 1000) });
        return true;
      }
      return false;
    },
    state: () => s,
  };
}
