// Keep working while you're away: while a job runs, the Mac doesn't go to sleep, and when it finishes
// (or needs you), a notification says so, so you can walk away from a long job and come back to it.
// (Texting your phone comes with the phone app.)

import { inQuiet, prefs } from "./prefs";
import { Notification, powerMonitor, powerSaveBlocker } from "electron";
import { log as bb } from "./blackbox";
import type { Job } from "./jobs";

let blocker: number | null = null;
const seen = new Map<string, string>(); // job id -> last status we announced

/** Call on every job update. */
export function awayWatch(job: Job, onClick: () => void) {
  const active = ["planning", "running", "checking"].includes(job.status);
  // 1) stay awake while working (the screen may still dim; the Mac won't sleep)
  if (active && blocker == null) {
    blocker = powerSaveBlocker.start("prevent-app-suspension");
    bb("away", "awake_on", { job: job.id });
  } else if (!active && blocker != null) {
    powerSaveBlocker.stop(blocker);
    blocker = null;
    bb("away", "awake_off", { job: job.id, status: job.status });
  }
  // 2) tell you when it's done or needs you, if you're not right there
  if (seen.get(job.id) === job.status) return;
  seen.set(job.id, job.status);
  const msg = notice(job);
  if (!msg) return;
  const pf = prefs();
  if (!pf.notifyAway && !forceNotify) return; // turned off in Home base > Settings
  if (pf.quiet && !forceNotify && inQuiet(new Date().getHours(), pf.quietFrom, pf.quietTo)) return; // quiet hours
  const idle = powerMonitor.getSystemIdleTime(); // seconds since you last touched the Mac
  if (idle < 45 && !forceNotify) return; // you're here: Milo tells you out loud instead
  if (!Notification.isSupported()) return;
  const n = new Notification({ title: msg.title, body: msg.body, silent: false });
  n.on("click", onClick);
  n.show();
  bb("away", "notified", { job: job.id, status: job.status, idle });
}

let forceNotify = false;
/** For testing: notify even when you're at the Mac. */
export const setForceNotify = (on: boolean) => (forceNotify = on);

export function notice(job: Job): { title: string; body: string } | null {
  const goal = job.goal.length > 80 ? job.goal.slice(0, 77) + "…" : job.goal;
  if (job.status === "done") return { title: "Milo finished", body: job.summary || goal };
  if (job.status === "needs_you") return { title: "Milo needs your OK", body: job.question || goal };
  if (job.status === "stuck") return { title: "Milo got stuck", body: job.question || goal };
  if (job.status === "failed") return { title: "Milo couldn't finish", body: job.question || goal };
  return null;
}
