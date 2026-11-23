import { contextBridge, ipcRenderer } from "electron";

function on(channel: string, cb: () => void) {
  const listener = () => cb();
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld("milo", {
  lib: {
    save: (item: unknown) => ipcRenderer.invoke("lib:save", item),
    list: (f?: unknown) => ipcRenderer.invoke("lib:list", f),
    move: (id: string, classId: string | null) => ipcRenderer.invoke("lib:move", id, classId),
    remove: (id: string) => ipcRenderer.invoke("lib:delete", id),
    counts: () => ipcRenderer.invoke("lib:counts"),
  },
  kit: {
    study: (request: string, mode: string, count: number, context?: string) => ipcRenderer.invoke("kit:study", request, mode, count, context),
    mastery: () => ipcRenderer.invoke("kit:mastery"),
    check: (item: unknown, answer: string) => ipcRenderer.invoke("kit:check", item, answer),
    mark: (skill: string, correct: boolean) => ipcRenderer.invoke("kit:mark", skill, correct),
    weak: () => ipcRenderer.invoke("kit:weak"),
    sketch: (request: string) => ipcRenderer.invoke("kit:sketch", request),
    image: (prompt: string) => ipcRenderer.invoke("kit:image", prompt),
    hasImages: () => ipcRenderer.invoke("kit:has-images"),
    table: (request: string) => ipcRenderer.invoke("kit:table", request),
    tableOps: (request: string, t: unknown, stats: string) => ipcRenderer.invoke("kit:table-ops", request, t, stats),
    notes: () => ipcRenderer.invoke("kit:notes"),
    saveNote: (n: unknown) => ipcRenderer.invoke("kit:note-save", n),
    deleteNote: (id: string) => ipcRenderer.invoke("kit:note-delete", id),
    makeNote: (request: string) => ipcRenderer.invoke("kit:note-make", request),
    exportNote: (n: unknown) => ipcRenderer.invoke("kit:note-export", n),
    askNotes: (q: string) => ipcRenderer.invoke("kit:notes-ask", q),
    pocket: () => ipcRenderer.invoke("kit:pocket"),
    hold: (text?: string) => ipcRenderer.invoke("kit:hold", text),
    pocketCopy: (id: string) => ipcRenderer.invoke("kit:pocket-copy", id),
    pocketRemove: (id: string) => ipcRenderer.invoke("kit:pocket-remove", id),
    plan: (request: string, items: unknown[]) => ipcRenderer.invoke("kit:plan", request, items),
    planToCalendar: (plan: unknown) => ipcRenderer.invoke("kit:plan-ics", plan),
    copy: (text: string) => ipcRenderer.invoke("kit:copy", text),
    copyImage: (dataUrl: string) => ipcRenderer.invoke("kit:copy-image", dataUrl),
    saveImage: (dataUrl: string, name: string) => ipcRenderer.invoke("kit:save-image", dataUrl, name),
    openCsv: (title: string, columns: string[], rows: unknown[][]) => ipcRenderer.invoke("kit:open-csv", title, columns, rows),
    classes: () => ipcRenderer.invoke("kit:classes"),
    saveClasses: (classes: unknown[], active: string | null) => ipcRenderer.invoke("kit:classes-save", classes, active),
    setActiveClass: (id: string | null) => ipcRenderer.invoke("kit:class-active", id),
    classFor: (text: string) => ipcRenderer.invoke("kit:class-for", text),
    parseClasses: (text: string, useScreen: boolean) => ipcRenderer.invoke("kit:classes-parse", text, useScreen),
  },
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
  gameplan: (hint: string) => ipcRenderer.invoke("milo:gameplan", hint),
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
  tts: (text: string, urgent?: boolean, around?: { previous?: string; next?: string }) => ipcRenderer.invoke("milo:tts", text, !!urgent, around),
  account: () => ipcRenderer.invoke("milo:account"),
  accountSend: (email: string) => ipcRenderer.invoke("milo:account-send", email),
  accountVerify: (email: string, code: string) => ipcRenderer.invoke("milo:account-verify", email, code),
  accountSignOut: () => ipcRenderer.invoke("milo:account-signout"),
  memories: () => ipcRenderer.invoke("milo:memories"),
  remember: (fact: string) => ipcRenderer.invoke("milo:remember", fact),
  onAccountChange: (cb: () => void) => on("milo:account-changed", cb),
  focusStart: (minutes: number) => ipcRenderer.invoke("milo:focus-start", minutes),
  focusStop: () => ipcRenderer.invoke("milo:focus-stop"),
  focusAllow: (label: string) => ipcRenderer.invoke("milo:focus-allow", label),
  focusBack: () => ipcRenderer.invoke("milo:focus-back"),
  focusSave: (s: unknown) => ipcRenderer.invoke("milo:focus-save", s),
  onFocusState: (cb: (s: unknown) => void) => {
    const l = (_e: unknown, s: unknown) => cb(s);
    ipcRenderer.on("milo:focus-state", l);
    return () => ipcRenderer.removeListener("milo:focus-state", l);
  },
  forgetAll: () => ipcRenderer.invoke("milo:forget-all"),
  feedback: (message: string, kind?: string) => ipcRenderer.invoke("milo:feedback", message, kind),
  onOpenFeedback: (cb: () => void) => on("milo:open-feedback", cb),
  activity: {
    list: () => ipcRenderer.invoke("milo:activity-list"),
    undo: (id: string) => ipcRenderer.invoke("milo:activity-undo", id),
    undoLast: () => ipcRenderer.invoke("milo:activity-undo-last"),
    say: (since?: number) => ipcRenderer.invoke("milo:activity-say", since),
    onChange: (cb: () => void) => on("milo:activity", cb),
    onOpen: (cb: () => void) => on("milo:open-activity", cb),
  },
  reportError: (err: { name?: string; message?: string; stack?: string }) => ipcRenderer.send("milo:renderer-error", err),
  task: (task: string) => ipcRenderer.invoke("milo:task", task),
  stopTask: () => ipcRenderer.send("milo:task-stop"),
  handsAccess: () => ipcRenderer.invoke("milo:hands-access"),
  perms: () => ipcRenderer.invoke("milo:perms"),
  prefs: {
    get: () => ipcRenderer.invoke("milo:prefs-get"),
    set: (p: unknown) => ipcRenderer.invoke("milo:prefs-set", p),
  },
  googleDisconnect: () => ipcRenderer.invoke("milo:google-disconnect"),
  pause: {
    get: () => ipcRenderer.invoke("milo:pause-get"),
    set: (on: boolean, minutes?: number) => ipcRenderer.invoke("milo:pause-set", on, minutes),
    onChange: (cb: (s: { on: boolean; since: number | null; until: number | null }) => void) => {
      const h = (_e: unknown, s: { on: boolean; since: number | null; until: number | null }) => cb(s);
      ipcRenderer.on("milo:pause", h);
      return () => ipcRenderer.removeListener("milo:pause", h);
    },
  },
  profileGet: () => ipcRenderer.invoke("milo:profile-get"),
  profileSet: (patch: Record<string, string>) => ipcRenderer.invoke("milo:profile-set", patch),
  usage: () => ipcRenderer.invoke("milo:usage"),
  google: {
    status: () => ipcRenderer.invoke("milo:google-status"),
    connect: () => ipcRenderer.invoke("milo:google-connect"),
    calendar: (days: number, range: string) => ipcRenderer.invoke("milo:google-calendar", days, range),
    mail: () => ipcRenderer.invoke("milo:google-mail"),
    doc: (title: string, text?: string) => ipcRenderer.invoke("milo:google-doc", title, text),
    draft: (request: string) => ipcRenderer.invoke("milo:google-draft", request),
    send: (draftId: string) => ipcRenderer.invoke("milo:google-send", draftId),
    eventParse: (request: string) => ipcRenderer.invoke("milo:google-event-parse", request),
    eventAdd: (ev: unknown) => ipcRenderer.invoke("milo:google-event-add", ev),
  },
  forecast: (q: { course: string; letter: string; exam?: string; portal?: string; fresh?: boolean }) => ipcRenderer.invoke("milo:forecast", q),
  finalWeight: (course: string, weight: number) => ipcRenderer.invoke("milo:final-weight", course, weight),
  gradeScore: (q: { course: string; name: string; earned: number; possible?: number }) => ipcRenderer.invoke("milo:grade-score", q),
  gradeNow: (course: string, portal?: string) => ipcRenderer.invoke("milo:grade-now", course, portal),
  d2lDue: (portal: string) => ipcRenderer.invoke("milo:d2l-due", portal),
  d2lCheck: (portal: string) => ipcRenderer.invoke("milo:d2l-check", portal),
  classesSync: (portal: string) => ipcRenderer.invoke("milo:classes-sync", portal),
  home: {
    open: () => ipcRenderer.invoke("milo:open-home"),
    route: (text: string) => ipcRenderer.send("milo:home-route", text),
    action: (a: unknown) => ipcRenderer.send("milo:home-action", a),
    talk: () => ipcRenderer.send("milo:home-talk"),
    grades: (portal: string, fresh?: boolean) => ipcRenderer.invoke("milo:home-grades", portal, !!fresh),
    onEcho: (fn: (e: { kind: string; payload: unknown }) => void) => {
      const l = (_e: unknown, ev: { kind: string; payload: unknown }) => fn(ev);
      ipcRenderer.on("milo:echo", l);
      return () => ipcRenderer.removeListener("milo:echo", l);
    },
    // (the frog's side)
    echo: (kind: string, payload: unknown) => ipcRenderer.send("milo:echo", kind, payload),
    onRouteText: (fn: (text: string) => void) => {
      const l = (_e: unknown, t: string) => fn(t);
      ipcRenderer.on("milo:route-text", l);
      return () => ipcRenderer.removeListener("milo:route-text", l);
    },
    onAction: (fn: (a: { kind: string; item: { title: string; course: string; due: string } }) => void) => {
      const l = (_e: unknown, a: { kind: string; item: { title: string; course: string; due: string } }) => fn(a);
      ipcRenderer.on("milo:home-action", l);
      return () => ipcRenderer.removeListener("milo:home-action", l);
    },
  },
  lecture: {
    start: (said: string) => ipcRenderer.invoke("milo:lecture-start", said),
    chunk: (id: string, n: number, wav: ArrayBuffer) => ipcRenderer.invoke("milo:lecture-chunk", id, n, wav),
    stop: () => ipcRenderer.invoke("milo:lecture-stop"),
    now: () => ipcRenderer.invoke("milo:lecture-now"),
    file: (lectureId: string, said: string) => ipcRenderer.invoke("milo:lecture-file", lectureId, said),
  },
  paper: (request: string, name?: string) => ipcRenderer.invoke("milo:paper", request, name),
  paperStop: () => ipcRenderer.invoke("milo:paper-stop"),
  onPaperProgress: (fn: (p: unknown) => void) => {
    const l = (_e: unknown, p: unknown) => fn(p);
    ipcRenderer.on("milo:paper-progress", l);
    return () => ipcRenderer.removeListener("milo:paper-progress", l);
  },
  d2lFeedUrl: (portal: string) => ipcRenderer.invoke("milo:d2l-feed-url", portal),
  d2lSubscribeUrl: (portal: string) => ipcRenderer.invoke("milo:d2l-subscribe-url", portal),
  d2lOpenChrome: (url: string) => ipcRenderer.invoke("milo:d2l-open-chrome", url),
  startupCheck: (portal?: string) => ipcRenderer.invoke("milo:startup-check", portal),
  syllabus: (course: string) => ipcRenderer.invoke("milo:syllabus", course),
  exam: (q: { course: string; kind?: string; extra?: string }) => ipcRenderer.invoke("milo:exam", q),
  feedFetch: (url: string) => ipcRenderer.invoke("milo:feed-fetch", url),
  feedConnect: (url?: string) => ipcRenderer.invoke("milo:feed-connect", url),
  jobStart: (goal: string, opts?: { approved?: boolean }) => ipcRenderer.invoke("milo:job-start", goal, opts),
  jobResume: (approve?: boolean) => ipcRenderer.invoke("milo:job-resume", approve),
  jobStop: () => ipcRenderer.invoke("milo:job-stop"),
  jobLast: () => ipcRenderer.invoke("milo:job-last"),
  jobIs: (text: string) => ipcRenderer.invoke("milo:job-is", text),
  onJob: (cb: (job: unknown) => void) => {
    const l = (_e: unknown, j: unknown) => cb(j);
    ipcRenderer.on("milo:job", l);
    return () => ipcRenderer.removeListener("milo:job", l);
  },
  updateInstall: () => ipcRenderer.invoke("milo:update-install"),
  onUpdateReady: (cb: (version: string) => void) => {
    const l = (_e: unknown, v: string) => cb(String(v ?? ""));
    ipcRenderer.on("milo:update-ready", l);
    return () => ipcRenderer.removeListener("milo:update-ready", l);
  },
  syncExchange: (kind: string, rows: unknown[]) => ipcRenderer.invoke("milo:sync-exchange", kind, rows),
  onSyncNow: (cb: (changed: string[]) => void) => {
    const l = (_e: unknown, changed: string[]) => cb(Array.isArray(changed) ? changed : []);
    ipcRenderer.on("milo:sync-now", l);
    return () => ipcRenderer.removeListener("milo:sync-now", l);
  },
  permAsk: (kind: string) => ipcRenderer.invoke("milo:perm-ask", kind),
  relaunch: () => ipcRenderer.invoke("milo:relaunch"),
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
  brief: (dataUrl: string, pageText?: string) => ipcRenderer.invoke("milo:brief", dataUrl, pageText),
  copy: (text: string) => ipcRenderer.send("milo:copy", text),
  onSummon: (cb: () => void) => on("milo:summon", cb),
  onTeachScreen: (cb: () => void) => on("milo:teach-screen", cb),
  onTalk: (cb: () => void) => on("milo:talk", cb),
  setCharacter: (desc: string) => ipcRenderer.send("milo:set-character", desc),
  setName: (name: string) => ipcRenderer.send("milo:set-name", name),
  quit: () => ipcRenderer.send("milo:quit"),
});
