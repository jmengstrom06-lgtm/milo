// Graded work is the student's to turn in: Milo never clicks that button, even with a yes.
import { describe, expect, it, vi } from "vitest";
vi.mock("electron", () => ({ app: { getPath: () => "/tmp/milo-graded-test" } }));
vi.mock("../src/main/blackbox", () => ({ log: () => {} }));
vi.mock("../src/main/usage", () => ({ budget: () => ({ ok: true }), readMeter: () => ({ cost: 0, calls: 0 }), startMeter: () => {}, stopMeter: () => ({ cost: 0, calls: 0 }) }));
const PLAN = [
  { do: 'In Chrome, go to https://tcu.brightspace.com/d2l/home and open "Problem Set 7" in Statistics.', done_when: "open" },
  { do: "Answer questions 1 to 5 in the boxes.", done_when: "filled" },
  { do: "Click Submit to turn in the assignment.", done_when: "submitted" },
];
vi.mock("../src/main/brain", () => ({
  persona: () => "",
  callTool: async (body: { tools: { name: string }[] }) => {
    const n = body.tools?.[0]?.name ?? "";
    if (/plan/i.test(n)) return { ok: true, data: { steps: PLAN } };
    if (/final|complete/i.test(n)) return { ok: true, data: { complete: true, missing: [], summary: "done" } };
    return { ok: true, data: { done: true, evidence: "seen", fix: "" } };
  },
}));
import { turnInStep, turnsInGradedWork } from "../src/main/commit";
import { startJob } from "../src/main/jobs";

describe("the turn-in button on a class site is never Milo's", () => {
  it.each([
    ["Submit", "https://tcu.brightspace.com/d2l/lms/dropbox/user/folder_submit_files.d2l?ou=1"],
    ["Submit Quiz", "https://tcu.brightspace.com/d2l/lms/quizzing/user/attempt/quiz_start_frame_auto.d2l"],
    ["Turn in", "https://tcu.instructure.com/courses/1/assignments/2"],
    ["Finish attempt", "https://moodle.school.edu/mod/quiz/attempt.php"],
    ["Save and Submit", "https://www.webassign.net/web/Student/Assignment-Responses/submit"],
  ])("held: %s", (label, url) => expect(turnsInGradedWork(label, url)).toBe(true));
  it.each([
    ["Next page", "https://tcu.brightspace.com/d2l/lms/quizzing/user/attempt/quiz_start_frame_auto.d2l"],
    ["Submit", "https://forms.gle/abc"], // a club sign-up form: the normal ask-first rule, not this one
    ["Save", "https://tcu.brightspace.com/d2l/le/content/1/Home"],
  ])("not this rule: %s", (label, url) => expect(turnsInGradedWork(label, url)).toBe(false));
  it.each([
    ["Click Submit to turn in the assignment.", "complete my stats problem set"],
    ["Upload the file to the dropbox", "do my lab report"],
    ["Click Finish attempt", "take my bio quiz"],
  ])("a job step that turns in schoolwork: %s", (step, goal) => expect(turnInStep(step, goal)).toBe(true));
  it("a non-school submit isn't this rule", () => expect(turnInStep("Click Submit", "sign me up for the chess club newsletter")).toBe(false));
});

describe("the job engine stops before turning it in, even when told to", () => {
  it.each([false, true])("approved=%s: does the work, leaves the Submit to the student", async (approved) => {
    const ran: string[] = [];
    const j = await startJob("In Chrome, go to D2L, open Problem Set 7 in Statistics, complete it and turn it in.", {
      doTask: async (t) => (ran.push(t), { ok: true, status: "done", text: "done" }),
      look: async () => ({ pageText: "Problem Set 7" }),
      emit: () => {},
      aborted: () => false,
      resetAbort: () => {},
    }, { approved });
    expect(ran.length).toBe(2);
    expect(ran.some((t) => /submit|turn in/i.test(t.split("\n")[0]))).toBe(false);
    expect(j.status).toBe("done");
    expect(j.summary).toMatch(/turn it in yourself/);
  });
});
