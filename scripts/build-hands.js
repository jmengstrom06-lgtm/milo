// Builds Milo's native helper (native/hands.swift -> dist/milo-hands).
// Skips quietly when not on a Mac or when Xcode Command Line Tools aren't installed:
// Milo still works, he just uses the slower osascript hands.
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const src = path.join(root, "native", "hands.swift");
const out = path.join(root, "dist", "milo-hands");

if (process.platform !== "darwin") {
  console.log("[hands] not on a Mac, skipping native helper");
  process.exit(0);
}
if (fs.existsSync(out) && fs.statSync(out).mtimeMs >= fs.statSync(src).mtimeMs) {
  console.log("[hands] native helper up to date");
  process.exit(0);
}
try {
  execFileSync("xcrun", ["--find", "swiftc"], { stdio: "ignore" });
} catch {
  console.log("[hands] Swift not found. Run `xcode-select --install` for faster hands. Using osascript for now.");
  process.exit(0);
}
fs.mkdirSync(path.dirname(out), { recursive: true });
try {
  execFileSync("xcrun", ["swiftc", "-O", src, "-o", out], { stdio: "inherit" });
  console.log("[hands] built dist/milo-hands");
} catch {
  console.log("[hands] build failed, using osascript for now (Milo still works)");
}
