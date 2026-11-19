import { useEffect, useState } from "react";

// Milo account: sign in with a 6-digit email code. Lives as a chip in the chat header.
// Signed in = Milo's brain and voice run through the backend (no keys on the Mac) and his memory syncs.

export default function AccountChip() {
  const [acct, setAcct] = useState<{ signedIn: boolean; email: string }>({ signedIn: false, email: "" });
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [mem, setMem] = useState<string[]>([]);
  const [cooldown, setCooldown] = useState(0); // seconds before another email can be sent

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  useEffect(() => {
    window.milo.account().then(setAcct).catch(() => {});
    // Clicking Log In in the email signs Milo in from the browser.
    return window.milo.onAccountChange(async () => {
      setAcct(await window.milo.account());
      setStep("email");
      setCode("");
      setMsg("You're signed in.");
      setOpen(true);
    });
  }, []);
  useEffect(() => {
    if (open) window.milo.memories().then(setMem).catch(() => {});
  }, [open, acct.signedIn]);

  const send = async () => {
    if (busy || cooldown > 0) return;
    setBusy(true);
    setMsg("");
    const r = await window.milo.accountSend(email);
    setBusy(false);
    setMsg(r.text);
    setCooldown(60); // one email per minute, sent or not
    if (r.ok) setStep("code");
  };
  const verify = async () => {
    setBusy(true);
    const r = await window.milo.accountVerify(email, code);
    setBusy(false);
    setMsg(r.text);
    if (r.ok) {
      setAcct(await window.milo.account());
      setCode("");
      setStep("email");
    }
  };
  const out = async () => {
    setAcct(await window.milo.accountSignOut());
    setMsg("Signed out.");
  };
  const forget = async () => {
    await window.milo.forgetAll();
    setMem([]);
    setMsg("Milo forgot everything he'd learned about you.");
  };

  return (
    <span style={{ position: "relative" }}>
      <button className={`chip ${acct.signedIn ? "chip--on" : ""}`} onClick={() => setOpen((o) => !o)} title="Your Milo account">
        {acct.signedIn ? "Account ✓" : "Sign in"}
      </button>
      {open && (
        <div className="acct">
          {acct.signedIn ? (
            <>
              <div className="acct__row">Signed in as {acct.email}</div>
              <button className="chip" onClick={out}>Sign out</button>
            </>
          ) : step === "email" ? (
            <>
              <div className="acct__row">Sign in with your school email</div>
              <input
                className="acct__in"
                type="email"
                placeholder="you@tcu.edu"
                value={email}
                autoFocus
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && send()}
              />
              <button className="chip chip--on" disabled={busy || cooldown > 0} onClick={send}>
                {busy ? "Sending…" : cooldown > 0 ? `Wait ${cooldown}s` : "Email me a link"}
              </button>
            </>
          ) : (
            <>
              <div className="acct__row">Tap Log In in the email, on your phone or this Mac</div>
              <div className="acct__msg">Sent to {email}. Milo signs in by himself a second later.</div>
              <div className="acct__msg">Or paste the link (or a 6-digit code) here:</div>
              <input
                className="acct__in"
                placeholder="Link or code"
                value={code}
                autoFocus
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !busy && verify()}
              />
              <button className="chip chip--on" disabled={busy} onClick={verify}>
                {busy ? "Checking…" : "Sign in"}
              </button>
              <button className="chip" onClick={() => setStep("email")}>Back</button>
            </>
          )}
          {msg && <div className="acct__msg">{msg}</div>}
          <div className="acct__mem">
            <div className="acct__row">What Milo remembers ({mem.length})</div>
            {mem.length === 0 ? (
              <div className="acct__msg">Nothing yet. He learns as you talk.</div>
            ) : (
              <ul>
                {mem.slice(0, 12).map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            )}
            {mem.length > 0 && (
              <button className="chip chip--danger" onClick={forget}>Forget all</button>
            )}
          </div>
        </div>
      )}
    </span>
  );
}
