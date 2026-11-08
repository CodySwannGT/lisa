/**
 * The audit pin test can read its pinned commit in a depth-1 checkout (#4521).
 *
 * Hosted CI's integration job checks the pull request out at depth 1, so the
 * pinned commit (an ancestor of the head) is absent and `git show` failed with
 * status 128 — a red required check that said nothing about the pin. This test
 * builds a real depth-1 clone of this repository and proves the helper fetches
 * exactly the pinned ancestor, while a SHA the remote does not hold stays
 * unavailable rather than passing.
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

afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

/**
 * Run git and return trimmed stdout, failing loudly on a nonzero status.
 * @param args - git arguments
 * @param cwd - Working directory
 * @returns Trimmed stdout
 */
function git(args: readonly string[], cwd = process.cwd()): string {
  const result = boundedSpawnSync({
    label: "pinned revision fixture",
    command: "git",
    args: [...args],
    cwd,
  });
  expect(result.status, String(result.stderr)).toBe(0);
  return String(result.stdout).trim();
}

/**
 * A depth-1 clone of this repository's HEAD, served over file://.
 * @returns The clone directory
 */
function shallowClone(): string {
  const root = fs.mkdtempSync(path.join(tmpdir(), "lisa-pinned-revision-"));
  const clone = path.join(root, "clone");
  const source = git(["rev-parse", "--absolute-git-dir"]);
  roots.push(root);
  git([
    "clone",
    "--quiet",
    "--depth=1",
    "--no-tags",
    `file://${source}`,
    clone,
  ]);
  return clone;
}

describe("ensurePinnedRevision in a depth-1 checkout", () => {
  it("fetches an absent pinned ancestor by SHA so its files can be read", () => {
    const clone = shallowClone();
    const ancestor = git(["rev-parse", "HEAD~1"]);
    expect(git(["rev-parse", "--is-shallow-repository"], clone)).toBe("true");
    expect(ensurePinnedRevision(ancestor, clone)).toBe("fetched");
    expect(git(["cat-file", "-t", ancestor], clone)).toBe("commit");
  });

  it("reports a commit the remote does not hold as unavailable", () => {
    const clone = shallowClone();
    expect(
      ensurePinnedRevision("0123456789abcdef0123456789abcdef01234567", clone)
    ).toBe("unavailable");
  });

  it("leaves a full repository untouched when the commit is present", () => {
    expect(ensurePinnedRevision(git(["rev-parse", "HEAD"]))).toBe("present");
  });
});
