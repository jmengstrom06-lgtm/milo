// What Home base already knows (school's D2L address, classes, current grades), shared with Milo's brain so
// chat never says "I don't have your grades" while the sidebar shows them. Kept in memory only.
export type StudentContext = { portal: string; classes: { name: string; grade: number | null }[] };
let ctx: StudentContext = { portal: "", classes: [] };

export function setStudentContext(c: Partial<StudentContext>) {
  ctx = {
    portal: typeof c.portal === "string" ? c.portal.slice(0, 200) : ctx.portal,
    classes: Array.isArray(c.classes)
      ? c.classes
          .filter((x) => x && typeof x.name === "string")
          .slice(0, 12)
          .map((x) => ({ name: x.name.slice(0, 80), grade: typeof x.grade === "number" && isFinite(x.grade) ? Math.round(x.grade * 10) / 10 : null }))
      : ctx.classes,
  };
}
/** A few lines for the brain's instructions. (pure given ctx) */
export function contextPrompt(c: StudentContext = ctx): string {
  if (!c.portal && !c.classes.length) return "";
  const lines = [
    c.portal ? `Their school's D2L is ${c.portal} (you're connected; never ask which school).` : "",
    c.classes.length ? `Their classes and current grades from D2L: ${c.classes.map((x) => `${x.name}${x.grade != null ? ` ${x.grade}%` : ""}`).join("; ")}.` : "",
  ].filter(Boolean);
  return `\nWhat you know from their school account:\n${lines.join("\n")}`;
}
