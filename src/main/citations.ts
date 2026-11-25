// MLA 9 and APA 7, for journal articles (from scholarly databases) and web pages. Pure (tested).
// Leaves out what's missing; never a placeholder like "n.p." for something that exists.

export type CiteStyle = "MLA" | "APA";
export type Source = {
  kind: "article" | "web";
  title: string;
  authors: string[]; // "Jane Q. Smith" or an organization
  year?: number;
  date?: string; // 2023-05-14
  container?: string; // journal
  site?: string; // website name
  volume?: string;
  issue?: string;
  pages?: string;
  doi?: string;
  url: string;
};

/** The style the student wants: what they said, else what the paper already uses, else MLA. (pure) */
export function styleOf(ask: string, docText = ""): CiteStyle {
  if (/\bapa\b/i.test(ask)) return "APA";
  if (/\bmla\b/i.test(ask)) return "MLA";
  if (/\n\s*References\s*\n/i.test(docText) || /\([A-Z][A-Za-z-]+(?: et al\.)?, \d{4}\)/.test(docText)) return "APA";
  return "MLA";
}

const ORG_WORDS = /\b(associations?|institutes?|universit(y|ies)|departments?|agenc(y|ies)|organi[sz]ations?|cent(er|re)s?|councils?|foundations?|societ(y|ies)|bureaus?|offices?|national|world|boards?|commissions?|administration|services|ministry|committee|alliance|coalition|network|program(me)?|project|news|times|press|inc|llc|corp)\b/i;
/** A group, not a person: org words, or a long name with "of"/"and"/"for" in it. */
const isOrg = (n: string) => ORG_WORDS.test(n) || (n.split(/\s+/).length >= 4 && /\b(of|and|for|the)\b/i.test(n));
const ORG = { test: isOrg };
const split = (name: string) => {
  const parts = name.trim().replace(/\s+/g, " ").split(" ");
  return { last: parts.pop() ?? "", first: parts };
};
const initials = (first: string[]) => first.map((f) => `${f.replace(/\./g, "")[0]?.toUpperCase()}.`).join(" ");
const sentence = (t: string) => t.replace(/\s+/g, " ").trim().replace(/[.]$/, "");
// Titles stay as the publisher wrote them: changing case by rule breaks names ("Alzheimer's", "iPhone", "COVID-19").
const titleCase = (t: string) => sentence(t);
const apaTitle = (t: string) => sentence(t);

function mlaAuthors(a: string[]): string {
  if (!a.length) return "";
  if (a.length === 1 && ORG.test(a[0])) return `${a[0]}.`;
  const { last, first } = split(a[0]);
  const lead = first.length ? `${last}, ${first.join(" ")}` : last;
  if (a.length === 1) return `${lead}.`;
  if (a.length === 2) return `${lead}, and ${a[1]}.`;
  return `${lead}, et al.`;
}
function apaAuthors(a: string[]): string {
  if (!a.length) return "";
  const one = (n: string) => (ORG.test(n) ? n : (() => { const { last, first } = split(n); return first.length ? `${last}, ${initials(first)}` : last; })());
  const list = a.slice(0, 20).map(one);
  if (list.length === 1) return list[0];
  if (list.length === 2) return `${list[0]}, & ${list[1]}`;
  return `${list.slice(0, -1).join(", ")}, & ${list[list.length - 1]}`;
}
const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};
const MON = ["Jan.", "Feb.", "Mar.", "Apr.", "May", "June", "July", "Aug.", "Sept.", "Oct.", "Nov.", "Dec."];
const MONTH = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const ymd = (s: Source) => {
  const m = (s.date ?? "").match(/(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?/);
  return { y: m ? Number(m[1]) : s.year, m: m?.[2] ? Number(m[2]) : undefined, d: m?.[3] ? Number(m[3]) : undefined };
};
const doiUrl = (doi?: string) => (doi ? `https://doi.org/${doi.replace(/^https?:\/\/doi\.org\//, "")}` : "");

/** One Works Cited / References line. */
export function citeLine(s: Source, style: CiteStyle, accessed = new Date()): string {
  const { y, m, d } = ymd(s);
  if (style === "APA") {
    const who = apaAuthors(s.authors) || s.site || host(s.url);
    const when = y ? `(${y}${s.kind === "web" && m ? `, ${MONTH[m - 1]}${d ? ` ${d}` : ""}` : ""})` : "(n.d.)";
    if (s.kind === "article") {
      const vol = s.volume ? `, ${s.volume}${s.issue ? `(${s.issue})` : ""}` : "";
      const pp = s.pages ? `, ${s.pages}` : "";
      return `${who}. ${when}. ${apaTitle(s.title)}. ${s.container ? `${titleCase(s.container)}${vol}${pp}. ` : ""}${doiUrl(s.doi) || s.url}`.replace(/\.\./g, ".");
    }
    const site = s.site && s.site !== who ? ` ${s.site}.` : "";
    return `${who}. ${when}. ${apaTitle(s.title)}.${site} ${s.url}`.replace(/\.\./g, ".");
  }
  // MLA 9
  const who = mlaAuthors(s.authors);
  if (s.kind === "article") {
    const bits = [s.container ? titleCase(s.container) : "", s.volume ? `vol. ${s.volume}` : "", s.issue ? `no. ${s.issue}` : "", y ? String(y) : "", s.pages ? `pp. ${s.pages}` : ""].filter(Boolean);
    const loc = s.doi ? `https://doi.org/${s.doi}` : s.url.replace(/^https?:\/\//, "");
    return `${who ? who + " " : ""}"${titleCase(s.title)}." ${bits.length ? bits.join(", ") + ", " : ""}${loc}.`.replace(/\.\./g, ".");
  }
  const site = s.site || host(s.url);
  const when = y ? `${d ? `${d} ` : ""}${m ? `${MON[m - 1]} ` : ""}${y}` : "";
  const acc = y ? "" : ` Accessed ${accessed.getDate()} ${MON[accessed.getMonth()]} ${accessed.getFullYear()}.`;
  const bits = [site && site !== s.authors[0] ? titleCase(site) : "", when, s.url.replace(/^https?:\/\//, "")].filter(Boolean);
  return `${who && s.authors[0] !== site ? who + " " : ""}"${titleCase(s.title)}." ${bits.join(", ")}.${acc}`.replace(/\.\./g, ".");
}

/** The in-text citation: (Smith) / (Smith and Lee) / (Smith et al.) in MLA; (Smith, 2021) in APA. */
export function inText(s: Source, style: CiteStyle): string {
  const lasts = s.authors.map((n) => (ORG.test(n) ? n : split(n).last));
  const { y } = ymd(s);
  const shortTitle = `"${titleCase(s.title).split(/[:.?]/)[0].split(" ").slice(0, 4).join(" ")}"`;
  if (style === "APA") {
    const who = !lasts.length ? shortTitle : lasts.length === 1 ? lasts[0] : lasts.length === 2 ? `${lasts[0]} & ${lasts[1]}` : `${lasts[0]} et al.`;
    return `(${who}, ${y ?? "n.d."})`;
  }
  const who = !lasts.length ? shortTitle : lasts.length === 1 ? lasts[0] : lasts.length === 2 ? `${lasts[0]} and ${lasts[1]}` : `${lasts[0]} et al.`;
  return `(${who})`;
}
