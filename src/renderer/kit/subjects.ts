// What each app offers, per kind of class. A stats student and an English student open the same
// app and see the moves that matter for THEIR class.

import type { Subject } from "./types";

type Starter = { label: string; request: string };
type Apps = { study: Starter[]; sketch: Starter[]; sheet: Starter[]; sketchHint: string; sheetHint: string; studyHint: string };

const S: Record<Subject, Apps> = {
  stats: {
    studyHint: "Normal distribution problems, hypothesis tests, z-scores…",
    study: [
      { label: "Teach me z-scores", request: "teach me z-scores" },
      { label: "Hypothesis test practice", request: "practice problems on hypothesis tests" },
      { label: "Probability cards", request: "flashcards on probability rules" },
    ],
    sketchHint: "Show N(70, 5) above 78, a right-skewed distribution, a sampling distribution…",
    sketch: [
      { label: "Normal curve", request: "show me a normal curve with mean 70 and sd 5, shade above 78" },
      { label: "Skewed vs symmetric", request: "draw three distributions side by side: skewed left, symmetric, skewed right, labeled" },
      { label: "Sampling distribution", request: "diagram of how a sampling distribution is built from many samples" },
    ],
    sheetHint: "Make an example histogram, or paste your numbers…",
    sheet: [
      { label: "Example histogram", request: "make me an example data set of 30 exam scores and a histogram" },
      { label: "Skewed example", request: "example of right-skewed data with a histogram, like household incomes" },
      { label: "Scatter + regression", request: "example data of hours studied vs exam score, scatter plot with regression line" },
      { label: "Box plot by group", request: "example exam scores for two sections and a box plot comparing them" },
    ],
  },
  math: {
    studyHint: "Derivatives, factoring, solving systems…",
    study: [
      { label: "Worked example", request: "a worked example from my class" },
      { label: "Practice problems", request: "practice problems for my class" },
      { label: "Formula cards", request: "flashcards of the key formulas for my class" },
    ],
    sketchHint: "Graph y = x^2 - 3, show how a changes a*(x-h)^2+k…",
    sketch: [
      { label: "Parabola with sliders", request: "graph y = a(x-h)^2 + k with sliders" },
      { label: "Sine wave", request: "graph y = a*sin(b*x) with sliders" },
      { label: "Tangent line", request: "graph y = x^3 - 3x and its tangent line at x = 1" },
    ],
    sheetHint: "Table of values for y = 2x + 1, my homework scores…",
    sheet: [
      { label: "Table of values", request: "table of x and y values for y = x^2 from -5 to 5 and a line chart" },
      { label: "Grade tracker", request: "a grade tracker table for my class with a bar chart" },
    ],
  },
  science: {
    studyHint: "Cell parts, stoichiometry, Newton's laws…",
    study: [
      { label: "Teach me a concept", request: "teach me the hardest concept in my class right now" },
      { label: "Vocab cards", request: "flashcards of key terms for my class" },
      { label: "Practice problems", request: "practice problems for my class" },
    ],
    sketchHint: "Plant cell, mitosis stages, free body diagram, the water cycle…",
    sketch: [
      { label: "Labeled diagram", request: "a labeled diagram of the main structure we're studying in my class" },
      { label: "Process steps", request: "a step-by-step process diagram for my class topic" },
      { label: "Free body diagram", request: "free body diagram of a box on a ramp with friction" },
    ],
    sheetHint: "My lab data, unit conversions, trial averages…",
    sheet: [
      { label: "Lab data table", request: "a lab data table with 3 trials, units, and the average, plus a line chart" },
      { label: "Example experiment", request: "example data for temperature vs reaction rate with a scatter plot" },
    ],
  },
  english: {
    studyHint: "Literary devices, thesis practice, grammar, vocab…",
    study: [
      { label: "Thesis practice", request: "practice writing strong thesis statements: give me prompts and grade my thesis" },
      { label: "Literary devices", request: "flashcards on literary devices with examples" },
      { label: "Grammar quiz", request: "a quick grammar and punctuation practice quiz" },
    ],
    sketchHint: "Plot diagram of my book, essay outline map, character map…",
    sketch: [
      { label: "Plot diagram", request: "a labeled plot diagram (exposition, rising action, climax, falling action, resolution) for the book I'm reading" },
      { label: "Essay outline map", request: "a visual outline of a 5-paragraph argumentative essay: thesis, claims, evidence, counterargument" },
      { label: "Character map", request: "a character relationship map for the book I'm reading" },
    ],
    sheetHint: "Source tracker, quote log with page numbers, reading log…",
    sheet: [
      { label: "Source tracker", request: "a source tracker table for my essay: source, author, MLA citation, key quote, page, how I'll use it" },
      { label: "Quote log", request: "a quote log table: quote, page, speaker, device, what it shows" },
      { label: "Reading log", request: "a reading log with date, pages read and minutes, plus a line chart" },
    ],
  },
  history: {
    studyHint: "Key dates, causes and effects, primary sources…",
    study: [
      { label: "Key events cards", request: "flashcards on the key events, people and dates for my class" },
      { label: "Cause and effect", request: "practice questions on causes and effects for my class" },
      { label: "Practice test", request: "a practice test for my class" },
    ],
    sketchHint: "Timeline of WWI, cause-and-effect chain, map of the colonies…",
    sketch: [
      { label: "Timeline", request: "a clean timeline of the period we're studying in my class" },
      { label: "Cause and effect", request: "a cause-and-effect chain diagram for the main event in my class" },
    ],
    sheetHint: "Timeline table, compare two empires, population data…",
    sheet: [
      { label: "Timeline table", request: "a timeline table: date, event, why it matters" },
      { label: "Compare and contrast", request: "a compare and contrast table for two things from my class" },
      { label: "Historical data", request: "historical population data for my class topic with a line chart" },
    ],
  },
  language: {
    studyHint: "Vocab, conjugations, translate sentences…",
    study: [
      { label: "Vocab cards", request: "vocabulary flashcards for my language class" },
      { label: "Conjugation drill", request: "practice conjugating common verbs in my language class" },
      { label: "Translate practice", request: "practice translating short sentences both ways" },
    ],
    sketchHint: "Labeled kitchen in Spanish, verb tense map…",
    sketch: [
      { label: "Labeled scene", request: "a labeled drawing of a kitchen with every object named in the language I'm learning" },
      { label: "Tense map", request: "a diagram of when to use each verb tense in the language I'm learning" },
    ],
    sheetHint: "Conjugation table, vocab list…",
    sheet: [
      { label: "Conjugation table", request: "a conjugation table for the 6 most common verbs in my language class" },
      { label: "Vocab list", request: "a vocab table: word, translation, example sentence" },
    ],
  },
  cs: {
    studyHint: "Trace this code, big-O, data structures…",
    study: [
      { label: "Code tracing", request: "code tracing practice: what does this print?" },
      { label: "Big-O cards", request: "flashcards on big-O of common operations" },
    ],
    sketchHint: "Linked list diagram, flowchart of a loop, binary tree…",
    sketch: [
      { label: "Data structure", request: "a labeled diagram of a binary search tree with insert steps" },
      { label: "Flowchart", request: "a flowchart of a while loop that sums numbers" },
    ],
    sheetHint: "Runtime comparison, test cases…",
    sheet: [{ label: "Runtime chart", request: "table of n vs operations for O(n), O(n log n) and O(n^2) and a line chart" }],
  },
  business: {
    studyHint: "Elasticity, break-even, ratios…",
    study: [
      { label: "Worked example", request: "a worked example from my class" },
      { label: "Key terms", request: "flashcards of key terms for my class" },
    ],
    sketchHint: "Supply and demand shift, cost curves…",
    sketch: [
      { label: "Supply & demand", request: "supply and demand graph with sliders to shift demand" },
      { label: "Break-even", request: "break-even chart: fixed cost 500, price 20, variable cost 12" },
    ],
    sheetHint: "Budget, break-even, sales data…",
    sheet: [
      { label: "Budget", request: "a monthly college student budget with a pie chart" },
      { label: "Sales example", request: "example monthly sales data for a year with a line chart" },
    ],
  },
  arts: {
    studyHint: "Movements, artists, terms…",
    study: [{ label: "Term cards", request: "flashcards of key terms for my class" }],
    sketchHint: "Color wheel, composition rule of thirds…",
    sketch: [{ label: "Color wheel", request: "a labeled color wheel with complementary pairs" }],
    sheetHint: "Practice log…",
    sheet: [{ label: "Practice log", request: "a practice log with date and minutes, plus a bar chart" }],
  },
  other: {
    studyHint: "Practice problems, flashcards, a practice test…",
    study: [
      { label: "Practice problems", request: "practice problems for my class" },
      { label: "Flashcards", request: "flashcards for my class" },
    ],
    sketchHint: "Graph y = x^2, a labeled diagram, a timeline…",
    sketch: [{ label: "Diagram", request: "a labeled diagram of what we're studying" }],
    sheetHint: "Make an example histogram, or paste your numbers…",
    sheet: [
      { label: "Example histogram", request: "make me an example data set and a histogram" },
      { label: "Grade tracker", request: "a grade tracker with a bar chart" },
    ],
  },
};

export const startersFor = (subject: Subject | undefined) => S[subject ?? "other"] ?? S.other;
