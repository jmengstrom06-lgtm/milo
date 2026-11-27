// Everything about the student's classes in one look, straight from D2L: every grade item (score, out of,
// percent, weight, the professor's feedback), the current grade, quizzes (when, how long, how many tries),
// discussions (did they post, how many replies) and assignments (did they turn it in). Read in parallel,
// cached for a few minutes. Whatever can't be read is listed as unread, never guessed.
// The builders are pure (tested); readClasses does the fetching.

import { log as bb } from "./blackbox";
import { courses, d2lGet, D2L_LE as LE, d2lStrip, matchCourse, myUserId, type Course } from "./d2l";

export type GItem = { id: number; name: string; category: string; score: number | null; outOf: number | null; pct: number | null; shown: string; weight: number | null; feedback: string; when: string | null };
export type QuizInfo = { id: number; name: string; due: string | null; start: string | null; end: string | null; minutes: number | null; attempts: number | null; about: string };
export type DiscInfo = { forumId: number; topicId: number; name: string; forum: string; due: string | null; end: string | null; locked: boolean; posted: boolean | null; replies: number };
export type AsgInfo = { id: number; name: string; due: string | null; submitted: boolean | null; at: string | null };
export type ClassInfo = {
  course: Course;
  current: { pct: number | null; shown: string } | null;
  categories: { name: string; weight: number; pct: number | null }[];
  grades: GItem[];
  quizzes: QuizInfo[];
  discussions: DiscInfo[];
  assignments: AsgInfo[];
  unread: string[];
};
export type Snapshot = { at: number; classes: ClassInfo[]; all: boolean };

// ---------- pure builders ----------
type GObj = { Id: number; Name: string; GradeType?: string; Weight?: number; MaxPoints?: number; CategoryId?: number };
type GCat = { Id: number; Name: string; Weight?: number };
type GVal = {
  GradeObjectIdentifier: string;
  GradeObjectName?: string;
  PointsNumerator?: number | null;
  PointsDenominator?: number | null;
  DisplayedGrade?: string;
  Comments?: { Text?: string; Html?: string };
  LastModified?: string | null;
  ReleasedDate?: string | null;
};
const round = (n: number) => Math.round(n * 10) / 10;

/** A class's grades exactly as D2L has them, with percents worked out (never estimated). (pure) */
export function gradesOf(objs: GObj[], cats: GCat[], vals: GVal[], fin: { DisplayedGrade?: string; PointsNumerator?: number | null; PointsDenominator?: number | null } | null) {
  const valOf = new Map(vals.map((v) => [String(v.GradeObjectIdentifier), v]));
  const catName = new Map(cats.map((k) => [k.Id, k.Name]));
  const items: GItem[] = objs
    .filter((o) => !/^category$/i.test(o.GradeType ?? ""))
    .map((o) => {
      const v = valOf.get(String(o.Id));
      const score = v?.PointsNumerator ?? null;
      const outOf = v?.PointsDenominator ?? (o.MaxPoints || null);
      const pct = score != null && outOf ? round((100 * score) / outOf) : null;
      return {
        id: o.Id,
        name: o.Name,
        category: catName.get(o.CategoryId ?? -1) ?? "",
        score,
        outOf,
        pct,
        shown: (v?.DisplayedGrade ?? "").trim(),
        weight: o.Weight ? round(o.Weight) : null,
        feedback: d2lStrip(v?.Comments?.Html || v?.Comments?.Text || "").slice(0, 600),
        when: v?.LastModified ?? v?.ReleasedDate ?? null,
      };
    });
  // a value D2L released for an item that isn't in the item list (it happens): keep it
  for (const v of vals) if (!objs.some((o) => String(o.Id) === String(v.GradeObjectIdentifier)) && v.PointsNumerator != null) {
    const pct = v.PointsDenominator ? round((100 * v.PointsNumerator) / v.PointsDenominator) : null;
    items.push({ id: Number(v.GradeObjectIdentifier), name: v.GradeObjectName ?? "item", category: "", score: v.PointsNumerator, outOf: v.PointsDenominator ?? null, pct, shown: (v.DisplayedGrade ?? "").trim(), weight: null, feedback: d2lStrip(v.Comments?.Html || v.Comments?.Text || "").slice(0, 600), when: v.LastModified ?? null });
  }
  const categories = cats
    .filter((k) => (k.Weight ?? 0) > 0)
    .map((k) => {
      const got = objs.filter((o) => o.CategoryId === k.Id).map((o) => items.find((i) => i.id === o.Id)).filter((i): i is GItem => !!i && i.pct != null && !!i.outOf);
      const pts = got.reduce((n, i) => n + i.outOf!, 0);
      return { name: k.Name, weight: round(k.Weight!), pct: got.length && pts ? round(got.reduce((n, i) => n + i.pct! * i.outOf!, 0) / pts) : null };
    });
  const shown = (fin?.DisplayedGrade ?? "").trim();
  const finPct = fin?.PointsNumerator != null && fin?.PointsDenominator ? round((100 * fin.PointsNumerator) / fin.PointsDenominator) : parseFloat(shown);
  const current = shown || isFinite(finPct) ? { pct: isFinite(finPct) ? round(finPct) : null, shown } : null;
  return { current, categories, grades: items };
}

type QRaw = {
  QuizId: number;
  Name: string;
  IsActive?: boolean;
  StartDate?: string | null;
  EndDate?: string | null;
  DueDate?: string | null;
  Description?: { Text?: { Text?: string; Html?: string } | string; Html?: string };
  Instructions?: { Text?: { Text?: string; Html?: string } | string };
  AttemptsAllowed?: { IsUnlimited?: boolean; NumberOfAttemptsAllowed?: number | null };
  TimeLimit?: { IsEnforced?: boolean; TimeLimitValue?: number | null } | number | null;
  TimeLimitValue?: number | null;
};
const rich = (x: unknown): string => (typeof x === "string" ? x : x && typeof x === "object" ? String((x as { Html?: string; Text?: string }).Html || (x as { Text?: string }).Text || "") : "");
/** D2L's quiz list (either shape it comes in) as plain quiz facts. Inactive (hidden) quizzes are left out. (pure) */
export function quizzesOf(raw: unknown): QuizInfo[] {
  const list: QRaw[] = Array.isArray(raw) ? raw : ((raw as { Objects?: QRaw[] })?.Objects ?? []);
  return list
    .filter((q) => q && q.IsActive !== false)
    .map((q) => {
      const tl = typeof q.TimeLimit === "number" ? q.TimeLimit : q.TimeLimit && q.TimeLimit.IsEnforced !== false ? q.TimeLimit.TimeLimitValue ?? null : q.TimeLimitValue ?? null;
      const at = q.AttemptsAllowed;
      return {
        id: q.QuizId,
        name: q.Name,
        due: q.DueDate ?? null,
        start: q.StartDate ?? null,
        end: q.EndDate ?? null,
        minutes: tl && tl > 0 ? tl : null,
        attempts: at?.IsUnlimited ? null : at?.NumberOfAttemptsAllowed ?? null,
        about: d2lStrip(rich(q.Description?.Text) || rich(q.Description) || rich(q.Instructions?.Text)).slice(0, 500),
      };
    });
}

type Sub = { Status?: number; Submissions?: { SubmissionDate?: string; Files?: unknown[] }[]; CompletionDate?: string | null };
/** Did the student turn it in? From D2L's "my submissions" answer (it comes in a few shapes). Null = can't tell. (pure) */
export function submittedOf(raw: unknown): { submitted: boolean | null; at: string | null } {
  if (raw == null) return { submitted: null, at: null };
  const list: Sub[] = Array.isArray(raw) ? raw : [raw as Sub];
  const subs = list.flatMap((e) => e?.Submissions ?? []);
  const dates = subs.map((s) => s.SubmissionDate ?? "").filter(Boolean).sort();
  if (subs.length) return { submitted: true, at: dates[dates.length - 1] ?? null };
  if (list.some((e) => e?.Status === 1 || e?.Status === 3)) return { submitted: true, at: list.find((e) => e?.CompletionDate)?.CompletionDate ?? null };
  return { submitted: false, at: null };
}

/** A question comparing classes needs every class read, even if it names one ("is stats my worst class?"). (pure) */
export function crossClass(ask: string): boolean {
  return /\b(all|every|each|classes|courses|which class|what class|lowest|highest|worst|best|average|gpa|other class)\b/i.test(ask);
}

// ---------- the text the answerer reads ----------
const fmt = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(+d) ? "" : d.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};
const num = (n: number | null) => (n == null ? "" : Number.isInteger(n) ? String(n) : String(round(n)));

/** The whole snapshot as plain lines: every number already worked out, every date written out. (pure) */
export function snapshotText(s: Snapshot, now = Date.now()): string {
  const out: string[] = [`Today: ${fmt(new Date(now).toISOString())}`];
  const cur = s.classes.filter((c) => c.current?.pct != null);
  if (cur.length > 1) out.push(`Current grades: ${cur.map((c) => `${c.course.short} ${num(c.current!.pct)}%`).join(", ")}. Average of these: ${num(cur.reduce((n, c) => n + c.current!.pct!, 0) / cur.length)}%.`);
  for (const c of s.classes) {
    out.push("", `## ${c.course.short} (${c.course.name})`);
    out.push(c.current ? `Current grade: ${c.current.shown || `${num(c.current.pct)}%`}${c.current.pct != null && !/%/.test(c.current.shown) ? ` (${num(c.current.pct)}%)` : ""}` : "Current grade: not shown in D2L");
    if (c.categories.length) out.push(`Weights: ${c.categories.map((k) => `${k.name} ${num(k.weight)}% (${k.pct == null ? "nothing graded yet" : `${num(k.pct)}% so far`})`).join("; ")}`);
    const graded = c.grades.filter((g) => g.score != null || g.shown);
    const open = c.grades.filter((g) => g.score == null && !g.shown);
    if (graded.length) {
      out.push("Graded:");
      for (const g of graded)
        out.push(
          `- ${g.name}${g.category ? ` [${g.category}]` : ""}: ${g.score != null ? `${num(g.score)}/${num(g.outOf)}${g.pct != null ? ` = ${num(g.pct)}%` : ""}` : g.shown}${g.weight ? `, worth ${num(g.weight)}%` : ""}${g.when ? `, updated ${fmt(g.when)}` : ""}${g.feedback ? `. Feedback: "${g.feedback.replace(/\s+/g, " ")}"` : ""}`
        );
    } else if (!c.unread.includes("grades")) out.push("Graded: nothing posted yet");
    if (open.length) out.push(`Not graded yet: ${open.map((g) => `${g.name}${g.weight ? ` (worth ${num(g.weight)}%)` : ""}`).join("; ")}`);
    if (c.quizzes.length)
      out.push(
        "Quizzes:",
        ...c.quizzes.map(
          (q) =>
            `- ${q.name}: ${q.due ? `due ${fmt(q.due)}` : q.end ? `closes ${fmt(q.end)}` : "no due date"}${q.start && Date.parse(q.start) > now ? `, opens ${fmt(q.start)}` : ""}${q.end && q.due ? `, closes ${fmt(q.end)}` : ""}${q.minutes ? `, ${q.minutes} min time limit` : ", no time limit shown"}${q.attempts ? `, ${q.attempts} attempt${q.attempts > 1 ? "s" : ""}` : q.attempts === null ? ", attempts: not limited or not shown" : ""}${q.about ? `. About: ${q.about.replace(/\s+/g, " ").slice(0, 200)}` : ""}`
        )
      );
    if (c.discussions.length)
      out.push(
        "Discussions:",
        ...c.discussions.map(
          (d) => `- ${d.name}${d.forum && d.forum !== d.name ? ` (${d.forum})` : ""}: ${d.due ? `due ${fmt(d.due)}` : d.end ? `closes ${fmt(d.end)}` : "no due date"}${d.locked ? ", locked" : ""}, ${d.posted == null ? "posting status unknown" : d.posted ? `you posted${d.replies ? ` and replied ${d.replies} time${d.replies > 1 ? "s" : ""}` : ", no replies yet"}` : d.replies ? `no main post yet, ${d.replies} repl${d.replies > 1 ? "ies" : "y"}` : "you haven't posted"}`
        )
      );
    if (c.assignments.length)
      out.push(
        "Assignments:",
        ...c.assignments.map((a) => `- ${a.name}: ${a.due ? `due ${fmt(a.due)}` : "no due date"}, ${a.submitted == null ? "turn-in status unknown" : a.submitted ? `turned in${a.at ? ` ${fmt(a.at)}` : ""}` : "not turned in"}`)
      );
    if (c.unread.length) out.push(`Couldn't read from D2L: ${c.unread.join(", ")}`);
  }
  return out.join("\n");
}

// ---------- reading it ----------
type Get = <T>(path: string) => Promise<T>;
const within = <T>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<T>((_, no) => setTimeout(() => no(new Error("slow")), ms))]);
const near = (iso: string | null | undefined, now: number, back: number, ahead: number) => !iso || (Date.parse(iso) > now - back * 86400e3 && Date.parse(iso) < now + ahead * 86400e3);

/** One class, everything at once. A part that fails goes in `unread`; the rest still comes back. */
export async function readClass(get: Get, c: Course, me: number | null, now = Date.now()): Promise<ClassInfo> {
  const L = `/d2l/api/le/${LE}/${c.id}`;
  const unread: string[] = [];
  const safe = <T>(what: string, p: Promise<T>, fallback: T, quiet = false) =>
    within(p, 12000).catch(() => {
      if (!quiet && !unread.includes(what)) unread.push(what);
      return fallback;
    });
  type F = { ForumId: number; Name: string; IsHidden?: boolean };
  type T = { TopicId: number; Name: string; DueDate?: string | null; EndDate?: string | null; IsLocked?: boolean; IsHidden?: boolean };
  type Folder = { Id: number; Name: string; DueDate?: string | null; IsHidden?: boolean };
  const [objs, cats, vals, fin, quizRaw, folders, forums] = await Promise.all([
    safe("grades", get<GObj[]>(`${L}/grades/`), [] as GObj[]),
    safe("grades", get<GCat[]>(`${L}/grades/categories/`), [] as GCat[], true),
    safe("grades", get<GVal[]>(`${L}/grades/values/myGradeValues/`), [] as GVal[]),
    safe("final grade", get<{ DisplayedGrade?: string; PointsNumerator?: number; PointsDenominator?: number }>(`${L}/grades/final/values/myGradeValue`), null, true),
    safe("quizzes", get<unknown>(`${L}/quizzes/`), [] as unknown),
    safe("assignments", get<Folder[]>(`${L}/dropbox/folders/`), [] as Folder[]),
    safe("discussions", get<F[]>(`${L}/discussions/forums/`), [] as F[]),
  ]);
  const g = gradesOf(objs ?? [], cats ?? [], vals ?? [], fin);
  // discussions: every topic; posting status for the ones that matter now (open, due recently or soon)
  const topicLists = await Promise.all(
    (forums ?? []).filter((f) => !f.IsHidden).slice(0, 15).map((f) => safe("discussions", get<T[]>(`${L}/discussions/forums/${f.ForumId}/topics/`), [] as T[]).then((ts) => (ts ?? []).filter((t) => !t.IsHidden).map((t) => ({ f, t }))))
  );
  const topics = topicLists.flat();
  type P = { PostingUserId?: number; ParentPostId?: number | null; IsDeleted?: boolean };
  const check = topics.filter(({ t }) => near(t.DueDate ?? t.EndDate, now, 10, 30)).slice(0, 8);
  const posts = new Map<number, P[] | null>();
  if (me)
    await Promise.all(
      check.map(({ f, t }) =>
        safe("discussion posts", get<P[]>(`${L}/discussions/forums/${f.ForumId}/topics/${t.TopicId}/posts/`), null as P[] | null, true).then((ps) => posts.set(t.TopicId, ps))
      )
    );
  const discussions: DiscInfo[] = topics.map(({ f, t }) => {
    const ps = posts.get(t.TopicId);
    const mine = ps ? ps.filter((p) => !p.IsDeleted && p.PostingUserId === me) : null;
    return { forumId: f.ForumId, topicId: t.TopicId, name: t.Name, forum: f.Name, due: t.DueDate ?? null, end: t.EndDate ?? null, locked: !!t.IsLocked, posted: mine ? mine.some((p) => !p.ParentPostId) : null, replies: mine ? mine.filter((p) => p.ParentPostId).length : 0 };
  });
  // assignments: turn-in status for the ones due around now
  const fs = (folders ?? []).filter((f) => !f.IsHidden);
  const subs = new Map<number, ReturnType<typeof submittedOf>>();
  await Promise.all(
    fs
      .filter((f) => near(f.DueDate, now, 14, 30))
      .slice(0, 10)
      .map((f) => safe("turn-in status", get<unknown>(`${L}/dropbox/folders/${f.Id}/submissions/mysubmissions/`), undefined as unknown, true).then((r) => r !== undefined && subs.set(f.Id, submittedOf(r))))
  );
  const assignments: AsgInfo[] = fs.map((f) => ({ id: f.Id, name: f.Name, due: f.DueDate ?? null, ...(subs.get(f.Id) ?? { submitted: null, at: null }) }));
  const byDue = <X extends { due: string | null; end?: string | null }>(a: X, b: X) => (Date.parse(a.due ?? a.end ?? "") || 9e15) - (Date.parse(b.due ?? b.end ?? "") || 9e15);
  return { course: c, ...g, quizzes: quizzesOf(quizRaw).sort(byDue), discussions: discussions.sort(byDue), assignments: assignments.sort(byDue), unread };
}

let cache: { key: string; snap: Snapshot } | null = null;
/** Read the classes a question needs (one class, or all of them). Cached for 5 minutes. */
export async function readClasses(portal: string, ask = "", opts: { fresh?: boolean; progress?: (t: string) => void } = {}): Promise<Snapshot> {
  const all = await courses(portal);
  const one = crossClass(ask) ? null : matchCourse(ask, all);
  const key = `${portal}|${one?.id ?? "all"}`;
  if (!opts.fresh && cache && Date.now() - cache.snap.at < 5 * 60e3) {
    if (cache.key === key) return cache.snap;
    if (one && cache.snap.all) return { ...cache.snap, classes: cache.snap.classes.filter((c) => c.course.id === one.id), all: false };
  }
  opts.progress?.(one ? `Checking ${one.short} in D2L…` : `Checking your ${all.length} classes in D2L…`);
  const t0 = Date.now();
  const me = await myUserId(portal).catch(() => null);
  const get: Get = (p) => d2lGet(portal, p);
  const classes = await Promise.all((one ? [one] : all).map((c) => readClass(get, c, me)));
  const snap: Snapshot = { at: Date.now(), classes, all: !one };
  cache = { key, snap };
  bb("classes", "read", { classes: classes.length, ms: Date.now() - t0, unread: classes.flatMap((c) => c.unread.map((u) => `${c.course.short}:${u}`)).slice(0, 10) });
  return snap;
}
/** Something changed (a post, a submission): read fresh next time. */
export const forgetClasses = () => (cache = null);
