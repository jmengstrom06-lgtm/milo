import { useEffect, useRef, useState } from "react";
import type { PanelSize } from "./ResearchPanel";

export type SavedTool = { id: string; title: string; html: string; created: number };

export function loadTools(): SavedTool[] {
  try {
    return JSON.parse(localStorage.getItem("milo.tools") || "[]");
  } catch {
    return [];
  }
}
export function saveTools(t: SavedTool[]) {
  try {
    localStorage.setItem("milo.tools", JSON.stringify(t.slice(0, 40)));
  } catch {
    /* ignore */
  }
}

/** Phase label from how far the code has gotten. */
function stage(code: string) {
  if (/<script/i.test(code)) return "Writing the logic";
  if (/<body|<main|<div/i.test(code)) return "Building the interface";
  if (/<style/i.test(code)) return "Designing the layout";
  return "Planning the tool";
}

export default function ToolPanel({
  request,
  existing,
  style,
  size,
  onSize,
  onClose,
  onDone,
  onSaved,
  hover,
}: {
  request: string;
  existing?: SavedTool | null; // reopening a saved tool
  style: React.CSSProperties;
  size: PanelSize;
  onSize: (s: PanelSize) => void;
  onClose: () => void;
  onDone: (title: string) => void;
  onSaved: (t: SavedTool) => void;
  hover: (on: boolean) => void;
}) {
  const [code, setCode] = useState(existing?.html ?? "");
  const [phase, setPhase] = useState<"building" | "done" | "error">(existing ? "done" : "building");
  const [title, setTitle] = useState(existing?.title ?? "");
  const [html, setHtml] = useState(existing?.html ?? "");
  const [err, setErr] = useState("");
  const [showCode, setShowCode] = useState(false);
  const [saved, setSaved] = useState(!!existing);
  const codeRef = useRef<HTMLPreElement>(null);
  const t0 = useRef(Date.now());
  const [secs, setSecs] = useState(0);

  useEffect(() => {
    if (existing) return;
    const off = window.milo.onBuild((ev) => {
      if (ev.type === "code") setCode((c) => c + ev.delta);
      if (ev.type === "done") {
        setTitle(ev.title);
        setHtml(ev.html);
        setPhase("done");
        setSecs(Math.round((Date.now() - t0.current) / 1000));
        onDone(ev.title);
      }
      if (ev.type === "error") {
        setErr(ev.text);
        setPhase("error");
      }
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    codeRef.current?.scrollTo({ top: codeRef.current.scrollHeight });
  }, [code]);

  const lines = code.split("\n").length;
  const save = () => {
    const t: SavedTool = { id: existing?.id ?? String(Date.now()), title: title || "Tool", html, created: Date.now() };
    onSaved(t);
    setSaved(true);
  };

  return (
    <div className={`rp rp--${size} ${phase === "building" ? "rp--working" : ""}`} style={style} onMouseEnter={() => hover(true)} onMouseLeave={() => hover(false)}>
      <div className="rp-inner">
        <div className="rp-head">
          <span className={`rp-orb ${phase === "building" ? "rp-orb--on" : ""}`} />
          <div className="rp-title">
            <div className="rp-kicker">
              Build{phase === "done" && !existing && <span> · {secs}s · {lines} lines</span>}
            </div>
            <div className="rp-q" title={request}>
              {phase === "done" ? title : request}
            </div>
          </div>
          <div className="rp-tools">
            {(["compact", "half", "full"] as PanelSize[]).map((s) => (
              <button key={s} className={`rp-icon ${size === s ? "rp-icon--on" : ""}`} onClick={() => onSize(s)} title={s}>
                <svg viewBox="0 0 16 16" width="13" height="13">
                  <rect x="2" y="2" width="12" height="12" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
                  {s === "compact" && <rect x="8" y="8" width="4" height="4" rx="1" fill="currentColor" />}
                  {s === "half" && <rect x="8" y="3.5" width="4.5" height="9" rx="1" fill="currentColor" />}
                  {s === "full" && <rect x="4" y="4" width="8" height="8" rx="1" fill="currentColor" />}
                </svg>
              </button>
            ))}
            <button className="rp-icon" onClick={onClose} title="Close (Esc)">
              <svg viewBox="0 0 16 16" width="12" height="12"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
            </button>
          </div>
        </div>

        <div className="rp-body rp-body--tool">
          {phase === "building" && (
            <>
              <div className="rp-step rp-step--now">
                <span className="rp-spin" />
                <span className="rp-shimmer">{stage(code)}…</span>
                <span className="tool-lines">{lines} lines</span>
              </div>
              <pre className="tool-code" ref={codeRef}>
                {code.slice(-6000)}
                <span className="rp-caret" />
              </pre>
            </>
          )}

          {phase === "error" && <div className="rp-error">{err}</div>}

          {phase === "done" && (
            <>
              <div className="tool-bar">
                <button onClick={() => setShowCode((v) => !v)}>{showCode ? "Show tool" : "View code"}</button>
                <button onClick={save} disabled={saved}>
                  {saved ? "Saved to My Tools" : "Save to My Tools"}
                </button>
              </div>
              {showCode ? (
                <pre className="tool-code tool-code--full">{html}</pre>
              ) : (
                <iframe className="tool-frame" title={title} sandbox="allow-scripts allow-forms allow-modals" srcDoc={html} />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
