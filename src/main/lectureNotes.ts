// Pure (unit-tested): lecture voice commands, and turning the AI's notes into the Notes app's text.

export type LectureNotes = {
  title: string;
  summary: string;
  sections: { heading: string; points: string[] }[];
  key_terms: { term: string; definition: string }[];
  exam_alerts: string[];
  flashcards: { q: string; a: string }[];
  questions: string[];
};

/** "listen to my stats lecture", "record class", "take notes on this lecture" -> start. "class is over" -> stop. */
export function lectureCommand(raw: string): { do: "start"; course: string } | { do: "stop" } | null {
  const t = raw.toLowerCase().replace(/[.!?]+$/, "").trim();
  if (/^(stop|end|finish|pause)( (listening|recording|the recording|taking notes|lecture mode))( (to|for|on) (the |this |my )?(lecture|class))?$|^(class|lecture)( is|'s)? (over|done|finished)$|^(the )?(class|lecture) (just )?ended$|^(we'?re|i'?m) (out of class|done with class)$/.test(t))
    return { do: "stop" };
  const m = t.match(/^(?:(?:can you |please |hey )?(?:listen to|record|take notes (?:on|for|during)|start (?:listening to|recording)|turn on lecture mode for|lecture mode(?: for)?)) ?(?:my |the |this )?(.*?) ?(?:lecture|class|lesson)?(?: for me)?$/);
  if (!m) return null;
  const said = t.slice(0, 40);
  if (!/\b(lecture|class|lesson|professor|lecture mode)\b/.test(said) && !/^record class/.test(t)) return null;
  return { do: "start", course: (m[1] ?? "").replace(/\b(lecture|class|lesson|my|the|this|today'?s)\b/g, "").replace(/\s+/g, " ").trim() };
}

/** Past lectures at the same weekday and time (within 40 min) say which class this is. Most common wins. (pure) */
export function scheduleMatch(past: { classId: string | null; startedAt: number }[], now: number): string | null {
  const d = new Date(now);
  const mins = d.getHours() * 60 + d.getMinutes();
  const votes = new Map<string, number>();
  for (const p of past) {
    if (!p.classId) continue;
    const q = new Date(p.startedAt);
    if (q.getDay() !== d.getDay() || now - p.startedAt < 3600e3) continue;
    if (Math.abs(q.getHours() * 60 + q.getMinutes() - mins) > 40) continue;
    votes.set(p.classId, (votes.get(p.classId) ?? 0) + 1);
  }
  return [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/** Minutes as "52 min" / "1 hr 15 min". */
export const minutesText = (ms: number) => {
  const m = Math.max(1, Math.round(ms / 60000));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} hr${m % 60 ? ` ${m % 60} min` : ""}`;
};

/** The note's text, as the Notes app shows it (plain text with simple markers). */
export function notesText(n: LectureNotes, meta: { course: string; date: string; length: string }, transcript: string): string {
  const out: string[] = [];
  out.push(`${meta.course ? `${meta.course} · ` : ""}${meta.date} · ${meta.length}`);
  if (n.summary) out.push("", "SUMMARY", n.summary);
  if (n.exam_alerts.length) out.push("", "⚠️ THE PROFESSOR FLAGGED (likely on the exam)", ...n.exam_alerts.map((x) => `• ${x}`));
  for (const s of n.sections) out.push("", s.heading.toUpperCase(), ...s.points.map((p) => `• ${p}`));
  if (n.key_terms.length) out.push("", "KEY TERMS", ...n.key_terms.map((k) => `• ${k.term}: ${k.definition}`));
  if (n.questions.length) out.push("", "QUESTIONS TO REVIEW", ...n.questions.map((q) => `• ${q}`));
  if (transcript.trim()) out.push("", "FULL TRANSCRIPT", transcript.trim());
  return out.join("\n");
}
