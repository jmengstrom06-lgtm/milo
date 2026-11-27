// Which D2L assignment is this paper for? Milo looks at the student's classes, picks the assignment the paper
// matches (title, topic, what they said, what's due), and reads its instructions, rubric and attached prompt,
// so edits aim at what the professor actually asked for. Quietly skipped if D2L isn't reachable.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { callClaude, callTool } from "./brain";
import { log as bb } from "./blackbox";
import { models } from "./gateway";
import { assignmentFileUrl, assignmentsFor, courses, fileBase64, type DAssignment } from "./d2l";
import { textOf } from "./reading";

export type AssignmentBrief = { label: string; brief: string; course: string; name: string; due: string | null };
const cache = new Map<string, { at: number; v: AssignmentBrief | null }>();

const PICK = {
  name: "pick_assignment",
  description: "Which assignment this paper is for.",
  input_schema: {
    type: "object",
    properties: {
      pick: { type: "number", description: "The number of the matching assignment, or -1 if none clearly matches." },
      why: { type: "string" },
    },
    required: ["pick", "why"],
  },
};

const withTimeout = <T>(p: Promise<T>, ms: number, fallback: T) => Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);

/** The prompt file attached to the assignment, as text (Word/text read here; a PDF summarized by the AI). */
async function attachmentText(portal: string, a: DAssignment): Promise<string> {
  const f = a.attachments.find((x) => /\.(docx?|pdf|txt|rtf)$/i.test(x.name) && (!x.size || x.size < 8e6));
  if (!f) return "";
  const b64 = await fileBase64(portal, assignmentFileUrl(portal, a.course.id, a.id, f.fileId), 8e6).catch(() => null);
  if (!b64) return "";
  if (/\.pdf$/i.test(f.name)) {
    const r = await callClaude({
      model: models.fast(),
      max_tokens: 1200,
      system: "List every requirement in this assignment prompt as short bullet points (length, sources, format, sections, topic, due date). Only what it says.",
      messages: [{ role: "user", content: [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } }, { type: "text", text: "Requirements:" }] }],
    });
    return r.ok ? r.data.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n").slice(0, 4000) : "";
  }
  const tmp = path.join(os.tmpdir(), `milo-prompt-${Date.now()}-${f.name.replace(/[^\w.-]/g, "_")}`);
  try {
    fs.writeFileSync(tmp, Buffer.from(b64, "base64"));
    const t = /\.txt$/i.test(f.name) ? fs.readFileSync(tmp, "utf8") : await textOf(tmp);
    return t.slice(0, 5000);
  } catch {
    return "";
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

/** The assignment this paper is for, as a brief the doc agent works from (null if none matches). */
export async function findAssignment(portal: string, paper: { key: string; title: string; text: string }, ask: string): Promise<AssignmentBrief | null> {
  if (!portal) return null;
  const hit = cache.get(paper.key);
  if (hit && Date.now() - hit.at < 30 * 60e3) return hit.v;
  const t0 = Date.now();
  const v = await withTimeout(
    (async () => {
      const cs = await courses(portal).catch(() => []);
      if (!cs.length) return null;
      const all = (await Promise.all(cs.map((c) => assignmentsFor(portal, c).catch(() => [] as DAssignment[])))).flat();
      const now = Date.now();
      const open = all
        .filter((a) => !a.due || (Date.parse(a.due) > now - 10 * 86400e3 && Date.parse(a.due) < now + 75 * 86400e3))
        .sort((a, b) => (Date.parse(a.due ?? "") || 9e15) - (Date.parse(b.due ?? "") || 9e15))
        .slice(0, 40);
      if (!open.length) return null;
      const list = open.map((a, i) => `[${i}] ${a.course.short} · ${a.name}${a.due ? ` · due ${new Date(a.due).toDateString()}` : ""} · ${a.instructions.slice(0, 160).replace(/\s+/g, " ")}`).join("\n");
      const r = await callTool<{ pick: number; why: string }>(
        {
          model: models.fast(),
          max_tokens: 300,
          system: "A college student has a paper open. Pick the class assignment it's for, using the paper's title and topic, what the student said, and the assignment names, instructions and due dates. Only pick one if it clearly matches a writing assignment; otherwise -1.",
          tools: [PICK],
          tool_choice: { type: "auto" },
          messages: [{ role: "user", content: `The student said: "${ask}"\nPaper title: ${paper.title}\nPaper starts: ${paper.text.slice(0, 1200)}\n\nAssignments:\n${list}` }],
        },
        PICK.name
      );
      const a = r.ok && r.data.pick >= 0 ? open[r.data.pick] : undefined;
      if (!a) return null;
      const file = await attachmentText(portal, a);
      const brief = [
        `Assignment: ${a.name} (${a.course.name})${a.due ? `, due ${new Date(a.due).toDateString()}` : ""}`,
        a.instructions ? `Instructions:\n${a.instructions}` : "",
        a.rubric ? a.rubric : "",
        file ? `From the attached prompt:\n${file}` : "",
      ]
        .filter(Boolean)
        .join("\n\n");
      return { label: `${a.name} · ${a.course.short}`, brief: brief.slice(0, 12000), course: a.course.short, name: a.name, due: a.due };
    })().catch(() => null),
    9000,
    null
  );
  bb("paper", "assignment", { found: !!v, name: v?.name ?? null, ms: Date.now() - t0 });
  cache.set(paper.key, { at: Date.now(), v });
  return v;
}
