// The 30 things students ask Milo most, each in the ways people actually say it.
// Every phrasing must land on the exact handler. "router" = the AI router decides (covered by evals/router.cases.ts).
import { describe, expect, it } from "vitest";
import { whereGoes } from "../src/renderer/exact";

const TOP30: [string, string, string[]][] = [
  ["1 what's due", "radar:list", ["what's due this week", "what do I have due tomorrow", "anything due today?", "do I have any homework due", "what's coming up", "show me my deadlines", "whats due"]],
  ["2 check D2L", "radar:scan", ["check D2L", "check for new assignments", "refresh my deadlines"]],
  ["3 start the next thing", "radar:start_first", ["start the next one", "start whatever's due first", "start my next assignment"]],
  ["4 grade now", "grade", ["what's my grade in stats", "how am I doing in econ", "what's my bio grade", "check my grade in calc", "tell me my grade for english"]],
  ["5 grade forecast", "forecast", ["what do I need on the final for a B in stats", "what do I need on the midterm to get an A in econ", "what do i need to get on the final to keep a B plus in bio"]],
  ["6 log a score", "score", ["I got an 85 on the midterm in stats", "I got 18 out of 20 on quiz 3 in econ", "I just got a B plus on my essay in english"]],
  ["7 final weight", "finalweight", ["the final is worth 25 percent in stats", "my midterm is worth 30% of my grade"]],
  ["8 practice exam", "exam", ["make me a practice midterm for stats", "give me a practice final", "make a mock exam for bio"]],
  ["9 start homework", "homework:start", ["start my stats homework", "help me start my bio lab", "let's start my econ problem set", "start my essay"]],
  ["10 resume homework", "homework:resume", ["pick up my bio lab", "continue my stats homework"]],
  ["11 handle this", "instant:handle", ["handle this", "help me with this", "what should I do here", "take care of this", "what can you do with this"]],
  ["12 worksheet: do it", "instant:sweep", ["do this whole worksheet", "finish all the problems on this page"]],
  ["13 worksheet: show me", "instant:sweep", ["show me the answers", "walk me through this worksheet", "I'll type them in", "just show me"]],
  ["14 worksheet: fill in", "instant:sweep", ["fill it in", "type them in", "fill in this worksheet and put Jake for the name", "I want these answers filled in in the boxes on the worksheet", "put the answers in the boxes", "complete this worksheet", "fill out this form", "answer this quiz"]],
  ["15 check my work", "instant:checkwork", ["check my work", "is this right", "did I get this right", "any mistakes", "check this before I submit", "does this meet the rubric"]],
  ["16 quiz me", "instant:quiz", ["quiz me", "quiz me on chapter 5", "test me on the cell cycle", "test me"]],
  ["17 lock in", "lockin", ["lock in", "lock in for 45 minutes on stats", "help me focus", "start a pomodoro", "let's lock in", "focus mode"]],
  ["18 lecture", "lecture", ["listen to my stats lecture", "record this lecture", "take notes on this lecture", "record class"]],
  ["19 my week", "instant:week", ["what's next", "fix my week", "plan my week", "what should I work on now", "I'm so behind", "get me back on track"]],
  ["20 add to calendar", "google:event", ["add a study session to my calendar tomorrow at 3", "put my bio exam on my calendar friday", "schedule a study group"]],
  ["21 read calendar", "google:calendar", ["what's on my calendar this week", "what do I have on my schedule today", "check my calendar"]],
  ["22 email", "google:draft", ["email my professor that I'll miss class", "write an email to dr smith about the extension", "draft an email to my TA"]],
  ["23 google doc", "google:doc", ["make a google doc called bio notes", "create a new google doc"]],
  ["24 write a paper", "instant:paper", ["write a 5 page paper on the civil war", "help me write an essay about climate change", "draft a research paper on social media"]],
  ["25 syllabus", "syllabus", ["read my syllabus", "read my stats syllabus", "this is my syllabus for econ"]],
  ["26 open D2L class", "instant:d2lclass", ["open my stats class on d2l", "pull up my bio assignments", "show me my econ quizzes on d2l"]],
  ["27 remember", "remember", ["remember my stats exam is friday", "remember that I work Tuesdays"]],
  ["28 undo", "undo", ["undo that", "undo", "take that back", "undo what you did"]],
  ["8b practice test", "exam", ["give me a practice test", "make me a practice test for stats"]],
  ["29 what did you do", "instant:activity", ["what did you do", "what happened while I was gone", "show me what you did"]],
  ["30 stop", "instant:hush", ["stop", "be quiet", "shh"]],
  // also common, and must never be swallowed by something else
  ["web task", "instant:task", ["open chrome and go to youtube.com", "go to the tcu library website"]],
  ["mac app", "app", ["open spotify", "quit spotify"]],
  ["home base", "home", ["open home base", "show my dashboard"]],
  ["pick an area", "pick_area", ["pick an area", "let me pick", "select this part", "let me show you the part", "only look at this part"]],
  ["whole screen again", "clear_area", ["look at the whole screen again", "forget the box"]],
  ["edit my paper", "instant:edit_paper", ["edit my paper", "proofread my essay", "fix the grammar in my paper", "make my essay sound less like AI", "tighten up my intro", "cut my essay to 800 words", "revise my draft against the rubric"]],
  ["sources", "instant:cite", ["find 5 sources for my paper", "add citations to my essay", "add a works cited page", "get me scholarly sources for my research paper"]],
  ["cite this page", "instant:cite_page", ["cite this in APA", "cite this article", "give me a citation for this page"]],
  ["discussion", "instant:discussion", ["do my discussion post for bio", "write my discussion board response", "reply to my classmates on the discussion", "help with the week 5 discussion post"]],
  ["reading", "instant:reading", ["read this chapter", "summarize this article", "make notes from this reading", "quiz me on this chapter", "go through this pdf"]],
  ["Milo's apps", "fast:open_kit", ["open your notes", "open sheets", "open the planner"]],
  ["profile", "profile", ["my major is finance", "my school email is jake@tcu.edu"]],
  ["teach / research / make (AI decides)", "router", ["teach me z-scores", "I don't get photosynthesis", "make me flashcards for bio", "graph y = x squared", "who won the TCU game last night", "explain number 3", "help me with bio"]],
];

describe("top 30 student requests land on the exact handler", () => {
  for (const [name, want, says] of TOP30)
    for (const say of says)
      it(`${name}: "${say}"`, () => {
        expect(whereGoes(say)).toBe(want);
      });
});

import { pickSpoken } from "../src/renderer/exact";
import { cleanAsk } from "../src/main/brain";

const BIO = [
  { label: "Start bio homework", say: "start my bio homework" },
  { label: "Teach me", say: "teach me today's bio topic" },
  { label: "Quiz me", say: "quiz me on bio" },
];
describe("ask when unsure", () => {
  it("picks a button by position", () => {
    expect(pickSpoken("the first one", BIO)).toBe(0);
    expect(pickSpoken("second", BIO)).toBe(1);
    expect(pickSpoken("last one", BIO)).toBe(2);
    expect(pickSpoken("third", BIO.slice(0, 2))).toBe(-1);
  });
  it("picks a button by its words", () => {
    expect(pickSpoken("quiz me", BIO)).toBe(2);
    expect(pickSpoken("the homework one", BIO)).toBe(0);
    expect(pickSpoken("teach me", BIO)).toBe(1);
  });
  it("anything else is a new command, not a pick", () => {
    expect(pickSpoken("open chrome and go to youtube", BIO)).toBe(-1);
    expect(pickSpoken("what's the weather", BIO)).toBe(-1);
  });
  it("a real ask keeps 2-3 runnable choices", () => {
    const r = cleanAsk({ kind: "ask", question: "What should we do for bio?", choices: BIO });
    expect(r.kind).toBe("ask");
    expect(r.choices).toHaveLength(3);
  });
  it("an ask with fewer than 2 usable choices becomes chat", () => {
    expect(cleanAsk({ kind: "ask", choices: [{ label: "Go", say: "go" }] }).kind).toBe("chat");
    expect(cleanAsk({ kind: "ask" }).kind).toBe("chat");
  });
  it("choices sent as a JSON string still work, and duplicates drop", () => {
    const r = cleanAsk({ kind: "ask", choices: JSON.stringify([...BIO, BIO[0]]) as unknown as typeof BIO });
    expect(r.choices).toHaveLength(3);
  });
  it("other routes pass through untouched", () => {
    expect(cleanAsk({ kind: "research", question: "x" })).toEqual({ kind: "research", question: "x" });
  });
});

import { speakMath, stripMath } from "../src/renderer/MathText";
describe("math out loud", () => {
  it("never drops Greek letters", () => {
    expect(speakMath("mean $\\mu$ and standard deviation $\\sigma$?")).toBe("mean mu and standard deviation sigma?");
    expect(speakMath("$z = \\frac{x - \\mu}{\\sigma}$")).toBe("z = x - mu over sigma");
    expect(stripMath("$\\mu$ and $\\sigma$")).toBe("μ and σ");
    expect(stripMath("$\\left(a\\right) \\le b$")).toBe("(a) ≤ b");
  });
});

import { parse as parseLong } from "../src/renderer/commands";
describe("edit my paper, said the long way", () => {
  it.each([
    "I have a paper open called Milo Test Paper. There's a bunch of grammar mistakes like spelling and stuff. I want you to look through it and fix all of it, please.",
    "I have a paper open in my Google Docs. I want you to look through it and look for any grammar mistakes and correct them",
    "can you go through my essay and fix the spelling",
    "look through the paper and find any grammar or mistakes and correct them",
    "I have a Google document paper open in the bottom of my screen, why Sleep Matters in college. I want you to look through it and reword anything that sounds off and fix my mistakes.",
  ])("%s", (s) => expect((parseLong(s, {} as never) as { kind: string }).kind).toBe("edit_paper"));
  it.each([
    ["write a paper on the french revolution", "paper"],
    ["find 5 sources for my paper", "cite"],
  ])("%s", (s, k) => expect((parseLong(s, {} as never) as { kind: string }).kind).toBe(k));
});

import { brainTrouble } from "../src/main/brain";
describe("brain errors are said plainly", () => {
  it("out of credits", () => expect(brainTrouble(400, '{"error":{"message":"Your credit balance is too low to access the Anthropic API."}}')).toMatch(/out of credits/));
  it("never reads JSON", () => expect(brainTrouble(400, '{"type":"error"}')).not.toMatch(/[{}]/));
});

describe("undo by voice never becomes computer control", () => {
  it.each(["undo the changes you just made to my paper", "undo all the edits", "remove the citations you added", "put my paper back", "undo your changes"])("%s", (s) =>
    expect((parseLong(s, {} as never) as { kind: string }).kind).toBe("undo")
  );
});
import { editBrief } from "../src/main/writing";
describe("what kind of edit they asked for", () => {
  it("grammar only", () => expect(editBrief("fix the grammar in my paper")).toMatch(/Fix only grammar/));
  it("grammar AND wording = both", () => {
    const b = editBrief("edit any bad grammar and any bad wording");
    expect(b).not.toMatch(/Fix only grammar/);
    expect(b).toMatch(/fix the wording/);
  });
  it("make it sound better", () => expect(editBrief("look for grammar mistakes and make it sound better")).toMatch(/fix the wording/));
});
