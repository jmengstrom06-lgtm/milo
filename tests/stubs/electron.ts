// Unit tests run in plain Node: this stands in for Electron so pure logic in main-process files can be tested.
// Any property or call returns another no-op, so importing a file never crashes.
const noop: any = new Proxy(function () {}, {
  get: (_t, k) => (k === "then" ? undefined : k === Symbol.toPrimitive ? () => "" : noop),
  apply: () => noop,
  construct: () => noop,
});
export const app = noop, ipcMain = noop, BrowserWindow = noop, shell = noop, net = noop, Notification = noop, safeStorage = noop,
  session = noop, nativeImage = noop, Tray = noop, Menu = noop, screen = noop, globalShortcut = noop, powerSaveBlocker = noop,
  clipboard = noop, desktopCapturer = noop, systemPreferences = noop, dialog = noop, protocol = noop, webContents = noop,
  nativeTheme = noop, powerMonitor = noop, contextBridge = noop, ipcRenderer = noop, autoUpdater = noop, crashReporter = noop;
export default noop;
