// "Start my Journaling assignment": find it in D2L's own data (assignment, quiz or discussion), read the
// instructions, rubric and attached prompt directly, and give the exact page to open. No clicking through
// Chrome, and it works even when Chrome isn't signed in to D2L (Milo reads with whichever sign-in works).
// Matching is pure (tested).

import { log as bb } from "./blackbox";
import { attachmentText } from "./assignmentMatch";
import { assignmentsFor, courses, d2lGet, D2L_LE as LE, d2lOrigin, d2lStrip, discussionTopics, matchCourse, type Course } from "./d2l";

const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter((w) => w.length > 1 && !/^(the|a|an|my|of|for|and|to|in|on)$/.test(w));
/** How well a D2L item name matches what the student / the calendar called it (0..1). (pure) */
export function nameScore(want: string, name: string): number {
  const A = words(want);
  const B = new Set(words(name));
  if (!A.length || !B.size) return 0;
  if (want.trim().toLowerCase() === name.trim().toLowerCase()) return 1;
  const both = A.filter((w) => B.has(w)).length;
  return both / Math.max(A.length, Math.min(B.size, A.length + 2));
}
/** The best match above a bar, or null. (pure) */
export function bestMatch<T>(want: string, items: T[], name: (x: T) => string, bar = 0.6): T | null {
  let best: { x: T; s: number } | null = null;
  for (const x of items) {
    const s = nameScore(want, name(x));
    if (!best || s > best.s) best = { x, s };
  }
  return best && best.s >= bar ? best.x : null;
}

export type OpenedAssignment = { kind: "assignment" | "quiz" | "discussion"; course: Course; name: string; due: string | null; url: string; text: string };

export async function openAssignment(portal: string, want: { title: string; course: string }): Promise<OpenedAssignment | null> {
  const t0 = Date.now();
  const cs = await courses(portal);
  const c = matchCourse(want.course, cs) ?? null;
  const pool = c ? [c] : cs;
  const o = d2lOrigin(portal);
  for (const course of pool) {
    const asg = bestMatch(want.title, await assignmentsFor(portal, course).catch(() => []), (a) => a.name);
    if (asg) {
      const att = await attachmentText(portal, asg).catch(() => "");
      const text = [`Assignment: ${asg.name} (${course.name})`, asg.due ? `Due: ${new Date(asg.due).toLocaleString()}` : "", asg.instructions && `Instructions:\n${asg.instructions}`, asg.rubric, att && `From the attached prompt:\n${att}`, asg.attachments.length ? `Attached files: ${asg.attachments.map((a) => a.name).join(", ")}` : ""].filter(Boolean).join("\n\n");
      bb("assignment", "opened", { kind: "assignment", course: course.short, ms: Date.now() - t0, chars: text.length, rubric: !!asg.rubric, attachment: !!att });
      return { kind: "assignment", course, name: asg.name, due: asg.due, url: `${o}/d2l/lms/dropbox/user/folder_submit_files.d2l?db=${asg.id}&grpid=0&isprv=0&bp=0&ou=${course.id}`, text };
    }
    type Q = { QuizId: number; Name: string; DueDate?: string | null; Description?: { Text?: { Html?: string; Text?: string } } };
    const qs = await d2lGet<{ Objects?: Q[] } | Q[]>(portal, `/d2l/api/le/${LE}/${course.id}/quizzes/`).catch(() => [] as Q[]);
    const quiz = bestMatch(want.title, Array.isArray(qs) ? qs : qs.Objects ?? [], (q) => q.Name);
    if (quiz) {
      bb("assignment", "opened", { kind: "quiz", course: course.short, ms: Date.now() - t0 });
      return { kind: "quiz", course, name: quiz.Name, due: quiz.DueDate ?? null, url: `${o}/d2l/lms/quizzing/user/quiz_summary.d2l?qi=${quiz.QuizId}&ou=${course.id}`, text: `Quiz: ${quiz.Name} (${course.name})\n${d2lStrip(quiz.Description?.Text?.Html || quiz.Description?.Text?.Text || "")}` };
    }
    const topic = bestMatch(want.title, await discussionTopics(portal, course).catch(() => []), (d) => d.name);
    if (topic) {
      bb("assignment", "opened", { kind: "discussion", course: course.short, ms: Date.now() - t0 });
      return { kind: "discussion", course, name: topic.name, due: topic.due, url: `${o}/d2l/le/${course.id}/discussions/topics/${topic.topicId}/View`, text: `Discussion: ${topic.name} (${course.name})\nPrompt:\n${topic.prompt}` };
    }
  }
  bb("assignment", "not_found", { course: c?.short ?? want.course, title: want.title.slice(0, 60), ms: Date.now() - t0 });
  return null;
}
