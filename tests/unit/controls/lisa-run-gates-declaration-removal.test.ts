import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { EXIT } from "../../../all/copy-overwrite/scripts/lisa-run-gates.mjs";
import { runControlAuditGit } from "../../helpers/control-audit-fixtures.js";
import {
  declaredFNone,
  fNoneWithConfig,
  NO_BUILTINS,
  NODE,
  type NoManifestRepository,
  RUNNER_SCRIPT,
  runShipped,
  wholeRepositoryPart,
} from "../../support/no-manifest-run.js";

const CONFIG = ".lisa.config.json";
const COMMIT_FLAG = "--moment=commit";
const PUSH_FLAG = "--moment=push";
const NO_CHECKS = "nothing was checked";
const DECLARED = {
  "code-style": {
    commit: "required",
    push: "required",
    parts: [wholeRepositoryPart([NODE, "-e", "process.exit(0)"])],
  },
};
const REFUSAL = "This change removes the declared checks";
const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/**
 * Track the fixture so each case cleans up its repository.
 * @param repository - Fixture to clean up after this case
 * @returns The fixture
 */
function keep(repository: NoManifestRepository): NoManifestRepository {
  cleanups.push(repository.cleanup);
  return repository;
}

describe("removing the checks that would have checked the change", () => {
  it("refuses deleting the staged declaration even when the disk copy is restored", () => {
    const repo = keep(declaredFNone(DECLARED));
    const root = repo.fixture.repoPath;
    runControlAuditGit(root, ["rm", CONFIG]);
    runControlAuditGit(root, [
      "restore",
      "--source=HEAD",
      "--worktree",
      CONFIG,
    ]);

    const result = runShipped(repo, RUNNER_SCRIPT, [COMMIT_FLAG, NO_BUILTINS]);
    expect(result.status).toBe(EXIT.BLOCKED);
    expect(result.stderr).toContain(REFUSAL);
    expect(result.stdout).not.toContain(NO_CHECKS);
  });

  it("refuses emptying the staged block and preserves the normal built-in fallback", () => {
    const repo = keep(declaredFNone(DECLARED));
    const root = repo.fixture.repoPath;
    writeFileSync(join(root, CONFIG), '{ "gates": {} }\n');
    runControlAuditGit(root, ["add", CONFIG]);

    const result = runShipped(repo, RUNNER_SCRIPT, [COMMIT_FLAG, NO_BUILTINS]);
    expect(result.status).toBe(EXIT.BLOCKED);
    expect(result.stderr).toContain(REFUSAL);
    expect(result.stdout).not.toContain(NO_CHECKS);
    expect(runShipped(repo, RUNNER_SCRIPT, [COMMIT_FLAG]).status).toBe(
      EXIT.NO_GATES
    );
  });

  it("uses the actual pushed refs even when the checkout still has the checks", () => {
    const repo = keep(declaredFNone(DECLARED));
    const root = repo.fixture.repoPath;
    const base = runControlAuditGit(root, ["rev-parse", "HEAD"]).trim();
    runControlAuditGit(root, ["switch", "--create", "remove"]);
    runControlAuditGit(root, ["rm", CONFIG]);
    runControlAuditGit(root, ["commit", "-m", "Remove declarations"]);
    const head = runControlAuditGit(root, ["rev-parse", "HEAD"]).trim();
    runControlAuditGit(root, ["switch", "main"]);
    const pushRefs = join(repo.scratch, "push-refs");
    writeFileSync(
      pushRefs,
      `refs/heads/remove ${head} refs/heads/remove ${base}\n`
    );

    const result = runShipped(repo, RUNNER_SCRIPT, [
      PUSH_FLAG,
      NO_BUILTINS,
      `--push-refs=${pushRefs}`,
    ]);
    expect(result.status).toBe(EXIT.BLOCKED);
    expect(result.stderr).toContain(REFUSAL);
  });

  it("refuses a push of a new branch that removes the declaration inherited from main", () => {
    const repo = keep(declaredFNone(DECLARED));
    const root = repo.fixture.repoPath;
    runControlAuditGit(root, [
      "update-ref",
      "refs/remotes/origin/main",
      "HEAD",
    ]);
    runControlAuditGit(root, ["switch", "--create", "remove"]);
    runControlAuditGit(root, ["rm", CONFIG]);
    runControlAuditGit(root, ["commit", "-m", "Remove declarations"]);
    const head = runControlAuditGit(root, ["rev-parse", "HEAD"]).trim();
    const pushRefs = join(repo.scratch, "push-refs");
    writeFileSync(
      pushRefs,
      `refs/heads/remove ${head} refs/heads/remove ${"0".repeat(head.length)}\n`
    );

    const result = runShipped(repo, RUNNER_SCRIPT, [
      PUSH_FLAG,
      NO_BUILTINS,
      `--push-refs=${pushRefs}`,
    ]);
    expect(result.status).toBe(EXIT.BLOCKED);
    expect(result.stderr).toContain(REFUSAL);
    expect(result.stdout).not.toContain(NO_CHECKS);
    const manual = runShipped(repo, RUNNER_SCRIPT, [PUSH_FLAG, NO_BUILTINS]);
    expect(manual.status).toBe(EXIT.BLOCKED);
    expect(manual.stderr).toContain(REFUSAL);
  });

  it("still reports no checks when the pushed baseline never declared any", () => {
    const repo = keep(fNoneWithConfig("{}\n"));
    const root = repo.fixture.repoPath;
    runControlAuditGit(root, [
      "update-ref",
      "refs/remotes/origin/main",
      "HEAD",
    ]);
    runControlAuditGit(root, ["rm", CONFIG]);
    runControlAuditGit(root, ["commit", "-m", "Remove empty settings"]);

    const result = runShipped(repo, RUNNER_SCRIPT, [PUSH_FLAG, NO_BUILTINS]);
    expect(result.status).toBe(EXIT.PROVED);
    expect(result.stdout).toContain("nothing was checked at push");
    expect(result.stderr).toBe("");
  });
});
