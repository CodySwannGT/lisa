/**
 * Regression tests for the four probes that spent a FAILURE as an ABSENCE
 * (CodySwannGT/lisa#3848).
 *
 * Each case stages a REAL failure of the real command — no stub says "pretend
 * git broke" — and asserts the post-fix behaviour. Every one of them fails
 * against the exact pre-fix code, which is the only property that makes a
 * regression test a regression test:
 *
 *   loadBaseline           pre-fix `available: true` with no scenarios; the
 *                          gate reported "nothing regressed" having compared
 *                          against nothing.
 *   windowsTreeExists      pre-fix returned `false` for EPERM — "the tree is
 *                          gone" — so a live process tree was left behind and
 *                          recorded as reaped.
 *   guardPopulation        pre-fix silently dropped an unreadable tracked
 *                          guard, shrinking the population the shell-guard
 *                          coverage check is measured against.
 *   mergeDriverInstaller   pre-fix logged "nothing in this working tree maps to
 *                          the driver" when `git check-attr` could not be asked.
 *
 * Per the Test Isolation house rule, expected values are HARDCODED.
 * @module tests/unit/scripts/probe-failure-not-absence
 */
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { windowsTreeExists } from "../../../all/copy-overwrite/scripts/lib/process-tree-runner.mjs";
import { loadBaseline } from "../../../expo/copy-overwrite/scripts/bdd/baseline.mjs";
import { installGeneratedArtifactMergeDriver } from "../../../scripts/install-generated-artifact-merge-driver.mjs";
import { guardPopulation } from "../../../scripts/lib/shell-guard-refusal-coverage.mjs";
import { boundedExecFileSync } from "../../helpers/io-latency-budget.js";
import { cleanGitEnv } from "../../helpers/test-utils.js";
import { resolveGit } from "../../support/git-executable.js";

const GIT = resolveGit();

/** Temp trees created by a test, removed afterwards. */
const created: string[] = [];

/**
 * Run git in a tree under the suite's deadline, returning trimmed stdout.
 * @param root - Working directory.
 * @param args - Git arguments.
 * @returns Trimmed stdout.
 */
function git(root: string, args: readonly string[]): string {
  return boundedExecFileSync({
    args,
    command: GIT,
    cwd: root,
    env: cleanGitEnv(process.env),
    label: `git ${args[0] ?? ""}`,
  }).trim();
}

/**
 * Create a throwaway git repository with one commit.
 * @param files - Repo-relative path to contents.
 * @returns Root and the commit sha.
 */
function makeRepo(files: Record<string, string>): {
  root: string;
  sha: string;
} {
  const root = mkdtempSync(path.join(os.tmpdir(), "lisa-test-probe-abs-"));
  created.push(root);
  git(root, ["init", "-q", "."]);
  git(root, ["config", "user.email", "test@example.invalid"]);
  git(root, ["config", "user.name", "Test"]);
  for (const [relative, contents] of Object.entries(files)) {
    const target = path.join(root, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, contents, "utf8");
  }
  git(root, ["add", "-A"]);
  git(root, ["commit", "-qm", "fixture"]);
  return { root, sha: git(root, ["rev-parse", "HEAD"]) };
}

afterEach(() => {
  while (created.length > 0) {
    rmSync(created.pop()!, { force: true, recursive: true });
  }
});

describe("a probe that could not ask is not read as a negative answer", () => {
  it("makes the BDD baseline unavailable when its feature listing fails", () => {
    // A commit whose TREE object cannot be read: `cat-file -e <sha>^{commit}`
    // still succeeds (the commit object is intact) while `ls-tree` exits 128.
    // That asymmetry is the real-world case — the revision plainly exists, and
    // the listing plainly could not be taken.
    const { root, sha } = makeRepo({
      "bdd/features/login.feature": "Feature: Login\n  Scenario: works\n",
    });
    const tree = git(root, ["rev-parse", "HEAD^{tree}"]);
    const object = path.join(
      root,
      ".git/objects",
      tree.slice(0, 2),
      tree.slice(2)
    );
    chmodSync(object, 0o000);

    let listable = true;
    try {
      git(root, ["ls-tree", "-r", "--name-only", sha]);
    } catch {
      listable = false;
    }
    // Precondition, asserted rather than assumed: if the chmod did not bite
    // (a run as root, an exotic filesystem) the case below proves nothing, and
    // a test that quietly proves nothing is the defect under test.
    expect(listable).toBe(false);

    const baseline = loadBaseline(root, sha);
    chmodSync(object, 0o444);

    expect(baseline.available).toBe(false);
    expect(baseline.error).toContain("could not be listed");
  });

  it("raises rather than reporting a process tree gone on a permission error", () => {
    const denied = Object.assign(new Error("operation not permitted"), {
      code: "EPERM",
    });

    expect(() =>
      windowsTreeExists(4242, () => {
        throw denied;
      })
    ).toThrow("operation not permitted");
  });

  it("still reads ESRCH as the process being genuinely absent", () => {
    const absent = Object.assign(new Error("no such process"), {
      code: "ESRCH",
    });

    expect(
      windowsTreeExists(4242, () => {
        throw absent;
      })
    ).toBe(false);
  });

  it("raises rather than shrinking the guard roster past an unreadable guard", () => {
    const { root } = makeRepo({
      "hooks/block-something.sh": "#!/usr/bin/env bash\nexit 2\n",
    });
    // Tracked, and gone from the working tree: `git ls-files` still names it,
    // so the population claims a guard whose bytes cannot be read.
    rmSync(path.join(root, "hooks/block-something.sh"));

    expect(() => guardPopulation(root)).toThrow(/block-something\.sh/u);
  });

  it("registers the merge driver when `check-attr` cannot be asked", () => {
    const { root } = makeRepo({
      ".gitattributes": "src/generated.json merge=lisa-generated-artifact\n",
      "scripts/merge-generated-artifact.mjs": "export default 0;\n",
      "src/generated.json": "{}\n",
    });
    // A corrupt index leaves `rev-parse --show-toplevel` working and makes
    // `git check-attr` exit 128 — "could not ask", wearing the same shape as
    // "no path maps to the driver".
    writeFileSync(path.join(root, ".git/index"), "not-an-index", "utf8");

    const logged: string[] = [];
    const code = installGeneratedArtifactMergeDriver(root, (line: string) =>
      logged.push(line)
    );

    expect(code).toBe(0);
    expect(logged.join("\n")).toContain("registered for 1 path(s)");
    expect(logged.join("\n")).not.toContain("nothing to register");
  });
});
