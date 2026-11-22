// The AI parts of the Google connector: turning "email Professor Weltman that I'll miss Friday" into a
// draft, and "add study group Tuesday at 7 to my calendar" into an event. Everything else is plain code.

import { callTool, persona } from "./brain";
import { models } from "./gateway";
import { gmailSearch, type Ev, type Mail } from "./google";
import { getProfile } from "./profile";

const pad = (n: number) => String(n).padStart(2, "0");
const localNow = () => {
  const d = new Date();
  return `${d.toDateString()} ${pad(d.getHours())}:${pad(d.getMinutes())} (${Intl.DateTimeFormat().resolvedOptions().timeZone})`;
};

const EMAIL_TOOL = {
  name: "email_draft",
  description: "An email the student wants to send.",
  input_schema: {
    type: "object",
    properties: {
      to: { type: "string", description: "The email address if the student gave one, else the person's name as they said it (e.g. 'Professor Weltman')." },
      subject: { type: "string" },
      body: { type: "string", description: "The email, in the student's voice: short, polite, clear. Sign with their first name. No placeholders unless a fact is truly missing; then [like this]." },
    },
    required: ["to", "subject", "body"],
  },
};
/** "email professor weltman that I'll miss class friday because of a game" -> a draft (to, subject, body). */
export async function composeEmail(request: string) {
  const me = getProfile();
  const r = await callTool<{ to: string; subject: string; body: string }>(
    {
      model: models.fast(),
      max_tokens: 900,
      system: `${persona()}\nWrite the email the student asked for. Student: ${me.name ?? "the student"}${me.school ? ` at ${me.school}` : ""}.`,
      tools: [EMAIL_TOOL],
      tool_choice: { type: "auto" },
      messages: [{ role: "user", content: request }],
    },
    EMAIL_TOOL.name
  );
  if (!r.ok) return r;
  let to = r.data.to.trim();
  // a name, not an address: find it in their email (someone they've written to or heard from)
  let found = true;
  if (!/@/.test(to)) {
    // a name, not an address: find it in emails they've gotten from that person
    const name = to.replace(/^(professor|prof\.?|dr\.?|mr\.?|ms\.?|mrs\.?)\s+/i, "").trim();
    const hits: Mail[] = await gmailSearch(`from:(${name})`, 3).catch(() => []);
    const addr = hits.map((h) => h.email).find(Boolean);
    if (addr) to = addr;
    else found = false;
  }
  return { ok: true as const, data: { ...r.data, to, found } };
}

const EVENT_TOOL = {
  name: "calendar_event",
  description: "A calendar event the student wants to add.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string" },
      start: { type: "string", description: "Local start: '2026-11-24T19:00', or just a date '2026-11-24' for all day." },
      end: { type: "string", description: "Local end in the same format, if they said how long or until when. Else ''." },
      where: { type: "string", description: "Place, if they said one. Else ''." },
    },
    required: ["title", "start"],
  },
};
export async function parseEvent(request: string) {
  return callTool<{ title: string; start: string; end?: string; where?: string }>(
    {
      model: models.fast(),
      max_tokens: 400,
      system: `${persona()}\nTurn the student's words into one calendar event. Right now it is ${localNow()}. "Tuesday" means the next Tuesday from today.`,
      tools: [EVENT_TOOL],
      tool_choice: { type: "auto" },
      messages: [{ role: "user", content: request }],
    },
    EVENT_TOOL.name
  );
}

// ---------- saying it out loud (no AI) ----------
const day = (d: Date) => {
  const t = new Date();
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const tom = new Date(t.getTime() + 86400e3);
  return same(d, t) ? "today" : same(d, tom) ? "tomorrow" : d.toLocaleDateString("en-US", { weekday: "long" });
};
const time = (d: Date) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).replace(":00", "");
export function sayCalendar(evs: Ev[], range: string): string {
  if (!evs.length) return `Nothing on your calendar ${range}.`;
  const parts = evs.slice(0, 4).map((e) => {
    const d = new Date(e.allDay ? `${e.start}T12:00` : e.start);
    return `${e.title} ${day(d)}${e.allDay ? "" : ` at ${time(d)}`}`;
  });
  return `${evs.length === 1 ? "One thing" : `${evs.length} things`} ${range}: ${parts.join(", ")}${evs.length > 4 ? ", and more" : ""}.`;
}
export function sayMail(ms: Mail[]): string {
  if (!ms.length) return "No new emails. Inbox zero!";
  const top = ms.slice(0, 3).map((m) => `${m.from.split(" ")[0] || m.from}: ${m.subject || "(no subject)"}`);
  return `${ms.length === 1 ? "One new email" : `${ms.length} new emails`}. ${top.join(". ")}.`;
}
