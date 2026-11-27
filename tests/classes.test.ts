import { describe, it, expect } from "vitest";
import { crossClass, gradesOf, quizzesOf, readClass, snapshotText, submittedOf, type Snapshot } from "../src/main/classData";
import { cleanAnswer } from "../src/main/classesAsk";
import { discussionPlan } from "../src/main/discussions";
import { pickMaterial, unitsOf } from "../src/main/quizPrep";
import { isClassesQ } from "../src/renderer/commands";
import type { Course } from "../src/main/d2l";

const STATS: Course = { id: 101, name: "Statistical Analysis 2023 050", short: "Statistical Analysis", code: "STAT2023", subject: "STAT" };
const NOW = Date.parse("2026-11-27T18:00:00Z");

describe("gradesOf: every item exactly as D2L has it", () => {
  const objs = [
    { Id: 1, Name: "Exam 1", CategoryId: 10, MaxPoints: 50, Weight: 0 },
    { Id: 2, Name: "Exam 2", CategoryId: 10, MaxPoints: 100 },
    { Id: 3, Name: "HW 1", CategoryId: 11, MaxPoints: 10 },
    { Id: 4, Name: "Final Exam", CategoryId: 12, MaxPoints: 100 },
    { Id: 5, Name: "Participation", GradeType: "Text" },
    { Id: 6, Name: "Exams", GradeType: "Category" },
  ];
  const cats = [
    { Id: 10, Name: "Exams", Weight: 50 },
    { Id: 11, Name: "Homework", Weight: 20 },
    { Id: 12, Name: "Final", Weight: 30 },
  ];
  const vals = [
    { GradeObjectIdentifier: "1", PointsNumerator: 42, PointsDenominator: 50, DisplayedGrade: "84 %", Comments: { Html: "<p>Nice work on #3&nbsp;but check units.</p>" }, LastModified: "2026-10-03T15:00:00Z" },
    { GradeObjectIdentifier: "2", PointsNumerator: 91, PointsDenominator: 100, DisplayedGrade: "91 %" },
    { GradeObjectIdentifier: "3", PointsNumerator: 10, PointsDenominator: 10 },
    { GradeObjectIdentifier: "99", GradeObjectName: "Bonus", PointsNumerator: 2, PointsDenominator: 2 },
  ];
  const g = gradesOf(objs, cats, vals, { DisplayedGrade: "88.5 %", PointsNumerator: 88.5, PointsDenominator: 100 });
  it("scores, out of, percent, category, feedback in plain words", () => {
    const e1 = g.grades.find((x) => x.name === "Exam 1")!;
    expect(e1).toMatchObject({ score: 42, outOf: 50, pct: 84, category: "Exams", feedback: "Nice work on #3 but check units." });
  });
  it("ungraded items stay ungraded (never guessed), with their max points", () => expect(g.grades.find((x) => x.name === "Final Exam")).toMatchObject({ score: null, pct: null, outOf: 100 }));
  it("category rows aren't items; a released value with no item is kept", () => {
    expect(g.grades.some((x) => x.name === "Exams")).toBe(false);
    expect(g.grades.find((x) => x.name === "Bonus")?.pct).toBe(100);
  });
  it("category percents are points-weighted: (42+91)/(50+100)", () => expect(g.categories.find((k) => k.name === "Exams")?.pct).toBe(88.7));
  it("a category with nothing graded is null, not 0", () => expect(g.categories.find((k) => k.name === "Final")?.pct).toBeNull());
  it("the current grade comes from D2L", () => expect(g.current).toEqual({ pct: 88.5, shown: "88.5 %" }));
  it("no final grade released = null", () => expect(gradesOf(objs, cats, [], null).current).toBeNull());
});

describe("quizzesOf", () => {
  it("reads the paged shape, time limits and attempts", () => {
    const q = quizzesOf({
      Objects: [
        { QuizId: 7, Name: "Quiz 5: Ch 7", DueDate: "2026-12-01T05:59:00Z", TimeLimit: { IsEnforced: true, TimeLimitValue: 30 }, AttemptsAllowed: { IsUnlimited: false, NumberOfAttemptsAllowed: 2 }, Description: { Text: { Html: "<p>Covers chapter 7</p>" } } },
        { QuizId: 8, Name: "Practice", AttemptsAllowed: { IsUnlimited: true }, TimeLimit: { IsEnforced: false, TimeLimitValue: 90 } },
        { QuizId: 9, Name: "Hidden", IsActive: false },
      ],
    });
    expect(q.map((x) => x.name)).toEqual(["Quiz 5: Ch 7", "Practice"]);
    expect(q[0]).toMatchObject({ minutes: 30, attempts: 2, about: "Covers chapter 7" });
    expect(q[1]).toMatchObject({ minutes: null, attempts: null }); // not enforced = no limit; unlimited = null
  });
  it("reads a plain array too", () => expect(quizzesOf([{ QuizId: 1, Name: "Q", TimeLimitValue: 15 }])[0].minutes).toBe(15));
  it("garbage = nothing", () => expect(quizzesOf(null)).toEqual([]));
});

describe("submittedOf", () => {
  it("submissions = turned in, latest date", () => expect(submittedOf([{ Submissions: [{ SubmissionDate: "2026-11-01T00:00:00Z" }, { SubmissionDate: "2026-11-02T00:00:00Z" }] }])).toEqual({ submitted: true, at: "2026-11-02T00:00:00Z" }));
  it("status published/submitted counts", () => expect(submittedOf({ Status: 3 }).submitted).toBe(true));
  it("empty = not turned in", () => expect(submittedOf([]).submitted).toBe(false));
  it("no answer = unknown, not 'no'", () => expect(submittedOf(null).submitted).toBeNull());
});

describe("which classes a question needs", () => {
  it.each(["what's my worst class", "which class am I doing best in", "my average across all my classes", "is stats my lowest grade out of my classes"])("all: %s", (q) => expect(crossClass(q)).toBe(true));
  it.each(["what's my grade in stats", "did I submit the lab report for bio", "when is my next stats quiz"])("one: %s", (q) => expect(crossClass(q)).toBe(false));
});

describe("readClass: one class, every part, failures listed (never guessed)", () => {
  const L = "/d2l/api/le/1.100/101";
  const data: Record<string, unknown> = {
    [`${L}/grades/`]: [{ Id: 1, Name: "Exam 1", MaxPoints: 50 }],
    [`${L}/grades/categories/`]: [],
    [`${L}/grades/values/myGradeValues/`]: [{ GradeObjectIdentifier: "1", PointsNumerator: 45, PointsDenominator: 50 }],
    [`${L}/grades/final/values/myGradeValue`]: { DisplayedGrade: "90 %" },
    [`${L}/dropbox/folders/`]: [
      { Id: 5, Name: "Lab 4", DueDate: "2026-11-30T05:59:00Z" },
      { Id: 6, Name: "Lab 9", DueDate: "2027-03-01T05:59:00Z" },
    ],
    [`${L}/dropbox/folders/5/submissions/mysubmissions/`]: [{ Submissions: [{ SubmissionDate: "2026-11-26T20:00:00Z" }] }],
    [`${L}/discussions/forums/`]: [{ ForumId: 3, Name: "Weekly" }],
    [`${L}/discussions/forums/3/topics/`]: [
      { TopicId: 30, Name: "Week 13", DueDate: "2026-11-29T05:59:00Z" },
      { TopicId: 31, Name: "Week 14", DueDate: "2026-12-06T05:59:00Z" },
    ],
    [`${L}/discussions/forums/3/topics/30/posts/`]: [
      { PostingUserId: 77, ParentPostId: null },
      { PostingUserId: 77, ParentPostId: 900 },
      { PostingUserId: 12, ParentPostId: null },
    ],
    [`${L}/discussions/forums/3/topics/31/posts/`]: [{ PostingUserId: 12, ParentPostId: null }],
  };
  const get = async <T,>(p: string): Promise<T> => {
    if (p in data) return data[p] as T;
    throw new Error("D2L said 403");
  };
  it("reads it all; quizzes failed and says so", async () => {
    const c = await readClass(get, STATS, 77, NOW);
    expect(c.current?.pct).toBe(90);
    expect(c.grades[0]).toMatchObject({ name: "Exam 1", pct: 90 });
    expect(c.discussions.map((d) => [d.name, d.posted, d.replies])).toEqual([
      ["Week 13", true, 1],
      ["Week 14", false, 0],
    ]);
    expect(c.assignments.map((a) => [a.name, a.submitted])).toEqual([
      ["Lab 4", true],
      ["Lab 9", null], // too far out to check: unknown, not "no"
    ]);
    expect(c.unread).toEqual(["quizzes"]);
  });
  it("a slow or failing class doesn't throw", async () => {
    const c = await readClass(async () => Promise.reject(new Error("down")), STATS, 77, NOW);
    expect(c.unread).toEqual(expect.arrayContaining(["grades", "quizzes", "assignments", "discussions"]));
    expect(c.current).toBeNull();
  });
});

describe("snapshotText: what the answerer reads", () => {
  const snap: Snapshot = {
    at: NOW,
    all: true,
    classes: [
      {
        course: STATS,
        current: { pct: 88.5, shown: "88.5 %" },
        categories: [{ name: "Exams", weight: 50, pct: 88.7 }],
        grades: [
          { id: 1, name: "Exam 1", category: "Exams", score: 42, outOf: 50, pct: 84, shown: "84 %", weight: null, feedback: "Check units.", when: "2026-10-03T15:00:00Z" },
          { id: 4, name: "Final Exam", category: "Final", score: null, outOf: 100, pct: null, shown: "", weight: 30, feedback: "", when: null },
        ],
        quizzes: [{ id: 7, name: "Quiz 5", due: "2026-12-01T05:59:00Z", start: null, end: null, minutes: 30, attempts: 2, about: "" }],
        discussions: [{ forumId: 3, topicId: 30, name: "Week 13", forum: "Weekly", due: "2026-11-29T05:59:00Z", end: null, locked: false, posted: false, replies: 0 }],
        assignments: [{ id: 5, name: "Lab 4", due: "2026-11-30T05:59:00Z", submitted: true, at: "2026-11-26T20:00:00Z" }],
        unread: [],
      },
      { course: { ...STATS, id: 102, short: "Biology", name: "Biology 1003" }, current: { pct: 79, shown: "79 %" }, categories: [], grades: [], quizzes: [], discussions: [], assignments: [], unread: ["quizzes"] },
    ],
  };
  const t = snapshotText(snap, NOW);
  it.each([
    "Current grades: Statistical Analysis 88.5%, Biology 79%. Average of these: 83.8%.",
    "Exam 1 [Exams]: 42/50 = 84%",
    'Feedback: "Check units."',
    "Not graded yet: Final Exam (worth 30%)",
    "30 min time limit, 2 attempts",
    "you haven't posted",
    "Lab 4: due",
    "turned in",
    "Couldn't read from D2L: quizzes",
    "Exams 50% (88.7% so far)",
  ])("has %s", (x) => expect(t).toContain(x));
});

describe("cleanAnswer", () => {
  it("keeps known actions, drops em dashes", () => {
    const a = cleanAnswer({ answer: "You got an 84 — not bad.", rows: [{ label: "Exam 1", value: "42/50" }], action: { kind: "forecast", course: "stats", letter: "b+", exam: "" } });
    expect(a.answer).toBe("You got an 84, not bad.");
    expect(a.action).toEqual({ kind: "forecast", course: "stats", letter: "B+", exam: "final" });
  });
  it("unknown action = none; open with a bad page = home", () => {
    expect(cleanAnswer({ answer: "x", action: { kind: "submit_quiz" } }).action.kind).toBe("none");
    expect(cleanAnswer({ answer: "x", action: { kind: "open", course: "bio", page: "nope" } }).action).toEqual({ kind: "open", course: "bio", page: "home" });
  });
  it("a plain question never opens a page or starts a draft", () => {
    expect(cleanAnswer({ answer: "x", action: { kind: "open", course: "english", page: "quizzes" } }, "do I have any quizzes in english").action.kind).toBe("none");
    expect(cleanAnswer({ answer: "x", action: { kind: "open", course: "stats", page: "grades" } }, "pull up my stats grades").action.kind).toBe("open");
    expect(cleanAnswer({ answer: "x", action: { kind: "discussion", course: "psych" } }, "did I post in psych").action.kind).toBe("none");
    expect(cleanAnswer({ answer: "x", action: { kind: "quiz_prep", course: "bio" } }, "help me get ready for my bio quiz").action.kind).toBe("quiz_prep");
  });
  it("forecast without a letter isn't a forecast", () => expect(cleanAnswer({ answer: "x", action: { kind: "forecast" } }).action.kind).toBe("none"));
});

describe("discussionPlan: what the request needs, given what's already posted", () => {
  const P = (id: number, userId: number, who: string, parentId: number | null = null) => ({ id, parentId, userId, who, subject: "", text: "x".repeat(60), at: "" });
  const prompt = "Write at least 200 words and reply to two classmates.";
  const ME = 77;
  const others = [P(1, 10, "Sarah Lopez"), P(2, 11, "Marcus Hill"), P(3, 12, "Ava Chen")];
  it("nothing posted: the main post + the replies it asks for", () => expect(discussionPlan("do my discussion post for psych", prompt, others, ME)).toMatchObject({ mode: "post", replies: 2 }));
  it("posted, no replies yet: just the 2 replies", () => expect(discussionPlan("do my discussion post", prompt, [...others, P(4, ME, "Me")], ME)).toMatchObject({ mode: "replies", replies: 2, posted: true }));
  it("posted and replied once: 1 still owed, and not to the same person", () => {
    const p = discussionPlan("finish my discussion", prompt, [...others, P(4, ME, "Me"), P(5, ME, "Me", 1)], ME);
    expect(p).toMatchObject({ mode: "replies", replies: 1, repliedTo: [1] });
  });
  it("everything done: done", () => expect(discussionPlan("do my discussion post", prompt, [...others, P(4, ME, "Me"), P(5, ME, "Me", 1), P(6, ME, "Me", 2)], ME).mode).toBe("done"));
  it("'reply to two classmates' = replies only, even before the main post", () => expect(discussionPlan("I have to reply to two classmates in psych", prompt, others, ME)).toMatchObject({ mode: "replies", replies: 2 }));
  it("'reply to Sarah's post' = one reply to Sarah", () => expect(discussionPlan("reply to sarah's post", prompt, others, ME)).toMatchObject({ mode: "replies", replies: 1, target: "Sarah Lopez" }));
  it("a name nobody posted under is flagged, not guessed", () => expect(discussionPlan("respond to jordan", prompt, others, ME)).toMatchObject({ target: null, named: "jordan" }));
  it("'reply to one more' after replying = 1 more", () => expect(discussionPlan("reply to one more classmate", prompt, [...others, P(4, ME, "Me"), P(5, ME, "Me", 1), P(6, ME, "Me", 2)], ME)).toMatchObject({ mode: "replies", replies: 1 }));
  it("no reply requirement and posted: done", () => expect(discussionPlan("do my discussion post", "Write 150 words.", [...others, P(4, ME, "Me")], ME).mode).toBe("done"));
});

describe("quiz prep: which class files a quiz covers", () => {
  const T = (Title: string, path: string, Url = "/x.pdf") => ({ Title, Url, path });
  const files = [
    T("Syllabus", "Start Here"),
    T("Chapter 6 slides", "Week 9 > Chapter 6"),
    T("Chapter 7 slides", "Week 10 > Chapter 7"),
    T("Ch 7 lecture notes: sampling distributions", "Week 10 > Chapter 7", "/n.docx"),
    T("Confidence intervals worksheet", "Week 11 > Chapter 8"),
  ];
  it("chapter numbers", () => expect(unitsOf("Quiz over Chapters 7-8")).toEqual([7, 8]));
  it("the chapter it names, not the syllabus or other chapters", () => expect(pickMaterial(files, { name: "Quiz 5", about: "Covers chapter 7" }).map((t) => t.Title).sort()).toEqual(["Ch 7 lecture notes: sampling distributions", "Chapter 7 slides"]));
  it("topic words when there's no number", () => expect(pickMaterial(files, { name: "Confidence Intervals Quiz" })[0].Title).toBe("Confidence intervals worksheet"));
  it("a quiz number stands in for the chapter when nothing else says", () => expect(pickMaterial(files, { name: "Quiz 6" })[0].Title).toBe("Chapter 6 slides"));
  it("nothing related = nothing (no random files)", () => expect(pickMaterial(files, { name: "Midterm" })).toEqual([]));
});

describe("questions about their own class data go to the classes answerer", () => {
  it.each([
    "what's my grade in stats",
    "what did I get on exam 2",
    "did I turn in the lab report",
    "did I submit my essay for english",
    "when's my next quiz",
    "how long is my bio quiz",
    "how many attempts do I get on the stats quiz",
    "did I post in psych this week",
    "am I missing anything in bio",
    "what did my professor say on my essay",
    "any new grades for me",
    "which class am I doing worst in",
    "am I passing chemistry",
    "milo, how am I doing in econ",
  ])("yes: %s", (q) => expect(isClassesQ(q.toLowerCase())).toBe(true));
  it.each([
    "do my discussion post for bio",
    "what do I need on the final for a B in stats",
    "what's due this week",
    "what is a t test",
    "what's the answer to question 3 on my quiz",
    "quiz me on my stats notes",
    "help me study for my bio quiz",
    "reply to two classmates in psych",
    "open chrome",
    "pull up my bio assignments",
  ])("no: %s", (q) => expect(isClassesQ(q.toLowerCase())).toBe(false));
});
