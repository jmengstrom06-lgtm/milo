import { describe, it, expect } from "vitest";
import { newer, SWAP_SCRIPT } from "../src/main/updater";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("updater", () => {
  it("compares versions", () => {
    expect(newer("0.2.166", "0.2.160")).toBe(true);
    expect(newer("v0.2.99", "0.2.100")).toBe(false);
    expect(newer("0.3.0", "0.2.999")).toBe(true);
    expect(newer("0.2.160", "0.2.160")).toBe(false);
  });
  it("the swap script replaces the app, and keeps the old one if the copy fails", () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "swap-"));
    const script = path.join(d, "swap.sh");
    // ditto/xattr/open are Mac tools: stand them in with cp for the test
    fs.writeFileSync(script, SWAP_SCRIPT.replace(/ditto "\$NEW" "\$APP"/, 'cp -R "$NEW" "$APP"'), { mode: 0o755 });
    const app = path.join(d, "Milo.app");
    const neu = path.join(d, "new", "Milo.app");
    fs.mkdirSync(app, { recursive: true });
    fs.writeFileSync(path.join(app, "v"), "old");
    fs.mkdirSync(neu, { recursive: true });
    fs.writeFileSync(path.join(neu, "v"), "new");
    execFileSync("/bin/bash", [script, "999999", neu, app, "0"]);
    expect(fs.readFileSync(path.join(app, "v"), "utf8")).toBe("new");
    expect(fs.existsSync(app + ".old")).toBe(false);
    execFileSync("/bin/bash", [script, "999999", path.join(d, "missing.app"), app, "0"]);
    expect(fs.readFileSync(path.join(app, "v"), "utf8")).toBe("new"); // failed copy: old one kept
  });
});
