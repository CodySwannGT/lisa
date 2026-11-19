/**
 * The public-commit refresh never ships a list that quietly lost entries
 * (CodySwannGT/lisa#4960).
 *
 * Refreshing at release makes the generator's history read part of every
 * release, so the ways that read can come back short stop being a developer's
 * problem and become a shipped defect. Each one below was run before it was
 * written down:
 *
 * - **A shallow clone** has only the commits above its cut-off. A refresh there
 *   would add the newest commit, satisfy "the release commit is listed", and
 *   omit everything merged since the previous release — the bug this refresh
 *   exists to fix, reproduced by the fix.
 * - **A linked worktree** shares its repository's refs, so it reads the same
 *   history as the main checkout. No guard needed; pinned so it stays true.
 * - **A recorded commit that history no longer reaches** must be carried
 *   forward. If the recorded file ever stopped matching the pattern the
 *   generator reads it with, the carry-forward would silently come back empty
 *   and the refresh would write only what is reachable today.
 * - **A long history** overflows the one-megabyte default a child's output is
 *   capped at, at about 25,500 commits. That is a loud failure, but one that
 *   would fail every release from then on.
 * @module tests/integration/upstream-public-commit-refresh-safety
 */
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  boundedExecFileSync,
  useIoLatencyBudget,
} from "../helpers/io-latency-budget.js";
import {
  CANONICAL_ORIGIN,
  createReleaseFixture,
  GENERATOR,
  git,
  listedCommits,
  MANIFEST_PATH,
  REFRESH_FLAG,
  type ReleaseFixture,
  runNode,
} from "../helpers/upstream-commit-release-fixture.js";
import { cleanGitEnv, GIT_BIN } from "../support/git-executable.js";

useIoLatencyBudget();

/** A well-formed SHA that names no commit, so no ref can reach it. */
const UNREACHABLE = "f".repeat(40);
/** Enough commits that listing them exceeds one megabyte of output. */
const LONG_HISTORY = 26_000;
const scratch: string[] = [];

/**
 * A fresh scratch repository, removed when the case ends.
 * @returns The fixture
 */
function fixture(): ReleaseFixture {
  const created = createReleaseFixture();
  scratch.push(created.root);
  return created;
}

/**
 * Record one more commit in a fixture's checked-in list, spelled by `entry`.
 * @param root - Fixture root
 * @param entry - The full line to insert into the public-commit block
 */
function recordCommitLine(root: string, entry: string): void {
  const file = path.join(root, MANIFEST_PATH);
  const source = readFileSync(file, "utf8");
  const block = source.indexOf("export const UPSTREAM_PUBLIC_COMMITS");
  const close = source.indexOf("\n  });", block);
  writeFileSync(
    file,
    `${source.slice(0, close)}\n${entry}${source.slice(close)}`
  );
}

afterEach(() => {
  for (const directory of scratch.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("refreshing the public-commit list", () => {
  it("refuses a shallow clone, where the ordinary check still passes", () => {
    const { root, commits } = fixture();
    const clone = `${root}-shallow`;
    scratch.push(clone);
    git(os.tmpdir(), "clone", "--depth", "1", `file://${root}`, clone);
    git(clone, "config", "remote.origin.url", CANONICAL_ORIGIN);
    expect(git(clone, "rev-parse", "--is-shallow-repository")).toBe("true");
    const before = readFileSync(path.join(clone, MANIFEST_PATH), "utf8");

    const refresh = runNode(clone, GENERATOR, REFRESH_FLAG);

    expect(refresh.status).not.toBe(0);
    expect(refresh.stderr).toContain("shallow");
    expect(refresh.stderr).toContain("git fetch --unshallow");
    expect(readFileSync(path.join(clone, MANIFEST_PATH), "utf8")).toBe(before);
    expect(listedCommits(clone)).not.toContain(commits.tip);
    expect(runNode(clone, GENERATOR, "--check").status).toBe(0);
  });

  it("reads the same history from a linked worktree", () => {
    const { root, commits } = fixture();
    const worktree = `${root}-worktree`;
    scratch.push(worktree);
    git(root, "worktree", "add", "--detach", worktree, commits.tip);

    const refresh = runNode(worktree, GENERATOR, REFRESH_FLAG);

    expect(refresh.stderr).toBe("");
    expect(refresh.status).toBe(0);
    expect(listedCommits(worktree)).toEqual(
      expect.arrayContaining(Object.values(commits))
    );
  });

  it("keeps a recorded commit that history no longer reaches", () => {
    const { root, commits } = fixture();
    recordCommitLine(root, `    ${UNREACHABLE}: true,`);

    const refresh = runNode(root, GENERATOR, REFRESH_FLAG);

    expect(refresh.status).toBe(0);
    expect(listedCommits(root)).toEqual(
      expect.arrayContaining([UNREACHABLE, ...Object.values(commits)])
    );
  });

  it("refuses to write a list that drops a recorded commit", () => {
    const { root } = fixture();
    // Still a listed commit to any reader, but no longer spelled the way the
    // generator spells one — what a reformat of the generated file would do.
    recordCommitLine(root, `    '${UNREACHABLE}': true,`);
    const before = readFileSync(path.join(root, MANIFEST_PATH), "utf8");

    const refresh = runNode(root, GENERATOR, REFRESH_FLAG);

    expect(refresh.status).not.toBe(0);
    expect(refresh.stderr).toContain(UNREACHABLE);
    expect(refresh.stderr).toContain("would drop");
    expect(readFileSync(path.join(root, MANIFEST_PATH), "utf8")).toBe(before);
  });

  it("refuses to write an empty list", () => {
    const { root, commits } = fixture();
    // No recorded commits to carry forward and no public ref to read: the
    // refresh would find nothing, and an empty list would refuse every
    // commit reference `lisa file-upstream` is given.
    const file = path.join(root, MANIFEST_PATH);
    const recorded = readFileSync(file, "utf8");
    const block = recorded.indexOf("export const UPSTREAM_PUBLIC_COMMITS");
    writeFileSync(
      file,
      recorded.slice(0, block) +
        recorded.slice(block).replace(/^ {4}"?[a-f0-9]{40}"?: true,\n/gmu, "")
    );
    git(root, "update-ref", "-d", "refs/remotes/origin/main");
    expect(git(root, "rev-list", "--remotes=origin")).toBe("");
    expect(listedCommits(root)).toEqual([]);
    const before = readFileSync(file);

    const refresh = runNode(root, GENERATOR, REFRESH_FLAG);

    expect(refresh.status).not.toBe(0);
    expect(refresh.stderr).toContain(
      "Refusing to generate an empty public origin commit manifest"
    );
    expect(readFileSync(file).equals(before)).toBe(true);
    expect(listedCommits(root)).not.toContain(commits.tip);
  });

  it("lists a history longer than one megabyte of commit ids", () => {
    const { root, commits } = fixture();
    const stream = Array.from({ length: LONG_HISTORY }, (_, index) => {
      const message = `bulk ${index}`;
      return [
        "commit refs/remotes/origin/bulk",
        `mark :${index + 1}`,
        `committer Release Fixture <release-fixture@example.invalid> ${1_700_000_000 + index} +0000`,
        `data ${message.length}`,
        message,
        ...(index === 0 ? [] : [`from :${index}`]),
        "",
      ].join("\n");
    }).join("");
    boundedExecFileSync({
      label: `git fast-import (${LONG_HISTORY} commits)`,
      command: GIT_BIN,
      args: ["fast-import", "--quiet"],
      baseMs: 30_000,
      cwd: root,
      env: cleanGitEnv(),
      input: stream,
      stdio: ["pipe", "ignore", "pipe"],
    });

    const refresh = runNode(root, GENERATOR, REFRESH_FLAG);

    expect(refresh.stderr).toBe("");
    expect(refresh.status).toBe(0);
    const listed = listedCommits(root);
    expect(listed.length).toBeGreaterThan(LONG_HISTORY);
    expect(listed).toEqual(expect.arrayContaining(Object.values(commits)));
  });
});
