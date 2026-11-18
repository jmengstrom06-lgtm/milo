import { contextBridge, ipcRenderer } from "electron";

function on(channel: string, cb: () => void) {
  const listener = () => cb();
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld("milo", {
  setClickable: (clickable: boolean) => ipcRenderer.send("milo:set-clickable", clickable),
  ask: (history: unknown) => ipcRenderer.invoke("milo:ask", history),
  look: (mode: string, request: string, focus?: unknown) => ipcRenderer.invoke("milo:look", mode, request, focus ?? null),
  refine: (box: unknown, topic: string) => ipcRenderer.invoke("milo:refine", box, topic),
  check: (lesson: unknown, answer: string) => ipcRenderer.invoke("milo:check", lesson, answer),
  practice: (lesson: unknown) => ipcRenderer.invoke("milo:practice", lesson),
  stt: (audio: ArrayBuffer) => ipcRenderer.invoke("milo:stt", audio),
  micAccess: () => ipcRenderer.invoke("milo:mic-access"),
  tts: (text: string) => ipcRenderer.invoke("milo:tts", text),
  task: (task: string) => ipcRenderer.invoke("milo:task", task),
  stopTask: () => ipcRenderer.send("milo:task-stop"),
  handsAccess: () => ipcRenderer.invoke("milo:hands-access"),
  onTaskStep: (cb: (step: unknown) => void) => {
    const l = (_e: unknown, step: unknown) => cb(step);
    ipcRenderer.on("milo:task-step", l);
    return () => ipcRenderer.removeListener("milo:task-step", l);
  },
  copy: (text: string) => ipcRenderer.send("milo:copy", text),
  onSummon: (cb: () => void) => on("milo:summon", cb),
  onTeachScreen: (cb: () => void) => on("milo:teach-screen", cb),
  onTalk: (cb: () => void) => on("milo:talk", cb),
  setCharacter: (desc: string) => ipcRenderer.send("milo:set-character", desc),
  quit: () => ipcRenderer.send("milo:quit"),
});
