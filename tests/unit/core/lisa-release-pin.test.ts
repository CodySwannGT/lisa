/**
 * Tests the resolution of "which commit is the installed Lisa's tag".
 *
 * The half of this that matters is the FAILING arm. A resolver that answers
 * confidently when it does not know is how a project ends up with a workflow
 * ref and a package pin describing different releases, and nothing downstream
 * can detect that — the workflow runs, it just runs the wrong Lisa. So every
 * "cannot resolve" case below asserts a throw, and none of them accept a
 * fallback value.
 * @module tests/unit/core/lisa-release-pin
 */
import fs from "fs-extra";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ReleasePinDependencies } from "../../../src/core/lisa-release-pin.js";
import {
  UnresolvableReleasePinError,
  resolveReleasePin,
  resolveTagCommitFromGit,
} from "../../../src/core/lisa-release-pin.js";
import { boundedExecFileSync } from "../../helpers/io-latency-budget.js";
import { cleanGitEnv, resolveGit } from "../../support/git-executable.js";

/** Git executable resolved the way every other fixture repo test resolves it. */
const GIT = resolveGit();

/** A full-length commit SHA, standing in for a real release commit. */
const SHA = "0123456789abcdef0123456789abcdef01234567";

/** Another, used where two distinct commits must be told apart. */
const OTHER_SHA = "fedcba9876543210fedcba9876543210fedcba98";

/**
 * Build resolver dependencies with the given overrides.
 * @param over - Fields to replace on the stamped-package default
 * @returns Dependencies ready to pass to the resolver
 */
function deps(
  over: Partial<ReleasePinDependencies> = {}
): ReleasePinDependencies {
  return {
    readVersion: () => "4.4.11",
    readStampedCommit: () => SHA,
    readStampedTag: () => "v4.4.11",
    resolveTagCommit: async () => null,
    ...over,
  };
}

describe("a published package", () => {
  it("uses the stamped release commit, which the release proved is the TAG's commit", async () => {
    // publish-to-npm.yml checks the tag out and stamps it, and
    // check-release-package-identity.mjs refuses to publish unless
    // `tag <tag> resolves <releaseCommit>`. That assertion is what makes this
    // stamp usable as "the commit the version's tag points at" rather than
    // "the commit the build happened to run on".
    expect(await resolveReleasePin("/lisa", deps())).toEqual({
      sha: SHA,
      version: "4.4.11",
    });
  });

  it("never consults main, or git, or the network when the stamp is present", async () => {
    let consulted = false;
    const pin = await resolveReleasePin(
      "/lisa",
      deps({
        resolveTagCommit: async () => {
          consulted = true;
          return OTHER_SHA;
        },
      })
    );
    expect(consulted).toBe(false);
    expect(pin.sha).toBe(SHA);
  });

  it("normalises an uppercase stamp rather than emitting a ref git will not resolve", async () => {
    const pin = await resolveReleasePin(
      "/lisa",
      deps({ readStampedCommit: () => SHA.toUpperCase() })
    );
    expect(pin.sha).toBe(SHA);
  });
});

describe("a source checkout", () => {
  it("resolves the version's tag from local git when nothing is stamped", async () => {
    const pin = await resolveReleasePin(
      "/lisa",
      deps({
        readStampedCommit: () => null,
        readStampedTag: () => null,
        resolveTagCommit: async (dir, tag) => {
          expect(dir).toBe("/lisa");
          expect(tag).toBe("v4.4.11");
          return OTHER_SHA;
        },
      })
    );
    expect(pin).toEqual({ sha: OTHER_SHA, version: "4.4.11" });
  });
});

describe("the failing arm", () => {
  it("THROWS when the tag resolves to no commit anywhere", async () => {
    await expect(
      resolveReleasePin(
        "/lisa",
        deps({
          readStampedCommit: () => null,
          readStampedTag: () => null,
          resolveTagCommit: async () => null,
        })
      )
    ).rejects.toBeInstanceOf(UnresolvableReleasePinError);
  });

  it("names the tag and the directory it looked in, so the operator can fix it", async () => {
    await expect(
      resolveReleasePin(
        "/somewhere/lisa",
        deps({
          readStampedCommit: () => null,
          readStampedTag: () => null,
          resolveTagCommit: async () => null,
        })
      )
    ).rejects.toThrow(/v4\.4\.11 is not a tag in \/somewhere\/lisa/u);
  });

  it("says nothing was written, because a half-pinned project reads as a finished one", async () => {
    await expect(
      resolveReleasePin(
        "/lisa",
        deps({
          readStampedCommit: () => null,
          readStampedTag: () => null,
          resolveTagCommit: async () => null,
        })
      )
    ).rejects.toThrow(/left\s+exactly as it was/u);
  });

  it("THROWS rather than falling back to main", async () => {
    // The one substitution that must never happen. A fallback here would trade
    // a loud abort for a project that looks pinned in the diff and is not.
    const failure = await resolveReleasePin(
      "/lisa",
      deps({
        readStampedCommit: () => null,
        readStampedTag: () => null,
        resolveTagCommit: async () => null,
      })
    ).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).not.toContain("@main");
  });

  it("THROWS on a SHORT stamped commit instead of pinning an ambiguous ref", async () => {
    await expect(
      resolveReleasePin("/lisa", deps({ readStampedCommit: () => "0123456" }))
    ).rejects.toThrow(/full 40-character commit SHA/u);
  });

  it("THROWS on a stamped commit that is not hex at all", async () => {
    await expect(
      resolveReleasePin(
        "/lisa",
        deps({ readStampedCommit: () => "refs/heads/main" })
      )
    ).rejects.toBeInstanceOf(UnresolvableReleasePinError);
  });

  it("THROWS when the stamped tag disagrees with the installed version", async () => {
    // The two describe different releases, so pinning either one hands the
    // project a workflow ref and a package pin that do not match.
    await expect(
      resolveReleasePin("/lisa", deps({ readStampedTag: () => "v4.4.10" }))
    ).rejects.toThrow(/version 4\.4\.11 but stamps release tag v4\.4\.10/u);
  });

  it("THROWS when the stamped tag is not a release tag at all", async () => {
    await expect(
      resolveReleasePin("/lisa", deps({ readStampedTag: () => "main" }))
    ).rejects.toThrow(/which is not a release tag/u);
  });
});

describe("resolveTagCommitFromGit against a real repository", () => {
  let repo: string;

  /**
   * Run one git command inside the fixture repository.
   * @param args - Arguments after the git executable
   * @returns Trimmed stdout
   */
  function git(...args: readonly string[]): string {
    return boundedExecFileSync({
      label: `git ${args[0] ?? ""}`,
      command: GIT,
      args: [...args],
      cwd: repo,
      env: cleanGitEnv(),
    }).trim();
  }

  beforeEach(async () => {
    repo = await fs.mkdtemp(path.join(os.tmpdir(), "lisa-tagpin-"));
    git("init");
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "Test");
    git("commit", "--allow-empty", "-m", "release");
    git("tag", "v4.4.11");
  });

  afterEach(async () => {
    await fs.remove(repo);
  });

  it("answers the TAG's commit, in full", async () => {
    // The stubs above prove the resolver's shape. This proves the one
    // implementation that ever talks to git reads a TAG rather than a branch
    // and hands back all forty characters of the commit it names.
    const sha = await resolveTagCommitFromGit(repo, "v4.4.11");
    expect(sha).toMatch(/^[0-9a-f]{40}$/u);
    expect(sha).toBe(git("rev-parse", "v4.4.11^{commit}"));
  });

  it("answers null for a tag that is not there, rather than guessing", async () => {
    expect(await resolveTagCommitFromGit(repo, "v9.9.9")).toBeNull();
  });

  it("answers null for a directory that is not a repository", async () => {
    const empty = await fs.mkdtemp(path.join(os.tmpdir(), "lisa-norepo-"));
    try {
      expect(await resolveTagCommitFromGit(empty, "v4.4.11")).toBeNull();
    } finally {
      await fs.remove(empty);
    }
  });
});
