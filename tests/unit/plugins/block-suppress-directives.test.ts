/**
 * Growth semantics for the Claude TypeScript-stack `block-suppress-directives`
 * PreToolUse hook (CodySwannGT/lisa#4492).
 *
 * The hook used to refuse any write whose payload merely CONTAINED a directive,
 * so rewriting a file that already carried one approved, scoped disable was
 * refused as if the agent had added it. It now refuses only growth: a directive
 * the write adds, another copy of one, or a textual change that widens one.
 * The case table is shared with the Codex and OpenCode ports so the copies
 * agree on what growth means.
 * @module tests/unit/plugins/block-suppress-directives
 */
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import {
  GROWTH_CASES,
  hookEnvelope,
  prepareDisk,
  RUNS_AS_ROOT,
} from "../../helpers/suppress-directive-growth-cases.js";

const SCRIPT_PATH = path.resolve(
  "plugins/src/typescript/hooks/block-suppress-directives.sh"
);
const BASH_PATH = "/bin/bash";
const EXIT_BLOCKED = 2;
const EXIT_ALLOWED = 0;

/**
 * Runs the hook in `cwd` with the given project directory (none by default, so
 * the gate façade stays out of the way and the built-in judges the write).
 * @param envelope The PreToolUse JSON on stdin.
 * @param cwd The working directory the hook runs in.
 * @param projectDir The CLAUDE_PROJECT_DIR to export, if any.
 * @returns The exit status and stderr.
 */
const run = (
  envelope: string,
  cwd: string,
  projectDir?: string
): { status: number | null; stderr: string } => {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.CLAUDE_PROJECT_DIR;
  if (projectDir !== undefined) env.CLAUDE_PROJECT_DIR = projectDir;
  const result = boundedSpawnSync({
    label: "block-suppress-directives.sh",
    command: BASH_PATH,
    args: [SCRIPT_PATH],
    input: envelope,
    cwd,
    env,
  });
  return { status: result.status, stderr: result.stderr };
};

describe("plugins/src/typescript block-suppress-directives.sh growth", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "lisa-suppress-growth-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it.each(GROWTH_CASES)("$name", growthCase => {
    if (growthCase.disk.kind === "unreadable" && RUNS_AS_ROOT) return;
    const target = prepareDisk(dir, growthCase.disk);
    const { status, stderr } = run(hookEnvelope(target, growthCase.call), dir);
    expect(status).toBe(growthCase.refused ? EXIT_BLOCKED : EXIT_ALLOWED);
    if (growthCase.refused) {
      expect(stderr).toContain("error-suppression directive");
    } else {
      expect(stderr).toBe("");
    }
  });

  it("reads a relative Write path against CLAUDE_PROJECT_DIR, not the cwd", () => {
    // The project holds the file with its one directive; the cwd does not. A
    // hook that resolved against the cwd would see a new file and refuse.
    const [keeps] = GROWTH_CASES;
    if (keeps?.call.tool !== "Write") throw new Error("case 0 is a Write");
    prepareDisk(dir, keeps.disk);
    const elsewhere = mkdtempSync(path.join(os.tmpdir(), "lisa-suppress-cwd-"));
    try {
      const { status } = run(
        hookEnvelope("target.ts", keeps.call),
        elsewhere,
        dir
      );
      expect(status).toBe(EXIT_ALLOWED);
    } finally {
      rmSync(elsewhere, { recursive: true, force: true });
    }
  });
});
