/**
 * The dispatcher exports memo state only when its leaf is private.
 * @module tests/unit/hooks/enforcement-fallback-memo-trust
 */
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { userInfo } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import {
  cleanupScratchRoots,
  scratchRoot,
} from "../../helpers/enforcement-fallback-fixtures.js";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

afterEach(cleanupScratchRoots);

/**
 * Return the exact memo path inherited by a disposable dispatched guard.
 * @param mode - Permissions of an existing memo leaf
 * @returns Observed and expected memo paths
 */
function inheritedMemo(mode: number): { actual: string; expected: string } {
  const root = scratchRoot();
  const temp = scratchRoot();
  const memo = path.join(temp, `lisa-guard-memo-${userInfo().uid}`);
  const hooks = path.join(root, "scripts/lisa-hooks");
  mkdirSync(memo);
  chmodSync(memo, mode);
  mkdirSync(hooks, { recursive: true });
  writeFileSync(
    path.join(hooks, "block-no-verify.sh"),
    `#!/usr/bin/env bash
printf '%s' "\${LISA_GUARD_MEMO_DIR:-unset}" > "$CLAUDE_PROJECT_DIR/memo-path"
`
  );
  return runMemo(root, temp, memo);
}

/**
 * Drive the canonical dispatcher against a prepared guard fixture.
 * @param root - Disposable project directory
 * @param temp - Private temp parent
 * @param memo - Expected memo directory
 * @returns Observed and expected memo paths
 */
function runMemo(
  root: string,
  temp: string,
  memo: string
): { actual: string; expected: string } {
  const result = boundedSpawnSync({
    label: "dispatcher memo trust probe",
    command: "/bin/bash",
    args: [path.resolve("scripts/lisa-enforcement-fallback.sh")],
    cwd: root,
    input: JSON.stringify({ tool_name: "Bash", tool_input: { command: "ls" } }),
    env: {
      ...process.env,
      CLAUDE_PROJECT_DIR: root,
      CLAUDE_CONFIG_DIR: "/nonexistent-claude-config",
      TMPDIR: temp,
      LISA_GUARD_MEMO_DIR: undefined,
    },
  });
  expect(result.status, result.stderr).toBe(0);
  return {
    actual: readFileSync(path.join(root, "memo-path"), "utf-8"),
    expected: realpathSync(memo),
  };
}

describe("dispatcher memo exports", () => {
  it.each([0o770, 0o777, 0o1777])(
    "does not export an insecure leaf (%o)",
    mode => {
      expect(inheritedMemo(mode).actual).toBe("unset");
    }
  );

  it("exports an owned private leaf", () => {
    const { actual, expected } = inheritedMemo(0o700);
    expect(actual).toBe(expected);
  });
});
