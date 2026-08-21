/**
 * Tests for the hook scan behind the report's executor column.
 *
 * Two of these are the difference between a truthful bucket and a fabricated
 * one. A commented-out step must never count as an executor, and a task name
 * must never match a longer task that merely starts the same way — `test:cov`
 * proving `test:cov:unit` would manufacture the exact green the report exists
 * to withhold.
 * @module tests/unit/cli/gate-report-executors
 */
import { describe, expect, it } from "vitest";

import {
  classifyHook,
  executorsFor,
  hookInvokesTask,
} from "../../../src/cli/gate-report-executors.js";
import { PUSH, TYPE_CORRECTNESS, TYPECHECK } from "./gate-report-fixtures.js";

/** The hook every case below reads from. */
const PRE_PUSH = ".husky/pre-push";

describe("classifying a hook", () => {
  it("finds the moment even when the runner path is assigned lines earlier", () => {
    const hook = classifyHook(
      PRE_PUSH,
      [
        'GATE_RUNNER="scripts/lisa-run-gates.mjs"',
        'if [ ! -f "$GATE_RUNNER" ]; then',
        '  GATE_RUNNER="all/copy-overwrite/scripts/lisa-run-gates.mjs"',
        "fi",
        'node "$GATE_RUNNER" --moment=push --coverage="$FILE"',
      ].join("\n")
    );
    expect(hook.gateRunnerMoments).toEqual([PUSH]);
  });

  it("does not credit a --moment flag in a hook that shells no gate runner", () => {
    const hook = classifyHook(PRE_PUSH, "node other-tool.mjs --moment=push\n");
    expect(hook.gateRunnerMoments).toEqual([]);
  });

  it("reads a built-in step's gate from its coverage marker", () => {
    const hook = classifyHook(
      PRE_PUSH,
      "if lisa_gate_covers dependency-vulnerability; then\n  echo skip\nfi\nnpm audit\n"
    );
    expect(hook.builtinGates).toEqual(["dependency-vulnerability"]);
  });

  it("gives a hook that names no moment the one git fires it at", () => {
    const hook = classifyHook(".husky/commit-msg", "commitlint --edit $1\n");
    expect(hook.moments).toEqual(["commit"]);
  });

  it("blanks comment lines so a worked example is never read as a step", () => {
    const hook = classifyHook(
      PRE_PUSH,
      "#     $RUNNER lighthouse:check\n$RUNNER typecheck\n"
    );
    expect(hookInvokesTask(hook.body, "lighthouse:check")).toBe(false);
    expect(hookInvokesTask(hook.body, TYPECHECK)).toBe(true);
  });
});

describe("matching a task literally", () => {
  it("does not let a shorter task claim a longer one", () => {
    expect(hookInvokesTask("$RUNNER test:cov\n", "test:cov:unit")).toBe(false);
    expect(hookInvokesTask("$RUNNER test:cov:unit\n", "test:cov")).toBe(false);
    expect(hookInvokesTask("$RUNNER test:cov\n", "test:cov")).toBe(true);
  });

  it("accepts every package manager a hook may resolve to", () => {
    for (const prefix of ["npm run", "yarn", "bun run", "pnpm run"]) {
      expect(hookInvokesTask(`  ${prefix} typecheck\n`, TYPECHECK)).toBe(true);
    }
  });
});

describe("attributing evidence to a moment", () => {
  const evidence = {
    files: [
      classifyHook(
        PRE_PUSH,
        'node "scripts/lisa-run-gates.mjs" --moment=push\nif lisa_gate_covers type-correctness; then echo x; fi\n$RUNNER typecheck\n'
      ),
    ],
  };

  it("does not credit a push hook at pull-request", () => {
    expect(
      executorsFor(evidence, {
        moment: "pull-request",
        gateId: TYPE_CORRECTNESS,
        task: TYPECHECK,
        declared: true,
      })
    ).toEqual([]);
  });

  it("reports the gate runner only when the pair is actually declared", () => {
    const undeclared = executorsFor(evidence, {
      moment: PUSH,
      gateId: TYPE_CORRECTNESS,
      task: TYPECHECK,
      declared: false,
    });
    expect(undeclared.map(entry => entry.kind)).toEqual(["hook-builtin"]);
    const declared = executorsFor(evidence, {
      moment: PUSH,
      gateId: TYPE_CORRECTNESS,
      task: TYPECHECK,
      declared: true,
    });
    expect(declared.map(entry => entry.kind)).toEqual([
      "gate-runner",
      "hook-builtin",
    ]);
  });

  it("falls back to a literal invocation when no marker names the gate", () => {
    const found = executorsFor(evidence, {
      moment: PUSH,
      gateId: "code-style",
      task: TYPECHECK,
      declared: false,
    });
    expect(found.map(entry => entry.kind)).toEqual(["hook-literal"]);
  });
});
