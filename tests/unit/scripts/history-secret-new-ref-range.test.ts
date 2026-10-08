/**
 * @file history-secret-new-ref-range.test.ts
 * @description A new remote ref introduces only what the push remote lacks.
 *
 * CodySwannGT/lisa#4393: a new-branch push used to scan everything reachable
 * from its tip, so a finding in a years-old commit the remote already held
 * failed every new branch. The range now subtracts the push remote's tracking
 * refs, and still includes every commit the remote does not have (#4345).
 * @module tests/history-secrets
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  introducedCommits,
  pushRemoteName,
} from "../../../all/copy-overwrite/scripts/lib/history-secret-git.mjs";
import { boundedExecFileSync } from "../../helpers/io-latency-budget.js";

const ZERO = "0".repeat(40);
const byText = (left: string, right: string): number =>
  left.localeCompare(right);
let scratch = "";

const git = (cwd: string, ...args: string[]): string =>
  boundedExecFileSync({
    label: `git ${args[0] ?? ""}`,
    command: "git",
    args,
    cwd,
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
    },
  }).trim();

const commit = (cwd: string, file: string, body: string): string => {
  writeFileSync(join(cwd, file), body);
  git(cwd, "add", file);
  git(cwd, "commit", "-qm", file);
  return git(cwd, "rev-parse", "HEAD");
};

/**
 * A working repository with a bare remote named `upstream` that already holds
 * `published` (root plus one more commit).
 * @returns The fixture's paths and commit IDs.
 */
const fixture = () => {
  const cwd = join(scratch, "work");
  const remote = join(scratch, "remote.git");
  git(scratch, "init", "-q", "--bare", remote);
  git(scratch, "init", "-q", "--initial-branch=main", cwd);
  git(cwd, "config", "user.name", "Fixture");
  git(cwd, "config", "user.email", "fixture@example.invalid");
  const root = commit(cwd, "root.txt", "root\n");
  const published = commit(cwd, "published.txt", "published\n");
  git(cwd, "remote", "add", "upstream", remote);
  git(cwd, "push", "-q", "upstream", "main");
  return { cwd, remote, root, published };
};

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "history-new-ref-"));
});
afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe("introduced history of a new remote ref", () => {
  it("introduces nothing for a new branch at history the remote already has", () => {
    const { cwd, published } = fixture();
    expect(
      introducedCommits(
        [{ before: ZERO, after: published }],
        cwd,
        40,
        "upstream"
      )
    ).toEqual([]);
  });

  it("introduces exactly the commits the remote does not have", () => {
    const { cwd } = fixture();
    git(cwd, "checkout", "-qb", "feature");
    const first = commit(cwd, "first.txt", "first\n");
    const second = commit(cwd, "second.txt", "second\n");
    expect(
      introducedCommits([{ before: ZERO, after: second }], cwd, 40, "upstream")
    ).toEqual([first, second].sort(byText));
  });

  it("resolves a push by URL to the one remote configured with it", () => {
    const { cwd, remote } = fixture();
    expect(pushRemoteName(remote, cwd)).toBe("upstream");
    const tip = commit(cwd, "next.txt", "next\n");
    expect(
      introducedCommits([{ before: ZERO, after: tip }], cwd, 40, remote)
    ).toEqual([tip]);
  });

  it("scans the complete history when the remote cannot be resolved", () => {
    const { cwd, root, published } = fixture();
    const all = [root, published].sort(byText);
    for (const remote of [undefined, "", "nowhere", "/no/such/url"])
      expect(
        introducedCommits([{ before: ZERO, after: published }], cwd, 40, remote)
      ).toEqual(all);
  });

  it("scans the complete history when the remote has no tracking refs", () => {
    const { cwd, root, published } = fixture();
    git(cwd, "remote", "add", "empty", join(scratch, "empty.git"));
    expect(
      introducedCommits([{ before: ZERO, after: published }], cwd, 40, "empty")
    ).toEqual([root, published].sort(byText));
  });

  it("refuses a URL two remotes share and a name that is a ref glob", () => {
    const { cwd, remote } = fixture();
    git(cwd, "remote", "add", "mirror", remote);
    expect(pushRemoteName(remote, cwd)).toBeNull();
    // `git remote add` refuses such a name; a hand-edited config does not.
    git(cwd, "config", "remote.up*.url", join(scratch, "other.git"));
    expect(pushRemoteName("up*", cwd)).toBeNull();
    expect(pushRemoteName(join(scratch, "other.git"), cwd)).toBeNull();
  });

  it("leaves an existing-branch update as new minus old", () => {
    const { cwd, published } = fixture();
    const next = commit(cwd, "next.txt", "next\n");
    for (const remote of [undefined, "upstream"])
      expect(
        introducedCommits([{ before: published, after: next }], cwd, 40, remote)
      ).toEqual([next]);
  });

  it("does not let a remote's refs hide an existing branch's old tip boundary", () => {
    const { cwd, root, published } = fixture();
    // The update's own `before` bounds it; tracking refs are not consulted.
    git(cwd, "checkout", "-q", "--detach", root);
    const side = commit(cwd, "side.txt", "side\n");
    expect(
      introducedCommits([{ before: root, after: side }], cwd, 40, "upstream")
    ).toEqual([side]);
    expect(published).not.toBe(side);
  });
});
