export {};

declare global {
  type GoogleReply = { ok: boolean; text: string; connect?: boolean; link?: string; linkLabel?: string };
  type MiloJobStep = { do: string; done_when: string; status: "todo" | "doing" | "retrying" | "done" | "failed" | "skipped"; tries: number; note?: string };
  type MiloJob = {
    id: string;
    goal: string;
    steps: MiloJobStep[];
    status: "planning" | "running" | "checking" | "done" | "needs_you" | "stuck" | "paused" | "stopped" | "failed";
    createdAt: number;
    updatedAt: number;
    replans: number;
    approved: boolean;
    question?: string;
    summary?: string;
    actions: number;
  };
  type MiloPrefs = { notifyAway: boolean; quiet: boolean; quietFrom: number; quietTo: number; noRecord: string[]; okRecord: string[]; autofill: boolean };
  type MiloPause = { on: boolean; since: number | null; until: number | null };
  type MiloActivity = {
    id: string;
    at: number;
    kind: "calendar" | "email_draft" | "email_sent" | "doc" | "memory" | "job" | "app" | "web" | "classes";
    title: string;
    detail?: string;
    link?: string;
    noUndo?: string;
    undone?: number;
    undoError?: string;
    canUndo: boolean;
    proof?: { level: "confirmed" | "checked" | "tried"; how: string };
    source?: { label: string; url?: string };
  };
  type PlanStep = { text: string; minutes: number; kind: "read" | "solve" | "write" | "research" | "review" | "submit"; detail: string };
  type GamePlan = { found: boolean; title: string; course: string; due: string; steps: PlanStep[]; total_minutes: number; say: string; missing: string };

  type MiloFluxEvent =
    | { type: "open" }
    | { type: "start"; turn: number }
    | { type: "update"; turn: number; text: string }
    | { type: "resumed"; turn: number }
    | { type: "end"; turn: number; text: string; confidence: number; trigger?: string }
    | { type: "closed"; reason: string }
    | { type: "error"; text: string };
  type MiloFocusState = {
    status: "work" | "distracted" | "neutral";
    label?: string;
    app: string;
    box?: MiloBox | null;
  };
  type MiloRoute = {
    kind: "chat" | "look" | "task" | "research" | "move" | "close" | "open_result" | "screen_question" | "kit" | "in_app" | "kit_menu" | "hold" | "drop" | "sweep" | "build" | "quiz" | "brief" | "watch" | "checkwork" | "lockin";
    minutes?: number;
    mode?: MiloMode;
    followUp?: boolean;
    where?: string;
    question?: string;
    on?: boolean;
    after?: string;
    app?: string;
    target?: string;
    request?: string;
    failed?: boolean;
  };
  type MiloMode = "teach" | "help" | "do";
  type MiloStep = { say: string; write: string };
  type MiloLesson = {
    found: boolean;
    target: { x: number; y: number; width: number; height: number } | null;
    topic: string;
    intro: string;
    steps: MiloStep[];
    answer: string;
    check_question: string;
    summary: string;
    others?: unknown[];
  };
  type MiloOther = { label: string; box: MiloBox };
  type QuizQ = { q: string; choices: string[]; correct: number; explain: string };
  type SweepItem = {
    label: string;
    work: string;
    answer: string;
    box: MiloBox;
    kind: "type" | "choose" | "none";
    point: { x: number; y: number } | null;
    screen: { x: number; y: number } | null;
  };
  type MiloBox = { x: number; y: number; width: number; height: number };
  type Err = { ok: false; text: string };
  type ResearchEvent =
    | { type: "status"; text: string }
    | { type: "query"; text: string }
    | { type: "sources"; items: { url: string; title: string; age?: string }[] }
    | { type: "reset" }
    | { type: "text"; delta: string }
    | { type: "cite"; url: string; title: string }
    | { type: "done"; answer: string; top: string | null; live: boolean }
    | { type: "error"; text: string };

  // Electron <webview> (live web pages inside the research panel)
  namespace JSX {
    interface IntrinsicElements {
      webview: { src?: string; style?: Record<string, string | number>; className?: string; partition?: string; ref?: unknown; key?: string | number };
    }
  }

  interface Window {
    milo: {
      lib: {
        save: (item: { id?: string; classId?: string | null; app: import("./kit/types").LibApp; title: string; data: unknown }) => Promise<import("./kit/types").LibItem | null>;
        list: (f?: { classId?: string | null | "all"; app?: import("./kit/types").LibApp | "all" }) => Promise<import("./kit/types").LibItem[]>;
        move: (id: string, classId: string | null) => Promise<import("./kit/types").LibItem | null>;
        remove: (id: string) => Promise<boolean>;
        counts: () => Promise<Record<string, Record<import("./kit/types").LibApp, number>>>;
      };
      kit: {
        mastery: () => Promise<Record<string, { right: number; wrong: number; last: number }>>;
        study: (request: string, mode: import("./kit/types").StudyMode, count: number, context?: string) => Promise<import("./kit/types").Res<import("./kit/types").StudySet>>;
        check: (item: { prompt: string; answer: string; skill?: string }, answer: string) => Promise<import("./kit/types").Res<{ correct: boolean; feedback: string }>>;
        mark: (skill: string, correct: boolean) => Promise<boolean>;
        weak: () => Promise<{ skill: string; right: number; wrong: number; last: number }[]>;
        sketch: (request: string) => Promise<import("./kit/types").Res<import("./kit/types").Sketch>>;
        image: (prompt: string) => Promise<{ ok: true; b64: string } | { ok: false; text: string }>;
        hasImages: () => Promise<boolean>;
        tableOps: (request: string, t: { columns: string[]; rows: (string | number)[][] }, stats: string) => Promise<import("./kit/types").Res<{ ops: import("./kit/types").TableOp[]; say: string }>>;
        table: (request: string) => Promise<import("./kit/types").Res<import("./kit/types").Table>>;
        notes: () => Promise<import("./kit/types").Note[]>;
        saveNote: (n: Partial<import("./kit/types").Note>) => Promise<import("./kit/types").Note>;
        deleteNote: (id: string) => Promise<boolean>;
        makeNote: (request: string) => Promise<import("./kit/types").Res<import("./kit/types").NoteDraft>>;
        exportNote: (n: import("./kit/types").Note) => Promise<boolean>;
        askNotes: (q: string) => Promise<import("./kit/types").Res<{ answer: string; note_id: string | null }>>;
        pocket: () => Promise<import("./kit/types").PocketItem[]>;
        hold: (text?: string) => Promise<{ ok: true; item: import("./kit/types").PocketItem } | { ok: false; text: string }>;
        pocketCopy: (id: string) => Promise<boolean>;
        pocketRemove: (id: string) => Promise<boolean>;
        plan: (request: string, items: { title: string; course: string; due: string }[]) => Promise<import("./kit/types").Res<import("./kit/types").Plan>>;
        copy: (text: string) => Promise<boolean>;
        planToCalendar: (plan: import("./kit/types").Plan) => Promise<boolean>;
        copyImage: (dataUrl: string) => Promise<boolean>;
        saveImage: (dataUrl: string, name: string) => Promise<string | null>;
        openCsv: (title: string, columns: string[], rows: (string | number)[][]) => Promise<boolean>;
        classes: () => Promise<import("./kit/types").ClassStore>;
        saveClasses: (classes: import("./kit/types").Klass[], active: string | null) => Promise<import("./kit/types").ClassStore>;
        setActiveClass: (id: string | null) => Promise<import("./kit/types").ClassStore>;
        classFor: (text: string) => Promise<import("./kit/types").Klass | null>;
        parseClasses: (text: string, useScreen: boolean) => Promise<import("./kit/types").Res<{ classes: { name: string; code?: string; subject: import("./kit/types").Subject }[]; say: string }>>;
      };
      log: (src: string, ev: string, data?: Record<string, unknown>) => void;
      flag: (note?: string) => Promise<{ file: string; dir: string }>;
      openLogs: () => void;
      fluxAvailable: () => Promise<boolean>;
      fluxOpen: () => Promise<boolean>;
      fluxAudio: (pcm: ArrayBuffer) => void;
      fluxForce: () => void;
      fluxClose: () => void;
      onFlux: (fn: (e: MiloFluxEvent) => void) => () => void;
      saveClip: (wav: ArrayBuffer, note?: string) => void;
      bridgeStatus: () => Promise<boolean>;
      screenAsk: (q: string) => Promise<{ ok: boolean; text: string }>;
      gameplan: (hint: string) => Promise<{ ok: true; data: GamePlan } | { ok: false; text: string }>;
      macSay: (text: string) => Promise<{ ok: true; audio: string } | { ok: false; text: string }>;
      onFlag: (fn: () => void) => () => void;
      setClickable: (clickable: boolean) => void;
      ask: (history: { role: "user" | "assistant"; content: string }[]) => Promise<{ ok: boolean; text: string }>;
      route: (
        text: string,
        ctx?: { researchOpen?: boolean; researchTopic?: string; inLesson?: boolean; lessonTopic?: string; toolOpen?: string; kitOpen?: string; quizOpen?: boolean; lockinOn?: boolean; lastCommand?: string }
      ) => Promise<MiloRoute>;
      look: (mode: MiloMode, request: string, focus?: MiloBox | null) => Promise<{ ok: true; lesson: MiloLesson; box: MiloBox | null; others: MiloOther[] } | Err>;
      refine: (box: MiloBox, topic: string) => Promise<{ ok: true; box: MiloBox } | Err>;
      check: (lesson: MiloLesson, answer: string) => Promise<{ ok: true; data: { correct: boolean; feedback: string } } | Err>;
      practice: (lesson: MiloLesson) => Promise<{ ok: true; data: { problems: { question: string; answer: string }[] } } | Err>;
      stt: (audio: ArrayBuffer) => Promise<{ ok: true; text: string } | Err>;
      micAccess: () => Promise<boolean>;
      tts: (text: string, urgent?: boolean, around?: { previous?: string; next?: string }) => Promise<{ ok: true; audio: string } | Err>;
      account: () => Promise<{ signedIn: boolean; email: string }>;
      accountSend: (email: string) => Promise<{ ok: boolean; text: string }>;
      perms: () => Promise<{ mic: boolean; screen: boolean; hands: boolean }>;
      profileGet: () => Promise<Record<string, string>>;
      profileSet: (patch: Record<string, string>) => Promise<Record<string, string>>;
      feedFetch: (url: string) => Promise<{ ok: boolean; text: string }>;
      feedConnect: (url?: string) => Promise<{ ok: true; url: string; text: string } | { ok: false; reason: "no_link" | "bad_feed"; text?: string }>;
      forecast: (q: { course: string; letter: string; exam?: string; portal?: string; fresh?: boolean }) => Promise<{ ok: boolean; text: string }>;
      finalWeight: (course: string, weight: number) => Promise<boolean>;
      gradeScore: (q: { course: string; name: string; earned: number; possible?: number }) => Promise<{ ok: boolean; text: string }>;
      gradeNow: (course: string, portal?: string) => Promise<{ ok: boolean; text: string; signin?: boolean }>;
      startupCheck: (portal?: string) => Promise<{ problems: { kind: string; text: string }[] }>;
      d2lCheck: (portal: string) => Promise<{ ok: boolean; signin: boolean; text: string; via?: "chrome" | "milo"; chrome: boolean }>;
      d2lOpenChrome: (url: string) => Promise<boolean>;
      classesSync: (portal: string) => Promise<{ ok: boolean; changed: boolean; added?: string[]; renamed?: { from: string; to: string }[]; names?: string[]; text?: string }>;
      home: {
        open: () => Promise<void>;
        route: (text: string) => void;
        action: (a: { kind: "together" | "do" | "do_submit"; item: { title: string; course: string; due: string } }) => void;
        talk: () => void;
        grades: (portal: string, fresh?: boolean) => Promise<{ name: string; grade: number | null }[]>;
        onEcho: (fn: (e: { kind: string; payload: unknown }) => void) => () => void;
        echo: (kind: string, payload: unknown) => void;
        onRouteText: (fn: (text: string) => void) => () => void;
        onAction: (fn: (a: { kind: string; item: { title: string; course: string; due: string } }) => void) => () => void;
      };
      lecture: {
        start: (said: string, confirmed?: boolean) => Promise<{ id: string; course: string; startedAt: number; blocked?: "class" | "paused" | "ask"; classId?: string | null }>;
        allow: (classId: string | null, allowed: boolean) => Promise<boolean>;
        discard: () => Promise<{ ok: boolean; course: string; remembered: boolean }>;
        chunk: (id: string, n: number, wav: ArrayBuffer) => Promise<boolean>;
        stop: () => Promise<{ ok: boolean; text: string; lectureId?: string; needsClass?: boolean; noteId?: string; minutes?: string; title?: string; flashcards?: number; alerts?: number }>;
        now: () => Promise<{ id: string; course: string; startedAt: number; chunks: number } | null>;
        file: (lectureId: string, said: string) => Promise<string | null>;
      };
      paper: (request: string, name?: string) => Promise<{ ok: boolean; text: string; url?: string; link?: string; linkLabel?: string; needTopic?: boolean; connect?: boolean }>;
      paperStop: () => Promise<boolean>;
      onPaperProgress: (fn: (p: { stage: string; text: string; url?: string; step?: number; of?: number }) => void) => () => void;
      d2lFeedUrl: (portal: string) => Promise<string | null>;
      d2lSubscribeUrl: (portal: string) => Promise<string | null>;
      d2lDue: (portal: string) => Promise<{ ok: true; items: { title: string; course: string; due: string; due_iso?: string; kind?: string }[] } | { ok: false; signin: boolean; text: string }>;
      syllabus: (course: string) => Promise<{ ok: boolean; text: string }>;
      exam: (q: { course: string; kind?: string; extra?: string }) => Promise<{ ok: true; topic: string; questions: { q: string; choices: string[]; correct: number; explain: string }[] } | { ok: false; text: string }>;
      google: {
        status: () => Promise<{ ready: boolean; connected: boolean; email: string | null }>;
        connect: () => Promise<{ ok: boolean; text: string }>;
        calendar: (days: number, range: string) => Promise<GoogleReply>;
        mail: () => Promise<GoogleReply>;
        doc: (title: string, text?: string) => Promise<GoogleReply>;
        draft: (request: string) => Promise<GoogleReply & { draftId?: string; to?: string; subject?: string; needAddress?: string }>;
        send: (draftId: string) => Promise<GoogleReply>;
        eventParse: (request: string) => Promise<GoogleReply & { ev?: { title: string; start: string; end?: string; where?: string } }>;
        eventAdd: (ev: { title: string; start: string; end?: string; where?: string }) => Promise<GoogleReply>;
      };
      usage: () => Promise<{ calls: number; cost: number; smart: number; fast: number; images: number; soft: number; hard: number }>;
      jobStart: (goal: string, opts?: { approved?: boolean }) => Promise<MiloJob>;
      jobResume: (approve?: boolean) => Promise<MiloJob | null>;
      jobStop: () => Promise<void>;
      jobLast: () => Promise<MiloJob | null>;
      jobIs: (text: string) => Promise<boolean>;
      onJob: (cb: (job: MiloJob) => void) => () => void;
      feedback: (message: string, kind?: string) => Promise<{ ok: boolean; text: string }>;
      onOpenFeedback: (cb: () => void) => () => void;
      activity: {
        list: () => Promise<MiloActivity[]>;
        undo: (id: string) => Promise<{ ok: boolean; text: string }>;
        undoLast: () => Promise<{ ok: boolean; text: string }>;
        say: (since?: number) => Promise<string>;
        onChange: (cb: () => void) => () => void;
        onOpen: (cb: () => void) => () => void;
      };
      updateInstall: () => Promise<void>;
      onUpdateReady: (cb: (version: string) => void) => () => void;
      syncExchange: (kind: "gameplan", rows: { id: string; updated: number; deleted?: boolean; data?: unknown }[]) => Promise<{ id: string; updated: number; deleted?: boolean; data?: unknown }[] | null>;
      onSyncNow: (cb: (changed: string[]) => void) => () => void;
      permAsk: (kind: "mic" | "screen" | "hands" | "automation") => Promise<boolean>;
      relaunch: () => Promise<void>;
      accountVerify: (email: string, code: string) => Promise<{ ok: boolean; text: string }>;
      accountSignOut: () => Promise<{ signedIn: boolean; email: string }>;
      memories: () => Promise<string[]>;
      prefs: {
        get: () => Promise<MiloPrefs>;
        set: (p: Partial<MiloPrefs>) => Promise<MiloPrefs>;
      };
      googleDisconnect: () => Promise<{ ready: boolean; connected: boolean; email: string | null }>;
      pause: {
        get: () => Promise<MiloPause>;
        set: (on: boolean, minutes?: number) => Promise<MiloPause>;
        onChange: (cb: (s: MiloPause) => void) => () => void;
      };
      remember: (fact: string) => Promise<boolean>;
      onAccountChange: (cb: () => void) => () => void;
      focusStart: (minutes: number) => Promise<{ focus: number; rest: number }[]>;
      focusStop: () => Promise<boolean>;
      focusAllow: (label: string) => Promise<boolean>;
      focusBack: () => Promise<string | null>;
      focusSave: (s: {
        topic?: string;
        plannedMinutes: number;
        focusedSeconds: number;
        slips: number;
        longestStreakSeconds: number;
        completed: boolean;
        startedAt: string;
      }) => Promise<boolean>;
      onFocusState: (cb: (s: MiloFocusState) => void) => () => void;
      forgetAll: () => Promise<boolean>;
      reportError: (err: { name?: string; message?: string; stack?: string }) => void;
      task: (task: string) => Promise<{ ok: true; status: "done" | "ask" | "stopped" | "quick" | "blocked"; text: string; rest?: string | null; did?: string[]; replayed?: boolean } | Err>;
      stopTask: () => void;
      handsAccess: () => Promise<boolean>;
      onTaskStep: (cb: (step: { say: string; action: string; point?: { x: number; y: number } | null }) => void) => () => void;
      research: (q: string, history?: { q: string; a: string }[]) => Promise<boolean>;
      stopResearch: () => void;
      openUrl: (url: string) => void;
      onResearch: (cb: (ev: ResearchEvent) => void) => () => void;
      sweepPlan: (skip: string[]) => Promise<{ ok: true; items: SweepItem[]; more: boolean } | Err>;
      sweepFill: (item: SweepItem) => Promise<{ ok: true } | Err>;
      scrollPage: () => Promise<{ ok: true } | Err>;
      build: (req: string) => Promise<boolean>;
      stopBuild: () => void;
      onBuild: (cb: (ev: { type: "code"; delta: string } | { type: "done"; title: string; html: string } | { type: "error"; text: string }) => void) => () => void;
      watchCheck: (force?: boolean) => Promise<{ ok: true; changed: boolean; mistake?: boolean; box?: MiloBox | null; hint?: string } | Err>;
      watchReset: () => void;
      quiz: (focus: string) => Promise<{ ok: true; topic: string; questions: QuizQ[] } | Err>;
      brief: (dataUrl: string, pageText?: string) => Promise<
        | { ok: true; data: { signed_in: boolean; items: { title: string; course: string; due: string; urgent: boolean; due_iso?: string; kind?: string }[]; spoken: string } }
        | Err
      >;
      copy: (text: string) => void;
      onSummon: (cb: () => void) => () => void;
      onTeachScreen: (cb: () => void) => () => void;
      onTalk: (cb: () => void) => () => void;
      setCharacter: (desc: string) => void;
      setName: (name: string) => void;
      quit: () => void;
    };
  }
}

