// The student's saved details: the pure parts (no Electron), shared with the renderer.

export type Profile = Partial<Record<ProfileKey, string>>;
export const PROFILE_KEYS = ["name", "email", "school_email", "student_id", "school", "major", "minor", "year", "phone", "advisor", "pronouns"] as const;
export type ProfileKey = (typeof PROFILE_KEYS)[number];
export const LABEL: Record<ProfileKey, string> = {
  name: "Full name",
  email: "Email",
  school_email: "School email",
  student_id: "Student ID",
  school: "School",
  major: "Major",
  minor: "Minor",
  year: "Year",
  phone: "Phone",
  advisor: "Advisor",
  pronouns: "Pronouns",
};

/** "my student id is 1234567", "remember my major is finance", "my email's jake@tcu.edu". */
export function parseProfileFact(text: string): { key: ProfileKey; value: string } | null {
  const t = text.trim().replace(/[.!]+$/, "");
  const m = t.match(/^(?:hey milo,?\s*)?(?:remember (?:that )?|save (?:that )?|fyi,?\s*)?my\s+(full name|name|school email|tcu email|email(?: address)?|student id(?: number)?|student number|id number|school|college|university|major|minor|year|class year|grade|phone(?: number)?|cell(?: number)?|advisor|pronouns)\s*(?:is|'s|are|=|:)\s+(.+)$/i);
  if (!m) return null;
  const k = m[1].toLowerCase();
  let value = m[2].trim().replace(/^["']|["']$/g, "");
  const key: ProfileKey = /name/.test(k)
    ? "name"
    : /school email|tcu email/.test(k)
      ? "school_email"
      : /email/.test(k)
        ? "email"
        : /student|id number/.test(k)
          ? "student_id"
          : /school|college|university/.test(k)
            ? "school"
            : /major/.test(k)
              ? "major"
              : /minor/.test(k)
                ? "minor"
                : /year|grade/.test(k)
                  ? "year"
                  : /phone|cell/.test(k)
                    ? "phone"
                    : /advisor/.test(k)
                      ? "advisor"
                      : "pronouns";
  if (key === "student_id" || key === "phone") value = value.replace(/\s+/g, "");
  if (key === "email" || key === "school_email") value = value.replace(/\s+at\s+/i, "@").replace(/\s+dot\s+/gi, ".").replace(/\s+/g, "").toLowerCase();
  if (!value || value.length > 120) return null;
  return { key, value };
}
export const profileLabel = (k: ProfileKey) => LABEL[k];
