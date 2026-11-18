export {};

declare global {
  interface Window {
    milo: {
      setClickable: (clickable: boolean) => void;
      ask: (history: { role: "user" | "assistant"; content: string }[]) => Promise<{ ok: boolean; text: string }>;
      onSummon: (cb: () => void) => () => void;
      quit: () => void;
    };
  }
}
