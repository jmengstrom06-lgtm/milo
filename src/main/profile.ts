// The student's details, saved once on this Mac and filled in for them: name, email, student ID, major...
// Never leaves the Mac except as part of the task Milo is doing (e.g. typed into a form the student asked for).

import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

import { LABEL, PROFILE_KEYS, type Profile } from "./profileFacts";
export { parseProfileFact, profileLabel, PROFILE_KEYS, type Profile, type ProfileKey } from "./profileFacts";

const file = () => path.join(app.getPath("userData"), "profile.json");
let cache: Profile | null = null;

export function getProfile(): Profile {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(file(), "utf8")) ?? {};
  } catch {
    cache = {};
  }
  return cache!;
}

export function setProfile(patch: Profile): Profile {
  const p = { ...getProfile() };
  for (const k of PROFILE_KEYS) {
    if (!(k in patch)) continue;
    const v = String(patch[k] ?? "").trim();
    if (v) p[k] = v.slice(0, 120);
    else delete p[k];
  }
  cache = p;
  try {
    fs.mkdirSync(app.getPath("userData"), { recursive: true });
    fs.writeFileSync(file(), JSON.stringify(p, null, 2));
  } catch {
    /* not fatal */
  }
  return p;
}

/** For prompts: the student's saved details, or "" if none. */
export function profileText(): string {
  const p = getProfile();
  const lines = PROFILE_KEYS.filter((k) => p[k]).map((k) => `${LABEL[k]}: ${p[k]}`);
  return lines.length ? `The student's saved details (use these when a form asks; never make up details that aren't here, ask instead):\n${lines.join("\n")}` : "";
}

