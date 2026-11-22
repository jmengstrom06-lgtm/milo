/** Pure (no Electron): safe to unit test. */
// The safety net: a button that commits something real always waits for the student's yes,
// even if the AI forgot to ask. On personal sites (calendar, mail, chat) "Save"/"Add"/"Create" commit too.
const COMMIT_ANYWHERE = /^\W*(submit|send|post|publish|pay|buy|purchase|place (the |my |an? )?order|check ?out|delete|turn (it )?in|unenroll|drop (the )?class)\b/i;
const COMMIT_PERSONAL = /^\W*(save|send|create|add|schedule|book|reserve|confirm|invite|reply|share|done)\b/i;
const PERSONAL_SITE = /calendar\.google\.com|mail\.google\.com|outlook\.(live|office|office365)\.com|messages\.google\.com|web\.whatsapp\.com|discord\.com|app\.slack\.com|instagram\.com|groupme\.com|linkedin\.com\/messaging/i;
export function needsYes(label: string, url: string): string | null {
  const l = (label ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
  if (!l) return null;
  const m = l.match(COMMIT_ANYWHERE) ?? (PERSONAL_SITE.test(url) ? l.match(COMMIT_PERSONAL) : null);
  return m ? m[1].toLowerCase() : null;
}
