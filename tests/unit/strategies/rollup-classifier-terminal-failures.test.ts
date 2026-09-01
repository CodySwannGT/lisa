/**
 * Bounded terminal-failure RED contracts for the trusted classifier ladder.
 * @module tests/unit/strategies/rollup-classifier-terminal-failures
 */
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  classifierAt,
  createClassifierTree,
  MALFORMED_HIDDEN_TAIL,
  plantClassifier,
  readInvocations,
  readWrites,
  removeClassifierTree,
} from "../../helpers/rollup-classifier-ladder-fixtures.js";
import { runClassifierLadder } from "../../helpers/rollup-classifier-ladder-harness.js";

/** Secret child-graph content that diagnostics must never disclose. */
const CHILD_PAYLOAD = "child-secret-payload";

/** Secret environment content that diagnostics must never disclose. */
const SECRET_SENTINEL = "secret-env-value";

/**
 * Execute one terminal-failure assertion with guaranteed fixture teardown.
 * @param assertion - Test body receiving one disposable classifier tree.
 */
const withTree = (
  assertion: (tree: ReturnType<typeof createClassifierTree>) => void
): void => {
  const tree = createClassifierTree();
  try {
    assertion(tree);
  } finally {
    removeClassifierTree(tree);
  }
};

/**
 * Require a bounded failure that never reached a tracker write transport.
 * @param run - Observable classifier-ladder process result.
 * @param writes - Recorded lifecycle and comment transport attempts.
 */
const expectClosed = (
  run: ReturnType<typeof runClassifierLadder>,
  writes: readonly string[]
): void => {
  expect(run.signal).toBeNull();
  expect(run.status).not.toBe(0);
  expect(writes).toEqual([]);
};

describe("bounded trusted-classifier terminal failures", () => {
  it("bounds ordinary and over-cap exhaustion diagnostics", () => {
    withTree(tree => {
      const run = runClassifierLadder(tree, {
        CLAUDE_PLUGIN_ROOT: tree.first,
        PLUGIN_ROOT: tree.second,
      });
      expectClosed(run, readWrites(tree));
      expect(run.stderr).toContain(classifierAt(tree.first));
      expect(run.stderr).toContain(classifierAt(tree.second));
      expect(run.stderr).not.toContain(SECRET_SENTINEL);
      expect(run.stderr).not.toContain(CHILD_PAYLOAD);
      expect(Buffer.byteLength(run.stderr)).toBeLessThanOrEqual(4_096);
    });

    withTree(tree => {
      const attemptedPrefix = path.join(tree.root, "over-cap-root-");
      const hiddenTail = "hidden-path-secret-sentinel";
      const oversizedRoot = `${attemptedPrefix}${"x".repeat(6_000)}${hiddenTail}`;
      const run = runClassifierLadder(tree, {
        CLAUDE_PLUGIN_ROOT: oversizedRoot,
      });
      expectClosed(run, readWrites(tree));
      expect(readInvocations(tree)).toEqual([]);
      expect(run.stderr).toContain(attemptedPrefix);
      expect(run.stderr).not.toContain(hiddenTail);
      expect(run.stderr).not.toContain(SECRET_SENTINEL);
      expect(run.stderr).not.toContain(CHILD_PAYLOAD);
      expect(Buffer.byteLength(run.stderr)).toBeLessThanOrEqual(4_096);
    });
  });

  it("bounds an oversized malformed classifier without trying later", () => {
    withTree(tree => {
      plantClassifier(tree, tree.first, "corrupt", "oversized-corrupt");
      plantClassifier(tree, tree.second, "later");
      const run = runClassifierLadder(tree, {
        CLAUDE_PLUGIN_ROOT: tree.first,
        PLUGIN_ROOT: tree.second,
      });
      expectClosed(run, readWrites(tree));
      expect(readInvocations(tree)).toEqual([]);
      expect(run.stdout).toBe("");
      expect(run.stderr).toContain(classifierAt(tree.first));
      expect(run.stderr).not.toContain(MALFORMED_HIDDEN_TAIL);
      expect(run.stderr).not.toContain(SECRET_SENTINEL);
      expect(run.stderr).not.toContain(CHILD_PAYLOAD);
      expect(Buffer.byteLength(run.stderr)).toBeLessThanOrEqual(4_096);
    });
  });

  it("bounds unreadable-only exhaustion without executing the leaf", () => {
    withTree(tree => {
      plantClassifier(tree, tree.first, "unreadable", "unreadable");
      const run = runClassifierLadder(tree, {
        CLAUDE_PLUGIN_ROOT: tree.first,
      });
      expectClosed(run, readWrites(tree));
      expect(readInvocations(tree)).toEqual([]);
      expect(run.stderr).toContain(classifierAt(tree.first));
      expect(run.stderr).not.toContain(SECRET_SENTINEL);
      expect(run.stderr).not.toContain(CHILD_PAYLOAD);
      expect(Buffer.byteLength(run.stderr)).toBeLessThanOrEqual(4_096);
    });
  });

  it("bounds nonzero output and never falls through to a later root", () => {
    withTree(tree => {
      plantClassifier(tree, tree.first, "nonzero", "nonzero");
      plantClassifier(tree, tree.second, "later");
      const run = runClassifierLadder(tree, {
        CLAUDE_PLUGIN_ROOT: tree.first,
        PLUGIN_ROOT: tree.second,
      });
      const diagnostic = `${run.stdout}${run.stderr}`;
      expectClosed(run, readWrites(tree));
      expect(readInvocations(tree).map(row => row.id)).toEqual(["nonzero"]);
      expect(diagnostic).toContain(classifierAt(tree.first));
      expect(diagnostic).not.toContain(SECRET_SENTINEL);
      expect(diagnostic).not.toContain(CHILD_PAYLOAD);
      expect(Buffer.byteLength(diagnostic)).toBeLessThanOrEqual(4_096);
    });
  });
});
