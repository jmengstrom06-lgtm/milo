// Pages Milo must NOT push through on his own: sign-ins, 2-step codes, "are you human" checks.
// He stops and asks the student instead of failing or guessing. Pure logic so it's easy to test.

export type Blocker = { kind: "login" | "code" | "captcha"; site: string; text: string };
type PageLike = { url?: string; title?: string; text?: string; elements?: { tag?: string; type?: string; label?: string; inView?: boolean }[] };

const hostOf = (url = "") => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};
const siteName = (url = "", title = "") => {
  const h = hostOf(url);
  if (/microsoftonline|login\.live|office\.com/.test(h)) return "your school Microsoft account";
  if (/accounts\.google/.test(h)) return "Google";
  if (/duosecurity|duo\.com/.test(h)) return "Duo";
  if (/okta/.test(h)) return "your school sign-in";
  if (/d2l|brightspace/.test(h) || /brightspace|d2l/i.test(title)) return "D2L";
  if (/instructure|canvas/.test(h)) return "Canvas";
  return h || "this site";
};

const CAPTCHA = /\b(captcha|recaptcha|hcaptcha|verify (that )?you('re| are) (a )?human|are you a robot|i'?m not a robot|checking (if the site connection is secure|your browser)|press and hold)\b/i;
const CODE = /\b((verification|security|authentication|one[- ]time|login|sign[- ]in|6[- ]digit) code|two[- ](step|factor)|2fa|multi[- ]factor|duo (push|mobile)|approve (the |this )?sign[- ]in|check your (phone|authenticator)|authenticator app|enter the code (we|that was) sent|we sent (a|you a) code)\b/i;
const LOGIN_URL = /(\/|\.)(login|log-in|signin|sign-in|sso|saml|oauth2?|cas\/login|adfs|idp)\b|microsoftonline\.com|accounts\.google\.com\/(v3\/)?signin|okta\.com/i;
const LOGIN_TEXT = /\b(sign in|log in|login|username|password)\b/i;

export function detectBlocker(p: PageLike): Blocker | null {
  const text = (p.text ?? "").slice(0, 6000);
  const site = siteName(p.url, p.title);
  const els = p.elements ?? [];
  if (CAPTCHA.test(text) || els.some((e) => /captcha|not a robot/i.test(e.label ?? "")))
    return { kind: "captcha", site, text: `${site === "this site" ? "This site" : site} wants to check you're human. Can you do that part? Say keep going when you're through.` };
  const pwd = els.some((e) => e.tag === "input" && e.type === "password" && e.inView !== false);
  const codeBox = els.some((e) => e.tag === "input" && /one-time-code|code|otp|passcode|verification/i.test(`${e.type} ${e.label}`));
  if (CODE.test(text) && (codeBox || /duo|approve|check your phone|authenticator/i.test(text) || LOGIN_URL.test(p.url ?? "")))
    return { kind: "code", site, text: `${site} needs your sign-in code or a tap on your phone. Can you do that? Say keep going when you're in.` };
  if (pwd || (LOGIN_URL.test(p.url ?? "") && LOGIN_TEXT.test(text)))
    return { kind: "login", site, text: `I need you to sign in to ${site}. I never type passwords. Say keep going when you're in.` };
  return null;
}
