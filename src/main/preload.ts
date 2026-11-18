import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("milo", {
  setClickable: (clickable: boolean) => ipcRenderer.send("milo:set-clickable", clickable),
  ask: (history: { role: "user" | "assistant"; content: string }[]) =>
    ipcRenderer.invoke("milo:ask", history) as Promise<{ ok: boolean; text: string }>,
  onSummon: (cb: () => void) => {
    const listener = () => cb();
    ipcRenderer.on("milo:summon", listener);
    return () => ipcRenderer.removeListener("milo:summon", listener);
  },
  quit: () => ipcRenderer.send("milo:quit"),
});
