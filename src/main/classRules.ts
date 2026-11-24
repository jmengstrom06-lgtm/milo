// Optional, per class: "Follow my syllabus AI rules". OFF unless the student turns it on for a class.
// When it's on, Milo reads that class's syllabus AI policy once, shows the exact quote, and holds back
// what the policy doesn't allow in that class. Like ChatGPT or Claude, nothing is limited by default.
// The core here is pure (tested); main.ts does the reading and saving.

export type Level = "none" | "study" | "credit" | "allowed" | "unclear";
export type ClassRule = { course: string; level: Level; quote: string; readAt: number; source: string };
export type Rules = Record<string, ClassRule>; // only classes the student switched on

export const LEVEL_LABEL: Record<Level, string> = {
  none: "No AI",
  study: "AI for studying only",
  credit: "AI allowed with credit",
  allowed: "AI allowed",
  unclear: "Unclear",
};

/** Things Milo can do for a class, from least to most involved. */
export type Act = "plan" | "study" | "check" | "write" | "fill";

/** Is this allowed under the class's rule? Unclear = careful (studying only). (pure) */
export function allowed(level: Level | undefined, act: Act): boolean {
  if (!level || level === "allowed" || level === "credit") return true;
  if (level === "none") return act === "plan";
  return act === "plan" || act === "study"; // study, unclear
}

/** One line Milo says when he holds back. (pure) */
export function holdBackLine(rule: ClassRule, act: Act): string {
  const instead = rule.level === "none" ? "I can still plan your time and remind you what's due." : "I'll explain it or quiz you instead.";
  const what = act === "fill" ? "fill this in" : act === "write" ? "write this" : act === "check" ? "check graded work" : "do that";
  return `Your ${rule.course} syllabus ${rule.level === "unclear" ? "isn't clear about AI" : `says "${rule.quote.slice(0, 120)}"`}, and you asked me to follow it, so I won't ${what} there. ${instead} You can turn this off in that class's settings.`;
}

/** Which followed class (if any) a request or screen is about, by its name or short name. (pure) */
export function ruleFor(rules: Rules, ...texts: string[]): ClassRule | null {
  const hay = texts.join(" ").toLowerCase();
  if (!hay.trim()) return null;
  for (const r of Object.values(rules)) {
    const name = r.course.toLowerCase();
    const words = name.split(/\s+/).filter((w) => w.length > 3 && !/^(intro|introduction|to|the|and|of)$/.test(w));
    if (hay.includes(name) || (words.length && words.every((w) => hay.includes(w)))) return r;
  }
  return null;
}

/** A short note for Milo's own instructions, so chat and lessons follow the rules too. (pure) */
export function rulesPrompt(rules: Rules): string {
  const list = Object.values(rules);
  if (!list.length) return "";
  return (
    "\nThe student asked you to follow these classes' syllabus AI rules. In those classes only, stay inside the rule and say why in one short sentence when you hold back:\n" +
    list.map((r) => `- ${r.course}: ${LEVEL_LABEL[r.level]}${r.quote ? ` ("${r.quote.slice(0, 160)}")` : ""}`).join("\n") +
    "\n(No AI = only planning and reminders. Studying only = explain, quiz, flashcards, but don't write, solve or check graded work for them. Unclear = treat as studying only and suggest they ask the professor.)"
  );
}

/** Clean what the AI read from a syllabus. A quote is required for anything but "unclear". (pure) */
export function cleanPolicy(raw: { level?: unknown; quote?: unknown } | null): { level: Level; quote: string } {
  const lv = String(raw?.level ?? "");
  const quote = typeof raw?.quote === "string" ? raw.quote.trim().slice(0, 300) : "";
  const level: Level = ["none", "study", "credit", "allowed", "unclear"].includes(lv) ? (lv as Level) : "unclear";
  return level !== "unclear" && !quote ? { level: "unclear", quote: "" } : { level, quote };
}
