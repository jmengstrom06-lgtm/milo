#!/usr/bin/env node
// `npm run ext:zip`: makes the file you upload to the Chrome Web Store (release/milo-extension-<version>.zip).
// Leaves out config.json (Milo's per-launch secret) and Mac junk files.

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const ext = path.join(root, "extension");
const manifest = JSON.parse(fs.readFileSync(path.join(ext, "manifest.json"), "utf8"));
const out = path.join(root, "release", `milo-extension-${manifest.version}.zip`);

fs.mkdirSync(path.dirname(out), { recursive: true });
if (fs.existsSync(out)) fs.rmSync(out);
execFileSync("zip", ["-r", "-X", out, ".", "-x", "config.json", "*.DS_Store", "__MACOSX*"], { cwd: ext, stdio: "ignore" });
const kb = (fs.statSync(out).size / 1024).toFixed(0);
console.log(`Made ${path.relative(root, out)} (${kb} KB). Upload it at https://chrome.google.com/webstore/devconsole`);
console.log("Store listing text, permission reasons and privacy policy: docs/chrome-web-store.md");
