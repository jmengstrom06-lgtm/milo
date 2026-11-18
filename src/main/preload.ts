import { contextBridge, ipcRenderer } from "electron";

function on(channel: string, cb: () => void) {
  const listener = () => cb();
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld("milo", {
  log: (src: string, ev: string, data: Record<string, unknown> = {}) => ipcRenderer.send("milo:log", src, ev, data),
  flag: (note?: string) => ipcRenderer.invoke("milo:log-flag", note ?? ""),
  openLogs: () => ipcRenderer.send("milo:open-logs"),
  fluxAvailable: () => ipcRenderer.invoke("milo:flux-available"),
  fluxOpen: () => ipcRenderer.invoke("milo:flux-open"),
  fluxAudio: (pcm: ArrayBuffer) => ipcRenderer.send("milo:flux-audio", pcm),
  fluxForce: () => ipcRenderer.send("milo:flux-force"),
  fluxClose: () => ipcRenderer.send("milo:flux-close"),
  onFlux: (fn: (e: unknown) => void) => {
    const l = (_e: unknown, ev: unknown) => fn(ev);
    ipcRenderer.on("milo:flux-event", l);
    return () => ipcRenderer.removeListener("milo:flux-event", l);
  },
  saveClip: (wav: ArrayBuffer, note?: string) => ipcRenderer.send("milo:save-clip", wav, note ?? ""),
  macSay: (text: string) => ipcRenderer.invoke("milo:mac-say", text),
  bridgeStatus: () => ipcRenderer.invoke("milo:bridge-status"),
  screenAsk: (q: string) => ipcRenderer.invoke("milo:screen-ask", q),
  onFlag: (fn: () => void) => {
    const l = () => fn();
    ipcRenderer.on("milo:flag", l);
    return () => ipcRenderer.removeListener("milo:flag", l);
  },
  setClickable: (clickable: boolean) => ipcRenderer.send("milo:set-clickable", clickable),
  ask: (history: unknown) => ipcRenderer.invoke("milo:ask", history),
  route: (text: string, ctx?: Record<string, unknown>) => ipcRenderer.invoke("milo:route", text, ctx ?? {}),
  look: (mode: string, request: string, focus?: unknown) => ipcRenderer.invoke("milo:look", mode, request, focus ?? null),
  refine: (box: unknown, topic: string) => ipcRenderer.invoke("milo:refine", box, topic),
  check: (lesson: unknown, answer: string) => ipcRenderer.invoke("milo:check", lesson, answer),
  practice: (lesson: unknown) => ipcRenderer.invoke("milo:practice", lesson),
  stt: (audio: ArrayBuffer) => ipcRenderer.invoke("milo:stt", audio),
  micAccess: () => ipcRenderer.invoke("milo:mic-access"),
  tts: (text: string, urgent?: boolean) => ipcRenderer.invoke("milo:tts", text, !!urgent),
  task: (task: string) => ipcRenderer.invoke("milo:task", task),
  stopTask: () => ipcRenderer.send("milo:task-stop"),
  handsAccess: () => ipcRenderer.invoke("milo:hands-access"),
  onTaskStep: (cb: (step: unknown) => void) => {
    const l = (_e: unknown, step: unknown) => cb(step);
    ipcRenderer.on("milo:task-step", l);
    return () => ipcRenderer.removeListener("milo:task-step", l);
  },
  research: (q: string, history?: { q: string; a: string }[]) => ipcRenderer.invoke("milo:research", q, history ?? []),
  stopResearch: () => ipcRenderer.send("milo:research-stop"),
  openUrl: (url: string) => ipcRenderer.send("milo:open-url", url),
  onResearch: (cb: (ev: unknown) => void) => {
    const l = (_e: unknown, ev: unknown) => cb(ev);
    ipcRenderer.on("milo:research-event", l);
    return () => ipcRenderer.removeListener("milo:research-event", l);
  },
  sweepPlan: (skip: string[]) => ipcRenderer.invoke("milo:sweep-plan", skip),
  sweepFill: (item: unknown) => ipcRenderer.invoke("milo:sweep-fill", item),
  scrollPage: () => ipcRenderer.invoke("milo:scroll-page"),
  build: (req: string) => ipcRenderer.invoke("milo:build", req),
  stopBuild: () => ipcRenderer.send("milo:build-stop"),
  onBuild: (cb: (ev: unknown) => void) => {
    const l = (_e: unknown, ev: unknown) => cb(ev);
    ipcRenderer.on("milo:build-event", l);
    return () => ipcRenderer.removeListener("milo:build-event", l);
  },
  watchCheck: (force?: boolean) => ipcRenderer.invoke("milo:watch-check", !!force),
  watchReset: () => ipcRenderer.send("milo:watch-reset"),
  quiz: (focus: string) => ipcRenderer.invoke("milo:quiz", focus),
  brief: (dataUrl: string) => ipcRenderer.invoke("milo:brief", dataUrl),
  copy: (text: string) => ipcRenderer.send("milo:copy", text),
  onSummon: (cb: () => void) => on("milo:summon", cb),
  onTeachScreen: (cb: () => void) => on("milo:teach-screen", cb),
  onTalk: (cb: () => void) => on("milo:talk", cb),
  setCharacter: (desc: string) => ipcRenderer.send("milo:set-character", desc),
  setName: (name: string) => ipcRenderer.send("milo:set-name", name),
  quit: () => ipcRenderer.send("milo:quit"),
});
