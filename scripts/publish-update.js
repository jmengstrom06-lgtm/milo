#!/usr/bin/env node
// Publish a new version of Milo to every student: `npm run release` (builds, then runs this).
// Uploads the built app from release/ to Supabase Storage (bucket "milo-updates"). Every installed Milo
// checks there and updates itself. The manifest (latest-mac.yml) goes up LAST, so no one sees a version
// whose files aren't there yet.
//
// Needs MILO_UPLOAD_KEY in your .env: Supabase dashboard > Project Settings > API Keys > service_role (secret).
// Never paste it anywhere else. Bump "version" in package.json before each release or no one updates.

const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const env = Object.fromEntries(
  (fs.existsSync(path.join(root, ".env")) ? fs.readFileSync(path.join(root, ".env"), "utf8") : "")
    .split("\n")
    .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2]])
);
const KEY = process.env.MILO_UPLOAD_KEY || env.MILO_UPLOAD_KEY;
const URL = "https://ptfvptkhzxnpvdhgnfcp.supabase.co";
const BUCKET = "milo-updates";
const dir = path.join(root, "release");
const version = require(path.join(root, "package.json")).version;

if (!KEY) {
  console.log("Missing MILO_UPLOAD_KEY in .env (Supabase > Project Settings > API Keys > service_role). Nothing uploaded.");
  process.exit(1);
}
if (!fs.existsSync(path.join(dir, "latest-mac.yml"))) {
  console.log("No release/latest-mac.yml. Run `npm run dist` first.");
  process.exit(1);
}

const files = fs
  .readdirSync(dir)
  .filter((f) => f.includes(version) && /\.(zip|zip\.blockmap|dmg)$/.test(f))
  .concat("latest-mac.yml"); // last on purpose

const type = (f) => (f.endsWith(".yml") ? "text/yaml" : f.endsWith(".dmg") ? "application/x-apple-diskimage" : "application/octet-stream");

(async () => {
  // don't publish the same version twice by accident
  const live = await fetch(`${URL}/storage/v1/object/public/${BUCKET}/latest-mac.yml`).then((r) => (r.ok ? r.text() : ""));
  const liveVersion = (live.match(/^version:\s*(.+)$/m) || [])[1];
  if (liveVersion && liveVersion.trim() === version) {
    console.log(`Version ${version} is already live. Bump "version" in package.json, run npm run release again.`);
    process.exit(1);
  }
  for (const f of files) {
    const body = fs.readFileSync(path.join(dir, f));
    process.stdout.write(`Uploading ${f} (${(body.length / 1e6).toFixed(1)} MB)… `);
    const r = await fetch(`${URL}/storage/v1/object/${BUCKET}/${encodeURIComponent(f)}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, apikey: KEY, "x-upsert": "true", "content-type": type(f), "cache-control": f.endsWith(".yml") ? "max-age=60" : "max-age=31536000" },
      body,
    });
    if (!r.ok) {
      console.log(`failed (${r.status}): ${(await r.text()).slice(0, 200)}`);
      process.exit(1);
    }
    console.log("done");
  }
  console.log(`\nMilo ${version} is live. Installed Milos pick it up within a few hours (or at their next launch).`);
  const dmg = files.find((f) => f.endsWith(".dmg"));
  if (dmg) console.log(`Download link for new students: ${URL}/storage/v1/object/public/${BUCKET}/${encodeURIComponent(dmg)}`);
})();
