// "Do my discussion post": read the real D2L prompt and classmates' posts, then draft the post (and the replies
// the prompt asks for) in the student's own voice. Nothing is posted until they say yes. Pure parts are tested.

import { callTool, persona } from "./brain";
import { models } from "./gateway";
import type { DPost, DTopic } from "./d2l";

/** Which topic they mean: the one they named, else open and not done yet, due soonest. (pure) */
export function pickTopic(topics: DTopic[], mine: Set<number>, said = "", now = Date.now()): DTopic | null {
  const open = topics.filter((t) => !t.locked && (!t.end || Date.parse(t.end) > now));
  const words = said.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 3 && !/^(discussion|discussions|board|post|posts|reply|replies|respond|response|class|week|weeks|topic|forum|please|milo|this|that|these|with|about|write|answer|help|need|have|from|classmates?|peers?|other|today|tonight|tomorrow|before|due|can|you|for|the|and|mine)$/.test(w));
  const named = words.length ? open.find((t) => words.some((w) => `${t.name} ${t.forum}`.toLowerCase().includes(w))) : null;
  const wk = said.match(/\b(?:week|module|unit|chapter)\s*(\d+)\b/i)?.[1];
  const byNum = wk ? open.find((t) => new RegExp(`\\b(week|module|unit|chapter)\\s*0?${wk}\\b`, "i").test(`${t.name} ${t.forum}`)) : null;
  if (byNum) return byNum;
  if (named) return named;
  const due = (t: DTopic) => Date.parse(t.due ?? t.end ?? "") || Infinity;
  const todo = open.filter((t) => !mine.has(t.topicId)).sort((a, b) => due(a) - due(b));
  return todo[0] ?? open.sort((a, b) => due(a) - due(b))[0] ?? null;
}

/** What the prompt asks for, counted so Milo can show ✓ for each. (pure) */
export function requirementsOf(prompt: string): { minWords: number; replies: number } {
  const p = prompt.toLowerCase().replace(/-/g, " ");
  const num = (s: string) => ({ one: 1, two: 2, three: 3, four: 4, five: 5, a: 1 } as Record<string, number>)[s] ?? Number(s);
  const w = p.match(/(?:at least|minimum(?: of)?|min\.?|no fewer than)?\s*(\d{2,4})(?:\s*(?:to\s*)?\d{2,4})?\s*words?/);
  const r = p.match(/(?:respond|reply|comment)\w*\s+(?:(?:to|on)\s+)?(?:at least\s+)?(one|two|three|four|five|a|\d)\s+(?:of your\s+)?(?:classmates?|peers?|other students?|posts?)/) ?? p.match(/(one|two|three|four|five|\d)\s+(?:classmates?|peers?)['’]?\s*(?:posts?|responses?)/);
  return { minWords: w ? Number(w[1]) : 0, replies: r ? num(r[1]) : 0 };
}

const DRAFT_TOOL = {
  name: "discussion_draft",
  description: "The student's discussion post and replies.",
  input_schema: {
    type: "object",
    properties: {
      subject: { type: "string", description: "A short, natural subject line (or 'Re: ...' style if the forum uses that)." },
      body: { type: "string", description: "The main post, plain text with blank lines between paragraphs." },
      replies: {
        type: "array",
        description: "Replies to classmates, only as many as the prompt asks for (0 if it doesn't).",
        items: {
          type: "object",
          properties: { post: { type: "number", description: "Index of the classmate's post you're replying to." }, body: { type: "string" } },
          required: ["post", "body"],
        },
      },
      checklist: { type: "array", description: "Each thing the prompt requires, and how the post covers it.", items: { type: "string" } },
    },
    required: ["subject", "body", "replies", "checklist"],
  },
};

export type Draft = { subject: string; body: string; replies: { parentId: number; to: string; excerpt: string; body: string }[]; checklist: string[] };

export async function draftDiscussion(o: { course: string; topic: DTopic; posts: DPost[]; me: number | null; voice: string[]; ask: string; name?: string; change?: string; previous?: Draft }): Promise<Draft | { error: string }> {
  const req = requirementsOf(o.topic.prompt);
  const others = o.posts.filter((p) => p.userId !== o.me && !p.parentId && p.text.length > 40).slice(0, 12);
  const r = await callTool<{ subject: string; body: string; replies: { post: number; body: string }[]; checklist: string[] }>(
    {
      model: models.smart(),
      max_tokens: 5000,
      system: `${persona()}
You draft a college student's discussion post for ${o.course}, in THEIR voice: first person, natural, specific, like a real student who did the reading. Not stiff, not AI-sounding (no "delve", "tapestry", "in today's world", no bullet lists unless the prompt wants them).
Answer every part of the prompt.${req.minWords ? ` The main post must be at least ${req.minWords} words (aim ~10% over).` : ""}${req.replies ? ` Write exactly ${req.replies} replies to different classmates: each responds to something specific they said, adds a thought or a question, ~80-150 words.` : " Write no replies unless the prompt asks."}
Never invent quotes, page numbers or statistics. Only cite readings the prompt or posts name, and only generally.${o.voice.length ? `\nHow this student writes (their past posts, match the voice, not the content):\n${o.voice.map((v) => `---\n${v.slice(0, 900)}`).join("\n")}` : ""}${o.name ? `\nThe student's name is ${o.name}.` : ""}`,
      tools: [DRAFT_TOOL],
      tool_choice: { type: "auto" },
      messages: [
        {
          role: "user",
          content: `Topic: ${o.topic.name}\nPrompt:\n${o.topic.prompt.slice(0, 6000) || "(no prompt text: answer the topic title thoughtfully)"}\n\nClassmates' posts:\n${others.map((p, i) => `[${i}] ${p.who}: ${p.text.slice(0, 1200)}`).join("\n\n") || "(none yet)"}${o.previous ? `\n\nYour last draft:\n${o.previous.body}\n\nChange it: ${o.change}` : o.ask ? `\n\nThe student said: "${o.ask}"` : ""}`,
        },
      ],
    },
    DRAFT_TOOL.name
  );
  if (!r.ok) return { error: r.text };
  const replies = (r.data.replies ?? [])
    .filter((x) => others[x.post])
    .slice(0, Math.max(req.replies, 0) || 3)
    .map((x) => ({ parentId: others[x.post].id, to: others[x.post].who, excerpt: others[x.post].text.slice(0, 160), body: x.body.trim() }));
  const wantsReplies = req.replies > 0 || /\b(reply|respond|comment on)\b/i.test(o.topic.prompt);
  return { subject: (r.data.subject || o.topic.name).slice(0, 150), body: r.data.body.trim(), replies: wantsReplies ? replies : [], checklist: (r.data.checklist ?? []).slice(0, 6) };
}

/** Plain text -> the simple HTML D2L shows (paragraphs, escaped). (pure) */
export const toHtml = (t: string) =>
  t
    .trim()
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>")}</p>`)
    .join("");
