// Saves the Anthropic API key from your clipboard into .env.
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

if (!key.startsWith("sk-ant-")) {
  console.error("Your clipboard doesn't hold an Anthropic key (it should start with sk-ant-).");
  console.error("Click 'Copy key' in the Claude Console, then run this again.");
  process.exit(1);
}

let env = fs.existsSync(envPath)
  ? fs.readFileSync(envPath, "utf8")
  : fs.existsSync(examplePath)
    ? fs.readFileSync(examplePath, "utf8")
    : "ANTHROPIC_API_KEY=\n";

if (/^ANTHROPIC_API_KEY=.*$/m.test(env)) {
  env = env.replace(/^ANTHROPIC_API_KEY=.*$/m, `ANTHROPIC_API_KEY=${key}`);
} else {
  env = `ANTHROPIC_API_KEY=${key}\n` + env;
}

fs.writeFileSync(envPath, env, { mode: 0o600 });
console.log(`Saved key ending in ...${key.slice(-4)} to .env. Milo has a brain now!`);
