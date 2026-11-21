// Milo's job engine: long tasks that actually finish.
// Plan the whole thing -> do each step -> CHECK it really happened (screen + page) -> retry a different way
// -> re-plan if stuck -> final check against the goal -> done. Progress is saved after every step, so a
// crash, a restart or "stop" picks up where it left off. Anything that submits, sends or buys waits for a yes.

import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { log as bb } from "./blackbox";
import { callTool, persona } from "./brain";
import { models } from "./gateway";
import { failRecipe, verifyRecipe } from "./recipes";
import { budget, readMeter, startMeter, stopMeter } from "./usage";
import { profileText } from "./profile";

export type StepStatus = "todo" | "doing" | "retrying" | "done" | "failed" | "skipped";
/** A check the page itself can answer, no AI needed: "the URL has /done", "the page says Thanks", "the Name box says Test Student". */
export type Proof = { kind: "url_has" | "page_has" | "field_is"; value: string; field?: string };
export type JobStep = { do: string; done_when: string; proof?: Proof; status: StepStatus; tries: number; note?: string };
export type JobStatus = "planning" | "running" | "checking" | "done" | "needs_you" | "stuck" | "paused" | "stopped" | "failed";
export type Job = {
  id: string;
  goal: string;
  steps: JobStep[];
  status: JobStatus;
  createdAt: number;
  updatedAt: number;
  replans: number;
  approved: boolean; // the student already said yes to submitting / sending / buying
  question?: string; // what Milo needs from you (needs_you / stuck)
  summary?: string; // what he did (done)
  actions: number; // how many task runs it took (for the test bench)
  cost?: number; // dollars of AI time so far
  aiCalls?: number;
  cheapChecks?: number; // steps proven from the page with no AI
};

/** What the engine needs from the rest of Milo (kept as inputs so it's easy to test). */
export type JobDeps = {
  doTask: (task: string) => Promise<{ ok: boolean; status?: string; text?: string; rest?: string | null; replayed?: boolean }>;
  look: (opts?: { shot?: boolean }) => Promise<Look>;
  emit: (job: Job) => void;
  aborted: () => boolean;
  resetAbort: () => void;
};

export type Look = { jpeg?: string; pageText?: string; url?: string; title?: string; fields?: { label: string; value?: string; checked?: boolean }[] };

// ---------- cheap checks: prove a step from the page itself ----------
const low = (x: unknown) => String(x ?? "").toLowerCase().replace(/\s+/g, " ").trim();
/** true = proven, false = clearly not, null = can't tell without the AI. */
export function cheapCheck(p: Proof | undefined, v: Look): boolean | null {
  if (!p || !p.value) return null;
  const want = low(p.value);
  if (p.kind === "url_has") return v.url ? low(v.url).includes(want) : null;
  if (p.kind === "page_has") return v.pageText ? low(v.pageText).includes(want) || null : null; // not found: maybe it's on screen another way
  if (p.kind === "field_is") {
    if (!v.fields?.length) return null;
    const f = v.fields.find((x) => low(x.label).includes(low(p.field)));
    if (!f) return null;
    if (want === "checked" || want === "unchecked") return f.checked === (want === "checked");
    return low(f.value) === want;
  }
  return null;
}

// ---------- saved jobs ----------
const file = () => path.join(app.getPath("userData"), "jobs.json");
let jobs: Job[] | null = null;
function all(): Job[] {
  if (jobs) return jobs;
  try {
    const raw = JSON.parse(fs.readFileSync(file(), "utf8"));
    jobs = Array.isArray(raw) ? raw : [];
  } catch {
    jobs = [];
  }
  // anything that was mid-run when Milo closed is paused, not lost
  for (const j of jobs) if (["planning", "running", "checking"].includes(j.status)) j.status = "paused";
  return jobs;
}
let onSave: ((j: Job) => void) | null = null;
function save(j: Job, deps?: JobDeps) {
  j.updatedAt = Date.now();
  onSave?.(j);
  const xs = all().filter((x) => x.id !== j.id);
  xs.unshift(j);
  jobs = xs.slice(0, 20);
  try {
    fs.mkdirSync(app.getPath("userData"), { recursive: true });
    fs.writeFileSync(file() + ".tmp", JSON.stringify(jobs));
    fs.renameSync(file() + ".tmp", file());
  } catch (e) {
    bb("job", "save_failed", { error: (e as Error).message });
  }
  deps?.emit(j);
}
export const listJobs = () => all();
export const lastJob = () => all()[0] ?? null;
/** The job to pick back up: paused, stuck or waiting on you. */
export const resumable = () => all().find((j) => ["paused", "needs_you", "stuck", "stopped"].includes(j.status)) ?? null;

// ---------- the brain parts ----------
const PLAN_TOOL = {
  name: "job_plan",
  description: "A plan for a long computer task.",
  input_schema: {
    type: "object",
    properties: {
      steps: {
        type: "array",
        minItems: 1,
        maxItems: 12,
        items: {
          type: "object",
          properties: {
            do: { type: "string", description: "One sub-task Milo's computer hands can do in one go, written as a complete instruction with every detail it needs (URLs, exact text to type, which option to pick). E.g. 'Go to http://site/form and type Test Student into the Name field'." },
            done_when: { type: "string", description: "What will be visible on the screen or page when this step really worked. E.g. 'The Name field shows Test Student'." },
            proof: {
              type: "object",
              description: "Optional: a check the page itself can answer with no looking. url_has = the address contains value. page_has = the page's text contains value (short, exact words that will appear). field_is = the box labeled `field` holds value (or 'checked'/'unchecked'). Leave out if unsure.",
              properties: { kind: { type: "string", enum: ["url_has", "page_has", "field_is"] }, value: { type: "string" }, field: { type: "string" } },
              required: ["kind", "value"],
            },
          },
          required: ["do", "done_when"],
        },
      },
    },
    required: ["steps"],
  },
};
const CHECK_TOOL = {
  name: "step_check",
  description: "Did this step really happen?",
  input_schema: {
    type: "object",
    properties: {
      done: { type: "boolean", description: "True only if the screen/page clearly shows the done_when condition." },
      evidence: { type: "string", description: "What you see that proves it, or what's wrong, in one sentence." },
      fix: { type: "string", description: "If not done: a specific different approach for the next try (e.g. 'the Save button is disabled; use the ⋯ menu > Save changes instead'). '' if done." },
    },
    required: ["done", "evidence", "fix"],
  },
};
const GOAL_TOOL = {
  name: "goal_check",
  description: "Is the whole goal finished?",
  input_schema: {
    type: "object",
    properties: {
      complete: { type: "boolean" },
      missing: { type: "array", items: { type: "string" }, description: "What's still not done, as concrete instructions. Empty if complete." },
      summary: { type: "string", description: "One or two sentences Milo says to the student: what he did and the result (include the answer if the goal asked a question). No markdown." },
    },
    required: ["complete", "missing", "summary"],
  },
};

const RULES = `You are Milo's job planner and checker. Milo is a desktop assistant on the student's Mac. His "hands" can do one sub-task at a time:
open apps/sites, click, type, pick options, scroll, switch tabs, read pages. He sees the screen through screenshots and reads web pages directly.`;

async function plan(goal: string, done: JobStep[], problem?: string) {
  const sofar = done.length ? `\nAlready done (don't repeat these):\n${done.map((s, i) => `${i + 1}. ${s.do}`).join("\n")}` : "";
  const why = problem ? `\nThe last plan got stuck: ${problem}\nPlan the REST of the job a different way.` : "";
  const r = await callTool<{ steps: { do: string; done_when: string; proof?: Proof }[] }>(
    {
      max_tokens: 2500,
      system: `${persona()}\n${RULES}\n${profileText()}\nBreak the student's goal into the steps still needed, in order. Each step must be small enough to do in one go (usually 1 to 4 actions) and include every detail (URLs, exact text, choices) so it can be done without the original goal. Group typing into one form into one or two steps. Any submit / send / buy / place-order / post / delete action must be its OWN step (never combined with filling things in), so the student can approve it. The final step should leave the result visible (e.g. the confirmation page). If the goal asks a question, add a last step that opens what's needed to answer it.`,
      tools: [PLAN_TOOL],
      tool_choice: { type: "auto" },
      messages: [{ role: "user", content: `Goal: ${goal}${sofar}${why}` }],
    },
    PLAN_TOOL.name
  );
  if (!r.ok) return r;
  return { ok: true as const, steps: (r.data.steps ?? []).filter((s) => s?.do).slice(0, 12).map((s) => ({ do: s.do, done_when: s.done_when || "", proof: s.proof?.kind && s.proof.value ? s.proof : undefined, status: "todo" as StepStatus, tries: 0 })) };
}

function screenContent(v: { jpeg?: string; pageText?: string; url?: string; title?: string }, text: string) {
  const content: unknown[] = [];
  if (v.jpeg) content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: v.jpeg } });
  const page = v.pageText ? `\n\nThe web page now (${v.title ?? ""} ${v.url ?? ""}):\n${v.pageText.slice(0, 12000)}` : "";
  content.push({ type: "text", text: text + page });
  return content;
}

/** The AI check. With the page's text, the small fast model reads it; only without it does the big one look at a screenshot. */
async function check(step: JobStep, v: Look, said: string) {
  return callTool<{ done: boolean; evidence: string; fix: string }>(
    {
      model: v.pageText && !v.jpeg ? models.fast() : models.smart(),
      max_tokens: 600,
      system: `${persona()}\n${RULES}\nCheck one step. Be strict: only say done if the screen or page clearly shows it. Milo's hands sometimes claim success when nothing happened.`,
      tools: [CHECK_TOOL],
      tool_choice: { type: "auto" },
      messages: [{ role: "user", content: screenContent(v, `Step: ${step.do}\nDone when: ${step.done_when}\nMilo's hands said afterwards: "${said.slice(0, 300)}"`) }],
    },
    CHECK_TOOL.name
  );
}

async function finalCheck(goal: string, steps: JobStep[], v: Look) {
  return callTool<{ complete: boolean; missing: string[]; summary: string }>(
    {
      model: v.pageText && !v.jpeg ? models.fast() : models.smart(),
      max_tokens: 900,
      system: `${persona()}\n${RULES}\nThe steps are finished. Check the WHOLE goal against what's on screen. If the goal asked a question, the summary must answer it.`,
      tools: [GOAL_TOOL],
      tool_choice: { type: "auto" },
      messages: [{ role: "user", content: screenContent(v, `Goal: ${goal}\nSteps done:\n${steps.map((s, i) => `${i + 1}. [${s.status}] ${s.do}${s.note ? ` (${s.note})` : ""}`).join("\n")}`) }],
    },
    GOAL_TOOL.name
  );
}

// ---------- running a job ----------
let running: string | null = null;
export const jobRunning = () => running;

/** Steps that can't be undone: the job always waits for a yes before these. */
const FINAL = /\b(submit|send|post|publish|pay|buy|purchase|place (the |my |an? )?order|check ?out|delete|finish and submit|turn (it )?in)\b/i;
const RISKY = /\b(submit|send|post|publish|pay|buy|purchase|place (the |my )?order|check ?out|delete|sign up|register|enroll|apply)\b/i;

export async function startJob(goal: string, deps: JobDeps, opts: { approved?: boolean } = {}): Promise<Job> {
  const j: Job = {
    id: `j${Date.now().toString(36)}`,
    goal: goal.trim(),
    steps: [],
    status: "planning",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    replans: 0,
    approved: !!opts.approved,
    actions: 0,
  };
  if (budget() === "hard") {
    j.status = "failed";
    j.question = "I've done a ton of heavy lifting today, so big jobs are paused until tomorrow.";
    save(j, deps);
    return j;
  }
  save(j, deps);
  bb("job", "start", { goal: j.goal.slice(0, 200), approved: j.approved });
  startMeter(j.id);
  const p = await plan(j.goal, []);
  if (!p.ok) {
    j.status = "failed";
    j.question = p.text;
    save(j, deps);
    return j;
  }
  j.steps = p.steps;
  bb("job", "planned", { steps: j.steps.map((s) => s.do.slice(0, 80)) });
  return runJob(j, deps);
}

/** Pick a job back up (after stop, a crash, or your yes). */
export async function resumeJob(id: string | null, deps: JobDeps, opts: { approve?: boolean } = {}): Promise<Job | null> {
  const j = id ? all().find((x) => x.id === id) : resumable();
  if (!j) return null;
  if (opts.approve) j.approved = true;
  j.question = undefined;
  bb("job", "resume", { id: j.id, from: j.steps.findIndex((s) => s.status !== "done") + 1, approve: !!opts.approve });
  return runJob(j, deps);
}

async function runJob(j: Job, deps: JobDeps): Promise<Job> {
  if (running && running !== j.id) {
    j.status = "paused";
    j.question = "I'm already working on something else. Say 'keep going' when that's done.";
    save(j, deps);
    return j;
  }
  running = j.id;
  deps.resetAbort();
  startMeter(j.id); // (again on resume: each run's cost adds to the job's total)
  const base = { cost: j.cost ?? 0, calls: j.aiCalls ?? 0 };
  const tally = () => {
    const m = readMeter(j.id);
    j.cost = Math.round((base.cost + m.cost) * 10000) / 10000;
    j.aiCalls = base.calls + m.calls;
  };
  onSave = (x) => {
    if (x.id === j.id) tally(); // the card shows cost live
  };
  const stopNow = () => {
    j.status = "stopped";
    const cur = j.steps.find((s) => s.status === "doing" || s.status === "retrying");
    if (cur) cur.status = "todo";
    save(j, deps);
    bb("job", "stopped", { id: j.id, done: j.steps.filter((s) => s.status === "done").length });
    return j;
  };
  try {
    j.status = "running";
    save(j, deps);
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < j.steps.length; i++) {
        const step = j.steps[i];
        if (step.status === "done" || step.status === "skipped") continue;
        if (!j.approved && FINAL.test(step.do)) {
          j.status = "needs_you";
          j.question = `Everything's ready. Next I'd ${step.do.split("\n")[0].replace(/^./, (c) => c.toLowerCase())}. Want me to go ahead?`;
          save(j, deps);
          bb("job", "needs_you", { step: i + 1, guard: true });
          return j;
        }
        let ok = false;
        let fix = "";
        for (let attempt = step.tries; attempt < 3; attempt++) {
          if (deps.aborted()) return stopNow();
          step.status = attempt === 0 ? "doing" : "retrying";
          step.tries = attempt + 1;
          save(j, deps);
          const context = `(Part of a bigger job: "${j.goal}". This step only.)`;
          const permission = j.approved ? "\n(The student already approved submitting / sending / buying for this job: go ahead without asking.)" : "";
          const retry = attempt > 0 ? `\n(The last try didn't work: ${fix || step.note || "it didn't happen"}. Do it a different way this time.)` : "";
          let r = await deps.doTask(`${step.do}\n${context}${permission}${retry}`);
          j.actions++;
          if (deps.aborted()) return stopNow();
          if (r.status === "quick" && r.rest) {
            r = await deps.doTask(`${r.rest}\n${context}${permission}`);
            j.actions++;
          }
          if (r.status === "stopped") return stopNow();
          if (r.status === "blocked") {
            // a sign-in / 2-step code / "are you human": the student's part, and it doesn't count as a failed try
            step.status = "todo";
            step.tries = attempt;
            j.status = "needs_you";
            j.question = r.text ?? "I need you to sign in first.";
            save(j, deps);
            bb("job", "blocked", { step: i + 1, question: j.question });
            return j;
          }
          if (r.status === "ask" && j.approved && RISKY.test(r.text ?? "")) {
            // already approved: his hands asked anyway, so give them the yes and let them do it
            r = await deps.doTask(`${step.do}\n${context}\n(Yes: the student already approved this. Do it now, don't ask again.)`);
            j.actions++;
            if (r.status === "stopped" || deps.aborted()) return stopNow();
          }
          if (r.status === "ask") {
            // Milo's hands want a yes (usually before submitting / sending / buying): wait for the student.
            {
              step.status = "todo";
              step.tries = attempt;
              j.status = "needs_you";
              j.question = r.text ?? "Should I go ahead?";
              save(j, deps);
              bb("job", "needs_you", { step: i + 1, question: j.question });
              return j;
            }
          }
          // CHECK it really happened: first from the page itself (free), then the AI.
          let v: Look = await deps.look({ shot: false }).catch(() => ({}));
          const cheap = cheapCheck(step.proof, v);
          if (cheap === true) {
            step.status = "done";
            step.note = `Checked on the page: ${step.proof!.kind.replace("_", " ")} "${step.proof!.value}"`;
            j.cheapChecks = (j.cheapChecks ?? 0) + 1;
            ok = true;
            verifyRecipe(step.do);
            bb("job", "step_done", { step: i + 1, tries: attempt + 1, cheap: true });
            break;
          }
          if (!v.pageText) v = await deps.look({ shot: true }).catch(() => ({})); // no page to read (an app, a canvas page): look at the screen
          const c = await check(step, v, r.text ?? "");
          if (c.ok && c.data.done) {
            step.status = "done";
            step.note = c.data.evidence.slice(0, 200);
            ok = true;
            verifyRecipe(step.do);
            bb("job", "step_done", { step: i + 1, tries: attempt + 1, evidence: step.note });
            break;
          }
          if ((r as { replayed?: boolean }).replayed) failRecipe(step.do); // memory replay didn't hold up
          fix = c.ok ? c.data.fix || c.data.evidence : r.text ?? "";
          step.note = (c.ok ? c.data.evidence : r.text ?? "").slice(0, 200);
          bb("job", "step_retry", { step: i + 1, attempt: attempt + 1, why: step.note, fix: fix.slice(0, 200) });
        }
        save(j, deps);
        if (ok) continue;
        // stuck on this step: re-plan the rest once, a different way
        step.status = "failed";
        if (j.replans < 2) {
          j.replans++;
          const done = j.steps.filter((s) => s.status === "done");
          const p = await plan(j.goal, done, `"${step.do}" didn't work after 3 tries: ${step.note ?? ""}`);
          if (p.ok && p.steps.length) {
            j.steps = [...j.steps.slice(0, i + 1), ...p.steps];
            bb("job", "replanned", { after: i + 1, steps: p.steps.map((s) => s.do.slice(0, 80)) });
            save(j, deps);
            continue;
          }
        }
        j.status = "stuck";
        j.question = `I got stuck on: ${step.do}. ${step.note ?? ""}`.slice(0, 400);
        save(j, deps);
        bb("job", "stuck", { step: i + 1, note: step.note });
        return j;
      }
      // all steps done: does the WHOLE goal hold?
      j.status = "checking";
      save(j, deps);
      let v: Look = await deps.look({ shot: false }).catch(() => ({}));
      if (!v.pageText) v = await deps.look({ shot: true }).catch(() => ({}));
      const g = await finalCheck(j.goal, j.steps, v);
      if (!g.ok || g.data.complete || !g.data.missing.length) {
        j.status = "done";
        j.summary = g.ok ? g.data.summary : "Done.";
        save(j, deps);
        bb("job", "done", { id: j.id, steps: j.steps.length, actions: j.actions, replans: j.replans });
        return j;
      }
      // something's missing: add steps for it and go again
      bb("job", "gaps", { missing: g.data.missing });
      j.steps.push(...g.data.missing.slice(0, 4).map((m) => ({ do: m, done_when: m, status: "todo" as StepStatus, tries: 0 })));
      j.status = "running";
      save(j, deps);
    }
    j.status = "stuck";
    j.question = "I did every step but it still isn't all the way done. Can you take a look?";
    save(j, deps);
    return j;
  } catch (e) {
    j.status = "failed";
    j.question = (e as Error).message;
    save(j, deps);
    bb("job", "error", { error: (e as Error).message });
    return j;
  } finally {
    tally();
    save(j, deps);
    stopMeter(j.id);
    onSave = null;
    running = null;
  }
}

/** Is this a long, multi-part task (a job) rather than a quick one? */
export function isJob(text: string): boolean {
  const t = text.toLowerCase();
  if (t.length < 25) return false;
  const clauses = t.split(/\b(?:and then|then|after that|and also|, and|;)\b/).filter((x) => x.trim().length > 6).length;
  const big = /\b(complete|finish|fill (it )?out|fill in|sign (me )?up|register|apply|do (all|every|each|the whole)|every|whole|entire|all of the|each of|step by step|go through|research .* and|compare|find .* and (then )?(add|buy|book|send|write|make)|take care of|handle)\b/.test(t);
  // how many separate things it asks for ("go to… add… check out… place the order" = 4)
  const verbs = new Set(t.match(/\b(go to|open|add|buy|check ?out|place|fill|type|enter|click|press|pick|choose|select|submit|send|write|make|find|answer|save|change|upload|download|compare|book|sign)\b/g) ?? []).size;
  return clauses >= 3 || verbs >= 4 || (big && (clauses >= 2 || verbs >= 2 || t.length > 60));
}
