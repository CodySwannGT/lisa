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
  pushDestination,
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

const introduced = (cwd: string, after: string, remoteArgs: string[]) =>
  introducedCommits([{ before: ZERO, after }], cwd, 40, remoteArgs);

describe("introduced history of a new remote ref", () => {
  it("introduces nothing for a new branch at history the destination already has", () => {
    const { cwd, remote, published } = fixture();
    expect(introduced(cwd, published, ["upstream"])).toEqual([]);
    expect(introduced(cwd, published, ["upstream", remote])).toEqual([]);
  });

  it("introduces exactly the commits the destination does not have", () => {
    const { cwd } = fixture();
    git(cwd, "checkout", "-qb", "feature");
    const first = commit(cwd, "first.txt", "first\n");
    const second = commit(cwd, "second.txt", "second\n");
    expect(introduced(cwd, second, ["upstream"])).toEqual(
      [first, second].sort(byText)
    );
  });

  it("asks a destination given only as a URL", () => {
    const { cwd, remote } = fixture();
    const tip = commit(cwd, "next.txt", "next\n");
    expect(introduced(cwd, tip, [remote, remote])).toEqual([tip]);
    expect(introduced(cwd, tip, [remote])).toEqual([tip]);
  });

  it("does not trust a tracking ref the destination no longer advertises", () => {
    const { cwd, remote, published } = fixture();
    git(cwd, "checkout", "-qb", "gone");
    const orphan = commit(cwd, "orphan.txt", "orphan\n");
    git(cwd, "push", "-q", "upstream", "gone");
    // Deleted on the remote side only; refs/remotes/upstream/gone survives.
    git(remote, "update-ref", "-d", "refs/heads/gone");
    expect(git(cwd, "rev-parse", "refs/remotes/upstream/gone")).toBe(orphan);
    expect(introduced(cwd, orphan, ["upstream"])).toEqual([orphan]);
    expect(introduced(cwd, published, ["upstream"])).toEqual([]);
  });

  it("asks the push URL, not the fetch URL, of a named remote", () => {
    const { cwd, root, published } = fixture();
    const elsewhere = join(scratch, "elsewhere.git");
    git(scratch, "init", "-q", "--bare", elsewhere);
    git(cwd, "remote", "set-url", "--push", "upstream", elsewhere);
    expect(pushDestination(["upstream"], cwd)).toBe(elsewhere);
    expect(introduced(cwd, published, ["upstream"])).toEqual(
      [root, published].sort(byText)
    );
  });

  it("scans the complete history when the destination cannot be asked", () => {
    const { cwd, root, published } = fixture();
    const all = [root, published].sort(byText);
    for (const remoteArgs of [[], [""], ["-x"], ["nowhere"], ["/no/such.git"]])
      expect(introduced(cwd, published, remoteArgs)).toEqual(all);
    git(cwd, "remote", "add", "empty", join(scratch, "empty.git"));
    git(scratch, "init", "-q", "--bare", join(scratch, "empty.git"));
    expect(introduced(cwd, published, ["empty"])).toEqual(all);
  });

  it("leaves an existing-branch update as new minus old", () => {
    const { cwd, root, published } = fixture();
    const next = commit(cwd, "next.txt", "next\n");
    for (const remoteArgs of [[], ["upstream"]])
      expect(
        introducedCommits(
          [{ before: published, after: next }],
          cwd,
          40,
          remoteArgs
        )
      ).toEqual([next]);
    // The update's own `before` bounds it; the destination is not consulted.
    git(cwd, "checkout", "-q", "--detach", root);
    const side = commit(cwd, "side.txt", "side\n");
    expect(
      introducedCommits([{ before: root, after: side }], cwd, 40, ["upstream"])
    ).toEqual([side]);
  });
});
