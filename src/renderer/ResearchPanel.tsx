import { useEffect, useMemo, useRef, useState } from "react";

export type PanelSize = "compact" | "half" | "full";
type Source = { url: string; title: string; age?: string };

const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
};
const favicon = (u: string) => `https://www.google.com/s2/favicons?domain=${host(u)}&sz=64`;

/** Light formatting for the answer: first line is the headline, "- " lines are bullets, **bold** works. */
function Answer({ text, streaming }: { text: string; streaming: boolean }) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const bold = (s: string) =>
    s.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith("**") && p.endsWith("**") ? <b key={i}>{p.slice(2, -2)}</b> : <span key={i}>{p}</span>));
  const [first, ...rest] = lines;
  return (
    <div className="rp-answer">
      {first && <p className="rp-answer__lead">{bold(first.replace(/^[-•]\s*/, ""))}</p>}
      {rest.length > 0 && (
        <ul>
          {rest.map((l, i) => (
            <li key={i}>{bold(l.replace(/^[-•*]\s*/, ""))}</li>
          ))}
        </ul>
      )}
      {streaming && <span className="rp-caret" />}
    </div>
  );
}

export default function ResearchPanel({
  question,
  history = [],
  style,
  size,
  onSize,
  onClose,
  onDone,
  hover,
}: {
  question: string;
  history?: { q: string; a: string }[];
  style: React.CSSProperties;
  size: PanelSize;
  onSize: (s: PanelSize) => void;
  onClose: () => void;
  onDone: (answer: string, top: string | null) => void;
  hover: (on: boolean) => void;
}) {
  const [status, setStatus] = useState("Thinking about where to look");
  const [queries, setQueries] = useState<string[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [answer, setAnswer] = useState("");
  const [top, setTop] = useState<string | null>(null);
  const [phase, setPhase] = useState<"working" | "done" | "error">("working");
  const [live, setLive] = useState(true);
  const [copied, setCopied] = useState(false);
  const started = useRef(Date.now());
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const off = window.milo.onResearch((ev) => {
      switch (ev.type) {
        case "status":
          setStatus(ev.text);
          break;
        case "query":
          setQueries((q) => (q.includes(ev.text) ? q : [...q, ev.text]));
          break;
        case "sources":
          setSources((s) => {
            const seen = new Set(s.map((x) => x.url));
            return [...s, ...ev.items.filter((x) => !seen.has(x.url))].slice(0, 12);
          });
          break;
        case "reset":
          setAnswer("");
          break;
        case "text":
          setStatus("Writing the answer");
          setAnswer((a) => a + ev.delta);
          break;
        case "done":
          setAnswer(ev.answer || "");
          setTop(ev.top);
          setLive(ev.live);
          setPhase("done");
          setElapsed(Math.round((Date.now() - started.current) / 100) / 10);
          onDone(ev.answer || "", ev.top);
          break;
        case "error":
          setStatus(ev.text);
          setPhase("error");
          break;
      }
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const domains = useMemo(() => sources.map((s) => host(s.url)), [sources]);
  const working = phase === "working";

  const copy = () => {
    window.milo.copy(answer.replace(/\*\*/g, ""));
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div
      className={`rp rp--${size} ${working ? "rp--working" : ""}`}
      style={style}
      onMouseEnter={() => hover(true)}
      onMouseLeave={() => hover(false)}
    >
      <div className="rp-inner">
        {/* header */}
        <div className="rp-head">
          <span className={`rp-orb ${working ? "rp-orb--on" : ""}`} />
          <div className="rp-title">
            <div className="rp-kicker">
              Research{phase === "done" && <span> · {elapsed}s · {sources.length} sources</span>}
            </div>
            <div className="rp-q" title={question}>
              {question}
            </div>
          </div>
          <div className="rp-tools">
            {(["compact", "half", "full"] as PanelSize[]).map((s) => (
              <button key={s} className={`rp-icon ${size === s ? "rp-icon--on" : ""}`} onClick={() => onSize(s)} title={s === "compact" ? "Compact" : s === "half" ? "Half screen" : "Full screen"}>
                <SizeIcon s={s} />
              </button>
            ))}
            <button className="rp-icon" onClick={onClose} title="Close (Esc)">
              <svg viewBox="0 0 16 16" width="12" height="12"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
            </button>
          </div>
        </div>

        <div className="rp-body">
          {/* earlier questions in this thread */}
          {history.length > 0 && (
            <div className="rp-thread">
              {history.map((t, i) => (
                <Earlier key={i} turn={t} />
              ))}
              <div className="rp-thread__now">Follow-up</div>
            </div>
          )}
          {/* live timeline */}
          {working && (
            <div className="rp-timeline">
              {queries.map((q, i) => (
                <div key={i} className="rp-step rp-step--done">
                  <span className="rp-dot" />
                  <span className="rp-step__label">Searched</span>
                  <span className="rp-step__q">“{q}”</span>
                </div>
              ))}
              <div className="rp-step rp-step--now">
                <span className="rp-spin" />
                <span className="rp-shimmer">{status}…</span>
              </div>
            </div>
          )}

          {/* sources */}
          {sources.length > 0 && (
            <div className="rp-sources">
              {sources.slice(0, size === "compact" ? 6 : 12).map((s, i) => (
                <button
                  key={s.url}
                  className="rp-chip"
                  style={{ animationDelay: `${i * 40}ms` }}
                  title={s.title}
                  onClick={() => {
                    setTop(s.url);
                  }}
                >
                  <img src={favicon(s.url)} alt="" />
                  <span>{domains[i]}</span>
                </button>
              ))}
            </div>
          )}

          {/* answer */}
          {(answer || phase === "done") && <Answer text={answer} streaming={working} />}
          {phase === "error" && <div className="rp-error">{status}</div>}
          {phase === "done" && !live && <div className="rp-note">Answered from memory: turn on web search in the Anthropic Console for live results.</div>}

          {/* the page he found, live */}
          {phase === "done" && top && (
            <div className="rp-page">
              <div className="rp-page__bar">
                <img src={favicon(top)} alt="" />
                <span className="rp-page__host">{host(top)}</span>
                <div className="rp-page__actions">
                  <button onClick={copy}>{copied ? "Copied" : "Copy answer"}</button>
                  <button onClick={() => window.milo.openUrl(top)}>Open in Chrome ↗</button>
                </div>
              </div>
              <div className="rp-page__view">
                <webview key={top} src={top} partition="persist:milo-research" className="rp-webview" />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Earlier({ turn }: { turn: { q: string; a: string } }) {
  const [open, setOpen] = useState(false);
  const lead = (turn.a.split("\n").map((l) => l.trim()).find(Boolean) ?? "").replace(/^[-•]\s*/, "").replace(/\*\*/g, "");
  return (
    <button className={`rp-turn ${open ? "rp-turn--open" : ""}`} onClick={() => setOpen((o) => !o)} title={open ? "Collapse" : "Expand"}>
      <div className="rp-turn__q">{turn.q}</div>
      {open ? <Answer text={turn.a} streaming={false} /> : <div className="rp-turn__a">{lead}</div>}
    </button>
  );
}

function SizeIcon({ s }: { s: PanelSize }) {
  if (s === "compact")
    return (
      <svg viewBox="0 0 16 16" width="13" height="13">
        <rect x="2" y="2" width="12" height="12" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <rect x="8" y="8" width="4" height="4" rx="1" fill="currentColor" />
      </svg>
    );
  if (s === "half")
    return (
      <svg viewBox="0 0 16 16" width="13" height="13">
        <rect x="2" y="2" width="12" height="12" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <rect x="8" y="3.5" width="4.5" height="9" rx="1" fill="currentColor" />
      </svg>
    );
  return (
    <svg viewBox="0 0 16 16" width="13" height="13">
      <rect x="2" y="2" width="12" height="12" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <rect x="4" y="4" width="8" height="8" rx="1" fill="currentColor" />
    </svg>
  );
}
