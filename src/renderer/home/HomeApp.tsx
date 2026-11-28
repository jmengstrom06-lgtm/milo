// Home base: Milo's real app window. Looks and works like ChatGPT/Claude, opens on your week,
// and it's the SAME Milo as the frog: what you type runs through his command router, and everything
// he does (steps, jobs, papers, lectures, undo) shows up here live.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { firstOffer } from "../decide";
import MiloFrog, { type FrogMood, type FrogOutfit } from "./MiloFrog";
import { levelSeen, markLevelSeen, OUTFITS, readGrowth, readMoments, setOutfit, unlocked, XP } from "./growth";
import ExamNight from "./ExamNight";
import ShareSheet, { type Moment } from "./Share";
import { demoOn, setDemo, withDemo } from "./demo";
import { WEEK_ASK } from "./weekFix";
import WeekPanel from "./WeekPanel";

// Home base talks to the Mac through M. In demo mode, reads come from a labeled sample student instead.
const DEMO = demoOn();
const M: Window["milo"] = DEMO ? withDemo(window.milo) : window.milo;

type Due = { title: string; course: string; due: string; due_iso?: string; kind?: string; url?: string };
type Klass = { id: string; name: string; code: string; subject: string; color: string };
type Grade = { name: string; grade: number | null };
type Msg = { role: "user" | "milo" | "work"; text: string; at: number };
type Chat = { id: string; title: string; classId: string | null; at: number; messages: Msg[] };
type Step = { text: string; at: number; state: "done" | "doing" };
type View = "today" | "chat" | "class" | "did" | "settings" | "milo";

const DAY = 86400e3;
const mono = "ui-monospace, 'SF Mono', Menlo, monospace";
const dotFor = (c?: Klass | null) => c?.color ?? "#6E6E78";
const pct = (n: number | null | undefined) => (n == null ? "—" : n.toFixed(1));
const whenShort = (iso?: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  const days = Math.floor((new Date(d.toDateString()).getTime() - new Date(new Date().toDateString()).getTime()) / DAY);
  if (days <= 0) return "TODAY";
  if (days === 1) return "TMRW";
  if (days < 7) return d.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase();
  return "NEXT";
};
const timeOf = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "");
const hoursUntil = (iso?: string) => (iso ? Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 3600e3)) : null);
const loadChats = (): Chat[] => {
  try {
    return JSON.parse(localStorage.getItem("milo.home.chats") || "[]");
  } catch {
    return [];
  }
};
const saveChats = (c: Chat[]) => {
  try {
    localStorage.setItem("milo.home.chats", JSON.stringify(c.slice(0, 60)));
  } catch {
    /* full */
  }
};

const I = {
  plus: <path d="M12 5v14M5 12h14" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </>
  ),
  cal: (
    <>
      <rect x="3.5" y="4.5" width="17" height="16" rx="3" />
      <path d="M3.5 9.5h17M8 3v3M16 3v3" />
    </>
  ),
  chat: <path d="M4 5.5h16v10H9l-5 4z" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </>
  ),
  clip: <path d="M20 11.5l-7.8 7.8a5 5 0 0 1-7.1-7.1l8.1-8.1a3.3 3.3 0 0 1 4.7 4.7l-8.1 8.1a1.7 1.7 0 0 1-2.4-2.4l7.5-7.5" />,
  screen: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </>
  ),
  up: <path d="M12 19V5M6 11l6-6 6 6" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  lock: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
  stop: <rect x="7" y="7" width="10" height="10" rx="1.5" />,
  star: <path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6-5.3-3-5.3 3 1.2-6L3.4 9.3l6-.7z" />,
};
const Ico = ({ d, size = 16, w = 1.8 }: { d: JSX.Element; size?: number; w?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d}
  </svg>
);

export default function HomeApp() {
  const [portal] = useState(() => localStorage.getItem("milo.portal") || (DEMO ? "demo.school.edu" : ""));
  const [view, setView] = useState<View>("today");
  const [classId, setClassId] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<null | "cmdk" | "voice">(null);
  const [due, setDue] = useState<Due[] | null>(null);
  // "Milo, what's next?": the week planner panel (opened from Today, chat, or the desktop frog)
  // the frog's "Fix it" on a checkup heads-up opens Settings, where the checkup list is
  useEffect(() => {
    const go = () => {
      try {
        const t = Number(localStorage.getItem("milo.openToday") || 0);
        if (Date.now() - t < 30e3) {
          localStorage.removeItem("milo.openToday");
          setView("today");
        }
      } catch {
        /* ignore */
      }
    };
    go();
    window.addEventListener("storage", go); // Home base already open: the frog's "Fix it" still brings you to Today
    window.addEventListener("focus", go);
    return () => {
      window.removeEventListener("storage", go);
      window.removeEventListener("focus", go);
    };
  }, []);
  const [weekOpen, setWeek] = useState(() => {
    try {
      const t = Number(localStorage.getItem("milo.openWeek") || 0);
      localStorage.removeItem("milo.openWeek");
      return Date.now() - t < 30e3;
    } catch {
      return false;
    }
  });
  const [dueErr, setDueErr] = useState<string | null>(null);
  const [classes, setClasses] = useState<Klass[]>([]);
  const [grades, setGrades] = useState<Grade[]>([]);
  const [acts, setActs] = useState<MiloActivity[]>([]);
  const [job, setJob] = useState<MiloJob | null>(null);
  const [paper, setPaper] = useState<{ stage: string; text: string; url?: string; step?: number; of?: number } | null>(null);
  const [lecture, setLecture] = useState<{ course: string; startedAt: number } | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [chats, setChats] = useState<Chat[]>(loadChats);
  const [chatId, setChatId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [toast, setToast] = useState<MiloActivity | null>(null);
  const [now, setNow] = useState(Date.now());
  const [voiceLines, setVoiceLines] = useState<{ who: "you" | "milo"; text: string }[]>([]);
  const [google, setGoogle] = useState<{ connected: boolean; email: string | null } | null>(null);
  const [d2l, setD2l] = useState<{ ok: boolean; via?: string } | null>(null);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [welcomed, setWelcomed] = useState(() => !!localStorage.getItem("milo.home.welcomed"));
  const [outfit, setOutfitState] = useState<FrogOutfit>(() => readGrowth().outfit);
  const [didFilter, setDidFilter] = useState<"all" | "undo" | MiloActivity["kind"]>("all");
  const [didSel, setDidSel] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [shareFirst, setShareFirst] = useState<string | null>(null);
  const [paused, setPaused] = useState<MiloPause | null>(null);
  const [perms, setPerms] = useState<{ mic: boolean; screen: boolean; hands: boolean } | null>(null);
  const [mems, setMems] = useState<string[] | null>(null);
  const [teach, setTeach] = useState("");
  const [prefs, setPrefsState] = useState<MiloPrefs | null>(null);
  const [acct, setAcct] = useState<{ signedIn: boolean; email: string } | null>(null);
  const [acctEmail, setAcctEmail] = useState("");
  const [acctCode, setAcctCode] = useState("");
  const [acctStep, setAcctStep] = useState<"email" | "code">("email");
  const [acctMsg, setAcctMsg] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [examNotes, setExamNotes] = useState<{ id: string; title: string; course: string; body: string; created: number }[]>([]);
  const [examSets, setExamSets] = useState(0);
  const [levelUp, setLevelUp] = useState<number | null>(null);
  const [levelFrom, setLevelFrom] = useState(1);
  const seenActs = useRef<string>("");
  const endRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // ---------------- data ----------------
  const loadDue = useCallback(async () => {
    if (!portal) return setDueErr("setup");
    const r = await M.d2lDue(portal).catch(() => null);
    if (r && r.ok) {
      setDue(r.items);
      setDueErr(null);
      void M.home.grades(portal).then(setGrades); // D2L is answering: make sure the grades are there too (cached = instant)
    } else setDueErr(r && !r.ok && r.signin ? "signin" : "offline");
  }, [portal]);
  useEffect(() => {
    void loadDue();
    void M.kit.classes().then((s: { classes?: Klass[] }) => setClasses(s?.classes ?? []));
    if (portal) void M.home.grades(portal).then(setGrades);
    void M.activity.list().then((a) => {
      setActs(a);
      seenActs.current = a[0]?.id ?? "";
    });
    void M.lecture.now().then((l) => l && setLecture({ course: l.course, startedAt: l.startedAt }));
    void M.google.status().then((g) => setGoogle(g));
    if (portal) void M.d2lCheck(portal).then((c) => setD2l({ ok: c.ok, via: c.via }));
    const t = window.setInterval(() => setNow(Date.now()), 30e3);
    const g = window.setInterval(() => portal && void M.home.grades(portal).then(setGrades), 10 * 60e3);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    const d = window.setInterval(() => void loadDue(), 10 * 60e3);
    return () => {
      window.clearInterval(t);
      window.clearInterval(g);
      window.clearInterval(d);
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, [loadDue, portal]);

  // Milo's live work, from the same agent as the frog
  useEffect(() => {
    const offs = [
      M.activity.onChange(() =>
        void M.activity.list().then((a) => {
          setActs(a);
          const fresh = a.find((x) => x.id !== seenActs.current && x.canUndo && Date.now() - x.at < 20e3);
          if (a[0]) seenActs.current = a[0].id;
          if (fresh) setToast(fresh);
        })
      ),
      M.onJob((j) => {
        setJob(j);
        const doing = j.steps.find((s) => s.status === "doing" || s.status === "retrying");
        if (doing) addStep(doing.do.split("\n")[0]);
        if (["done", "needs_you", "stuck", "stopped", "failed"].includes(j.status)) finishSteps(j.status === "done" ? j.summary || "Done" : j.question || j.status);
      }),
      M.onPaperProgress((p) => {
        setPaper(p.stage === "done" || p.stage === "error" ? null : p);
        if (p.stage === "done") finishSteps("Paper finished");
        else if (p.stage !== "error") addStep(p.text);
      }),
      M.onTaskStep((s) => s.say && addStep(s.say)),
      M.home.onEcho((e) => {
        if (e.kind === "said") {
          const text = String(e.payload ?? "");
          if (text) appendToChat({ role: "milo", text, at: Date.now() });
          setVoiceLines((v) => [...v.slice(-4), { who: "milo", text }]);
        } else if (e.kind === "heard") {
          const text = String(e.payload ?? "");
          setVoiceLines((v) => [...v.slice(-4), { who: "you", text }]);
          if (document.hasFocus()) appendToChat({ role: "user", text, at: Date.now() });
        } else if (e.kind === "week") {
          setView("today");
          setWeek(false);
          window.setTimeout(() => setWeek(true), 0);
        } else if (e.kind === "lecture") {
          const p = e.payload as { on: boolean; course?: string; startedAt?: number };
          setLecture(p.on ? { course: p.course ?? "", startedAt: p.startedAt ?? Date.now() } : null);
        }
      }),
    ];
    return () => offs.forEach((o) => o());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    void M.pause.get().then(setPaused);
    return M.pause.onChange(setPaused);
  }, []);
  useEffect(() => {
    if (view !== "settings") return;
    void M.perms().then(setPerms);
    void M.memories().then(setMems);
    void M.prefs.get().then(setPrefsState);
    void M.account().then(setAcct);
  }, [view]);
  useEffect(() => M.onAccountChange(() => void M.account().then(setAcct)), []);
  const setPref = (p: Partial<MiloPrefs>) => void M.prefs.set(p).then(setPrefsState);
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 7000);
    return () => window.clearTimeout(t);
  }, [toast]);

  // ---------------- live steps ----------------
  const addStep = (text: string) =>
    setSteps((s) => {
      const t = text.trim().replace(/…$/, "");
      if (!t || s[s.length - 1]?.text === t) return s;
      return [...s.map((x) => ({ ...x, state: "done" as const })), { text: t, at: Date.now(), state: "doing" as const }].slice(-12);
    });
  const finishSteps = (summary: string) =>
    setSteps((s) => {
      if (s.length) appendToChat({ role: "work", text: `${s.length} step${s.length > 1 ? "s" : ""} · ${summary}`, at: Date.now() });
      return [];
    });
  const working = !!(paper || lecture || (job && ["planning", "running", "checking"].includes(job.status)) || steps.some((s) => s.state === "doing" && now - s.at < 45e3));

  // ---------------- chats ----------------
  const chatIdRef = useRef<string | null>(null);
  chatIdRef.current = chatId;
  const appendToChat = (m: Msg) => {
    // Pick the chat first (outside the state update, which React may run twice)
    let id = chatIdRef.current;
    let fresh: Chat | null = null;
    if (!id) {
      if (m.role !== "user") return; // Milo talking to the frog, with no Home chat open: not a new chat
      id = `c${Date.now().toString(36)}`;
      chatIdRef.current = id;
      setChatId(id);
      fresh = { id, title: m.text.slice(0, 60), classId: null, at: Date.now(), messages: [] };
    }
    const target = id;
    setChats((all) => {
      const list = fresh && !all.some((c) => c.id === target) ? [fresh, ...all] : all;
      const next = list.map((c) => (c.id === target ? { ...c, at: Date.now(), messages: [...c.messages, m] } : c));
      saveChats(next);
      return next;
    });
  };
  const chat = chats.find((c) => c.id === chatId) ?? null;
  const send = (raw: string) => {
    const text = raw.trim();
    if (!text) return;
    if (paused?.on) {
      setDraft("");
      setView("chat");
      appendToChat({ role: "user", text, at: Date.now() });
      appendToChat({ role: "milo", text: "I'm paused right now, so I'm not looking at your screen, listening, or doing anything. Turn me back on (top of Today or in Settings) and ask again.", at: Date.now() + 1 });
      return;
    }
    if (WEEK_ASK.test(text)) {
      setDraft("");
      setOverlay(null);
      setView("today");
      setWeek(false);
      window.setTimeout(() => setWeek(true), 0);
      return;
    }
    setDraft("");
    setView("chat");
    setOverlay(null);
    appendToChat({ role: "user", text, at: Date.now() });
    setSteps([]);
    M.home.route(text);
  };
  const newChat = () => {
    setChatId(null);
    setView("chat");
    setSteps([]);
    window.setTimeout(() => inputRef.current?.focus(), 50);
  };
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [chat?.messages.length, steps.length]);

  // ---------------- derived ----------------
  const week = useMemo(
    () =>
      (due ?? [])
        .filter((d) => d.due_iso && new Date(d.due_iso).getTime() > now - 6 * 3600e3 && new Date(d.due_iso).getTime() < now + 10 * DAY)
        .sort((a, b) => (a.due_iso ?? "").localeCompare(b.due_iso ?? "")),
    [due, now]
  );
  const next = useMemo(() => firstOffer(week.map((d) => ({ ...d, urgent: d.due_iso ? new Date(d.due_iso).getTime() - now < 48 * 3600e3 : false })), now), [week, now]);
  const exam = week.find((d) => d.kind === "exam" && d.due_iso && new Date(d.due_iso).getTime() - now < 36 * 3600e3);
  const classOf = (name: string) => classes.find((c) => c.name === name || name.startsWith(c.name) || c.name.startsWith(name)) ?? null;
  // D2L just came back (signed in again, Chrome reopened): fill the grades in right away, don't wait 10 minutes
  const d2lWas = useRef<boolean | null>(null);
  useEffect(() => {
    const ok = d2l?.ok ?? null;
    if (ok && d2lWas.current === false && portal) void M.home.grades(portal, true).then(setGrades);
    d2lWas.current = ok;
  }, [d2l?.ok, portal]);
  const gradeOf = (name: string) => grades.find((g) => g.name === name || g.name.startsWith(name) || name.startsWith(g.name))?.grade ?? null;
  // ---- checkup: run on open and every 30 minutes; fixes rerun it ----
  const [check, setCheck] = useState<MiloCheckItem[] | null>(null);
  const [checking, setChecking] = useState(false);
  const runCheckup = useCallback(async () => {
    if (DEMO) return setCheck([]);
    setChecking(true);
    const r = await M.checkup(portal).catch(() => null);
    setChecking(false);
    if (r) setCheck(r);
  }, [portal]);
  useEffect(() => {
    void runCheckup();
    const t = window.setInterval(() => void runCheckup(), 30 * 60e3);
    return () => window.clearInterval(t);
  }, [runCheckup]);
  const fixCheck = async (i: MiloCheckItem) => {
    const k = i.fix?.kind;
    if (k === "sign-in") setView("settings");
    else if (k === "d2l") {
      if (portal) M.openUrl(portal.startsWith("http") ? portal : `https://${portal}`);
      else send("Help me connect my school's D2L");
    } else if (k === "unpause") {
      await M.pause.set(false).then(setPaused);
    } else if (k === "google" || k === "chrome") {
      const r = await M.checkupFix(k).catch(() => null);
      if (r?.text) setVoiceLines((v) => [...v.slice(-4), { who: "milo", text: r.text }]);
    } else if (k === "screen" || k === "hands" || k === "mic") await M.permAsk(k);
    window.setTimeout(() => void runCheckup(), k === "retry" ? 0 : 4000);
  };

  // tell Milo's brain what Home base knows, so chat can use it (never sent anywhere else)
  useEffect(() => {
    if (DEMO) return;
    M.setContext?.({ portal, classes: classes.map((c) => ({ name: c.name, grade: gradeOf(c.name) })) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portal, classes, grades]);
  const known = classes.map((c) => gradeOf(c.name)).filter((g): g is number => g != null);
  const avg = known.length ? known.reduce((a, b) => a + b, 0) / known.length : null;
  const thisWeek = week.filter((d) => new Date(d.due_iso!).getTime() < now + 7 * DAY);
  const dayStart = new Date(new Date(now).toDateString()).getTime();
  const nowPos = ((now - dayStart) / (7 * DAY)) * 100;
  const marks = thisWeek.map((d) => ({ d, left: ((new Date(d.due_iso!).getTime() - dayStart) / (7 * DAY)) * 100 })).filter((m) => m.left <= 100);
  const days = Array.from({ length: 7 }, (_, i) => new Date(dayStart + i * DAY).toLocaleDateString("en-US", { weekday: "short", day: "numeric" }).toUpperCase());
  const greeting = (() => {
    const h = new Date(now).getHours();
    const n = (localStorage.getItem("milo.name") || "").split(" ")[0];
    return `${h < 5 ? "Hey" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"}${n ? `, ${n}` : ""}.`;
  })();
  const sub = dueErr === "signin"
    ? "Your D2L sign-in ran out. Sign in to D2L in Chrome and I'll pick it up."
    : dueErr === "setup"
      ? "Connect your school's D2L and I'll keep track of everything due."
      : !due
        ? "Checking D2L…"
        : thisWeek.length
          ? `${thisWeek.length} thing${thisWeek.length > 1 ? "s" : ""} due this week.${next?.due_iso ? ` The first one is ${whenShort(next.due_iso) === "TODAY" ? "today" : whenShort(next.due_iso) === "TMRW" ? "tomorrow" : new Date(next.due_iso).toLocaleDateString("en-US", { weekday: "long" })}.` : ""}`
          : "Nothing due this week. You're all caught up.";
  const chips = [
    "What's next?",
    next ? `Start ${next.title}` : "What's due this week?",
    "Quiz me on my last lecture",
    classes[0] ? `What do I need on the ${classes[0].name} final?` : "What can you do?",
    "Write a paper on…",
  ];
  const cls = classes.find((c) => c.id === classId) ?? null;
  const running = [
    ...(paper ? [{ what: "Writing a paper", detail: paper.text, pct: paper.of ? ((paper.step ?? 0) / paper.of) * 100 : 20, live: true }] : []),
    ...(job && ["planning", "running", "checking"].includes(job.status)
      ? [{ what: job.goal.replace(/^In Chrome, /, "").slice(0, 70), detail: `${job.steps.filter((s) => s.status === "done").length}/${job.steps.length} steps`, pct: job.steps.length ? (job.steps.filter((s) => s.status === "done").length / job.steps.length) * 100 : 10, live: true }]
      : []),
    ...(lecture ? [{ what: `Listening${lecture.course ? ` · ${lecture.course}` : ""}`, detail: `${Math.max(1, Math.round((now - lecture.startedAt) / 60e3))} min · notes after class`, pct: 100, live: true }] : []),
  ];
  const lastDone = acts.find((a) => now - a.at < 6 * 3600e3);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const growth = useMemo(() => readGrowth(new Date(now)), [now, view]);
  const moments = useMemo(() => readMoments(), [view, now]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const seen = levelSeen(growth.level);
    if (growth.level > seen) {
      setLevelFrom(seen);
      setLevelUp(growth.level);
    }
  }, [growth.level]);
  const examCls = exam ? classOf(exam.course) : null;
  useEffect(() => {
    if (!exam) return;
    const first = exam.course.split(" ")[0];
    void M.kit.notes().then((n) => setExamNotes(n.filter((x) => x.course === exam.course || x.course.startsWith(first))));
    if (examCls) void M.lib.list({ classId: examCls.id, app: "study" }).then((l) => setExamSets(l.length));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exam?.title, examCls?.id]);
  const laterDue = (due ?? []).filter((d) => d.due_iso && new Date(d.due_iso).getTime() >= now + 7 * DAY).sort((a, b) => (a.due_iso ?? "").localeCompare(b.due_iso ?? "")).slice(0, 3);
  const heroMood: FrogMood = paused?.on
    ? "sleep"
    : !online
    ? "sleep"
    : dueErr
      ? "worried"
      : working
        ? "think"
        : exam
          ? "focus"
          : due && !thisWeek.length
            ? "happy"
            : "wave";
  const shareMoments: Moment[] = [
    ...(growth.streak
      ? [{ id: "streak", kicker: "STUDY STREAK", big: `${growth.streak} day${growth.streak === 1 ? "" : "s"} in a row.`, small: "Locked in every single day", mood: "celebrate" as FrogMood, from: "#5B2FB0", to: "#2A1452" }]
      : []),
    { id: "level", kicker: "LEVEL UP", big: `Milo hit level ${growth.level}.`, small: `${growth.name} · ${growth.xp} XP from real studying`, mood: "happy", from: "#2F8F6A", to: "#123826" },
    ...(growth.stepsDone
      ? [{ id: "steps", kicker: "GETTING IT DONE", big: `${growth.stepsDone} step${growth.stepsDone === 1 ? "" : "s"} finished.`, small: "One small step at a time", mood: "write" as FrogMood, from: "#C4652F", to: "#4A2112" }]
      : []),
  ];
  const pickOutfit = (id: FrogOutfit) => {
    if (!unlocked(growth.level, id)) return;
    setOutfit(id);
    setOutfitState(id);
  };
  const dismissWelcome = () => {
    try {
      localStorage.setItem("milo.home.welcomed", String(Date.now()));
    } catch {
      /* full */
    }
    setWelcomed(true);
  };

  // ---------------- keys ----------------
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.metaKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOverlay((o) => (o === "cmdk" ? null : "cmdk"));
      } else if (e.metaKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        newChat();
      } else if (e.key === "Escape") setOverlay(null);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startNext = (kind: "together" | "do" | "teach") => {
    if (!next) return;
    setView("chat");
    setChatId(null);
    chatIdRef.current = null;
    appendToChat({ role: "user", text: kind === "together" ? `Help me do ${next.title}` : kind === "teach" ? `Teach me what I need for ${next.title}` : `Do ${next.title} for me`, at: Date.now() });
    setSteps([]);
    M.home.action({ kind, item: { title: next.title, course: next.course, due: next.due } });
  };
  const stopAll = () => {
    M.stopTask();
    void M.jobStop();
    void M.paperStop();
  };
  const openVoice = () => {
    setVoiceLines([]);
    setOverlay("voice");
    M.home.talk();
  };

  // ---------------- render ----------------
  return (
    <div className="hb">
      {working && <div className="hb-edge" aria-hidden="true" />}
      <aside className="hb-side">
        <div className="hb-brand">
          <MiloFrog size={30} outfit={outfit} mood={paused?.on ? "sleep" : working ? "think" : "idle"} />
          <span className="hb-word">milo</span>
        </div>
        <button className="hb-new" onClick={newChat}>
          <Ico d={I.plus} />
          <span>New chat</span>
          <kbd>⌘N</kbd>
        </button>
        <button className="hb-search" onClick={() => setOverlay("cmdk")}>
          <Ico d={I.search} />
          <span>Search or do anything</span>
          <kbd>⌘K</kbd>
        </button>
        <nav className="hb-nav" aria-label="Main">
          <button className={view === "today" ? "on" : ""} onClick={() => setView("today")}>
            <Ico d={I.cal} />
            <span>Today</span>
            {thisWeek.length > 0 && <em>{thisWeek.length}</em>}
          </button>
          <button className={view === "chat" ? "on" : ""} onClick={() => setView("chat")}>
            <Ico d={I.chat} />
            <span>Chat with Milo</span>
            {working && <i className="hb-live" aria-label="working" />}
          </button>
          <button className={view === "did" ? "on" : ""} onClick={() => setView("did")}>
            <Ico d={I.clock} />
            <span>What Milo did</span>
          </button>
          <button className={view === "settings" ? "on" : ""} onClick={() => setView("settings")}>
            <Ico d={I.gear} />
            <span>Settings</span>
          </button>
        </nav>
        <div className="hb-group">
          <div className="hb-label">CLASSES</div>
          {classes.map((c) => (
            <button
              key={c.id}
              className={`hb-cls ${view === "class" && classId === c.id ? "on" : ""}`}
              onClick={() => {
                setClassId(c.id);
                setView("class");
              }}
            >
              <i style={{ background: dotFor(c) }} aria-hidden="true" />
              <span>{c.name}</span>
              <b>{pct(gradeOf(c.name))}</b>
            </button>
          ))}
          {!classes.length && <p className="hb-empty">Classes show up once D2L is connected.</p>}
        </div>
        <div className="hb-group hb-recent">
          <div className="hb-label">RECENT</div>
          {chats.slice(0, 8).map((c) => (
            <button
              key={c.id}
              className={chatId === c.id && view === "chat" ? "on" : ""}
              onClick={() => {
                setChatId(c.id);
                setView("chat");
              }}
            >
              <span>{c.title}</span>
            </button>
          ))}
        </div>
        <div className="hb-me">
          <div className="hb-avatar" aria-hidden="true">
            {(localStorage.getItem("milo.name") || "You").slice(0, 2).toUpperCase()}
          </div>
          <div className="hb-mename">
            <b>{localStorage.getItem("milo.name") || "You"}</b>
            <span>{d2l?.ok ? `D2L via ${d2l.via === "chrome" ? "Chrome" : "Milo"}` : "D2L not connected"}</span>
          </div>
          <button className="hb-ico" aria-label="Settings" onClick={() => setView("settings")}>
            <Ico d={I.gear} size={17} w={1.7} />
          </button>
        </div>
      </aside>

      <main className="hb-main">
        <header className="hb-top">
          <div className="hb-crumb">
            {view === "today" && `TODAY  ·  ${new Date(now).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }).toUpperCase()}  ·  ${new Date(now).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`}
            {view === "chat" && `CHAT  ·  ${(chat?.title ?? "NEW").toUpperCase()}`}
            {view === "class" && `CLASSES  ·  ${(cls?.name ?? "").toUpperCase()}`}
            {view === "did" && "WHAT MILO DID"}
            {view === "settings" && "SETTINGS"}
            {view === "milo" && "MILO'S ROOM"}
          </div>
          <div className="hb-pills">
            <span className="hb-pill">
              <i style={{ background: d2l?.ok ? "#3DD68C" : "#F2555A" }} />
              D2L
            </span>
            <span className="hb-pill">
              <i style={{ background: google?.connected ? "#3DD68C" : "#5A5A63" }} />
              Google
            </span>
            <button className="hb-pill hb-btnpill" onClick={() => send("Lock in for 50 minutes")}>
              <Ico d={I.lock} size={13} w={2} />
              Lock in
            </button>
          </div>
        </header>

        <div className="hb-scroll">
          {DEMO && (
            <div className="hb-demobar" role="status">
              <b>DEMO</b> Sample student, fake classes. Nothing real is read or changed.
              <button className="hb-link" onClick={() => setDemo(false)}>
                Exit demo
              </button>
            </div>
          )}
          {/* ================= TODAY ================= */}
          {view === "today" && exam && !showAll && !paused?.on && (
            <div className="hb-page">
              <ExamNight
                exam={exam}
                color={dotFor(examCls)}
                notes={examNotes}
                sets={examSets}
                hidden={Math.max(0, thisWeek.length - 1)}
                outfit={outfit}
                onSend={send}
                onShowAll={() => setShowAll(true)}
              />
            </div>
          )}
          {view === "today" && !(exam && !showAll && !paused?.on) && (
            <div className="hb-page hb-rise">
              {exam && (
                <section className="hb-exam" aria-label="Exam coming up">
                  <div>
                    <div className="hb-kicker">EXAM NIGHT</div>
                    <h2>
                      {exam.title} · {exam.course}
                    </h2>
                    <p>
                      {timeOf(exam.due_iso)} {whenShort(exam.due_iso) === "TMRW" ? "tomorrow" : "today"}. Everything else can wait.
                    </p>
                  </div>
                  <div className="hb-row">
                    <button className="hb-primary" onClick={() => send(`Make me a study plan for ${exam.title} in ${exam.course} tonight`)}>
                      Plan tonight
                    </button>
                    <button className="hb-ghost" onClick={() => send(`Quiz me for ${exam.title} in ${exam.course}`)}>
                      Quiz me
                    </button>
                  </div>
                </section>
              )}

              {!paused?.on && <Checkup items={check} busy={checking} onFix={(i) => void fixCheck(i)} onRun={() => void runCheckup()} />}
              {weekOpen && !paused?.on && (
                <WeekPanel
                  M={M}
                  due={due}
                  demo={DEMO}
                  googleOn={!!google?.connected}
                  dueErr={dueErr}
                  outfit={outfit}
                  onClose={() => setWeek(false)}
                  onConnect={() => void M.google.connect().then(() => M.google.status().then(setGoogle))}
                  onSay={(t) => setVoiceLines((v) => [...v.slice(-4), { who: "milo", text: t }])}
                />
              )}
              {paused?.on && (
                <section className="hb-state hb-state-paused" role="status">
                  <MiloFrog size={64} mood="sleep" outfit={outfit} />
                  <div>
                    <b>Milo is paused{paused.until ? ` until ${new Date(paused.until).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}` : ""}</b>
                    <span>He isn't looking at your screen, listening, or running anything. Your stuff below is just what D2L already said.</span>
                  </div>
                  <button className="hb-primary hb-sm" onClick={() => void M.pause.set(false).then(setPaused)}>
                    Turn Milo back on
                  </button>
                </section>
              )}
              {!online && (
                <section className="hb-state hb-state-off" role="status">
                  <MiloFrog size={64} mood="sleep" outfit={outfit} />
                  <div>
                    <b>You're offline. I'm still here.</b>
                    <span>Lock in, timers, your notes and flashcards still work. Chat, homework help and D2L wait for wifi, and anything I was doing picks up where it left off.</span>
                  </div>
                  <button className="hb-ghost hb-sm" onClick={() => send("Lock in for 50 minutes")}>
                    Lock in offline
                  </button>
                </section>
              )}
              {online && (dueErr === "signin" || dueErr === "setup" || d2l?.ok === false) && (
                <section className="hb-state hb-state-warn" role="status">
                  <MiloFrog size={64} mood="worried" outfit={outfit} />
                  <div>
                    <b>{dueErr === "setup" ? "Connect D2L so I can watch your due dates" : "D2L signed me out"}</b>
                    <span>{dueErr === "setup" ? "Once it's connected I'll catch every due date, even the ones the calendar misses." : "Your login expired, so due dates below might be out of date. Sign in to D2L in Chrome and I'll pick it right back up."}</span>
                  </div>
                  <button
                    className="hb-primary hb-sm"
                    onClick={() =>
                      portal
                        ? (M.openUrl(portal.startsWith("http") ? portal : `https://${portal}`), window.setTimeout(() => void loadDue(), 45e3))
                        : send("Help me connect my school's D2L")
                    }
                  >
                    {dueErr === "setup" ? "Connect D2L" : "Sign back in"}
                  </button>
                </section>
              )}
              {online && !welcomed && due && !dueErr && (
                <section className="hb-wow" aria-label="Milo read your D2L">
                  <MiloFrog size={120} mood="celebrate" outfit={outfit} />
                  <div className="hb-wowtext">
                    <div className="hb-kicker hb-purple">I JUST READ YOUR D2L</div>
                    <h2>
                      {thisWeek.length
                        ? `You've got ${thisWeek.length} thing${thisWeek.length > 1 ? "s" : ""} due this week.${next ? ` The first one is ${next.title}.` : ""}`
                        : "Nothing due this week. Nice."}
                    </h2>
                    <p>{next ? "Want me to start it with you? I'll split it into small steps, and nothing gets turned in without your yes." : "Want to get ahead while it's quiet?"}</p>
                    <div className="hb-row">
                      {next && (
                        <button className="hb-primary" onClick={() => (dismissWelcome(), startNext("together"))}>
                          Start it together
                        </button>
                      )}
                      <button className="hb-ghost" onClick={dismissWelcome}>
                        {next ? "Show me Home base" : "Got it"}
                      </button>
                    </div>
                  </div>
                </section>
              )}

              <div className="hb-hello">
                <div className="hb-hellome">
                  <button className="hb-frogbtn" aria-label="Open Milo's room" onClick={() => setView("milo")}>
                    <MiloFrog size={108} mood={heroMood} outfit={outfit} />
                  </button>
                  <div>
                    <h1>{greeting}</h1>
                    <p>{sub}</p>
                    <button className="hb-lvpill" onClick={() => setView("milo")}>
                      Level {growth.level} · {growth.streak ? `${growth.streak}-day streak` : "start a streak today"} · {growth.toNext ? `${growth.toNext} XP to level ${growth.level + 1}` : "max level"}
                    </button>
                  </div>
                </div>
                <div className="hb-stats">
                  <div>
                    <b>{due ? thisWeek.length : "—"}</b>
                    <span>DUE THIS WEEK</span>
                  </div>
                  <div>
                    <b>
                      {avg == null ? "—" : avg.toFixed(1)}
                      {avg != null && <small>%</small>}
                    </b>
                    <span>AVERAGE GRADE</span>
                  </div>
                  <div>
                    <b>{acts.filter((a) => now - a.at < DAY && !a.undone).length}</b>
                    <span>DONE FOR YOU TODAY</span>
                  </div>
                </div>
              </div>

              {online && welcomed && !dueErr && due && !thisWeek.length && (
                <section className="hb-clear" aria-label="Nothing due this week">
                  <MiloFrog size={96} mood="happy" outfit={outfit} />
                  <div className="hb-cleartext">
                    <h2>You're clear for the next 7 days.</h2>
                    <p>{growth.streak ? `Want to get ahead while it's quiet? A 10-minute lock-in keeps your ${growth.streak}-day streak alive.` : "Want to get ahead while it's quiet?"}</p>
                    <div className="hb-clearlist">
                      {laterDue.map((d) => (
                        <button key={d.title + d.due} onClick={() => send(`Start ${d.title} for ${d.course}`)}>
                          <span>Get ahead on {d.title}</span>
                          <em>{new Date(d.due_iso!).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</em>
                        </button>
                      ))}
                      <button onClick={() => send("Quiz me on my last lecture")}>
                        <span>Quiz me on my last lecture</span>
                        <em>6 questions</em>
                      </button>
                      <button onClick={() => send("Lock in for 25 minutes")}>
                        <span>Lock in for 25 minutes</span>
                        <em>+{XP.focusDay} XP</em>
                      </button>
                    </div>
                  </div>
                </section>
              )}

              <section className="hb-card hb-live-card" aria-label="Milo, live">
                <div className="hb-cardhead">
                  <span className="hb-kicker hb-purple">
                    <i className={working ? "hb-live" : "hb-idle"} aria-hidden="true" />
                    MILO · {paused?.on ? "PAUSED" : working ? "LIVE" : "READY"}
                  </span>
                  <span className="hb-muted">{running.length ? `${running.length} running` : "Say or type anything"}</span>
                </div>
                {running.map((r, i) => (
                  <div className="hb-job" key={i}>
                    <span className="hb-spin" aria-hidden="true" />
                    <span className="hb-jobtext">
                      <b>{r.what}</b>
                      <em> · {r.detail}</em>
                    </span>
                    <span className="hb-bar" aria-hidden="true">
                      <i style={{ width: `${Math.max(6, Math.min(100, r.pct))}%` }} />
                    </span>
                    <button className="hb-mini" onClick={() => setView("chat")}>
                      Watch
                    </button>
                  </div>
                ))}
                <div className="hb-job">
                  <span className="hb-dotok" aria-hidden="true" />
                  <span className="hb-jobtext">
                    <b>Keeping an eye on D2L</b>
                    <em> · warns you before anything's due</em>
                  </span>
                  <span className="hb-bar" aria-hidden="true">
                    <i style={{ width: "100%", background: "#2E2A3D" }} />
                  </span>
                  <span />
                </div>
                {lastDone && (
                  <div className="hb-job">
                    <span className="hb-check" aria-hidden="true">
                      <Ico d={I.check} size={14} w={2.4} />
                    </span>
                    <span className="hb-jobtext">
                      <b>{lastDone.title}</b>
                      <em> · {new Date(lastDone.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</em>
                    </span>
                    <span className="hb-bar" aria-hidden="true">
                      <i style={{ width: "100%", background: "#3DD68C" }} />
                    </span>
                    {lastDone.link ? (
                      <button className="hb-mini" onClick={() => M.openUrl(lastDone.link!)}>
                        Open
                      </button>
                    ) : (
                      <span />
                    )}
                  </div>
                )}
              </section>

              <section className="hb-card" aria-label="The week">
                <div className="hb-cardhead">
                  <span className="hb-kicker">THE WEEK</span>
                  <span className="hb-muted">Deadlines move closer as the week goes</span>
                </div>
                <div className="hb-time">
                  <div className="hb-track" />
                  <div className="hb-past" style={{ width: `${nowPos}%` }} />
                  {days.map((d, i) => (
                    <div key={d} className="hb-day" style={{ left: `${(i * 100) / 7}%`, color: i === 0 ? "#C4B5FD" : undefined }}>
                      {d}
                    </div>
                  ))}
                  <div className="hb-now" style={{ left: `${nowPos}%` }}>
                    <i />
                    <span>NOW</span>
                  </div>
                  {due && !marks.length && <div className="hb-timeempty">Nothing due this week</div>}
                  {marks.map(({ d, left }, i) => (
                    <button key={i} className="hb-mark" style={{ left: `${left}%`, top: i % 2 ? 58 : 41 }} onClick={() => send(`Make a game plan for ${d.title} in ${d.course}`)} title={`${d.title} · ${d.course}`}>
                      <i style={{ borderColor: dotFor(classOf(d.course)) }} />
                      <span>{d.title.length > 22 ? `${d.title.slice(0, 21)}…` : d.title}</span>
                    </button>
                  ))}
                </div>
              </section>

              <div className="hb-grid">
                <section className="hb-next" aria-label="Next up">
                  {next ? (
                    <>
                      <div className="hb-nextmain">
                        <div className="hb-kicker hb-purple">NEXT UP</div>
                        <h2>{next.title}</h2>
                        <div className="hb-meta">
                          <span>
                            <i style={{ background: dotFor(classOf(next.course)) }} />
                            {next.course}
                          </span>
                          <span>Due {next.due}</span>
                        </div>
                        <p>I can do it for you, help you do it, or teach it first. You always turn it in yourself.</p>
                        <div className="hb-row">
                          <button className="hb-primary" onClick={() => startNext("do")}>
                            Do it for me
                          </button>
                          <button className="hb-ghost" onClick={() => startNext("together")}>
                            Help me do it
                          </button>
                          <button className="hb-ghost" onClick={() => startNext("teach")}>
                            Teach me first
                          </button>
                        </div>
                      </div>
                      <div className="hb-count">
                        <b>
                          {hoursUntil(next.due_iso) != null && hoursUntil(next.due_iso)! >= 48 ? Math.round(hoursUntil(next.due_iso)! / 24) : hoursUntil(next.due_iso)}
                          <small>{hoursUntil(next.due_iso) != null && hoursUntil(next.due_iso)! >= 48 ? "d" : "h"}</small>
                        </b>
                        <span>UNTIL DUE</span>
                      </div>
                    </>
                  ) : (
                    <div className="hb-nextmain">
                      <div className="hb-kicker hb-purple">NEXT UP</div>
                      <h2>{dueErr ? "Connect D2L" : due ? "You're all caught up" : "Checking D2L…"}</h2>
                      <p>{dueErr ? sub : "Nothing due soon. Want to get ahead? Ask me to quiz you on your last lecture."}</p>
                    </div>
                  )}
                </section>

                <section className="hb-card" aria-label="Grades">
                  <div className="hb-cardhead">
                    <span className="hb-kicker">GRADES</span>
                    <span className="hb-muted">from D2L</span>
                  </div>
                  {classes.map((c) => (
                    <button
                      key={c.id}
                      className="hb-grade"
                      onClick={() => {
                        setClassId(c.id);
                        setView("class");
                      }}
                    >
                      <i style={{ background: dotFor(c) }} aria-hidden="true" />
                      <span>{c.name}</span>
                      <b>{pct(gradeOf(c.name))}</b>
                    </button>
                  ))}
                </section>
              </div>

              <div className="hb-grid2">
                <section className="hb-card" aria-label="This week">
                  <div className="hb-cardhead">
                    <span className="hb-kicker">COMING UP</span>
                    <span className="hb-muted">tap one for a game plan</span>
                  </div>
                  {week.slice(0, 7).map((d, i) => (
                    <button key={i} className="hb-due" onClick={() => send(`Make a game plan for ${d.title} in ${d.course}`)}>
                      <span className="hb-when" style={{ color: whenShort(d.due_iso) === "TODAY" || whenShort(d.due_iso) === "TMRW" ? "#F5B544" : undefined }}>
                        {whenShort(d.due_iso)}
                      </span>
                      <i style={{ background: dotFor(classOf(d.course)) }} aria-hidden="true" />
                      <span className="hb-duetext">
                        <b>{d.title}</b>
                        <em>{d.course}</em>
                      </span>
                      <span className="hb-time2">{timeOf(d.due_iso)}</span>
                    </button>
                  ))}
                  {due && !week.length && <p className="hb-empty">Nothing due in the next 10 days.</p>}
                </section>
                <ActList acts={acts.slice(0, 5)} title="WHAT MILO DID" onAll={() => setView("did")} />
              </div>
            </div>
          )}

          {/* ================= CHAT ================= */}
          {view === "chat" && (
            <div className="hb-chat hb-rise">
              <div className="hb-thread">
                {!chat?.messages.length && !steps.length && (
                  <div className="hb-hero">
                    <MiloFrog size={110} mood={working ? "think" : "wave"} outfit={outfit} />
                    <h2>What should we get done?</h2>
                    <p>I can see your classes, your due dates and your notes, and I can do the work, not just talk about it.</p>
                  </div>
                )}
                {chat?.messages.map((m, i) =>
                  m.role === "user" ? (
                    <div key={i} className="hb-you">
                      {m.text}
                    </div>
                  ) : m.role === "work" ? (
                    <div key={i} className="hb-workdone">
                      <Ico d={I.check} size={13} w={2.4} />
                      {m.text}
                    </div>
                  ) : (
                    <div key={i} className="hb-milo">
                      <div className="hb-mav" aria-hidden="true">
                        <MiloFrog size={34} mood="happy" outfit={outfit} />
                      </div>
                      <div className="hb-mtext">
                        <p>{m.text}</p>
                        <div className="hb-tools">
                          <button className="hb-ico" aria-label="Copy" onClick={() => void navigator.clipboard.writeText(m.text)}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                              <rect x="9" y="9" width="11" height="11" rx="2" />
                              <path d="M5 15V5h10" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                )}
                {steps.length > 0 && (
                  <div className="hb-steps" aria-live="polite">
                    {steps.map((s, i) => (
                      <div key={i} className={`hb-step ${s.state}`}>
                        {s.state === "done" ? <Ico d={I.check} size={13} w={2.6} /> : <span className="hb-spin" aria-hidden="true" />}
                        <span>{s.text}</span>
                      </div>
                    ))}
                  </div>
                )}
                <div ref={endRef} />
              </div>
              {(working || steps.length > 0) && (
                <aside className="hb-watch" aria-label="Milo is working">
                  <div className="hb-cardhead">
                    <span className="hb-kicker hb-purple">
                      <i className="hb-live" aria-hidden="true" />
                      WATCH MILO WORK
                    </span>
                  </div>
                  <div className="hb-watchlog">
                    {steps.slice(-6).map((s, i) => (
                      <div key={i} className={s.state}>
                        <span>{new Date(s.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" })}</span>
                        {s.text}
                      </div>
                    ))}
                    {!steps.length && <div className="doing">{running[0]?.what ?? "Working…"}</div>}
                  </div>
                  <div className="hb-row">
                    <button className="hb-ghost hb-sm" onClick={stopAll}>
                      <Ico d={I.stop} size={13} /> Stop
                    </button>
                    <button className="hb-ghost hb-sm" onClick={stopAll}>
                      Take over
                    </button>
                  </div>
                  {paper?.url && (
                    <button className="hb-ghost hb-sm" onClick={() => M.openUrl(paper.url!)}>
                      Open the Google Doc
                    </button>
                  )}
                </aside>
              )}
            </div>
          )}

          {/* ================= CLASS ================= */}
          {view === "class" && cls && <ClassPage cls={cls} grade={gradeOf(cls.name)} due={(due ?? []).filter((d) => classOf(d.course)?.id === cls.id)} chats={chats.filter((c) => c.title.toLowerCase().includes(cls.name.split(" ")[0].toLowerCase()))} onAsk={send} onChat={(id) => (setChatId(id), setView("chat"))} />}

          {/* ================= WHAT MILO DID ================= */}
          {view === "did" && (
            <DidPage
              acts={acts}
              now={now}
              filter={didFilter}
              setFilter={setDidFilter}
              sel={didSel}
              setSel={setDidSel}
              outfit={outfit}
            />
          )}

          {/* ================= MILO'S ROOM ================= */}
          {view === "milo" && (
            <div className="hb-page hb-rise">
              <section className="hb-room" aria-label="Milo">
                <MiloFrog size={230} mood={growth.level > 1 ? "happy" : "wave"} outfit={outfit} title="Milo" />
                <div className="hb-roomtext">
                  <div className="hb-bubble">
                    {growth.xp
                      ? `We've done ${growth.stepsDone} step${growth.stepsDone === 1 ? "" : "s"} and ${growth.focusDays} lock-in day${growth.focusDays === 1 ? "" : "s"} together. ${growth.toNext ? `${growth.toNext} more XP and I hit level ${growth.level + 1}.` : "I'm maxed out. Legend."}`
                      : "Finish one step of a game plan or lock in for 10 minutes and I start growing."}
                  </div>
                  <div className="hb-roomname">
                    <h1>Milo</h1>
                    <span>
                      Level {growth.level} · {growth.name}
                    </span>
                  </div>
                  <div className="hb-xp">
                    <span className="hb-xpbar" aria-hidden="true">
                      <i style={{ width: `${Math.round(growth.pct * 100)}%` }} />
                    </span>
                    <b>{growth.toNext ? `${growth.xp - growth.floor} / ${growth.ceil - growth.floor} XP` : `${growth.xp} XP`}</b>
                  </div>
                  <div className="hb-row">
                    <button className="hb-primary" onClick={() => send("Lock in for 45 minutes")}>
                      Lock in for {XP.focusDay} XP
                    </button>
                    {next && (
                      <button className="hb-ghost" onClick={() => startNext("together")}>
                        Start {next.title}
                      </button>
                    )}
                    <button className="hb-ghost" onClick={() => setSharing(true)}>
                      Share Milo
                    </button>
                  </div>
                </div>
              </section>

              <div className="hb-grid2">
                <section className="hb-card" aria-label="Wardrobe">
                  <div className="hb-cardhead">
                    <span className="hb-kicker">WARDROBE</span>
                    <span className="hb-muted">Earned by real studying, never bought</span>
                  </div>
                  <div className="hb-wardrobe" role="radiogroup" aria-label="Milo's outfit">
                    {OUTFITS.map((o) => {
                      const open = unlocked(growth.level, o.id);
                      return (
                        <button key={o.id} role="radio" aria-checked={outfit === o.id} aria-disabled={!open} className={`hb-outfit ${outfit === o.id ? "on" : ""} ${open ? "" : "locked"}`} onClick={() => pickOutfit(o.id)}>
                          <MiloFrog size={78} outfit={o.id} />
                          <b>{o.label}</b>
                          <span>{open ? (outfit === o.id ? "Wearing" : "Unlocked") : o.how}</span>
                        </button>
                      );
                    })}
                  </div>
                </section>

                <section className="hb-card" aria-label="Streak">
                  <div className="hb-cardhead">
                    <span className="hb-kicker">STREAK</span>
                    <span className="hb-muted">days with 10+ focused minutes</span>
                  </div>
                  <div className="hb-streak">
                    <b>{growth.streak}</b>
                    <span>day{growth.streak === 1 ? "" : "s"}</span>
                  </div>
                  <div className="hb-week">
                    {growth.week.map((d, i) => (
                      <div key={i} className={`hb-sday ${d.on ? "on" : ""} ${d.today ? "today" : ""}`}>
                        <i aria-hidden="true" />
                        <span>{d.label}</span>
                      </div>
                    ))}
                  </div>
                  <p className="hb-muted">{growth.week[6].on ? "Today counts. See you tomorrow." : "Lock in for 10 minutes today to keep it going."}</p>
                </section>
              </div>

              <section className="hb-card" aria-label="How Milo grows">
                <div className="hb-cardhead">
                  <span className="hb-kicker">HOW MILO GROWS</span>
                </div>
                <div className="hb-set">
                  <div>
                    <b>Finish a step of a game plan</b>
                  </div>
                  <em className="hb-plus">+{XP.step}</em>
                </div>
                <div className="hb-set">
                  <div>
                    <b>Lock in for 10+ minutes in a day</b>
                  </div>
                  <em className="hb-plus">+{XP.focusDay}</em>
                </div>
                <p className="hb-muted">Opening the app doesn't count, and neither does “Do it for me.”</p>
              </section>

              <section className="hb-card" aria-label="Moments Milo remembers">
                <div className="hb-cardhead">
                  <span className="hb-kicker">MOMENTS MILO REMEMBERS</span>
                  <span className="hb-muted">tap one to share it</span>
                </div>
                {moments.map((m) => (
                  <div key={m.id} className="hb-moment">
                    <MiloFrog size={48} mood={m.mood} outfit={outfit} />
                    <div>
                      <b>{m.what}</b>
                      <span>{m.when}</span>
                    </div>
                    <button className="hb-mini" onClick={() => (setShareFirst(m.id), setSharing(true))}>
                      Share
                    </button>
                  </div>
                ))}
                {!moments.length && <p className="hb-muted">Your first finished game plan or lock-in shows up here.</p>}
              </section>
            </div>
          )}

          {/* ================= SETTINGS ================= */}
          {view === "settings" && (
            <div className="hb-page hb-rise hb-settings">
              <h1 className="hb-h1">Settings</h1>

              {/* checkup first: "Fix it" lands here, and the Pause switch below must never be the first thing under your finger */}
              <Checkup all items={check} busy={checking} onFix={(i) => void fixCheck(i)} onRun={() => void runCheckup()} />

              <section className={`hb-pause ${paused?.on ? "on" : ""}`} aria-label="Pause Milo">
                <MiloFrog size={84} mood={paused?.on ? "sleep" : "happy"} outfit={outfit} />
                <div className="hb-pausetext">
                  <b>{paused?.on ? `Milo is paused${paused.until ? ` until ${new Date(paused.until).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}` : ""}` : "Milo is on"}</b>
                  <span>
                    {paused?.on
                      ? "He isn't looking at your screen, listening, or running anything. Jobs that were going stopped where they were."
                      : "He only looks at your screen when you ask or while a job you started runs, and only listens after “Milo…”."}
                  </span>
                  {!paused?.on && (
                    <div className="hb-row">
                      <button className="hb-ghost hb-sm" onClick={() => void M.pause.set(true, 60).then(setPaused)}>
                        Pause 1 hour
                      </button>
                      <button
                        className="hb-ghost hb-sm"
                        onClick={() => {
                          const t = new Date();
                          t.setDate(t.getDate() + 1);
                          t.setHours(8, 0, 0, 0);
                          void M.pause.set(true, Math.round((t.getTime() - Date.now()) / 60e3)).then(setPaused);
                        }}
                      >
                        Until tomorrow 8 AM
                      </button>
                    </div>
                  )}
                </div>
                <button
                  role="switch"
                  aria-checked={!!paused?.on}
                  aria-label="Pause Milo"
                  className={`hb-switch hb-switch-warn ${paused?.on ? "on" : ""}`}
                  onClick={() => void M.pause.set(!paused?.on).then(setPaused)}
                >
                  <i aria-hidden="true" />
                </button>
              </section>


              <section className="hb-card" aria-label="Check this beta">
                <div className="hb-set">
                  <div>
                    <b>
                      Check this <em className="hb-setstate">beta</em>
                    </b>
                    <span>
                      {prefs?.preflight
                        ? "On. “Milo, check this” checks your work against the rubric you copied (or instructions on screen) and labels each thing Fix, Check, or Can't tell."
                        : "Off. “Check my work” just looks for mistakes. Turn on to also check against the rubric."}
                    </span>
                  </div>
                  <button role="switch" aria-checked={!!prefs?.preflight} aria-label="Check this beta" className={`hb-switch ${prefs?.preflight ? "on" : ""}`} onClick={() => setPref({ preflight: !prefs?.preflight })}>
                    <i aria-hidden="true" />
                  </button>
                </div>
              </section>

              <section className="hb-card" aria-label="Demo mode">
                <div className="hb-set">
                  <div>
                    <b>Demo mode</b>
                    <span>Show Home base with a sample student's week. Good for showing friends or filming Milo without your real classes on screen.</span>
                  </div>
                  <button role="switch" aria-checked={DEMO} aria-label="Demo mode" className={`hb-switch ${DEMO ? "on" : ""}`} onClick={() => setDemo(!DEMO)}>
                    <i aria-hidden="true" />
                  </button>
                </div>
              </section>

              <section className="hb-card" aria-label="What Milo can see and do">
                <div className="hb-cardhead">
                  <span className="hb-kicker">WHAT MILO CAN SEE AND DO</span>
                  <span className="hb-muted">your Mac asks for each one once</span>
                </div>
                {(
                  [
                    ["screen", "Screen", "So he can see the question you're stuck on. Only when you ask, or while a job you started runs.", perms?.screen],
                    ["mic", "Microphone", "For “Milo, …” and lecture notes. He ignores everything that doesn't start with his name.", perms?.mic],
                    ["hands", "Clicking and typing", "So he can do things for you. Anything that submits, sends, buys or deletes waits for your yes.", perms?.hands],
                  ] as const
                ).map(([kind, label, why, on]) => (
                  <div className="hb-set" key={kind}>
                    <div>
                      <b>
                        <i className={`hb-dot ${paused?.on ? "" : on ? "ok" : "off"}`} aria-hidden="true" />
                        {label}
                        <em className="hb-setstate">{paused?.on ? "paused" : on == null ? "" : on ? "allowed" : "off"}</em>
                      </b>
                      <span>{why}</span>
                    </div>
                    {on === false && (
                      <button className="hb-ghost hb-sm" onClick={() => void M.permAsk(kind).then(() => M.perms().then(setPerms))}>
                        Turn on
                      </button>
                    )}
                  </div>
                ))}
                <div className="hb-set">
                  <div>
                    <b>Type worksheet answers in for me</b>
                    <span>
                      {prefs?.autofill
                        ? "On. “Do this worksheet” fills in the answers. Say “show me the answers” anytime and I'll just show them."
                        : "Off. I show each answer and how I got it, and you type it in. Say “fill it in” and I will."}
                    </span>
                  </div>
                  <button
                    role="switch"
                    aria-checked={!!prefs?.autofill}
                    aria-label="Type worksheet answers in for me"
                    className={`hb-switch ${prefs?.autofill ? "on" : ""}`}
                    onClick={() => setPref({ autofill: !prefs?.autofill })}
                  >
                    <i aria-hidden="true" />
                  </button>
                </div>
                <p className="hb-muted hb-promiseline">I ask before anything gets turned in, sent, bought or deleted. Everything I do shows up in What Milo did, with Undo where it's possible. Crash reports never include what's on your screen or what you say.</p>
              </section>

              <section className="hb-card" aria-label="Connections">
                <div className="hb-cardhead">
                  <span className="hb-kicker">CONNECTIONS</span>
                </div>
                <div className="hb-set">
                  <div>
                    <b>
                      <i className={`hb-dot ${d2l?.ok ? "ok" : "off"}`} aria-hidden="true" />
                      D2L Brightspace
                    </b>
                    <span>{d2l?.ok ? `Due dates, grades and syllabi, through ${d2l.via === "chrome" ? "your Chrome sign-in" : "Milo's own sign-in"}. Checks every 10 minutes while Home is open.` : portal ? "Signed out. Sign in to D2L in Chrome and I'll pick it up." : "Not set up yet."}</span>
                  </div>
                  <div className="hb-row">
                    <button
                      className="hb-ghost hb-sm"
                      onClick={() => {
                        if (!portal) return send("Help me connect my school's D2L");
                        void M.d2lCheck(portal).then((c) => setD2l({ ok: c.ok, via: c.via }));
                        void loadDue();
                      }}
                    >
                      {portal ? "Recheck" : "Set up"}
                    </button>
                    {portal && (
                      <button
                        className="hb-ghost hb-sm"
                        onClick={() => {
                          if (!window.confirm("Turn off D2L? Milo stops reading your due dates and grades until you set it up again.")) return;
                          try {
                            localStorage.removeItem("milo.portal");
                          } catch {
                            /* ignore */
                          }
                          location.reload();
                        }}
                      >
                        Turn off
                      </button>
                    )}
                  </div>
                </div>
                <div className="hb-set">
                  <div>
                    <b>
                      <i className={`hb-dot ${google?.connected ? "ok" : "off"}`} aria-hidden="true" />
                      Google
                    </b>
                    <span>{google?.connected ? `Calendar, Gmail drafts and Docs as ${google.email}. Sending and adding always wait for your yes.` : "Calendar, Gmail drafts and Docs."}</span>
                  </div>
                  {google?.connected ? (
                    <button
                      className="hb-ghost hb-sm"
                      onClick={() => {
                        if (window.confirm("Disconnect Google? Milo won't see your calendar, Gmail or Docs until you connect again.")) void M.googleDisconnect().then(setGoogle);
                      }}
                    >
                      Disconnect
                    </button>
                  ) : (
                    <button className="hb-ghost hb-sm" onClick={() => void M.google.connect().then(() => M.google.status().then(setGoogle))}>
                      Connect
                    </button>
                  )}
                </div>
              </section>

              <section className="hb-card" aria-label="Lecture listener">
                <div className="hb-cardhead">
                  <span className="hb-kicker">LECTURE LISTENER</span>
                  <span className="hb-muted">say “Milo, listen to class”</span>
                </div>
                {classes.map((c) => {
                  const on = !(prefs?.noRecord ?? []).includes(c.id);
                  return (
                    <div className="hb-set" key={c.id}>
                      <div>
                        <b>
                          <i className="hb-dot" style={{ background: dotFor(c) }} aria-hidden="true" />
                          {c.name}
                        </b>
                        <span>{on ? "Milo takes notes when you ask" : "Milo never listens in this class"}</span>
                      </div>
                      <button
                        role="switch"
                        aria-checked={on}
                        aria-label={`Lecture notes in ${c.name}`}
                        className={`hb-switch ${on ? "on" : ""}`}
                        onClick={() => setPref({ noRecord: on ? [...(prefs?.noRecord ?? []), c.id] : (prefs?.noRecord ?? []).filter((x) => x !== c.id) })}
                      >
                        <i aria-hidden="true" />
                      </button>
                    </div>
                  );
                })}
                {!classes.length && <p className="hb-muted">Your classes show up here once D2L is connected.</p>}
                <p className="hb-muted hb-promiseline">
                  Say “Milo, listen to class” to start. Turn off any class you never want recorded. In class, tap “Not in this class” on the listening badge to delete the recording on the spot. Audio is deleted once your notes are made.
                </p>
              </section>

              <section className="hb-card" aria-label="Notifications">
                <div className="hb-cardhead">
                  <span className="hb-kicker">NOTIFICATIONS</span>
                  <span className="hb-muted">when you're at the Mac, Milo just tells you out loud</span>
                </div>
                <div className="hb-set">
                  <div>
                    <b>When a job finishes or needs you</b>
                    <span>A Mac notification if you've walked away, so you can come back to it.</span>
                  </div>
                  <button role="switch" aria-checked={!!prefs?.notifyAway} aria-label="Job notifications" className={`hb-switch ${prefs?.notifyAway ? "on" : ""}`} onClick={() => setPref({ notifyAway: !prefs?.notifyAway })}>
                    <i aria-hidden="true" />
                  </button>
                </div>
                <div className="hb-set">
                  <div>
                    <b>Quiet hours</b>
                    <span>
                      No notifications from{" "}
                      <select aria-label="Quiet hours start" className="hb-select" value={prefs?.quietFrom ?? 23} disabled={!prefs?.quiet} onChange={(e) => setPref({ quietFrom: Number(e.target.value) })}>
                        {Array.from({ length: 24 }, (_, h) => (
                          <option key={h} value={h}>
                            {new Date(2026, 0, 1, h).toLocaleTimeString("en-US", { hour: "numeric" })}
                          </option>
                        ))}
                      </select>{" "}
                      to{" "}
                      <select aria-label="Quiet hours end" className="hb-select" value={prefs?.quietTo ?? 8} disabled={!prefs?.quiet} onChange={(e) => setPref({ quietTo: Number(e.target.value) })}>
                        {Array.from({ length: 24 }, (_, h) => (
                          <option key={h} value={h}>
                            {new Date(2026, 0, 1, h).toLocaleTimeString("en-US", { hour: "numeric" })}
                          </option>
                        ))}
                      </select>
                    </span>
                  </div>
                  <button role="switch" aria-checked={!!prefs?.quiet} aria-label="Quiet hours" className={`hb-switch ${prefs?.quiet ? "on" : ""}`} onClick={() => setPref({ quiet: !prefs?.quiet })}>
                    <i aria-hidden="true" />
                  </button>
                </div>
              </section>

              <section className="hb-card" aria-label="Account">
                <div className="hb-cardhead">
                  <span className="hb-kicker">ACCOUNT</span>
                </div>
                {acct?.signedIn ? (
                  <div className="hb-set">
                    <div>
                      <b>
                        <i className="hb-dot ok" aria-hidden="true" />
                        {acct.email}
                      </b>
                      <span>Signed in. Your memory, classes and plans sync across your Macs.</span>
                    </div>
                    <button className="hb-ghost hb-sm" onClick={() => void M.accountSignOut().then(setAcct)}>
                      Sign out
                    </button>
                  </div>
                ) : (
                  <form
                    className="hb-signin"
                    onSubmit={(e) => {
                      e.preventDefault();
                      setAcctMsg("");
                      if (acctStep === "email") {
                        const em = acctEmail.trim();
                        if (!/^\S+@\S+\.\S+$/.test(em)) return setAcctMsg("That doesn't look like an email.");
                        void M.accountSend(em).then((r) => (r.ok ? (setAcctStep("code"), setAcctMsg(`Code sent to ${em}.`)) : setAcctMsg(r.text)));
                      } else {
                        void M.accountVerify(acctEmail.trim(), acctCode.trim()).then((r) => {
                          if (!r.ok) return setAcctMsg(r.text);
                          setAcctStep("email");
                          setAcctCode("");
                          void M.account().then(setAcct);
                        });
                      }
                    }}
                  >
                    <div>
                      <b>Sign in to sync</b>
                      <span>Your memory, classes and plans follow you to any Mac.</span>
                    </div>
                    <div className="hb-teach">
                      {acctStep === "email" ? (
                        <>
                          <label htmlFor="hb-email" className="hb-sr">
                            Email
                          </label>
                          <input id="hb-email" type="email" autoComplete="email" value={acctEmail} onChange={(e) => setAcctEmail(e.target.value)} placeholder="you@tcu.edu" />
                          <button className="hb-primary hb-sm" type="submit">
                            Send code
                          </button>
                        </>
                      ) : (
                        <>
                          <label htmlFor="hb-code" className="hb-sr">
                            6-digit code
                          </label>
                          <input id="hb-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={acctCode} onChange={(e) => setAcctCode(e.target.value.replace(/\D/g, ""))} placeholder="6-digit code" />
                          <button className="hb-primary hb-sm" type="submit">
                            Sign in
                          </button>
                          <button className="hb-ghost hb-sm" type="button" onClick={() => (setAcctStep("email"), setAcctMsg(""))}>
                            Back
                          </button>
                        </>
                      )}
                    </div>
                    {acctMsg && (
                      <p className="hb-muted" role="status">
                        {acctMsg}
                      </p>
                    )}
                  </form>
                )}
                <div className="hb-set">
                  <div>
                    <b>Plan</b>
                    <span>Milo beta. Billing and plans turn on at launch.</span>
                  </div>
                </div>
              </section>

              <section className="hb-card" aria-label="What Milo knows about you">
                <div className="hb-cardhead">
                  <span className="hb-kicker">WHAT MILO KNOWS ABOUT YOU</span>
                  <button
                    className="hb-link hb-danger"
                    onClick={() => {
                      if (window.confirm("Make Milo forget everything he's learned about you? Your classes and files stay. This can't be undone.")) void M.forgetAll().then(() => setMems([]));
                    }}
                  >
                    Forget everything
                  </button>
                </div>
                {(mems ?? []).slice(0, 12).map((m, i) => (
                  <div className="hb-set" key={i}>
                    <div>
                      <span className="hb-memline">{m}</span>
                    </div>
                  </div>
                ))}
                {mems && !mems.length && <p className="hb-muted">Nothing yet. I learn as we talk, like your classes, your exams and what you find hard.</p>}
                <form
                  className="hb-teach"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = teach.trim();
                    if (!f) return;
                    void M.remember(f).then(() => M.memories().then(setMems));
                    setTeach("");
                  }}
                >
                  <label htmlFor="hb-teach" className="hb-sr">
                    Teach Milo something about you
                  </label>
                  <input id="hb-teach" value={teach} onChange={(e) => setTeach(e.target.value)} placeholder="Teach Milo something, like “I study best after 9 PM”" />
                  <button className="hb-ghost hb-sm" type="submit">
                    Remember
                  </button>
                </form>
              </section>

              <section className="hb-card" aria-label="More">
                <div className="hb-set">
                  <div>
                    <b>Milo's look</b>
                    <span>Unlock outfits by studying</span>
                  </div>
                  <button className="hb-ghost hb-sm" onClick={() => setView("milo")}>
                    Wardrobe
                  </button>
                </div>
                <div className="hb-set">
                  <div>
                    <b>Shortcuts</b>
                    <span>Talk to Milo: ⌘⇧Space · Look at my screen: ⌘⇧Y · Pick an area: ⌘⇧2 · Open Home base: ⌘⇧H · Search: ⌘K</span>
                  </div>
                </div>
                <div className="hb-set">
                  <div>
                    <b>Feedback</b>
                    <span>Something broke, or an idea? It goes straight to Jake.</span>
                  </div>
                  <button className="hb-ghost hb-sm" onClick={() => send("Report a bug")}>
                    Send
                  </button>
                </div>
              </section>
            </div>
          )}
        </div>

        {/* ================= COMPOSER ================= */}
        {view !== "did" && view !== "settings" && view !== "milo" && (
          <div className="hb-compose">
            {(view === "today" || !chat?.messages.length) && (
              <div className="hb-chips">
                {chips.map((c) => (
                  <button
                    key={c}
                    className="hb-chip"
                    onClick={() => {
                      if (c.endsWith("…")) {
                        setDraft(c.replace(/…$/, ""));
                        inputRef.current?.focus();
                      } else send(c);
                    }}
                  >
                    {c}
                  </button>
                ))}
              </div>
            )}
            <div className="hb-box">
              <label htmlFor="hb-ask" className="hb-sr">
                Ask Milo
              </label>
              <textarea
                id="hb-ask"
                ref={inputRef}
                rows={1}
                value={draft}
                placeholder={view === "class" && cls ? `Ask about ${cls.name}…` : "Ask Milo, or tell him to do something…"}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send(view === "class" && cls && !/\b(class|course)\b/i.test(draft) ? `${draft} (for ${cls.name})` : draft);
                  }
                }}
              />
              <div className="hb-boxrow">
                <button className="hb-ico" aria-label="Look at my screen" onClick={() => send("Look at my screen and help me with this")}>
                  <Ico d={I.screen} size={17} />
                </button>
                <span className="hb-hint">knows your D2L, calendar and notes</span>
                <span className="hb-flex" />
                <button className="hb-mic" aria-label="Talk to Milo" onClick={openVoice}>
                  <Ico d={I.mic} size={18} />
                </button>
                <button className="hb-send" aria-label="Send" disabled={!draft.trim()} onClick={() => send(draft)}>
                  <Ico d={I.up} size={18} w={2.2} />
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      {sharing && (
        <ShareSheet
          moments={(() => {
            const extra: Moment[] = moments.map((x) => ({ id: x.id, kicker: x.kicker, big: x.big, small: x.small, mood: x.mood, from: "#5B2FB0", to: "#2A1452" }));
            const all = [...shareMoments, ...extra];
            const first = all.find((x) => x.id === shareFirst);
            return (first ? [first, ...all.filter((x) => x !== first)] : all).slice(0, 4);
          })()}
          outfit={outfit}
          onClose={() => (setSharing(false), setShareFirst(null))}
        />
      )}

      {/* ================= LEVEL UP ================= */}
      {levelUp && (
        <div className="hb-approve-wrap" onClick={() => (markLevelSeen(levelUp), setLevelUp(null))}>
          <section className="hb-levelup" role="dialog" aria-label={`Milo reached level ${levelUp}`} onClick={(e) => e.stopPropagation()}>
            <MiloFrog size={170} mood="celebrate" outfit={outfit} />
            <span className="hb-kicker hb-purple">LEVEL UP</span>
            <h2>Milo hit level {levelUp}!</h2>
            <p>
              {growth.name}.{" "}
              {OUTFITS.filter((o) => o.level > levelFrom && o.level <= levelUp).length
                ? `New outfit unlocked: ${OUTFITS.filter((o) => o.level > levelFrom && o.level <= levelUp).map((o) => o.label).join(", ")}.`
                : "All from real studying. Keep going."}
            </p>
            <div className="hb-row">
              {OUTFITS.filter((o) => o.level > levelFrom && o.level <= levelUp).slice(0, 1).map((o) => (
                <button key={o.id} className="hb-primary" onClick={() => (pickOutfit(o.id), markLevelSeen(levelUp), setLevelUp(null))}>
                  Put on the {o.label.toLowerCase()}
                </button>
              ))}
              <button className="hb-ghost" onClick={() => (markLevelSeen(levelUp), setLevelUp(null), setShareFirst("level"), setSharing(true))}>
                Share it
              </button>
              <button className="hb-ghost" onClick={() => (markLevelSeen(levelUp), setLevelUp(null))}>
                Nice
              </button>
            </div>
          </section>
        </div>
      )}

      {/* ================= NEEDS YOUR YES ================= */}
      {job?.status === "needs_you" && job.question && (
        <ApprovalCard
          key={`${job.id}:${job.question}`}
          job={job}
          outfit={outfit}
          onYes={() => void M.jobResume(true).then((j) => j && setJob(j))}
          onLook={() => setView("chat")}
          onNo={() => void M.jobStop().then(() => setJob((j) => (j ? { ...j, status: "stopped" } : j)))}
        />
      )}

      {/* ================= UNDO BAR ================= */}
      {toast && (
        <div className="hb-toast" role="status">
          <Ico d={I.check} size={15} w={2.4} />
          <span>{toast.title}</span>
          <button
            onClick={() => {
              void M.activity.undo(toast.id);
              setToast(null);
            }}
          >
            Undo
          </button>
        </div>
      )}

      {/* ================= ⌘K ================= */}
      {overlay === "cmdk" && (
        <CommandBar
          onClose={() => setOverlay(null)}
          items={[
            ...(next ? [{ group: "DO", label: `Start ${next.title}`, hint: "↵", run: () => startNext("together") }] : []),
            { group: "DO", label: "Write a paper on…", hint: "", run: () => (setOverlay(null), setView("chat"), setDraft("Write a 3 page paper on "), window.setTimeout(() => inputRef.current?.focus(), 30)) },
            { group: "DO", label: "Listen to my lecture", hint: "", run: () => send("Listen to my lecture") },
            { group: "DO", label: "What's due this week?", hint: "", run: () => send("What's due this week?") },
            { group: "DO", label: "Talk to Milo", hint: "⌘⇧Space", run: openVoice },
            { group: "DO", label: "Lock in for 50 minutes", hint: "", run: () => send("Lock in for 50 minutes") },
            ...classes.map((c) => ({ group: "CLASSES", label: c.name, hint: pct(gradeOf(c.name)), run: () => (setOverlay(null), setClassId(c.id), setView("class")) })),
            ...chats.slice(0, 20).map((c) => ({ group: "CHATS", label: c.title, hint: "", run: () => (setOverlay(null), setChatId(c.id), setView("chat")) })),
          ]}
          onAsk={send}
        />
      )}

      {/* ================= VOICE ================= */}
      {overlay === "voice" && (
        <div className="hb-voice" role="dialog" aria-label="Voice mode">
          <div className="hb-kicker hb-purple">{voiceLines.length && voiceLines[voiceLines.length - 1].who === "milo" ? "MILO" : "LISTENING"}</div>
          <div className="hb-orb" aria-hidden="true">
            <MiloFrog size={150} mood={voiceLines.length && voiceLines[voiceLines.length - 1].who === "milo" ? "happy" : "listen"} outfit={outfit} />
          </div>
          <div className="hb-wave" aria-hidden="true">
            {Array.from({ length: 28 }, (_, i) => (
              <i key={i} style={{ animationDuration: `${0.7 + ((i * 37) % 9) / 10}s`, animationDelay: `${((i * 53) % 10) / 10}s` }} />
            ))}
          </div>
          <div className="hb-vlines">
            {voiceLines.slice(-2).map((l, i) => (
              <p key={i} className={l.who}>
                {l.who === "you" ? `“${l.text}”` : l.text}
              </p>
            ))}
            {!voiceLines.length && <p className="you">Say anything. “What's due this week?”</p>}
          </div>
          <div className="hb-row">
            <button className="hb-ghost" onClick={() => M.home.talk()}>
              Talk again
            </button>
            <button className="hb-ghost" onClick={() => setOverlay(null)}>
              End voice
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Milo stopped right before something that can't be taken back (submit, send, buy, post, delete). */
function ApprovalCard({ job, outfit, onYes, onLook, onNo }: { job: MiloJob; outfit: FrogOutfit; onYes: () => void; onLook: () => void; onNo: () => void }) {
  const done = job.steps.filter((s) => s.status === "done").length;
  const nextStep = job.steps.find((s) => s.status !== "done" && s.status !== "skipped");
  const [busy, setBusy] = useState(false);
  return (
    <div className="hb-approve-wrap">
      <section className="hb-approve" role="alertdialog" aria-labelledby="hb-approve-q" aria-describedby="hb-approve-what">
        <div className="hb-approve-head">
          <MiloFrog size={36} mood="think" outfit={outfit} />
          MILO NEEDS YOUR YES
        </div>
        <div className="hb-approve-body">
          <h2 id="hb-approve-q">{job.question}</h2>
          <p className="hb-muted">
            {job.goal.replace(/^In Chrome, /, "").slice(0, 140)} · {done} of {job.steps.length} steps done
          </p>
          {nextStep && (
            <div className="hb-approve-what" id="hb-approve-what">
              <span className="hb-kicker">WHAT I'LL DO IF YOU SAY YES</span>
              <p>{nextStep.do.split("\n")[0]}</p>
            </div>
          )}
          <p className="hb-approve-note">Things that get turned in, sent or bought usually can't be taken back. That's why I stopped to ask.</p>
          <div className="hb-row">
            <button
              className="hb-primary hb-big"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                onYes();
              }}
            >
              {busy ? "Going…" : "Yes, go ahead"}
            </button>
            <button className="hb-ghost" onClick={onLook}>
              Show me first
            </button>
            <button className="hb-ghost" onClick={onNo}>
              Not now
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

const PROOF_LABEL: Record<"confirmed" | "checked" | "tried", string> = { confirmed: "✓ CONFIRMED", checked: "✓ CHECKED", tried: "NOT VERIFIED" };
const KIND_LABEL: Record<MiloActivity["kind"], string> = {
  calendar: "Calendar",
  email_draft: "Email draft",
  email_sent: "Email sent",
  doc: "Docs",
  memory: "Memory",
  job: "Job",
  app: "Apps",
  web: "Web",
  classes: "Classes",
};
const KIND_COLOR: Partial<Record<MiloActivity["kind"], string>> = { doc: "#8FA3E8", calendar: "#7CC7A8", classes: "#F5B544", email_draft: "#D59AB8", email_sent: "#D59AB8", web: "#C4B5FD", job: "#C4B5FD" };

function DidPage({
  acts,
  now,
  filter,
  setFilter,
  sel,
  setSel,
  outfit,
}: {
  acts: MiloActivity[];
  now: number;
  filter: "all" | "undo" | MiloActivity["kind"];
  setFilter: (f: "all" | "undo" | MiloActivity["kind"]) => void;
  sel: string | null;
  setSel: (id: string | null) => void;
  outfit: FrogOutfit;
}) {
  const kinds = Array.from(new Set(acts.map((a) => a.kind)));
  const shown = acts.filter((a) => (filter === "all" ? true : filter === "undo" ? a.canUndo : a.kind === filter));
  const today = new Date(new Date(now).toDateString()).getTime();
  const dayLabel = (t: number) => {
    const d = Math.floor((today - new Date(new Date(t).toDateString()).getTime()) / DAY);
    return d <= 0 ? "TODAY" : d === 1 ? "YESTERDAY" : new Date(t).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" }).toUpperCase();
  };
  const groups: { label: string; items: MiloActivity[] }[] = [];
  for (const a of shown) {
    const l = dayLabel(a.at);
    const g = groups[groups.length - 1];
    if (g && g.label === l) g.items.push(a);
    else groups.push({ label: l, items: [a] });
  }
  const week = acts.filter((a) => now - a.at < 7 * DAY);
  const pick = acts.find((a) => a.id === sel) ?? shown[0] ?? null;
  const chip = (id: typeof filter, label: string, n: number) => (
    <button key={id} className={`hb-chip ${filter === id ? "on" : ""}`} aria-pressed={filter === id} onClick={() => setFilter(id)}>
      {label}
      <em>{n}</em>
    </button>
  );
  return (
    <div className="hb-did hb-rise">
      <div className="hb-didmain">
        <div className="hb-hello">
          <div className="hb-hellome">
            <MiloFrog size={84} mood="write" outfit={outfit} />
            <div>
              <h1>What Milo did</h1>
              <p>Everything I touched, where, and how to take it back. No secrets.</p>
            </div>
          </div>
          <div className="hb-stats">
            <div>
              <b>{week.length}</b>
              <span>THIS WEEK</span>
            </div>
            <div>
              <b>{acts.filter((a) => a.canUndo).length}</b>
              <span>CAN UNDO NOW</span>
            </div>
            <div>
              <b>{acts.filter((a) => a.undone).length}</b>
              <span>YOU UNDID</span>
            </div>
          </div>
        </div>
        <div className="hb-chips" role="group" aria-label="Filter">
          {chip("all", "All", acts.length)}
          {chip("undo", "Can undo", acts.filter((a) => a.canUndo).length)}
          {kinds.map((k) => chip(k, KIND_LABEL[k], acts.filter((a) => a.kind === k).length))}
        </div>
        {groups.map((g) => (
          <section className="hb-card hb-didgroup" key={g.label} aria-label={g.label}>
            <div className="hb-cardhead">
              <span className="hb-kicker">{g.label}</span>
              <span className="hb-muted">
                {g.items.length} action{g.items.length > 1 ? "s" : ""}
              </span>
            </div>
            {g.items.map((a) => (
              <div key={a.id} className={`hb-didrow ${a.undone ? "undone" : ""} ${pick?.id === a.id ? "sel" : ""}`}>
                <span className="hb-didtime">{new Date(a.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</span>
                <span className="hb-didkind" style={{ color: KIND_COLOR[a.kind] ?? "#A1A1AA" }} aria-hidden="true">
                  {KIND_LABEL[a.kind].slice(0, 3).toUpperCase()}
                </span>
                <button className="hb-didtitle" onClick={() => setSel(a.id)}>
                  <b>{a.title}</b>
                  {a.detail && <em>{a.detail}</em>}
                </button>
                <span className={`hb-didstatus ${a.undone ? "" : (a.proof?.level ?? "ok")}`} title={a.proof?.how}>
                  {a.undone ? "UNDONE" : PROOF_LABEL[a.proof?.level ?? "confirmed"]}
                </span>
                {a.canUndo ? (
                  <button className="hb-mini" onClick={() => void M.activity.undo(a.id)}>
                    Undo
                  </button>
                ) : (
                  <span className="hb-didfinal">{a.undone ? "" : "Final"}</span>
                )}
              </div>
            ))}
          </section>
        ))}
        {!shown.length && (
          <section className="hb-state">
            <MiloFrog size={64} mood="idle" outfit={outfit} />
            <div>
              <b>{acts.length ? "Nothing matches that filter." : "Nothing yet."}</b>
              <span>Everything I do for you shows up here, with Undo wherever it's possible.</span>
            </div>
          </section>
        )}
      </div>

      {pick && (
        <aside className="hb-diddetail" aria-label="Details">
          <span className="hb-kicker">DETAILS</span>
          <div className="hb-muted">
            {KIND_LABEL[pick.kind]} · {new Date(pick.at).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" })}
          </div>
          <h2>{pick.title}</h2>
          {pick.detail && <p>{pick.detail}</p>}
          {pick.link && (
            <button className="hb-ghost hb-sm" onClick={() => M.openUrl(pick.link!)}>
              Open where it happened
            </button>
          )}
          {pick.proof && (
            <div className={`hb-proofbox ${pick.proof.level}`}>
              <span className="hb-kicker">{pick.proof.level === "tried" ? "NOT VERIFIED" : "HOW I KNOW IT WORKED"}</span>
              <p>{pick.proof.how}</p>
            </div>
          )}
          {pick.source && (
            <div className="hb-proofbox src">
              <span className="hb-kicker">SOURCE</span>
              {pick.source.url ? (
                <button className="hb-link" onClick={() => M.openUrl(pick.source!.url!)}>
                  {pick.source.label}
                </button>
              ) : (
                <p>{pick.source.label}</p>
              )}
            </div>
          )}
          <div className="hb-undobox">
            <span className="hb-kicker hb-purple">WHAT UNDO DOES</span>
            <p>
              {pick.undone
                ? "Already undone."
                : pick.canUndo
                  ? `Reverses this in ${KIND_LABEL[pick.kind]}. Nothing else changes.`
                  : pick.noUndo || "This one can't be taken back, which is why I ask before doing things like it."}
            </p>
            {pick.undoError && <p className="hb-err">Last undo didn't work: {pick.undoError}</p>}
          </div>
          {pick.canUndo && (
            <button className="hb-ghost" onClick={() => void M.activity.undo(pick.id)}>
              Undo this
            </button>
          )}
        </aside>
      )}
    </div>
  );
}

function ActList({ acts, title, onAll }: { acts: MiloActivity[]; title: string; onAll?: () => void }) {
  return (
    <section className="hb-card" aria-label="What Milo did">
      <div className="hb-cardhead">
        <span className="hb-kicker">{title}</span>
        {onAll && (
          <button className="hb-link" onClick={onAll}>
            See all
          </button>
        )}
      </div>
      {acts.map((a) => (
        <div key={a.id} className={`hb-act ${a.undone ? "undone" : ""}`}>
          <div className="hb-thumb" aria-hidden="true">
            <i style={{ background: a.kind === "doc" ? "#8B5CF6" : a.kind === "calendar" ? "#D8B27A" : a.kind === "classes" ? "#7CC7A8" : "#8FA3E8" }} />
            <i />
            <i />
          </div>
          <div className="hb-acttext">
            <b>{a.title}</b>
            <em>
              {new Date(a.at).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" })}
              {a.undone ? " · undone" : ""}
            </em>
          </div>
          {a.link && !a.undone && (
            <button className="hb-mini" onClick={() => M.openUrl(a.link!)}>
              Open
            </button>
          )}
          {a.canUndo && (
            <button className="hb-mini" onClick={() => void M.activity.undo(a.id)}>
              Undo
            </button>
          )}
        </div>
      ))}
      {!acts.length && <p className="hb-empty">Nothing yet. Everything Milo does for you shows up here, with Undo.</p>}
    </section>
  );
}

/** The checkup: what's broken and a one-tap fix for each. `all` shows the full list (Settings). */
function Checkup({ items, all, busy, onFix, onRun }: { items: MiloCheckItem[] | null; all?: boolean; busy: boolean; onFix: (i: MiloCheckItem) => void; onRun: () => void }) {
  const bad = (items ?? []).filter((i) => i.ok === false);
  const shown = all ? items ?? [] : bad;
  if (!all && !bad.length) return null;
  return (
    <section className={`hb-card hb-checkup ${bad.length ? "bad" : ""}`} aria-label="Checkup">
      <div className="hb-cardhead">
        <span className="hb-kicker">{all ? "CHECKUP" : `CHECKUP · ${bad.length} THING${bad.length > 1 ? "S" : ""} NEED${bad.length > 1 ? "" : "S"} YOU`}</span>
        <button className="hb-link" disabled={busy} onClick={onRun}>
          {busy ? "Checking…" : "Check again"}
        </button>
      </div>
      {!items && <p className="hb-muted">Checking everything Milo needs…</p>}
      {shown.map((i) => (
        <div className="hb-set" key={i.id}>
          <div>
            <b>
              <span className={`hb-ck ${i.ok === true ? "ok" : i.ok === false ? "bad" : "off"}`} aria-hidden="true">
                {i.ok === true ? "✓" : i.ok === false ? "!" : "–"}
              </span>
              {i.label}
            </b>
            <span>{i.detail}</span>
          </div>
          {i.fix && i.ok !== true && (
            <button className={i.ok === false ? "hb-primary hb-sm" : "hb-ghost hb-sm"} onClick={() => onFix(i)}>
              {i.fix.label}
            </button>
          )}
        </div>
      ))}
    </section>
  );
}

const RULE_LABEL: Record<MiloRuleLevel, string> = { none: "No AI", study: "AI for studying only", credit: "AI allowed with credit", allowed: "AI allowed", unclear: "Unclear" };
const RULE_DOES: Record<MiloRuleLevel, string> = {
  none: "Milo only plans your time and reminds you what's due in this class.",
  study: "Milo explains, quizzes and makes flashcards, but won't write, fill in or check graded work here.",
  credit: "Milo does everything. Remember to note that you used AI.",
  allowed: "Milo does everything here.",
  unclear: "Milo treats it as studying only until you change it. Worth asking your professor.",
};
/** Optional, off by default: "Follow my syllabus AI rules" for this class. */
function RulesCard({ cls }: { cls: Klass }) {
  const [rules, setRules] = useState<MiloRules>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void M.rules.get().then(setRules).catch(() => {});
  }, []);
  const r = rules[cls.id];
  const run = async (on: boolean, fromScreen = false) => {
    setBusy(true);
    const res = await M.rules.set({ classId: cls.id, course: cls.name, on, portal: localStorage.getItem("milo.portal") || "", fromScreen }).catch(() => null);
    setBusy(false);
    if (res?.rules) setRules(res.rules);
  };
  const toggle = () => run(!r);
  const notFound = !!r && !r.quote;
  return (
    <section className="hb-card" aria-label="Syllabus AI rules">
      <div className="hb-set">
        <div>
          <b>Follow my syllabus AI rules</b>
          <span>{busy ? "Reading your syllabus… (a few seconds)" : r ? (r.quote ? RULE_DOES[r.level] : "On, but I still need the syllabus. See below.") : "Off. Milo works like any AI tool here. Turn on and he'll read this class's syllabus and follow its AI policy."}</span>
        </div>
        <button role="switch" aria-checked={!!r} aria-label="Follow my syllabus AI rules" disabled={busy} className={`hb-switch ${r ? "on" : ""}`} onClick={() => void toggle()}>
          <i aria-hidden="true" />
        </button>
      </div>
      {r && !busy && (
        <div className="hb-rule">
          <div className="hb-rulerow">
            <span className={`hb-rulebadge ${r.level}`}>AI: {RULE_LABEL[r.level]}</span>
            <select aria-label="Change the level" value={r.level} onChange={(e) => void M.rules.level(cls.id, e.target.value as MiloRuleLevel).then(setRules)}>
              {(Object.keys(RULE_LABEL) as MiloRuleLevel[]).map((l) => (
                <option key={l} value={l}>
                  {RULE_LABEL[l]}
                </option>
              ))}
            </select>
          </div>
          {r.quote ? (
            <>
              <blockquote>“{r.quote}”</blockquote>
              <p className="hb-muted">From: {r.source}</p>
            </>
          ) : (
            <div className="hb-rulemiss">
              <b>{/No syllabus found/.test(r.source) ? "I couldn't find this class's syllabus in D2L." : "I couldn't find an AI policy in this syllabus."}</b>
              <span>Last resort: open the syllabus and scroll to the part about AI, then tap “Read it from my screen.” Until then I treat this class as studying only.</span>
              <div className="hb-row">
                <button className="hb-ghost hb-sm" disabled={busy} onClick={() => void run(true)}>
                  Search D2L again
                </button>
                <button className="hb-primary hb-sm" disabled={busy} onClick={() => void run(true, true)}>
                  Read it from my screen
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function ClassPage({ cls, grade, due, chats, onAsk, onChat }: { cls: Klass; grade: number | null; due: Due[]; chats: Chat[]; onAsk: (t: string) => void; onChat: (id: string) => void }) {
  const [notes, setNotes] = useState<{ id: string; title: string; updated: number }[]>([]);
  const [sets, setSets] = useState<{ id: string; title: string; data: unknown }[]>([]);
  useEffect(() => {
    void M.kit.notes().then((n) => setNotes(n.filter((x) => x.course === cls.name || x.course.startsWith(cls.name.split(" ")[0])).slice(0, 6)));
    void M.lib.list({ classId: cls.id, app: "study" }).then((l) => setSets(l.slice(0, 6) as { id: string; title: string; data: unknown }[]));
  }, [cls.id, cls.name]);
  const cards = (d: unknown) => ((d as { items?: unknown[] })?.items?.length ?? 0);
  return (
    <div className="hb-page hb-rise">
      <div className="hb-hello">
        <div>
          <div className="hb-code">
            <i style={{ background: cls.color }} aria-hidden="true" />
            {cls.code || "CLASS"}
          </div>
          <h1>{cls.name}</h1>
        </div>
        <div className="hb-stats">
          <div>
            <b>
              {grade == null ? "—" : grade.toFixed(1)}
              {grade != null && <small>%</small>}
            </b>
            <span>CURRENT GRADE</span>
          </div>
          <div>
            <button className="hb-ghost" onClick={() => onAsk(`What do I need on the final in ${cls.name} for an A?`)}>
              What do I need on the final?
            </button>
          </div>
        </div>
      </div>
      <RulesCard cls={cls} />
      <div className="hb-grid2">
        <section className="hb-card">
          <div className="hb-cardhead">
            <span className="hb-kicker">DUE</span>
            <span className="hb-muted">{due.length}</span>
          </div>
          {due.slice(0, 6).map((d, i) => (
            <button key={i} className="hb-due" onClick={() => onAsk(`Make a game plan for ${d.title} in ${d.course}`)}>
              <span className="hb-when">{whenShort(d.due_iso)}</span>
              <i style={{ background: cls.color }} aria-hidden="true" />
              <span className="hb-duetext">
                <b>{d.title}</b>
                <em>{d.due}</em>
              </span>
              <span />
            </button>
          ))}
          {!due.length && <p className="hb-empty">Nothing due right now.</p>}
        </section>
        <section className="hb-card">
          <div className="hb-cardhead">
            <span className="hb-kicker">LECTURE NOTES</span>
            <span className="hb-muted">{notes.length}</span>
          </div>
          {notes.map((n) => (
            <button key={n.id} className="hb-due" onClick={() => onAsk(`Quiz me on my notes: ${n.title}`)}>
              <span className="hb-when">{new Date(n.updated).toLocaleDateString("en-US", { month: "short", day: "numeric" }).toUpperCase()}</span>
              <i style={{ background: cls.color }} aria-hidden="true" />
              <span className="hb-duetext">
                <b>{n.title}</b>
                <em>tap to get quizzed on it</em>
              </span>
              <span />
            </button>
          ))}
          {!notes.length && <p className="hb-empty">Say “listen to my {cls.name.split(" ")[0]} lecture” in class and notes show up here.</p>}
        </section>
        <section className="hb-card">
          <div className="hb-cardhead">
            <span className="hb-kicker">FLASHCARDS</span>
            <span className="hb-muted">{sets.length} sets</span>
          </div>
          {sets.map((s) => (
            <div key={s.id} className="hb-due">
              <span className="hb-when">SET</span>
              <i style={{ background: cls.color }} aria-hidden="true" />
              <span className="hb-duetext">
                <b>{s.title}</b>
                <em>{cards(s.data)} cards</em>
              </span>
              <span />
            </div>
          ))}
          {!sets.length && <p className="hb-empty">Flashcards from lectures and study sessions land here.</p>}
        </section>
        <section className="hb-card">
          <div className="hb-cardhead">
            <span className="hb-kicker">CHATS</span>
            <span className="hb-muted">{chats.length}</span>
          </div>
          {chats.slice(0, 6).map((c) => (
            <button key={c.id} className="hb-due" onClick={() => onChat(c.id)}>
              <span className="hb-when">{new Date(c.at).toLocaleDateString("en-US", { month: "short", day: "numeric" }).toUpperCase()}</span>
              <i style={{ background: cls.color }} aria-hidden="true" />
              <span className="hb-duetext">
                <b>{c.title}</b>
                <em>{c.messages.length} messages</em>
              </span>
              <span />
            </button>
          ))}
          {!chats.length && <p className="hb-empty">Ask about this class below.</p>}
        </section>
      </div>
    </div>
  );
}

function CommandBar({ items, onClose, onAsk }: { items: { group: string; label: string; hint: string; run: () => void }[]; onClose: () => void; onAsk: (t: string) => void }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const shown = items.filter((i) => !q || i.label.toLowerCase().includes(q.toLowerCase())).slice(0, 12);
  const run = (i: number) => {
    const it = shown[i];
    if (it) {
      onClose();
      it.run();
    } else if (q.trim()) onAsk(q);
  };
  let last = "";
  return (
    <div className="hb-scrim" onMouseDown={onClose}>
      <div className="hb-cmd" role="dialog" aria-label="Command bar" onMouseDown={(e) => e.stopPropagation()}>
        <div className="hb-cmdin">
          <Ico d={I.search} size={17} />
          <label htmlFor="hb-cmdq" className="hb-sr">
            Search or tell Milo what to do
          </label>
          <input
            id="hb-cmdq"
            autoFocus
            value={q}
            placeholder="Search chats and classes, or tell Milo what to do…"
            onChange={(e) => {
              setQ(e.target.value);
              setSel(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") (e.preventDefault(), setSel((s) => Math.min(s + 1, shown.length - 1)));
              else if (e.key === "ArrowUp") (e.preventDefault(), setSel((s) => Math.max(s - 1, 0)));
              else if (e.key === "Enter") run(shown.length ? sel : -1);
            }}
          />
          <kbd>esc</kbd>
        </div>
        <div className="hb-cmdlist">
          {shown.map((it, i) => {
            const head = it.group !== last ? it.group : null;
            last = it.group;
            return (
              <div key={`${it.group}${it.label}${i}`}>
                {head && <div className="hb-label">{head}</div>}
                <button className={i === sel ? "on" : ""} onMouseEnter={() => setSel(i)} onClick={() => run(i)}>
                  <span>{it.label}</span>
                  <kbd>{it.hint}</kbd>
                </button>
              </div>
            );
          })}
          {!shown.length && q.trim() && (
            <button className="on" onClick={() => run(-1)}>
              <span>Ask Milo: “{q}”</span>
              <kbd>↵</kbd>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
