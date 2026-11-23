// First run: Milo sets himself up with the student in about a minute.
// Name -> a live demo (Milo fixes a sample week) -> sign in -> classes -> permissions (live checkmarks) -> D2L -> 3 things to try.

import { useEffect, useRef, useState } from "react";
import WeekShow from "./WeekShow";
import { ClassesEditor } from "./kit/Classes";
import type { ClassStore } from "./kit/types";

export type SetupStep = "hi" | "show" | "account" | "classes" | "perms" | "d2l" | "done";
const STEPS: SetupStep[] = ["hi", "show", "account", "classes", "perms", "d2l", "done"];
const KEY = "milo.setupStep";

export const setupDone = () => {
  try {
    return localStorage.getItem("milo.onboarded") === "1";
  } catch {
    return true;
  }
};
export const savedStep = (): SetupStep => {
  try {
    const s = localStorage.getItem(KEY) as SetupStep | null;
    return s && STEPS.includes(s) ? s : "hi";
  } catch {
    return "hi";
  }
};

const PERMS: { id: "mic" | "screen" | "hands"; title: string; why: string }[] = [
  { id: "mic", title: "Microphone", why: "So you can just talk to me." },
  { id: "screen", title: "Screen Recording", why: "So I can see your homework and jump to the question." },
  { id: "hands", title: "Accessibility", why: "So I can click and type for you (opening D2L, filling in answers)." },
];

export default function Onboarding({
  name,
  setName,
  portal,
  onPortal,
  onDone,
  say,
  hover,
  shifted,
}: {
  shifted?: boolean; // the D2L sign-in window is open on the right: slide over to the left
  name: string;
  setName: (n: string) => void;
  portal: string;
  onPortal: (url: string) => void;
  onDone: () => void;
  say: (t: string) => void;
  hover: (on: boolean) => void;
}) {
  const [step, setStepState] = useState<SetupStep>(savedStep);
  const setStep = (s: SetupStep) => {
    setStepState(s);
    try {
      localStorage.setItem(KEY, s);
    } catch {
      /* ignore */
    }
  };
  const go = (d = 1) => setStep(STEPS[Math.max(0, Math.min(STEPS.length - 1, STEPS.indexOf(step) + d))]);

  // what Milo says on each step (once)
  const said = useRef<Set<SetupStep>>(new Set());
  useEffect(() => {
    if (said.current.has(step)) return;
    said.current.add(step);
    const lines: Record<SetupStep, string> = {
      hi: "Hey! I'm Milo. I live on your screen and help you get through school. What should I call you?",
      show: "",
      account: "First, your account. I'll email you a link.",
      classes: "What classes are you taking? Everything I make gets filed under them.",
      perms: "Now three switches, so I can hear you, see your homework and click for you.",
      d2l: "Last one. Connect D2L and I'll watch your due dates for you.",
      done: `You're all set${name ? `, ${name}` : ""}. Here's what to try first.`,
    };
    if (lines[step]) say(lines[step]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // ---- account ----
  const [acct, setAcct] = useState<{ signedIn: boolean; email: string }>({ signedIn: false, email: "" });
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const load = () => window.milo.account().then(setAcct).catch(() => {});
    load();
    return window.milo.onAccountChange(load);
  }, []);
  useEffect(() => {
    if (step === "account" && acct.signedIn && sent) {
      say("Got it, you're signed in.");
      const t = setTimeout(() => go(), 1200);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acct.signedIn, step]);
  const send = async () => {
    if (busy || !/\S+@\S+\.\S+/.test(email)) return setMsg("Type your email first.");
    setBusy(true);
    setMsg("");
    const r = await window.milo.accountSend(email.trim());
    setBusy(false);
    setMsg(r.ok ? "" : r.text);
    if (r.ok) setSent(true);
  };

  // ---- classes ----
  const [store, setStore] = useState<ClassStore>({ classes: [], active: null });
  useEffect(() => {
    window.milo.kit.classes().then(setStore).catch(() => {});
  }, []);

  // ---- permissions (live) ----
  const [perms, setPerms] = useState<{ mic: boolean; screen: boolean; hands: boolean }>({ mic: false, screen: false, hands: false });
  const [askedScreen, setAskedScreen] = useState(false);
  useEffect(() => {
    if (step !== "perms") return;
    const check = () => window.milo.perms().then(setPerms).catch(() => {});
    check();
    const t = window.setInterval(check, 1200);
    return () => window.clearInterval(t);
  }, [step]);
  const allOn = perms.mic && perms.screen && perms.hands;

  // ---- d2l ----
  const [url, setUrl] = useState(portal);
  const [opened, setOpened] = useState(false);

  const dots = STEPS.slice(0, -1);
  const i = STEPS.indexOf(step);
  return (
    <div className={`ob-wrap ${shifted ? "ob-wrap--left" : ""}`}>
      <div className="ob" onMouseEnter={() => hover(true)} onMouseMove={() => hover(true)} onMouseLeave={() => hover(false)}>
        {step !== "done" && (
          <div className="ob-dots">
            {dots.map((d, k) => (
              <span key={d} className={`ob-dot ${k < i ? "ob-dot--done" : k === i ? "ob-dot--on" : ""}`} />
            ))}
          </div>
        )}

        {step === "hi" && (
          <>
            <div className="ob-big">Hey, I'm Milo 👋</div>
            <p className="ob-sub">Your study buddy that lives on your screen. Tell me your name and I'll show you what I do.</p>
            <label className="ob-label">What should I call you?</label>
            <input className="ob-input" autoFocus value={name} placeholder="Your first name" onChange={(e) => setName(e.target.value.slice(0, 30))} onKeyDown={(e) => e.key === "Enter" && name.trim() && go()} />
            <div className="ob-actions">
              <button className="kit-btn kit-btn--primary ob-next" disabled={!name.trim()} onClick={() => go()}>
                Let's go →
              </button>
            </div>
          </>
        )}

        {step === "show" && <WeekShow name={name} say={say} onNext={() => go()} />}

        {step === "account" && (
          <>
            <div className="ob-big">Your account</div>
            <p className="ob-sub">So your stuff is saved and my brain works. No password: I'll email you a link.</p>
            {acct.signedIn ? (
              <div className="ob-ok">✓ Signed in as {acct.email}</div>
            ) : !sent ? (
              <>
                <input className="ob-input" autoFocus type="email" value={email} placeholder="you@tcu.edu" onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} />
                {msg && <div className="ob-msg">{msg}</div>}
              </>
            ) : (
              <div className="ob-wait">
                <span className="ob-spin" />
                <div>
                  <b>Check your email</b> and tap <b>Log In</b>. On your phone works too. I'll notice the second you do.
                  <button className="ob-link" onClick={() => setSent(false)}>
                    Use a different email
                  </button>
                </div>
              </div>
            )}
            <div className="ob-actions">
              <button className="ob-skip" onClick={() => go(-1)}>
                ← Back
              </button>
              {acct.signedIn ? (
                <button className="kit-btn kit-btn--primary ob-next" onClick={() => go()}>
                  Next →
                </button>
              ) : !sent ? (
                <button className="kit-btn kit-btn--primary ob-next" disabled={busy} onClick={send}>
                  {busy ? "Sending…" : "Email me a link"}
                </button>
              ) : (
                <button className="ob-skip" onClick={() => go()}>
                  Skip for now
                </button>
              )}
            </div>
          </>
        )}

        {step === "classes" && (
          <>
            <div className="ob-big">Your classes</div>
            <p className="ob-sub">Type them however (like "Stats 2023, English Comp, Bio") and I'll sort them out.</p>
            <div className="ob-classes">
              <ClassesEditor
                store={store}
                courses={[]}
                say={say}
                onSave={async (s) => {
                  const r = await window.milo.kit.saveClasses(s.classes, s.active ?? s.classes[0]?.id ?? null);
                  setStore(r ?? s);
                  go();
                }}
              />
            </div>
            <div className="ob-actions">
              <button className="ob-skip" onClick={() => go(-1)}>
                ← Back
              </button>
              <button className="ob-skip" onClick={() => go()}>
                {store.classes.length ? "Next →" : "Skip for now"}
              </button>
            </div>
          </>
        )}

        {step === "perms" && (
          <>
            <div className="ob-big">Three switches</div>
            <p className="ob-sub">macOS asks once. Tap each one; it turns green the second it's on.</p>
            <div className="ob-perms">
              {PERMS.map((p) => {
                const on = perms[p.id];
                return (
                  <div key={p.id} className={`ob-perm ${on ? "ob-perm--on" : ""}`}>
                    <span className="ob-perm__check">{on ? "✓" : ""}</span>
                    <div className="ob-perm__body">
                      <b>{p.title}</b>
                      <span>{p.why}</span>
                    </div>
                    {!on && (
                      <button
                        className="kit-btn kit-btn--sm kit-btn--primary"
                        onClick={() => {
                          void window.milo.permAsk(p.id);
                          if (p.id === "screen") setAskedScreen(true);
                          if (p.id === "hands") void window.milo.permAsk("automation");
                        }}
                      >
                        Turn on
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            {askedScreen && !perms.screen && (
              <div className="ob-note">
                Flipped Screen Recording on? macOS needs me to restart for it to work.{" "}
                <button className="ob-link" onClick={() => window.milo.relaunch()}>
                  Restart Milo
                </button>
              </div>
            )}
            <div className="ob-actions">
              <button className="ob-skip" onClick={() => go(-1)}>
                ← Back
              </button>
              <button className={allOn ? "kit-btn kit-btn--primary ob-next" : "ob-skip"} onClick={() => go()}>
                {allOn ? "Next →" : "Skip for now"}
              </button>
            </div>
          </>
        )}

        {step === "d2l" && (
          <>
            <div className="ob-big">Connect D2L</div>
            <p className="ob-sub">I'll check it a few times a day and warn you before anything's due. Paste your D2L home page link from your browser.</p>
            <input className="ob-input" value={url} placeholder="https://d2l.yourschool.edu" onChange={(e) => setUrl(e.target.value.trim())} onKeyDown={(e) => e.key === "Enter" && url && (onPortal(url), setOpened(true))} />
            {opened && <div className="ob-note">Sign in in the window that opened, then come back and tap Done.</div>}
            <div className="ob-actions">
              <button className="ob-skip" onClick={() => go(-1)}>
                ← Back
              </button>
              {!opened ? (
                <>
                  <button className="ob-skip" onClick={() => go()}>
                    Skip for now
                  </button>
                  <button
                    className="kit-btn kit-btn--primary ob-next"
                    disabled={!/^(https?:\/\/)?[\w.-]+\.\w+/.test(url)}
                    onClick={() => {
                      onPortal(url);
                      setOpened(true);
                    }}
                  >
                    Open & sign in
                  </button>
                </>
              ) : (
                <button className="kit-btn kit-btn--primary ob-next" onClick={() => go()}>
                  Done →
                </button>
              )}
            </div>
          </>
        )}

        {step === "done" && (
          <>
            <div className="ob-big">You're set{name ? `, ${name}` : ""} 🎉</div>
            <p className="ob-sub">Talk to me anytime: start with "Milo…" or hold ⌘⇧Space.</p>
            <div className="ob-tries">
              <div className="ob-try">
                <span>🗓️</span>
                <div>
                  <b>"Milo, what's due this week?"</b>
                  <em>Everything coming up, from D2L.</em>
                </div>
              </div>
              <div className="ob-try">
                <span>🚀</span>
                <div>
                  <b>"Milo, start my stats homework."</b>
                  <em>Opens it and breaks it into small steps.</em>
                </div>
              </div>
              <div className="ob-try">
                <span>👀</span>
                <div>
                  <b>⌘⇧Y on any question</b>
                  <em>I jump to it and teach it step by step.</em>
                </div>
              </div>
            </div>
            <div className="ob-actions">
              <button className="kit-btn kit-btn--primary ob-next ob-next--wide" onClick={onDone}>
                Let's do this
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
