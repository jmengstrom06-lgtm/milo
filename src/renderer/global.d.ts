export {};

declare global {
  type MiloRoute = {
    kind: "chat" | "look" | "task" | "research" | "move" | "close" | "open_result" | "sweep" | "build" | "quiz" | "brief" | "watch" | "checkwork";
    mode?: MiloMode;
    followUp?: boolean;
    where?: string;
    question?: string;
    on?: boolean;
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
      setClickable: (clickable: boolean) => void;
      ask: (history: { role: "user" | "assistant"; content: string }[]) => Promise<{ ok: boolean; text: string }>;
      route: (
        text: string,
        ctx?: { researchOpen?: boolean; researchTopic?: string; inLesson?: boolean; lessonTopic?: string; toolOpen?: string; quizOpen?: boolean; lastCommand?: string }
      ) => Promise<MiloRoute>;
      look: (mode: MiloMode, request: string, focus?: MiloBox | null) => Promise<{ ok: true; lesson: MiloLesson; box: MiloBox | null; others: MiloOther[] } | Err>;
      refine: (box: MiloBox, topic: string) => Promise<{ ok: true; box: MiloBox } | Err>;
      check: (lesson: MiloLesson, answer: string) => Promise<{ ok: true; data: { correct: boolean; feedback: string } } | Err>;
      practice: (lesson: MiloLesson) => Promise<{ ok: true; data: { problems: { question: string; answer: string }[] } } | Err>;
      stt: (audio: ArrayBuffer) => Promise<{ ok: true; text: string } | Err>;
      micAccess: () => Promise<boolean>;
      tts: (text: string, urgent?: boolean) => Promise<{ ok: true; audio: string } | Err>;
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
