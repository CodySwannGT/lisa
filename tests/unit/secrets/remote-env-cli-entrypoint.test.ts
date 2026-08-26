/**
 * Process-boundary regression for the remote-environment installer.
 *
 * Importing its helpers cannot prove that the executable guard runs. A missing
 * dependency in that guard once made every CLI invocation exit successfully
 * without doing any work, so this test launches the shipped script itself.
 * @module tests/unit/secrets/remote-env-cli-entrypoint
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { boundedExecFileSync } from "../../helpers/io-latency-budget.js";

const SCRIPT = path.resolve(
  "plugins/src/base/skills/lisa-setup-remote-env/scripts/setup-remote-env.mjs"
);
const INSTALL_DIR = path.join("scripts", "lisa-remote-env");
const ASSETS = ["setup.sh", "session-start.sh"] as const;

describe("remote environment CLI entrypoint", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "lisa-remote-env-cli-"));
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("executes --install and writes both repository assets", () => {
    const output = boundedExecFileSync({
      label: "remote environment installer",
      command: process.execPath,
      args: [SCRIPT, "--install"],
      cwd: root,
    });

    expect(output).toContain("Installing remote-environment scripts");
    for (const asset of ASSETS) {
      expect(existsSync(path.join(root, INSTALL_DIR, asset))).toBe(true);
    }
  });
});
