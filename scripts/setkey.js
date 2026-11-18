// Saves an API key from your clipboard into .env. Works for:
//   Anthropic keys  (start with sk-ant-)  -> ANTHROPIC_API_KEY
//   ElevenLabs keys (start with sk_)      -> ELEVENLABS_API_KEY
//   Deepgram keys   (40 letters/numbers)  -> DEEPGRAM_API_KEY
// Usage: copy the key, then run `npm run setkey` (or double-click "Set Milo Key.command").
const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const envPath = path.join(root, ".env");
const examplePath = path.join(root, ".env.example");

let key = "";
try {
  key = execSync("pbpaste", { encoding: "utf8" }).trim();
} catch {
  console.error("Couldn't read the clipboard. This command works on a Mac.");
  process.exit(1);
}

let name = null;
if (key.startsWith("sk-ant-")) name = "ANTHROPIC_API_KEY";
else if (/^sk_[A-Za-z0-9]{20,}$/.test(key)) name = "ELEVENLABS_API_KEY";
else if (/^[a-f0-9]{40}$/i.test(key)) name = "DEEPGRAM_API_KEY";

if (!name) {
  console.error("Your clipboard doesn't hold a key I recognize.");
  console.error("Anthropic keys start with sk-ant-   ElevenLabs keys start with sk_   Deepgram keys are 40 letters/numbers");
  console.error("Copy the key, then run this again.");
  process.exit(1);
}

let env = fs.existsSync(envPath)
  ? fs.readFileSync(envPath, "utf8")
  : fs.existsSync(examplePath)
    ? fs.readFileSync(examplePath, "utf8")
    : "";

const line = new RegExp(`^${name}=.*$`, "m");
if (line.test(env)) env = env.replace(line, `${name}=${key}`);
else env = env.replace(/\n*$/, "\n") + `${name}=${key}\n`;

fs.writeFileSync(envPath, env, { mode: 0o600 });
const label = name === "ANTHROPIC_API_KEY" ? "Anthropic (brain)" : name === "DEEPGRAM_API_KEY" ? "Deepgram (ears)" : "ElevenLabs (voice)";
console.log(`Saved ${label} key ending in ...${key.slice(-4)} to .env. Restart Milo to use it.`);
