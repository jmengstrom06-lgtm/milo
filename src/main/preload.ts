import { contextBridge, ipcRenderer } from "electron";

function on(channel: string, cb: () => void) {
  const listener = () => cb();
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld("milo", {
  setClickable: (clickable: boolean) => ipcRenderer.send("milo:set-clickable", clickable),
  ask: (history: unknown) => ipcRenderer.invoke("milo:ask", history),
  route: (text: string) => ipcRenderer.invoke("milo:route", text),
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
  research: (q: string) => ipcRenderer.invoke("milo:research", q),
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
  copy: (text: string) => ipcRenderer.send("milo:copy", text),
  onSummon: (cb: () => void) => on("milo:summon", cb),
  onTeachScreen: (cb: () => void) => on("milo:teach-screen", cb),
  onTalk: (cb: () => void) => on("milo:talk", cb),
  setCharacter: (desc: string) => ipcRenderer.send("milo:set-character", desc),
  setName: (name: string) => ipcRenderer.send("milo:set-name", name),
  quit: () => ipcRenderer.send("milo:quit"),
});
