import { useEffect, useRef, useState } from "react";

type Item = { title: string; course: string; due: string; urgent: boolean };
export type BriefState =
  | { phase: "loading" }
  | { phase: "ready"; items: Item[]; spoken: string }
  | { phase: "signin" }
  | { phase: "setup" }
  | { phase: "error"; text: string };

type WebviewEl = HTMLElement & {
  capturePage: () => Promise<{ toDataURL: () => string; resize?: (o: { width: number }) => { toDataURL: () => string } }>;
  addEventListener: HTMLElement["addEventListener"];
};

/** Loads the portal in a hidden, logged-in browser view, snapshots it, and asks Milo what's due. */
export function BriefLoader({ url, onResult }: { url: string; onResult: (s: BriefState) => void }) {
  const ref = useRef<WebviewEl | null>(null);
  useEffect(() => {
    const wv = ref.current;
    if (!wv) return;
    let done = false;
    const run = async () => {
      if (done) return;
      done = true;
      await new Promise((r) => setTimeout(r, 2500)); // let the portal's widgets fill in
      try {
        const img = await wv.capturePage();
        const r = await window.milo.brief(img.toDataURL());
        if (!r.ok) return onResult({ phase: "error", text: r.text });
        if (!r.data.signed_in) return onResult({ phase: "signin" });
        onResult({ phase: "ready", items: r.data.items ?? [], spoken: r.data.spoken ?? "" });
      } catch (e) {
        onResult({ phase: "error", text: `Couldn't read your portal: ${(e as Error).message}` });
      }
    };
    wv.addEventListener("did-stop-loading", run);
    const t = window.setTimeout(run, 15000);
    return () => {
      window.clearTimeout(t);
      wv.removeEventListener("did-stop-loading", run);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);
  return (
    <div className="brief-offscreen" aria-hidden>
      <webview ref={ref} src={url} partition="persist:milo-research" style={{ width: "1280px", height: "860px" }} />
    </div>
  );
}

/** The greeting card next to Milo. */
export function BriefCard({
  greeting,
  state,
  style,
  portal,
  onSetPortal,
  onSignIn,
  onOpenPortal,
  onClose,
  hover,
}: {
  greeting: string;
  state: BriefState;
  style: React.CSSProperties;
  portal: string;
  onSetPortal: (url: string) => void;
  onSignIn: () => void;
  onOpenPortal: () => void;
  onClose: () => void;
  hover: (on: boolean) => void;
}) {
  const [draft, setDraft] = useState(portal);
  return (
    <div className="rp rp--compact brief" style={style} onMouseEnter={() => hover(true)} onMouseMove={() => hover(true)} onMouseLeave={() => hover(false)}>
      <div className="rp-inner">
        <div className="rp-head">
          <span className={`rp-orb ${state.phase === "loading" ? "rp-orb--on" : ""}`} />
          <div className="rp-title">
            <div className="rp-kicker">{new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}</div>
            <div className="rp-q">{greeting}</div>
          </div>
          <div className="rp-tools">
            <button className="rp-icon" onClick={onClose} title="Dismiss">
              <svg viewBox="0 0 16 16" width="12" height="12"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
            </button>
          </div>
        </div>
        <div className="rp-body">
          {state.phase === "loading" && (
            <div className="rp-step rp-step--now">
              <span className="rp-spin" />
              <span className="rp-shimmer">Checking what's due…</span>
            </div>
          )}

          {state.phase === "ready" && (
            <>
              {state.items.length === 0 ? (
                <div className="brief-empty">Nothing due soon. You're all caught up.</div>
              ) : (
                <div className="brief-list">
                  {state.items.map((it, i) => (
                    <div key={i} className="brief-item" style={{ animationDelay: `${i * 60}ms` }}>
                      <span className={`brief-dot ${it.urgent ? "brief-dot--hot" : ""}`} />
                      <div className="brief-main">
                        <div className="brief-title">{it.title}</div>
                        <div className="brief-course">{it.course}</div>
                      </div>
                      <span className={`brief-due ${it.urgent ? "brief-due--hot" : ""}`}>{it.due}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="tool-bar">
                <button onClick={onOpenPortal}>Open D2L</button>
              </div>
            </>
          )}

          {state.phase === "signin" && (
            <div className="brief-setup">
              <p>Sign in to D2L once inside Milo and he'll check what's due every day.</p>
              <div className="tool-bar">
                <button onClick={onSignIn}>Sign in to D2L</button>
              </div>
            </div>
          )}

          {state.phase === "setup" && (
            <div className="brief-setup">
              <p>Add your D2L address and Milo will tell you what's due each morning.</p>
              <form
                className="brief-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (draft.trim()) onSetPortal(draft.trim());
                }}
              >
                <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="https://yourschool.brightspace.com" />
                <button type="submit">Connect</button>
              </form>
            </div>
          )}

          {state.phase === "error" && <div className="rp-error">{state.text}</div>}
        </div>
      </div>
    </div>
  );
}

/** One-time sign-in: the portal, live, in a panel. The login is remembered. */
export function SignInPanel({ url, style, onDone, hover }: { url: string; style: React.CSSProperties; onDone: () => void; hover: (on: boolean) => void }) {
  return (
    <div className="rp rp--half" style={style} onMouseEnter={() => hover(true)} onMouseMove={() => hover(true)} onMouseLeave={() => hover(false)}>
      <div className="rp-inner">
        <div className="rp-head">
          <span className="rp-orb" />
          <div className="rp-title">
            <div className="rp-kicker">Connect D2L</div>
            <div className="rp-q">Sign in once. Milo will remember it.</div>
          </div>
          <div className="tool-bar">
            <button onClick={onDone}>I'm signed in</button>
          </div>
        </div>
        <div className="rp-body">
          <div className="rp-page" style={{ flex: 1 }}>
            <div className="rp-page__view">
              <webview src={url} partition="persist:milo-research" className="rp-webview" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
