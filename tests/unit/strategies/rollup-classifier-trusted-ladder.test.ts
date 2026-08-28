/**
 * RED contract for first-existing trusted rollup-classifier resolution (#3383).
 *
 * Every behavior case lifts the future shell function from the authored skill
 * at test time. The v4.23.25 pre-fix skill therefore registers this complete
 * matrix before failing on its missing function instead of aborting at import.
 * @module tests/unit/strategies/rollup-classifier-trusted-ladder
 */
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  classifierAt,
  createClassifierTree,
  EXACT_CHILD_GRAPH,
  plantClassifier,
  plantEscapingSymlink,
  plantEscapingScriptsSymlink,
  readInvocations,
  readWrites,
  removeClassifierTree,
} from "../../helpers/rollup-classifier-ladder-fixtures.js";
import {
  occurrences,
  runClassifierLadder,
} from "../../helpers/rollup-classifier-ladder-harness.js";

/** Stable classifier identity for cwd-independence assertions. */
const CWD_INDEPENDENT_ID = "cwd-independent";

/**
 * Execute one assertion with guaranteed fixture teardown.
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
 * Require one ordinary bounded failure with no mutation transport.
 * @param run - Observable resolver-ladder child result.
 * @param writes - Recorded lifecycle or comment transport attempts.
 */
const expectClosed = (
  run: ReturnType<typeof runClassifierLadder>,
  writes: readonly string[]
): void => {
  expect(run.signal).toBeNull();
  expect(run.status).not.toBe(0);
  expect(writes).toEqual([]);
};

describe("executed trusted classifier ladder", () => {
  it("continues after an absent first root and preserves the graph", () => {
    withTree(tree => {
      plantClassifier(tree, tree.second, "later");
      const run = runClassifierLadder(tree, {
        CLAUDE_PLUGIN_ROOT: tree.first,
        PLUGIN_ROOT: tree.second,
      });

      expect(run).toMatchObject({ signal: null, status: 0 });
      expect(run.stdout).toBe("classified-by:later\n");
      expect(readInvocations(tree)).toEqual([
        { id: "later", input: tree.graph, payload: EXACT_CHILD_GRAPH },
      ]);
      expect(readWrites(tree)).toEqual([]);
    });
  });

  it("executes only the first usable classifier when both exist", () => {
    withTree(tree => {
      plantClassifier(tree, tree.first, "first");
      plantClassifier(tree, tree.second, "second");
      const run = runClassifierLadder(tree, {
        CLAUDE_PLUGIN_ROOT: tree.first,
        PLUGIN_ROOT: tree.second,
      });

      expect(run.status).toBe(0);
      expect(readInvocations(tree).map(row => row.id)).toEqual(["first"]);
    });
  });

  it("deduplicates the same trusted root before exhaustion", () => {
    withTree(tree => {
      const run = runClassifierLadder(tree, {
        CLAUDE_PLUGIN_ROOT: tree.first,
        PLUGIN_ROOT: tree.first,
      });

      expectClosed(run, readWrites(tree));
      expect(occurrences(run.stderr, classifierAt(tree.first))).toBe(1);
    });
  });

  it("selects the same classifier from unrelated caller directories", () => {
    withTree(tree => {
      plantClassifier(tree, tree.second, CWD_INDEPENDENT_ID);
      const roots = { PLUGIN_ROOT: tree.second };
      const first = runClassifierLadder(tree, roots, tree.cwdA);
      const second = runClassifierLadder(tree, roots, tree.cwdB);

      expect([first.status, second.status]).toEqual([0, 0]);
      expect(readInvocations(tree).map(row => row.id)).toEqual([
        CWD_INDEPENDENT_ID,
        CWD_INDEPENDENT_ID,
      ]);
    });
  });

  it("ignores a relative root even when cwd contains its classifier", () => {
    withTree(tree => {
      plantClassifier(tree, path.join(tree.cwdA, "relative"), "relative");
      plantClassifier(tree, tree.second, "trusted");
      const run = runClassifierLadder(tree, {
        CLAUDE_PLUGIN_ROOT: "relative",
        PLUGIN_ROOT: tree.second,
      });

      expect(run.status).toBe(0);
      expect(readInvocations(tree).map(row => row.id)).toEqual(["trusted"]);
    });
  });

  it("never considers an unrecognized absolute-root variable", () => {
    withTree(tree => {
      plantClassifier(tree, tree.untrusted, "untrusted");
      const run = runClassifierLadder(tree, {
        UNTRUSTED_PLUGIN_ROOT: tree.untrusted,
      });

      expectClosed(run, readWrites(tree));
      expect(readInvocations(tree)).toEqual([]);
    });
  });

  it("rejects a traversal-shaped root and continues to a trusted root", () => {
    withTree(tree => {
      plantClassifier(tree, tree.untrusted, "traversal-target");
      plantClassifier(tree, tree.second, "trusted");
      const traversal = `${tree.first}/../untrusted absolute root`;
      const run = runClassifierLadder(tree, {
        CLAUDE_PLUGIN_ROOT: traversal,
        PLUGIN_ROOT: tree.second,
      });

      expect(run.status).toBe(0);
      expect(readInvocations(tree).map(row => row.id)).toEqual(["trusted"]);
    });
  });

  it("rejects a classifier symlink escape and continues in order", () => {
    withTree(tree => {
      plantEscapingSymlink(tree, tree.first);
      plantClassifier(tree, tree.second, "trusted");
      const run = runClassifierLadder(tree, {
        CLAUDE_PLUGIN_ROOT: tree.first,
        PLUGIN_ROOT: tree.second,
      });

      expect(run.status).toBe(0);
      expect(readInvocations(tree).map(row => row.id)).toEqual(["trusted"]);
    });
  });

  it("rejects an escaping scripts ancestor with a regular leaf", () => {
    withTree(tree => {
      plantEscapingScriptsSymlink(tree, tree.first);
      plantClassifier(tree, tree.second, "trusted");
      const run = runClassifierLadder(tree, {
        CLAUDE_PLUGIN_ROOT: tree.first,
        PLUGIN_ROOT: tree.second,
      });

      expect(run.status).toBe(0);
      expect(readInvocations(tree).map(row => row.id)).toEqual(["trusted"]);
    });
  });

  it("continues past a directory at the fixed classifier path", () => {
    withTree(tree => {
      plantClassifier(tree, tree.first, "directory", "directory");
      plantClassifier(tree, tree.second, "trusted");
      const run = runClassifierLadder(tree, {
        CLAUDE_PLUGIN_ROOT: tree.first,
        PLUGIN_ROOT: tree.second,
      });

      expect(run.status).toBe(0);
      expect(readInvocations(tree).map(row => row.id)).toEqual(["trusted"]);
    });
  });

  it("continues past an unreadable classifier without executing it", () => {
    withTree(tree => {
      plantClassifier(tree, tree.first, "unreadable", "unreadable");
      plantClassifier(tree, tree.second, "trusted");
      const run = runClassifierLadder(tree, {
        CLAUDE_PLUGIN_ROOT: tree.first,
        PLUGIN_ROOT: tree.second,
      });

      expect(run.status).toBe(0);
      expect(readInvocations(tree).map(row => row.id)).toEqual(["trusted"]);
    });
  });

  it("ignores empty trusted-root values and never consults cwd", () => {
    withTree(tree => {
      plantClassifier(tree, path.join(tree.cwdA, "plugins/lisa"), "cwd");
      const run = runClassifierLadder(tree, {
        CLAUDE_PLUGIN_ROOT: "",
        PLUGIN_ROOT: "",
      });

      expectClosed(run, readWrites(tree));
      expect(readInvocations(tree)).toEqual([]);
    });
  });
});
