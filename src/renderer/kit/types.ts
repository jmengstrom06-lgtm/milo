// Shapes shared by Milo's Kit (mirror of src/main/kit.ts).

export type GraphSpec =
  | { type: "normal"; mean: number; sd: number; shadeFrom?: number | null; shadeTo?: number | null; markers?: number[]; xlabel?: string }
  | { type: "function"; exprs: string[]; xmin: number; xmax: number; ymin?: number; ymax?: number; points?: { x: number; y: number; label?: string }[] }
  | { type: "bar"; labels: string[]; values: number[]; xlabel?: string; ylabel?: string }
  | { type: "line"; labels: string[]; values: number[]; xlabel?: string; ylabel?: string }
  | { type: "scatter"; points: { x: number; y: number }[]; fit?: boolean; xlabel?: string; ylabel?: string }
  | { type: "histogram"; values: number[]; bins?: number; xlabel?: string };

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
export type StudySet = { title: string; subject: string; items: StudyItem[]; say: string };
export type StudyMode = "worked" | "practice" | "cards" | "test";
export type Sketch = { title: string; say: string; graph: GraphSpec | null; image_prompt: string | null };
export type Table = { title: string; columns: string[]; rows: (string | number)[][]; say: string };
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
