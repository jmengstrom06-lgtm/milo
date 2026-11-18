export {};

declare global {
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
  type MiloBox = { x: number; y: number; width: number; height: number };
  type Err = { ok: false; text: string };

  interface Window {
    milo: {
      setClickable: (clickable: boolean) => void;
      ask: (history: { role: "user" | "assistant"; content: string }[]) => Promise<{ ok: boolean; text: string }>;
      look: (mode: MiloMode, request: string, focus?: MiloBox | null) => Promise<{ ok: true; lesson: MiloLesson; box: MiloBox | null; others: MiloOther[] } | Err>;
      refine: (box: MiloBox, topic: string) => Promise<{ ok: true; box: MiloBox } | Err>;
      check: (lesson: MiloLesson, answer: string) => Promise<{ ok: true; data: { correct: boolean; feedback: string } } | Err>;
      practice: (lesson: MiloLesson) => Promise<{ ok: true; data: { problems: { question: string; answer: string }[] } } | Err>;
      stt: (audio: ArrayBuffer) => Promise<{ ok: true; text: string } | Err>;
      micAccess: () => Promise<boolean>;
      tts: (text: string, urgent?: boolean) => Promise<{ ok: true; audio: string } | Err>;
      task: (task: string) => Promise<{ ok: true; status: "done" | "ask" | "stopped"; text: string } | Err>;
      stopTask: () => void;
      handsAccess: () => Promise<boolean>;
      onTaskStep: (cb: (step: { say: string; action: string; point?: { x: number; y: number } | null }) => void) => () => void;
      copy: (text: string) => void;
      onSummon: (cb: () => void) => () => void;
      onTeachScreen: (cb: () => void) => () => void;
      onTalk: (cb: () => void) => () => void;
      setCharacter: (desc: string) => void;
      quit: () => void;
    };
  }
}
