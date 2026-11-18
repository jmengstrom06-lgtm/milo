// Instant commands: common requests Milo can do without asking the AI (no screenshot round trip).
// "open google docs and write a story about a frog" -> quick step (new doc) + rest ("write a story…") for the AI.

export type QuickStep =
  | { kind: "app"; app: string; say: string }
  | { kind: "url"; url: string; say: string }
  | { kind: "keys"; keys: string; say: string; browser?: boolean }
  | { kind: "download"; say: string }
  | { kind: "folder"; folder: "downloads" | "desktop" | "documents"; say: string };

const APPS: Record<string, string> = {
  chrome: "Google Chrome", "google chrome": "Google Chrome", safari: "Safari", firefox: "Firefox", arc: "Arc",
  word: "Microsoft Word", "microsoft word": "Microsoft Word", excel: "Microsoft Excel", "microsoft excel": "Microsoft Excel",
  powerpoint: "Microsoft PowerPoint", "power point": "Microsoft PowerPoint", outlook: "Microsoft Outlook", teams: "Microsoft Teams",
  notes: "Notes", "apple notes": "Notes", calculator: "Calculator", calendar: "Calendar", reminders: "Reminders",
  messages: "Messages", imessage: "Messages", mail: "Mail", finder: "Finder", music: "Music", "apple music": "Music",
  spotify: "Spotify", claude: "Claude", chatgpt: "ChatGPT", "chat gpt": "ChatGPT", slack: "Slack", discord: "Discord",
  zoom: "zoom.us", facetime: "FaceTime", photos: "Photos", preview: "Preview", pages: "Pages", numbers: "Numbers", keynote: "Keynote",
  "vs code": "Visual Studio Code", vscode: "Visual Studio Code", terminal: "Terminal", "system settings": "System Settings",
  settings: "System Settings", "app store": "App Store", notion: "Notion", "photo booth": "Photo Booth", maps: "Maps",
};

const SITES: Record<string, [string, string]> = {
  youtube: ["https://www.youtube.com", "YouTube"],
  gmail: ["https://mail.google.com", "Gmail"], "google mail": ["https://mail.google.com", "Gmail"],
  "google docs": ["https://docs.google.com/document/u/0/", "Google Docs"], docs: ["https://docs.google.com/document/u/0/", "Google Docs"],
  "google sheets": ["https://docs.google.com/spreadsheets/u/0/", "Google Sheets"], sheets: ["https://docs.google.com/spreadsheets/u/0/", "Google Sheets"],
  "google slides": ["https://docs.google.com/presentation/u/0/", "Google Slides"], slides: ["https://docs.google.com/presentation/u/0/", "Google Slides"],
  "google drive": ["https://drive.google.com", "Google Drive"], drive: ["https://drive.google.com", "Google Drive"],
  "google calendar": ["https://calendar.google.com", "Google Calendar"], google: ["https://www.google.com", "Google"],
  "google maps": ["https://maps.google.com", "Google Maps"], "google classroom": ["https://classroom.google.com", "Google Classroom"],
  instagram: ["https://www.instagram.com", "Instagram"], tiktok: ["https://www.tiktok.com", "TikTok"], "tik tok": ["https://www.tiktok.com", "TikTok"],
  twitter: ["https://x.com", "X"], x: ["https://x.com", "X"], linkedin: ["https://www.linkedin.com", "LinkedIn"],
  reddit: ["https://www.reddit.com", "Reddit"], netflix: ["https://www.netflix.com", "Netflix"], amazon: ["https://www.amazon.com", "Amazon"],
  github: ["https://github.com", "GitHub"], wikipedia: ["https://www.wikipedia.org", "Wikipedia"], espn: ["https://www.espn.com", "ESPN"],
  "claude.ai": ["https://claude.ai", "Claude"], "chatgpt.com": ["https://chatgpt.com", "ChatGPT"], quizlet: ["https://quizlet.com", "Quizlet"],
  canvas: ["https://canvas.instructure.com", "Canvas"], outlook: ["https://outlook.office.com", "Outlook"],
};

const NEW_DOCS: [RegExp, string, string][] = [
  [/^(a )?(new |blank )?(google )?doc(ument)?$|^(a )?new (google )?docs?$/, "https://docs.new", "a new Google Doc"],
  [/^(a )?(new |blank )?(google )?(spread)?sheet$|^(a )?new (google )?sheets$/, "https://sheets.new", "a new Google Sheet"],
  [/^(a )?(new |blank )?(google )?slides?( deck)?$|^(a )?new (google )?presentation$/, "https://slides.new", "a new Google Slides deck"],
];

const enc = encodeURIComponent;
const clean = (s: string) =>
  s.toLowerCase().replace(/[.!?]+$/, "").replace(/^(the|my|a|an|up)\s+/g, "").replace(/\s+(app|application|website|site|page)$/, "").trim();

function isNewDocWanted(t: string) {
  return /\b(new|blank)\b/.test(t) || /^(a )?(doc|document|sheet|spreadsheet|slides?|presentation)$/.test(t);
}

/** Exported for tests. */
export function plan(raw: string): { steps: QuickStep[]; rest: string | null } {
  const text = raw.trim().replace(/[.!?]+$/, "");
  const t = text.toLowerCase();

  // Split "do X and then do Y" into the first clause and the rest.
  const m = t.match(/^(.+?)\s*(?:,?\s+and then\s+|,?\s+then\s+|,?\s+and\s+)(.+)$/);
  const first = m ? m[1] : t;
  const restRaw = m ? text.slice(text.toLowerCase().indexOf(m[2], m[1].length)) : null;

  const step = one(first);
  if (!step) return { steps: [], rest: text }; // not instant: the AI handles all of it
  if (!restRaw) return { steps: [step], rest: null };
  const more = plan(restRaw);
  return { steps: [step, ...more.steps], rest: more.rest };
}

function one(t: string): QuickStep | null {
  // ---- folders
  const f = t.match(/\b(downloads?|desktop|documents)( folder)?$/);
  if (f && /^(open|go to|go into|pull up|show me|bring up)\b/.test(t) && (f[2] || /folder/.test(t) || !/download(ed)?\b/.test(t))) {
    const folder = f[1].startsWith("download") ? "downloads" : (f[1] as "desktop" | "documents");
    return { kind: "folder", folder, say: `Opening your ${folder}!` };
  }
  // ---- newest download
  if (
    /\b(download|downloaded|downloads)\b/.test(t) &&
    /^(open|go to|go into|pull up|show me|bring up|find|get|look at|check)\b/.test(t) &&
    !/\bfolder\b/.test(t)
  )
    return { kind: "download", say: "Opening your latest download!" };

  // ---- tab / browser keys
  if (/^(open |make |start )?(a )?new tab$/.test(t)) return { kind: "keys", keys: "cmd+t", say: "New tab!", browser: true };
  if (/^(open |make )?(a )?new (browser )?window$/.test(t)) return { kind: "keys", keys: "cmd+n", say: "New window!", browser: true };
  if (/^close (this |the |that )?tab$/.test(t)) return { kind: "keys", keys: "cmd+w", say: "Closing the tab" };
  if (/^(go to |switch to )?(the )?next tab$/.test(t)) return { kind: "keys", keys: "ctrl+tab", say: "Next tab" };
  if (/^(go to |switch to )?(the )?(previous|last|other) tab$/.test(t)) return { kind: "keys", keys: "ctrl+shift+tab", say: "Previous tab" };
  if (/^(go back|back|go to the previous page)$/.test(t)) return { kind: "keys", keys: "cmd+[", say: "Going back" };
  if (/^(go forward|forward)$/.test(t)) return { kind: "keys", keys: "cmd+]", say: "Going forward" };
  if (/^(refresh|reload)( (this|the) page)?$/.test(t)) return { kind: "keys", keys: "cmd+r", say: "Refreshing" };
  if (/^scroll down$/.test(t)) return { kind: "keys", keys: "pagedown", say: "Scrolling down" };
  if (/^scroll up$/.test(t)) return { kind: "keys", keys: "pageup", say: "Scrolling up" };
  if (/^reopen (the |that |my )?(last )?(closed )?tab$/.test(t)) return { kind: "keys", keys: "cmd+shift+t", say: "Bringing it back" };

  // ---- searches
  let s = t.match(/^(?:search|look up|find)\s+(?:on\s+)?youtube\s+(?:for\s+)?(.+)$/) || t.match(/^(?:search|look up|find)\s+(?:for\s+)?(.+?)\s+on youtube$/);
  if (s) return { kind: "url", url: `https://www.youtube.com/results?search_query=${enc(s[1])}`, say: `Searching YouTube for ${s[1]}` };
  s = t.match(/^(?:search|look up|find)\s+(?:on\s+)?amazon\s+(?:for\s+)?(.+)$/) || t.match(/^(?:search|look up|find)\s+(?:for\s+)?(.+?)\s+on amazon$/);
  if (s) return { kind: "url", url: `https://www.amazon.com/s?k=${enc(s[1])}`, say: `Searching Amazon for ${s[1]}` };
  s = t.match(/^(?:google|search google for|search (?:the web |online )?for|search|look up)\s+(.+?)(?:\s+on google)?$/);
  if (s && !/^(it|that|this)$/.test(s[1])) return { kind: "url", url: `https://www.google.com/search?q=${enc(s[1])}`, say: `Searching for ${s[1]}` };

  // ---- open / go to
  const o = t.match(/^(?:open|launch|start|pull up|bring up|go to|go on|switch to|show me|take me to|visit|get me|make|create)\s+(?:up\s+)?(.+)$/);
  if (!o) return null;
  const target = clean(o[1]);

  for (const [re, url, label] of NEW_DOCS) {
    if (re.test(target) && isNewDocWanted(o[1].toLowerCase())) return { kind: "url", url, say: `Opening ${label}!` };
  }
  if (SITES[target]) return { kind: "url", url: SITES[target][0], say: `Opening ${SITES[target][1]}!` };
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)*\.(com|org|edu|net|io|ai|gov|co|us|app|dev|tv|me)(\/\S*)?$/.test(target))
    return { kind: "url", url: `https://${target}`, say: `Going to ${target}` };
  if (APPS[target]) return { kind: "app", app: APPS[target], say: `Opening ${APPS[target].replace(/^Microsoft |\.us$/, "")}!` };
  // Unknown one-word/two-word names: try it as an app ("open figma").
  if (/^[a-z0-9 ]{2,24}$/.test(target) && target.split(" ").length <= 2 && !/\b(it|this|that|them)\b/.test(target)) {
    const name = target.replace(/\b\w/g, (c) => c.toUpperCase());
    return { kind: "app", app: name, say: `Opening ${name}!` };
  }
  return null;
}
