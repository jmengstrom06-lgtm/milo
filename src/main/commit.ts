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

// Graded work is the student's to turn in. Milo can help them do it, fill it in and check it, but the button
// that hands it to the professor is theirs, every time, even if they say "and turn it in".
const LMS_SITE = /brightspace\.com|\/d2l\/|instructure\.com|canvas\.|blackboard\.com|\/ultra\/|moodle|schoology\.com|gradescope\.com|mylab|pearson\.com|mheducation\.com|connect\.mheducation|webassign\.net|wileyplus|cengage\.com|aplia|mastering|achieve\.macmillan/i;
const TURN_IN_BUTTON = /^\W*(submit|turn (it )?in|hand in|finish attempt|submit (quiz|attempt|assignment|answers?|all|test|exam)|save (all )?and submit|finish (quiz|test|exam)|end (quiz|test|exam))\b/i;
const TURN_IN_TEXT = /\b(submit(ting)?|turn(ing)? (it |this |that |them )?in|hand(ing)? (it )?in|finish (the )?(attempt|quiz|test|exam)|upload(ing)? (it |the \w+ )?to (the )?(dropbox|assignment))\b/i;
const SCHOOL_WORK = /\b(d2l|brightspace|canvas|blackboard|moodle|dropbox|assignment|homework|problem set|quiz|exam|midterm|final|test|worksheet|lab report|essay|paper|discussion|graded|module|chapter \d|mylab|webassign|gradescope)\b/i;

/** Is this button the one that turns in graded work (on a school site)? (pure) */
export function turnsInGradedWork(label: string, url: string): boolean {
  const l = (label ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
  return !!l && LMS_SITE.test(url ?? "") && TURN_IN_BUTTON.test(l);
}
/** Is this step of a job "turn in the graded work"? (pure) */
export function turnInStep(step: string, goal: string): boolean {
  return TURN_IN_TEXT.test(step) && (SCHOOL_WORK.test(`${step} ${goal}`) || LMS_SITE.test(`${step} ${goal}`));
}
export const TURN_IN_LINE = "It's all filled in and open for you. Look it over and turn it in yourself: I don't submit graded work, so it's always your call.";
