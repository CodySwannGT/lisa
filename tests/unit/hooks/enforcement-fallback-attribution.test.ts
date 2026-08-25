/**
 * Which copy of a guard refused, and how old that copy is.
 *
 * Enforcement resolves from the checkout the agent is working in, never from
 * npm, so publishing a guard fix does not reach the copy governing an agent on
 * a branch cut before it. Because the aggregate takes the strongest refusal,
 * the oldest resolved copy governs: one guard measured 22/22 on `main`, 22/22
 * in the installed marketplace clone, and 19/22 on the copy actually in force
 * (CodySwannGT/lisa#3205).
 *
 * The refusal was anonymous, which is what made that unfixable from inside a
 * session: a stale copy's block reads as the guard being WRONG rather than OLD,
 * and the only move left is to route around it. A guard routed around protects
 * nothing.
 *
 * These cases drive the real PreToolUse stdin contract — permits and refusals
 * both, because a permits-only proof shows a guard ran and not that it bites —
 * and construct an actual disagreement between two resolved copies of different
 * vintage, since copies that always agree cannot demonstrate attribution at
 * all.
 * @module tests/unit/hooks/enforcement-fallback-attribution
 */
import { mkdirSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  BEHIND,
  BLOCKED,
  BLOCK_INSTRUCTION_FILES,
  BLOCK_ISSUE_CREATE,
  BLOCK_NO_VERIFY,
  BLOCK_SHELL_JSON,
  CURRENT,
  GUARDS,
  HOST_TREE,
  PARITY_SAFETY_NET,
  PLUGIN_HOOKS,
  PLUGIN_TREE,
  REPO_ROOT,
  bash,
  cleanupScratchRoots,
  dateHostTree,
  datePluginTree,
  installRealGuards,
  runFallback,
  scratchRoot,
  write,
  writeBehindGuard,
} from "../../helpers/enforcement-fallback-fixtures.js";

afterEach(cleanupScratchRoots);

/** One row of the measured payload table. */
interface Row {
  readonly label: string;
  readonly payload: unknown;
  /** The guard expected to refuse, or null when the call is permitted. */
  readonly refusedBy: string | null;
}

/**
 * Permits and refusals in one table.
 *
 * Both halves are load-bearing. A permits-only table shows the dispatcher ran
 * without showing that anything bites, and a refusals-only table cannot catch a
 * dispatcher that refuses everything — which is an outage, not enforcement.
 */
const PAYLOAD_TABLE: readonly Row[] = [
  { label: "a directory listing", payload: bash("ls -la"), refusedBy: null },
  {
    label: "an ordinary commit",
    payload: bash("git commit -m x"),
    refusedBy: null,
  },
  { label: "the test suite", payload: bash("bun run test"), refusedBy: null },
  { label: "a scoped delete", payload: bash("rm -rf ./dist"), refusedBy: null },
  {
    label: "a physical scratch path",
    payload: bash("ls /private/tmp/probe"),
    refusedBy: null,
  },
  { label: "listing issues", payload: bash("gh issue list"), refusedBy: null },
  {
    label: "writing an ordinary source file",
    payload: write(path.join(REPO_ROOT, "src", "probe.ts")),
    refusedBy: null,
  },
  {
    label: "the long hook bypass",
    payload: bash("git commit --no-verify -m x"),
    refusedBy: BLOCK_NO_VERIFY,
  },
  {
    label: "the short hook bypass",
    payload: bash("git commit -n -m x"),
    refusedBy: BLOCK_NO_VERIFY,
  },
  {
    label: "the environment hook bypass",
    payload: bash("HUSKY=0 git commit -m x"),
    refusedBy: BLOCK_NO_VERIFY,
  },
  {
    label: "deleting root",
    payload: bash("rm -rf /"),
    refusedBy: PARITY_SAFETY_NET,
  },
  {
    label: "deleting home",
    payload: bash("rm -rf ~"),
    refusedBy: PARITY_SAFETY_NET,
  },
  {
    label: "a force push",
    payload: bash("git push --force origin main"),
    refusedBy: PARITY_SAFETY_NET,
  },
  {
    label: "parsing JSON in the shell",
    payload: bash('cat package.json | grep -o "version"'),
    refusedBy: BLOCK_SHELL_JSON,
  },
  {
    label: "creating an issue directly",
    payload: bash("gh issue create --title x --body y"),
    refusedBy: BLOCK_ISSUE_CREATE,
  },
  {
    label: "writing a session-instruction file",
    payload: write(path.join(REPO_ROOT, "AGENTS.md")),
    refusedBy: BLOCK_INSTRUCTION_FILES,
  },
];

describe("the payload table, through the real stdin contract", () => {
  for (const row of PAYLOAD_TABLE) {
    if (row.refusedBy === null) {
      it(`permits ${row.label}, and names no producing copy`, () => {
        const { status, output } = runFallback(row.payload, REPO_ROOT);

        expect(status).toBe(0);
        expect(output).not.toContain("Refused by ");
      });
      continue;
    }

    it(`refuses ${row.label}, naming the copy that produced it`, () => {
      const producer = path.join(PLUGIN_HOOKS, `${row.refusedBy}.sh`);
      const { status, output } = runFallback(row.payload, REPO_ROOT);

      expect(status).toBe(BLOCKED);
      // The absolute path, not the guard's name: the whole point is which FILE
      // on which disk objected, and a name is the same in every checkout.
      expect(output).toContain(`Refused by ${producer}`);
      // And a vintage alongside it. A path alone does not tell anyone the copy
      // is old, which is the thing an operator has to know to act.
      expect(output).toMatch(/Refused by .*\(lisa \d+\.\d+\.\d+/u);
    });
  }
});

describe("two resolved copies of different vintage that disagree", () => {
  /**
   * A checkout holding a behind-the-times `scripts/lisa-hooks/` safety net and
   * current copies of everything else under `plugins/lisa/hooks/`.
   *
   * This is the shape the defect was measured in: resolution is first-wins per
   * guard, so the older tree governs that one guard while the newer tree
   * governs the rest, and the aggregate returns a single exit code for all six.
   * @returns The project root.
   */
  function rootWithDisagreeingCopies(): string {
    const root = scratchRoot();
    const hostTree = path.join(root, HOST_TREE);

    mkdirSync(hostTree, { recursive: true });
    writeBehindGuard(path.join(hostTree, `${PARITY_SAFETY_NET}.sh`));
    dateHostTree(root, BEHIND);

    installRealGuards(
      path.join(root, PLUGIN_TREE),
      GUARDS.filter(guard => guard !== PARITY_SAFETY_NET)
    );
    datePluginTree(root, CURRENT);
    return root;
  }

  /**
   * The same checkout with the behind-the-times copy absent, so every guard
   * resolves from the current tree.
   * @returns The project root.
   */
  function rootWithCurrentCopiesOnly(): string {
    const root = scratchRoot();

    installRealGuards(path.join(root, PLUGIN_TREE));
    datePluginTree(root, CURRENT);
    return root;
  }

  /** The payload the two copies decide differently. */
  const CONTESTED = bash("ls /private/tmp/lisa-probe");

  it("permits the payload when only the current copies resolve", () => {
    // The control half of the disagreement. Without it the case below shows a
    // refusal but not that the copies disagreed about anything.
    expect(runFallback(CONTESTED, rootWithCurrentCopiesOnly()).status).toBe(0);
  });

  it("refuses it once the behind-the-times copy resolves too", () => {
    expect(runFallback(CONTESTED, rootWithDisagreeingCopies()).status).toBe(
      BLOCKED
    );
  });

  it("names the behind-the-times copy as the one that refused", () => {
    const root = rootWithDisagreeingCopies();
    const producer = path.join(root, HOST_TREE, `${PARITY_SAFETY_NET}.sh`);
    const { output } = runFallback(CONTESTED, root);

    expect(output).toContain(`Refused by ${producer}`);
  });

  it("says how far behind that copy is, and against what", () => {
    // A path names the copy; only a version says it is OLD rather than wrong.
    const { output } = runFallback(CONTESTED, rootWithDisagreeingCopies());

    expect(output).toContain(`lisa ${BEHIND}, STALE — ${CURRENT}`);
  });

  it("reports the staleness before anything is refused", () => {
    // Learning a copy is old only after it has already blocked something is
    // being told too late to act on it.
    const { output } = runFallback(CONTESTED, rootWithDisagreeingCopies());

    expect(output.indexOf("behind")).toBeGreaterThanOrEqual(0);
    expect(output.indexOf("behind")).toBeLessThan(output.indexOf("Refused by"));
  });

  it("reports the staleness on a run that refuses nothing at all", () => {
    // The preventive half. A report that only ever arrives attached to a
    // refusal is a post-mortem, not a warning.
    const { status, output } = runFallback(
      bash("ls -la"),
      rootWithDisagreeingCopies()
    );

    expect(status).toBe(0);
    expect(output).toContain(`lisa ${BEHIND}`);
    expect(output).toContain("npx @codyswann/lisa apply");
  });

  it("says the enforcement copy does not track npm", () => {
    // The one sentence that turns the report into an action: refreshing the
    // package is not what fixes this.
    const { output } = runFallback(CONTESTED, rootWithDisagreeingCopies());

    expect(output).toContain("not from npm");
  });
});
