/**
 * Tests for the block-masked-exit-status.sh hook.
 *
 * The falsifiable-checks rule's first failure mode, made executable: `$?` read
 * straight after a pipeline ending in an output filter is the filter's status,
 * so `gate | tail -4; echo "exit=$?"` reports 0 for a failing gate. The hook
 * must stay narrow: an unread pipeline, `$?` after a plain command, pipefail,
 * PIPESTATUS, and quoted text are all allowed.
 * @module tests/unit/hooks/block-masked-exit-status
 */
import path from "path";

import { describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

const HOOK_PATH = path.resolve(
  "plugins/src/base/hooks/block-masked-exit-status.sh"
);
const EXIT_BLOCKED = 2;
const EXIT_ALLOWED = 0;

const runHook = (command: string, toolName = "Bash") =>
  boundedSpawnSync({
    label: "block-masked-exit-status.sh",
    command: "/bin/bash",
    args: [HOOK_PATH],
    input: JSON.stringify({ tool_name: toolName, tool_input: { command } }),
  });

describe("block-masked-exit-status.sh", () => {
  it.each([
    'node scripts/gate.mjs 2>&1 | tail -4; echo "exit=$?"',
    "bun test | grep FAIL && echo $?",
    "ls | wc -l\necho $?",
    "make check | tee out.log; status=${?}",
  ])("blocks a status read after a filtered pipeline: %s", command => {
    const result = runHook(command);
    expect(result.status).toBe(EXIT_BLOCKED);
    expect(result.stderr).toContain("not of");
    expect(result.stderr).toContain("status=$?");
  });

  it.each([
    "bun test | tail -5",
    "bun test; echo $?",
    "set -o pipefail; bun test | tail; echo $?",
    'bun test | tail; echo "${PIPESTATUS[0]}"',
    'echo "a | tail; echo $?"',
    "cmd | jq . ; echo $?",
    "x || y; echo $?",
  ])("allows: %s", command => {
    expect(runHook(command).status).toBe(EXIT_ALLOWED);
  });

  it("ignores non-Bash tools", () => {
    expect(runHook("a | tail; echo $?", "Write").status).toBe(EXIT_ALLOWED);
  });
});
