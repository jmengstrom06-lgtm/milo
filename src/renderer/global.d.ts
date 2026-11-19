export {};

declare global {
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
      accountVerify: (email: string, code: string) => Promise<{ ok: boolean; text: string }>;
      accountSignOut: () => Promise<{ signedIn: boolean; email: string }>;
      memories: () => Promise<string[]>;
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
      task: (task: string) => Promise<{ ok: true; status: "done" | "ask" | "stopped" | "quick"; text: string; rest?: string | null; did?: string[] } | Err>;
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
      brief: (dataUrl: string) => Promise<
        | { ok: true; data: { signed_in: boolean; items: { title: string; course: string; due: string; urgent: boolean }[]; spoken: string } }
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
