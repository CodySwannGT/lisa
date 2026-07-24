import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const MANAGED_HOOK_PAIRS = [
  [".husky/pre-commit", ".husky/pre-push"],
  [
    "typescript/copy-contents/.husky/pre-commit",
    "typescript/copy-contents/.husky/pre-push",
  ],
  [".claude-pr/.husky/pre-commit", ".claude-pr/.husky/pre-push"],
] as const;

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
      expect(typecheckIndex).toBeLessThan(prePush.indexOf("$RUNNER test:cov"));
      expect(prePush).toContain("TypeScript errors before pushing");
    }
  );
});
