/**
 * Process-boundary regression for secret materialization.
 *
 * Importing `materialize()` cannot prove that the executable guard reaches the
 * CLI body. A missing dependency in that guard once made every invocation exit
 * zero after writing nothing, so this test launches the shipped script itself.
 * @module tests/unit/secrets/materialize-cli-entrypoint
 */
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { boundedExecFileSync } from "../../helpers/io-latency-budget.js";

const SCRIPT = path.resolve(
  "plugins/src/base/skills/lisa-secrets-access/scripts/materialize-secrets.mjs"
);

describe("materialize-secrets CLI entrypoint", () => {
  let root: string;
  let home: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "lisa-materialize-cli-"));
    home = path.join(root, "home");
    writeFileSync(
      path.join(root, ".lisa.config.json"),
      `${JSON.stringify({
        secrets: {
          provider: "env",
          namespace: "cli-test",
          require: ["SAFE_FIXTURE"],
          surface: "claude-web",
        },
      })}\n`
    );
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("runs the CLI body and writes the materialized files", () => {
    const output = boundedExecFileSync({
      label: "secret materializer",
      command: process.execPath,
      args: [SCRIPT],
      cwd: root,
      env: { HOME: home, SAFE_FIXTURE: "present" },
    });

    expect(output).toContain("materialized 1 secret(s)");
    const secretsPath = path.join(home, ".config", "cli-test", "secrets.env");
    expect(existsSync(secretsPath)).toBe(true);
    const materialized = readFileSync(secretsPath, "utf8");
    expect(materialized).toContain("export SAFE_FIXTURE='present'");
    expect(materialized).not.toContain("HOME=");
  });
});
