// Router evals: real things Jake said (from the black-box logs) + edge cases, with the right decision.
// Run against the REAL AI: `npm run eval`. Every bug you flag becomes a new case here, so it can't come back.
//
// expect.kind can list several acceptable kinds. app = which Milo app (for kit). after = true means
// a multi-step request: the router must hand back the rest ("after") so nothing gets dropped.

export type Ctx = {
  researchOpen?: boolean;
  researchTopic?: string;
  inLesson?: boolean;
  lessonTopic?: string;
  toolOpen?: string;
  kitOpen?: string;
  quizOpen?: boolean;
  lastCommand?: string;
};
export type Case = { say: string; ctx?: Ctx; expect: { kind: string | string[]; app?: string; after?: boolean }; real?: boolean; note?: string };

const SHEET: Ctx = { kitOpen: `Milo's Sheet (class: Statistics), showing "Example: Stats Exam Scores": 30 rows, columns Student, Exam Score (%), with a histogram of Exam Score (%)`, lastCommand: "Open up your sheets and make me a histogram." };
const SHEET_EMPTY: Ctx = { kitOpen: `Milo's Sheet, showing "Sheet": an empty sheet`, lastCommand: "open sheet." };
const STUDY: Ctx = { kitOpen: `Milo's Study app (class: Statistics), practice mode on "Normal distribution: P(X > x)", waiting for the student's answer` };
const STUDY_DONE: Ctx = { kitOpen: `Milo's Study app, worked mode on "Normal distribution: P(X > x)"` };
const NOTES: Ctx = { kitOpen: `Milo's Notes app, note "Bio exam" open` };
const SKETCH: Ctx = { kitOpen: `Milo's Sketch app, showing "P(X > 78) for N(70, 5)"` };
const RESEARCH: Ctx = { researchOpen: true, researchTopic: "When does TCU play next for basketball?" };
const UFC: Ctx = { researchOpen: true, researchTopic: "Who is Usman Nurmagomedov?" };

export const CASES: Case[] = [
  // ---- real (from the logs) -----------------------------------------------------------------
  { real: true, say: "open chrome, go to the TCU library website and tell me today's hours", expect: { kind: ["task", "research"] }, note: "a real library website, not Milo's saved work" },
  { say: "what are the library hours today", expect: { kind: ["research", "task", "chat"] } },
  { real: true, say: "How are you today?", expect: { kind: "chat" } },
  { real: true, say: "open a Chrome tab for me with depogram.com on it", expect: { kind: "task" } },
  { real: true, say: "open ChatGPT and ask it to write a short story about a frog", expect: { kind: "task" } },
  { real: true, say: "close ChatGPT and then open Chrome and find out when the next TCU basketball game is", expect: { kind: "task" } },
  { real: true, say: "Um, access my screen in Chrome. It has D2L open and find out when my next exam is.", expect: { kind: ["screen_question"] } },
  { real: true, say: "um, would you open a Microsoft... or actually, no. Let's not do Microsoft. Let's do a Google Doc, and I want you to write me a little story", expect: { kind: "task" } },
  { real: true, say: "Would you open a Google Chrome tab and then search up when TCU plays next for basketball?", expect: { kind: "task" }, note: "said Chrome = task, not the research box" },
  { real: true, say: "Milo. Now could you close this tab and then open ChatGPT and have it write me a story?", ctx: RESEARCH, expect: { kind: "close", after: true } },
  { real: true, say: "just close your research tab that you just opened up and then open ChatGPT.", ctx: RESEARCH, expect: { kind: "close", after: true } },
  { real: true, say: "would you make a note that my bio exam is on Friday?", expect: { kind: "kit", app: "notes" } },
  { real: true, say: "Now would you close that note?", ctx: NOTES, expect: { kind: "close" } },
  { real: true, say: "would you now close that note and Open ChatGPT and have it write me a story?", ctx: NOTES, expect: { kind: "close", after: true } },
  { real: true, say: "I would like you to open my notes and make a note that says I have a math exam on Tuesday.", expect: { kind: "kit", app: "notes" } },
  { real: true, say: "I would like you to open ChatGPT. Have it write me a story, and then copy that story and paste it into my Claude, but don't send it yet.", expect: { kind: "task" } },
  { real: true, say: "I would like you to open up a Chrome tab and open up Google Docs. I would like you to open a blank Google Doc and write me a story.", expect: { kind: "task" } },
  { real: true, say: "I would like you to close the Chrome tab that's open, and then I would like you to go to my Claude and ask it how it's doing today.", expect: { kind: "task" } },
  { real: true, say: "Um, I would like you to open up one of your animated note guides and make a statistics problem so I can study.", expect: { kind: "kit", app: "study" } },
  { real: true, say: "what can you do?", expect: { kind: "kit_menu" } },
  { real: true, say: "could you create an image for me on the sketch of, like, a house?", ctx: SKETCH, expect: { kind: ["in_app", "kit"], app: "sketch" } },
  { real: true, say: "open your notes and make a study statistics problem and solve it so I can study.", expect: { kind: "kit", app: "study" } },
  { real: true, say: "would you open your notes and make me a statistics problem so I can study?", expect: { kind: "kit", app: "study" } },
  { real: true, say: "Move to the bottom left of my screen instead of the right. Actually, move to the middle and open what you can do.", expect: { kind: "move", after: true } },
  { real: true, say: "what features are inside the pocket?", expect: { kind: "chat" }, note: "a question about an app is answered, not opened" },
  { real: true, say: "What is the pocket? Well, like, what is it used for? What is the pocket used for?", expect: { kind: "chat" } },
  { real: true, say: "what are some cool things you can do for me to help me with school?", expect: { kind: ["kit_menu", "chat"] } },
  { real: true, say: "open sheet.", expect: { kind: "kit", app: "sheet" } },
  { real: true, say: "make me a histogram on this sheet.", ctx: SHEET_EMPTY, expect: { kind: ["in_app", "kit"], app: "sheet" } },
  { real: true, say: "open up Sheets.", ctx: STUDY_DONE, expect: { kind: "kit", app: "sheet" }, note: "bare sheets = Milo's Sheet, not Google" },
  { real: true, say: "I wanna study for statistics. Open up your sheets and make me a histogram.", expect: { kind: "kit", app: "sheet" } },
  { real: true, say: "Uh, can you close that now and open up your notes and then make a note that I have a flight in a couple hours?", ctx: SHEET, expect: { kind: "close", after: true } },

  { real: true, say: "Milo, would you close that tab with the histogram on it for me?", ctx: SHEET, expect: { kind: "close" }, note: "2026-11-18: went to Chrome" },
  { real: true, say: "close the tab with the histogram on it and close the Chrome tab.", ctx: SHEET, expect: { kind: "close", after: true } },
  { real: true, say: "close Chrome.", ctx: SHEET, expect: { kind: "task" } },

  // ---- Sheet open -------------------------------------------------------------------------------
  { say: "make it a box plot instead", ctx: SHEET, expect: { kind: "in_app" } },
  { say: "add a column with z-scores", ctx: SHEET, expect: { kind: "in_app" } },
  { say: "make me another example but skewed right", ctx: SHEET, expect: { kind: ["in_app", "kit"], app: "sheet" } },
  { say: "who scored above average", ctx: SHEET, expect: { kind: "in_app" } },
  { say: "sort it by score, highest first", ctx: SHEET, expect: { kind: "in_app" } },
  { say: "change it to a pie chart", ctx: SHEET, expect: { kind: "in_app" } },
  { say: "what's the mean of the scores", ctx: SHEET, expect: { kind: ["in_app", "chat"] } },
  { say: "okay Milo can you now close that sheet and do another test", ctx: SHEET, expect: { kind: "close", after: true } },
  { say: "cool, close the sheet", ctx: SHEET, expect: { kind: "close" } },
  { say: "open google sheets", ctx: SHEET, expect: { kind: "task" } },
  { say: "move to the bottom left", ctx: SHEET, expect: { kind: "move" } },
  { say: "close the chrome tab", ctx: SHEET, expect: { kind: "task" }, note: "Chrome is not Milo's app" },
  { say: "open your notes", ctx: SHEET, expect: { kind: "kit", app: "notes" } },
  { say: "what's the weather tomorrow", ctx: SHEET, expect: { kind: "research" } },
  { say: "now give me practice problems on this in study", ctx: SHEET, expect: { kind: "kit", app: "study" } },

  // ---- Study open, waiting for an answer -----------------------------------------------------------
  { say: "point zero five", ctx: STUDY, expect: { kind: "in_app" } },
  { say: "I think it's about five percent", ctx: STUDY, expect: { kind: "in_app" } },
  { say: "give me a harder one", ctx: STUDY, expect: { kind: "in_app" } },
  { say: "can I get a hint", ctx: STUDY, expect: { kind: "in_app" } },
  { say: "explain how you got that", ctx: STUDY, expect: { kind: ["in_app", "chat"] } },
  { say: "close this and open your sketch and draw a plant cell", ctx: STUDY, expect: { kind: "close", after: true } },
  { say: "what's the weather tomorrow", ctx: STUDY, expect: { kind: "research" } },
  { say: "make me flashcards on this instead", ctx: STUDY, expect: { kind: ["in_app", "kit"], app: "study" } },

  // ---- Notes / Sketch open ---------------------------------------------------------------------------
  { say: "add that the exam moved to Monday", ctx: NOTES, expect: { kind: "in_app" } },
  { say: "what did I write about z-scores", ctx: NOTES, expect: { kind: ["in_app", "kit"], app: "notes" } },
  { say: "quiz me on this note", ctx: NOTES, expect: { kind: ["in_app", "kit"] } },
  { say: "close notes", ctx: NOTES, expect: { kind: "close" } },
  { say: "shade above 80", ctx: SKETCH, expect: { kind: "in_app" } },
  { say: "add labels to it", ctx: SKETCH, expect: { kind: "in_app" } },

  // ---- research box open -----------------------------------------------------------------------------
  { say: "tell me more about his fight record", ctx: UFC, expect: { kind: "research" } },
  { say: "open it in chrome", ctx: RESEARCH, expect: { kind: "open_result" } },
  { say: "close this tab", ctx: RESEARCH, expect: { kind: "close" } },
  { say: "close that and open my notes", ctx: RESEARCH, expect: { kind: "close", after: true } },

  // ---- nothing open -------------------------------------------------------------------------------------
  { say: "open sheets and make me a histogram", expect: { kind: "kit", app: "sheet" } },
  { say: "make me an example histogram", expect: { kind: "kit", app: "sheet" } },
  { say: "box plot of these numbers: 4, 8, 15, 16, 23, 42", expect: { kind: "kit", app: "sheet" } },
  { say: "pie chart of my budget, rent 900, food 300, fun 100", expect: { kind: "kit", app: "sheet" } },
  { say: "make a chart of the numbers I copied", expect: { kind: "kit", app: "sheet" } },
  { say: "open notes", expect: { kind: "kit", app: "notes" } },
  { say: "open apple notes", expect: { kind: "task" } },
  { say: "open google docs and write me a story", expect: { kind: "task" } },
  { say: "teach me z-scores", expect: { kind: "kit", app: "study" } },
  { say: "make me five practice problems on derivatives", expect: { kind: "kit", app: "study" } },
  { say: "flashcards for bio", expect: { kind: "kit", app: "study" } },
  { say: "graph y equals x squared minus 3", expect: { kind: "kit", app: "sketch" } },
  { say: "what does a mitochondria look like", expect: { kind: "kit", app: "sketch" } },
  { say: "draw me a plant cell", expect: { kind: "kit", app: "sketch" } },
  { say: "plan my week for exam 3 on the 25th", expect: { kind: "kit", app: "planner" } },
  { say: "what's due this week", expect: { kind: ["brief", "screen_question"] } },
  { say: "help me with this problem", expect: { kind: "look" } },
  { say: "just do this problem for me", expect: { kind: "look" } },
  { say: "summarize this page", expect: { kind: "screen_question" } },
  { say: "who won the UFC fight last night", expect: { kind: "research" } },
  { say: "look up the TCU basketball schedule in chrome", expect: { kind: "task" } },
  { say: "move to the top right", expect: { kind: "move" } },
  { say: "get out of the way", expect: { kind: "move" } },
  { say: "hold this", expect: { kind: "hold" } },
  { say: "drop it in ChatGPT", expect: { kind: "drop" } },
  { say: "explain what a derivative is", expect: { kind: ["chat", "kit"] } },
  { say: "build me a GPA calculator", expect: { kind: "build" } },
  { say: "watch me work", expect: { kind: "watch" } },
  { say: "check my work", expect: { kind: "checkwork" } },
  { say: "do every question on this page", expect: { kind: "sweep" } },
  { say: "open youtube", expect: { kind: "task" } },
  { say: "open a new google sheet", expect: { kind: "task" } },
  { say: "write in my google doc that the meeting is at 5", expect: { kind: "task" } },
  { say: "move to the bottom left and then open your notes", expect: { kind: "move", after: true } },
  { say: "uh, okay, so, open the sheet", expect: { kind: "kit", app: "sheet" } },
  // ---- writing help on their own work --------------------------------------------------------
  { say: "can you look over my essay and make it flow better", expect: { kind: "edit_paper" } },
  { say: "my paper is like 200 words too long, trim it", expect: { kind: "edit_paper" } },
  { say: "I need 5 scholarly sources for my research paper", expect: { kind: "cite" } },
  { say: "make my works cited page", expect: { kind: "cite" } },
  { say: "I have to reply to two classmates on the psych discussion board", expect: { kind: "discussion" } },
  { say: "answer this week's discussion for history", expect: { kind: "discussion" } },
  { say: "I have 60 pages to read for history tonight, help", expect: { kind: ["reading", "ask"] } },
  { say: "summarize this article for me", expect: { kind: ["reading", "screen_question"] } },
  { say: "write a 3 page essay on the french revolution", expect: { kind: ["task", "chat", "kit"] }, note: "a NEW paper is the paper flow (keyword rule), never edit_paper" },
  // ---- ask when unsure: vague asks get buttons, clear asks never do ----------------------------
  { say: "help me with bio", expect: { kind: "ask" }, note: "start homework, teach, or quiz?" },
  { say: "make something for stats", expect: { kind: "ask" } },
  { say: "can you do the essay", expect: { kind: ["ask", "look", "task"] } },
  { say: "teach me z-scores", expect: { kind: "kit", app: "study" }, note: "clear: never ask" },
  { say: "I don't get photosynthesis", expect: { kind: "kit", app: "study" } },
  { say: "make me flashcards for bio", expect: { kind: "kit", app: "study" } },
  { say: "who won the TCU game last night", expect: { kind: "research" } },
  { say: "explain number 3", expect: { kind: "look" } },
  { say: "hey milo how's it going", expect: { kind: "chat" }, note: "greeting: never ask" },
  { say: "make it a box plot", ctx: SHEET, expect: { kind: "in_app" }, note: "an open app explains it: never ask" },
];
