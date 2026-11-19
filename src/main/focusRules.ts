// Lock-in mode: what counts as a distraction. Pure functions (no Electron), unit-tested in tests/focus.test.ts.

export type FocusVerdict =
  | { status: "work" } // studying, or anything that isn't a known distraction
  | { status: "distracted"; label: string } // a known time sink ("TikTok", "Messages")
  | { status: "neutral" }; // Milo himself, Finder, System Settings: don't count either way

/** Sites that eat study time. Matched on the host (subdomains included). */
const SITES: Record<string, string> = {
  "tiktok.com": "TikTok",
  "instagram.com": "Instagram",
  "youtube.com": "YouTube",
  "youtu.be": "YouTube",
  "x.com": "X",
  "twitter.com": "X",
  "reddit.com": "Reddit",
  "facebook.com": "Facebook",
  "snapchat.com": "Snapchat",
  "netflix.com": "Netflix",
  "hulu.com": "Hulu",
  "disneyplus.com": "Disney+",
  "max.com": "Max",
  "primevideo.com": "Prime Video",
  "twitch.tv": "Twitch",
  "discord.com": "Discord",
  "espn.com": "ESPN",
  "bleacherreport.com": "Bleacher Report",
  "pinterest.com": "Pinterest",
  "tumblr.com": "Tumblr",
  "9gag.com": "9GAG",
  "amazon.com": "Amazon",
  "shein.com": "Shein",
  "draftkings.com": "DraftKings",
  "fanduel.com": "FanDuel",
  "prizepicks.com": "PrizePicks",
  "chess.com": "Chess.com",
  "roblox.com": "Roblox",
  "web.whatsapp.com": "WhatsApp",
  "messenger.com": "Messenger",
};

/** Mac apps that eat study time (the app's name as macOS shows it). */
const APPS: Record<string, string> = {
  messages: "Messages",
  discord: "Discord",
  steam: "Steam",
  "steam helper": "Steam",
  whatsapp: "WhatsApp",
  telegram: "Telegram",
  facetime: "FaceTime",
  netflix: "Netflix",
  tv: "Apple TV",
  photos: "Photos",
  minecraft: "Minecraft",
  roblox: "Roblox",
  "roblox player": "Roblox",
  chess: "Chess",
  instagram: "Instagram",
  tiktok: "TikTok",
};

/** Apps that never count: Milo himself and the Mac's own plumbing. */
const NEUTRAL_APPS = /^(electron|milo|finder|system settings|system preferences|loginwindow|dock|control center|notification center|spotlight|screenshot|activity monitor|terminal|iterm2?)$/i;

const BROWSERS = /^(google chrome|safari|arc|brave browser|microsoft edge|firefox|opera|chromium|vivaldi|dia)$/i;
export const isBrowser = (app: string) => BROWSERS.test(app.trim());

/** Videos on YouTube that are obviously for class don't count. */
const STUDY_TITLE = /\b(lecture|lesson|tutorial|khan academy|crash course|organic chemistry tutor|professor|explained|how to solve|practice problems?|exam review|study with me|chapter \d+|calculus|statistics|algebra|chemistry|biology|physics|economics|accounting|derivative|integral|z-score|hypothesis test)\b/i;

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function siteLabel(host: string): string | null {
  if (!host) return null;
  for (const [domain, label] of Object.entries(SITES)) {
    if (host === domain || host.endsWith("." + domain)) return label;
  }
  return null;
}

/**
 * Is the student working right now?
 * `allowed` = labels the student said are for school this session ("YouTube is for class").
 */
export function judge(app: string, url = "", title = "", allowed: Set<string> = new Set()): FocusVerdict {
  const a = app.trim();
  if (!a || NEUTRAL_APPS.test(a)) return { status: "neutral" };
  if (isBrowser(a)) {
    const label = siteLabel(hostOf(url));
    if (!label || allowed.has(label)) return { status: "work" };
    if (label === "YouTube" && STUDY_TITLE.test(title) && !/\/shorts\//.test(url)) return { status: "work" };
    return { status: "distracted", label };
  }
  const label = APPS[a.toLowerCase()];
  if (label && !allowed.has(label)) return { status: "distracted", label };
  return { status: "work" };
}

const ONES: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

/** Speech-to-text writes numbers as words: "forty five minutes" -> "45 minutes". Leaves "an"/"a"/"one hour" readable. */
export function digitsFromWords(text: string): string {
  return text
    .replace(/\b(twenty|thirty|forty|fourty|fifty|sixty|seventy|eighty|ninety)[\s-]+(one|two|three|four|five|six|seven|eight|nine)\b/g, (_, t, o) => String(TENS[t] + ONES[o]))
    .replace(/\b(twenty|thirty|forty|fourty|fifty|sixty|seventy|eighty|ninety)\b/g, (_, t) => String(TENS[t]))
    .replace(/\b(a|one) hundred( and)? (\d+)\b/g, (_, _a, _b, n) => String(100 + Number(n)))
    .replace(/\b(a|one) hundred\b/g, "100")
    .replace(/\b(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen)\b(?=\s*(?:minutes?|mins?))/g, (w) => String(ONES[w]));
}

/** "lock in for 45 minutes on stats" -> { minutes: 45, topic: "stats" }. Exported for tests. */
export function parseLockIn(text: string): { minutes?: number; topic?: string } {
  const t = digitsFromWords(text.toLowerCase().replace(/[.!?]+$/, ""));
  let minutes: number | undefined;
  const words: Record<string, number> = { an: 1, a: 1, one: 1, two: 2, three: 3, half: 0.5 };
  const hm = t.match(/(\d+(?:\.\d+)?|an|a|one|two|three)\s*(?:and a half\s*)?(hours?|hrs?)\b/);
  if (/half an hour|half hour|thirty minutes/.test(t)) minutes = 30;
  else if (hm) {
    const n = words[hm[1]] ?? parseFloat(hm[1]);
    minutes = Math.round((n + (/and a half/.test(hm[0]) || /hours?\s+and a half/.test(t) ? 0.5 : 0)) * 60);
  } else {
    const mm = t.match(/(\d+)\s*(?:minutes?|mins?|m)\b/);
    if (mm) minutes = parseInt(mm[1], 10);
  }
  if (/pomodoro/.test(t) && !minutes) minutes = 25;
  if (minutes !== undefined) minutes = Math.max(5, Math.min(240, minutes));

  // Topic: the words after "on" / "for" / "study" that aren't a length of time.
  let topic: string | undefined;
  const cleaned = t.replace(/\b(?:for\s+)?(?:\d+(?:\.\d+)?|an?|one|two|three|half)\s*(?:and a half\s*)?(?:hours?|hrs?|minutes?|mins?)\b|\bhalf an hour\b|\bhalf hour\b|\bpomodoro\b/g, " ");
  for (const m of cleaned.matchAll(/\b(?:on|for|studying|study|with|do|doing)\s+(?:my\s+)?(?:the\s+)?([a-z0-9][a-z0-9 &'-]*)/g)) {
    const cand = m[1].replace(/\s+(?:for|until|till|now|please|real quick)\b.*$/, "").trim();
    if (cand && !/^(me|it|this|that|a while|a bit|now|real|focus|focused|lock|locking|in)\b/.test(cand)) topic = cand;
  }
  if (topic) topic = topic.replace(/\s+(homework|hw)$/, " homework").slice(0, 40);
  return { minutes, topic };
}

/** Pomodoro-style blocks: short sessions are one block; long ones get 25/5 cycles. */
export function planBlocks(minutes: number): { focus: number; rest: number }[] {
  if (minutes <= 35) return [{ focus: minutes, rest: 0 }];
  const blocks: { focus: number; rest: number }[] = [];
  let left = minutes;
  while (left > 0) {
    // Never end on a break: if only a few minutes would be left after this block, add them to it.
    const f = left - 25 <= 5 ? left : 25;
    left -= f;
    const r = left > 0 ? Math.min(5, left) : 0;
    left -= r;
    blocks.push({ focus: f, rest: r });
  }
  // Fold a tiny last block into the one before it.
  if (blocks.length > 1 && blocks[blocks.length - 1].focus < 10) {
    const last = blocks.pop()!;
    blocks[blocks.length - 1].focus += last.focus;
    blocks[blocks.length - 1].rest = 0;
  }
  return blocks;
}
