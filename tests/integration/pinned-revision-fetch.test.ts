/**
 * The audit pin test can read its pinned commit in a depth-1 checkout (#4521).
 *
 * Hosted CI's integration job checks the pull request out at depth 1, so the
 * pinned commit (an ancestor of the head) is absent and `git show` failed with
 * status 128 — a red required check that said nothing about the pin. This test
 * builds its own throwaway two-commit repository, clones it at depth 1 over
 * file://, and proves the helper fetches exactly the absent ancestor. It never
 * reads the outer checkout, which is itself depth 1 in hosted CI.
 * @module tests/integration/pinned-revision-fetch
 */
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ensurePinnedRevision } from "../helpers/pinned-revision.js";
import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../helpers/io-latency-budget.js";

useIoLatencyBudget();
const roots: string[] = [];

/** Fixed identity and dates, so the fixture never reads user git config. */
const GIT_ENV = {
  GIT_AUTHOR_NAME: "Fixture",
  GIT_AUTHOR_EMAIL: "fixture@example.invalid",
  GIT_COMMITTER_NAME: "Fixture",
  GIT_COMMITTER_EMAIL: "fixture@example.invalid",
  GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z",
  GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
};

afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

/**
 * Run git in a directory and return trimmed stdout, failing on nonzero status.
 * @param cwd - Working directory
 * @param args - git arguments
 * @returns Trimmed stdout
 */
function git(cwd: string, args: readonly string[]): string {
  const result = boundedSpawnSync({
    label: "pinned revision fixture",
    command: "git",
    args: [...args],
    cwd,
    env: { ...process.env, ...GIT_ENV },
  });
  expect(result.status, String(result.stderr)).toBe(0);
  return String(result.stdout).trim();
}

/**
 * A throwaway source repository with two commits.
 * @returns The repository root and both commit SHAs
 */
function sourceRepository(): {
  root: string;
  first: string;
  second: string;
} {
  const base = fs.mkdtempSync(path.join(tmpdir(), "lisa-pinned-revision-"));
  const root = path.join(base, "source");
  roots.push(base);
  fs.mkdirSync(root);
  git(root, ["init", "--quiet", "--initial-branch=main"]);
  // Object properties evaluate in order: `first` is committed before `second`.
  return {
    root,
    first: commitPin(root, "first"),
    second: commitPin(root, "second"),
  };
}

/**
 * Write pin.txt, commit it, and return the new commit's SHA.
 * @param root - Repository root
 * @param content - The file's single line, also the commit message
 * @returns The commit SHA
 */
function commitPin(root: string, content: string): string {
  fs.writeFileSync(path.join(root, "pin.txt"), `${content}\n`);
  git(root, ["add", "pin.txt"]);
  git(root, ["commit", "--quiet", "-m", content]);
  return git(root, ["rev-parse", "HEAD"]);
}

/**
 * Clone the source repository over file://, at depth 1 or in full.
 * @param source - Source repository root
 * @param depth - "shallow" for depth 1, "full" for complete history
 * @returns The clone directory
 */
function cloneOf(source: string, depth: "shallow" | "full"): string {
  const clone = `${source}-${depth}`;
  git(path.dirname(source), [
    "clone",
    "--quiet",
    "--no-tags",
    ...(depth === "shallow" ? ["--depth=1"] : []),
    `file://${source}`,
    clone,
  ]);
  return clone;
}

describe("ensurePinnedRevision in a depth-1 checkout", () => {
  it("fetches an absent pinned ancestor by SHA so its files can be read", () => {
    const { root, first } = sourceRepository();
    const clone = cloneOf(root, "shallow");
    expect(git(clone, ["rev-parse", "--is-shallow-repository"])).toBe("true");
    expect(ensurePinnedRevision(first, clone)).toBe("fetched");
    expect(git(clone, ["show", `${first}:pin.txt`])).toBe("first");
  });

  it("reports a commit the remote does not hold as unavailable", () => {
    const clone = cloneOf(sourceRepository().root, "shallow");
    expect(
      ensurePinnedRevision("0123456789abcdef0123456789abcdef01234567", clone)
    ).toBe("unavailable");
  });

  it("leaves a full clone untouched when the commit is present", () => {
    const { root, first } = sourceRepository();
    expect(ensurePinnedRevision(first, cloneOf(root, "full"))).toBe("present");
  });

  it.each(["--upload-pack=touch /tmp/pwned", "HEAD~1", "main", "abc123"])(
    "refuses non-SHA input %j without running git fetch",
    revision => {
      const clone = cloneOf(sourceRepository().root, "shallow");
      expect(ensurePinnedRevision(revision, clone)).toBe("unavailable");
      // Nothing was fetched: the clone still holds exactly its one commit.
      expect(git(clone, ["rev-list", "--count", "--all"])).toBe("1");
    }
  );
});
