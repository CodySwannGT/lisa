import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { trackedHookCopyPairs } from "../../helpers/hook-roster.js";

/**
 * Every directory holding both managed hooks, derived rather than typed.
 *
 * A roster written by hand answers only for the copies whoever wrote it
 * remembered, which is how a third copy drifted six commits behind while every
 * parity test stayed green (CodySwannGT/lisa#2847).
 */
const MANAGED_HOOK_PAIRS = trackedHookCopyPairs("pre-commit", "pre-push").map(
  pair => [...pair]
);

describe("whole-project TypeScript hook placement", () => {
  it.each(MANAGED_HOOK_PAIRS)(
    "keeps commits staged and runs typecheck before push gates: %s",
    async (preCommitPath, prePushPath) => {
      const preCommit = await readFile(path.resolve(preCommitPath), "utf8");
      const prePush = await readFile(path.resolve(prePushPath), "utf8");

      expect(preCommit).not.toContain("$RUNNER typecheck");
      expect(preCommit).toContain("gitleaks protect --staged");
      expect(preCommit).toContain("lint-staged --config");

      const typecheckIndex = prePush.indexOf("$RUNNER typecheck");
      expect(typecheckIndex).toBeGreaterThanOrEqual(0);
      expect(typecheckIndex).toBeLessThan(
        prePush.indexOf('echo "🔒 Running security audit..."')
      );
      // The coverage script is resolved into a variable now, because which one
      // runs decides whether the integration tree is collected once or twice
      // (#2827). The ordering claim is unchanged: typecheck comes first.
      expect(typecheckIndex).toBeLessThan(
        prePush.indexOf('$RUNNER "$COVERAGE_SCRIPT"')
      );
      expect(prePush).toContain("TypeScript errors before pushing");
    }
  );
});
