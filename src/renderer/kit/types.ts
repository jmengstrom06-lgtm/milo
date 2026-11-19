// Shapes shared by Milo's Kit (mirror of src/main/kit.ts).

export type GraphSpec =
  | { type: "normal"; mean: number; sd: number; shadeFrom?: number | null; shadeTo?: number | null; markers?: number[]; xlabel?: string }
  | { type: "function"; exprs: string[]; xmin: number; xmax: number; ymin?: number; ymax?: number; points?: { x: number; y: number; label?: string }[]; params?: { name: string; min: number; max: number; value: number }[] }
  | { type: "bar"; labels: string[]; values: number[]; xlabel?: string; ylabel?: string }
  | { type: "line"; labels: string[]; values: number[]; xlabel?: string; ylabel?: string }
  | { type: "scatter"; points: { x: number; y: number }[]; fit?: boolean; xlabel?: string; ylabel?: string }
  | { type: "histogram"; values: number[]; bins?: number; xlabel?: string; stats?: boolean }
  | { type: "box"; groups: { label: string; values: number[] }[]; xlabel?: string }
  | { type: "pie"; labels: string[]; values: number[] };

export type StudyItem = {
  id: string;
  kind: "problem" | "card";
  skill: string;
  prompt: string;
  answer: string;
  hint: string;
  steps: { say: string; write: string }[];
  graph: GraphSpec | null;
};
export type StudySet = { title: string; subject: string; items: StudyItem[]; say: string; lesson?: { points: { say: string; write: string }[] } | null };
export type StudyMode = "worked" | "practice" | "cards" | "test" | "learn";
export type Sketch = { title: string; say: string; graph: GraphSpec | null; svg?: string | null; image_prompt: string | null };
export type Table = { title: string; columns: string[]; rows: (string | number)[][]; say: string; chart?: ChartPick | null };
export type Note = { id: string; title: string; course: string; body: string; created: number; updated: number };
export type NoteDraft = { title: string; course: string; body: string; say: string };
export type PocketItem = { id: string; text: string; from: string; at: number };
export type Plan = {
  title: string;
  say: string;
  days: { date: string; label: string; tasks: { text: string; kind: "study" | "review" | "due" | "exam"; topic?: string; minutes?: number }[] }[];
};
export type Res<T> = { ok: true; data: T } | { ok: false; text: string };

export type KitApp = "study" | "sketch" | "notes" | "sheet" | "planner" | "pocket";
export const KIT_APPS: { id: KitApp; name: string; hint: string }[] = [
  { id: "study", name: "Study", hint: "Practice problems, worked examples, flashcards" },
  { id: "sketch", name: "Sketch", hint: "Graphs, diagrams and images" },
  { id: "notes", name: "Notes", hint: "Your notes, by class" },
  { id: "sheet", name: "Sheet", hint: "Tables and quick stats" },
  { id: "planner", name: "Planner", hint: "Study plan from your due dates" },
  { id: "pocket", name: "Pocket", hint: "Things you asked Milo to hold" },
];

export type TableOp =
  | { op: "add_column"; name: string; expr: string }
  | { op: "sort"; column: string; desc?: boolean }
  | { op: "filter"; column: string; cmp: ">" | "<" | ">=" | "<=" | "=" | "!="; value: string }
  | { op: "remove_column"; column: string }
  | { op: "rename_column"; column: string; to: string }
  | { op: "add_row"; values: (string | number)[] }
  | { op: "graph"; kind: ChartKind; x?: string; y: string; bins?: number }
  | { op: "set_table"; title?: string; columns: string[]; rows: (string | number)[][] }
  | { op: "sample"; name: string; dist: "normal" | "uniform" | "skewed_right" | "skewed_left" | "bimodal"; n: number; mean?: number; sd?: number; min?: number; max?: number; decimals?: number };
export type ChartKind = "histogram" | "bar" | "line" | "scatter" | "box" | "pie";
export type ChartPick = { kind: ChartKind; x?: string; y: string; bins?: number };

export type Subject = "math" | "stats" | "science" | "english" | "history" | "language" | "cs" | "business" | "arts" | "other";
export type Klass = { id: string; name: string; code: string; subject: Subject; color: string };
export type ClassStore = { classes: Klass[]; active: string | null };
export const SUBJECT_NAMES: Record<Subject, string> = {
  math: "Math", stats: "Statistics", science: "Science", english: "English / Writing", history: "History / Social science",
  language: "Language", cs: "Computer science", business: "Business / Econ", arts: "Arts", other: "Other",
};

// The class library: everything Milo makes is filed under a class (mirror of src/main/library.ts).
export type LibApp = "sketch" | "sheet" | "study" | "planner";
export type LibItem = { id: string; classId: string | null; app: LibApp; title: string; created: number; updated: number; data: unknown };
