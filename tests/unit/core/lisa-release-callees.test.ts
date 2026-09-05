/**
 * Tests the resolver that answers which reusable workflows a Lisa release
 * actually carries.
 *
 * The question exists because the pinner assumes the release is a superset of
 * what a consumer references. A reusable workflow added after the latest
 * release exists only on `main`, and pinning a caller of it at the release
 * commit produces a `uses:` GitHub cannot resolve — a load error, so zero jobs,
 * so zero failures, and nothing anywhere naming the file that is missing
 * (CodySwannGT/lisa#4021).
 *
 * Two of these carry the weight:
 *
 *   - **unknown is not empty** — a package published before the stamp existed
 *     answers null, and null has to mean "pin as before". An empty set would
 *     stop pinning every caller in every such project, trading a narrow silent
 *     break for a total one.
 *   - **the stamp wins over local git** — an installed package is not a git
 *     repository, so the stamp is the only source that can answer in the case
 *     this module exists for. A resolver that preferred git would work in
 *     every test and answer nothing in production.
 * @module tests/unit/core/lisa-release-callees
 */
import { execFile } from "node:child_process";
import * as path from "node:path";
import { promisify } from "node:util";
import * as fs from "fs-extra";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ReleaseCalleeDependencies } from "../../../src/core/lisa-release-callees.js";
import {
  listWorkflowsAtCommitFromGit,
  resolveReleaseCallees,
} from "../../../src/core/lisa-release-callees.js";
import type { ReleasePin } from "../../../src/core/reusable-workflow-pin.js";
import {
  cleanGitEnv,
  cleanupTempDir,
  createTempDir,
} from "../../helpers/test-utils.js";

const execFileAsync = promisify(execFile);

/** The commit the fixture release resolves to. */
const SHA = "0123456789abcdef0123456789abcdef01234567";

/** The pin whose callees are being resolved. */
const PIN: ReleasePin = { sha: SHA, version: "4.48.0" };

/** A directory no source can answer from, used where neither should be asked. */
const NOWHERE = "/nowhere";

/** The reusable most fixtures record. */
const QUALITY = "quality.yml";

/** The reusable that exists only on `main` in the reported failure. */
const UNRELEASED = "sentry-deploy.yml";

/**
 * Readers that answer with neither a stamp nor a git listing.
 * @param over - Fields to replace
 * @returns Dependencies for the resolver under test
 */
function deps(
  over: Partial<ReleaseCalleeDependencies> = {}
): ReleaseCalleeDependencies {
  return {
    readStampedWorkflows: () => null,
    listWorkflowsAtCommit: async () => null,
    ...over,
  };
}

describe("resolving the reusable workflows a release carries", () => {
  it("reads the inventory a published package stamps", async () => {
    const callees = await resolveReleaseCallees(
      NOWHERE,
      PIN,
      deps({ readStampedWorkflows: () => [QUALITY, "gates.yml"] })
    );

    expect(callees?.has(QUALITY)).toBe(true);
    expect(callees?.has(UNRELEASED)).toBe(false);
  });

  it("prefers the stamp over local git, because an install has only the stamp", async () => {
    // A consumer's node_modules copy of Lisa is not a git repository. A
    // resolver that reached for git first would pass every test written
    // against a checkout and answer nothing in the case this exists for.
    const callees = await resolveReleaseCallees(
      NOWHERE,
      PIN,
      deps({
        readStampedWorkflows: () => [QUALITY],
        listWorkflowsAtCommit: async () => [UNRELEASED],
      })
    );

    expect([...(callees ?? [])]).toEqual([QUALITY]);
  });

  it("falls back to the tree at the pinned commit when nothing is stamped", async () => {
    const callees = await resolveReleaseCallees(
      NOWHERE,
      PIN,
      deps({ listWorkflowsAtCommit: async () => ["gates.yml"] })
    );

    expect([...(callees ?? [])]).toEqual(["gates.yml"]);
  });

  it("answers UNKNOWN rather than EMPTY when no source recorded anything", async () => {
    // The whole safety property of this module. Null means "pin as before";
    // an empty set would mean "pin nothing", which would unpin every caller in
    // every project running a Lisa published before the stamp existed.
    expect(await resolveReleaseCallees(NOWHERE, PIN, deps())).toBeNull();
  });

  it("treats a stamp that records nothing usable as unknown too", async () => {
    const callees = await resolveReleaseCallees(
      NOWHERE,
      PIN,
      deps({ readStampedWorkflows: () => ["README.md", "  "] })
    );

    expect(callees).toBeNull();
  });

  it("matches a caller's bare file name even when the source recorded a path", async () => {
    const callees = await resolveReleaseCallees(
      NOWHERE,
      PIN,
      deps({
        listWorkflowsAtCommit: async () => [".github/workflows/quality.yml"],
      })
    );

    expect(callees?.has(QUALITY)).toBe(true);
  });
});

describe("listing a commit's workflows from a Lisa checkout", () => {
  let tempDir: string;
  let lisaDir: string;

  /**
   * Run one git command inside the fixture repository.
   * @param args - Arguments after `git`
   * @returns Trimmed stdout
   */
  async function git(...args: readonly string[]): Promise<string> {
    const result = await execFileAsync("git", ["-C", lisaDir, ...args], {
      encoding: "utf8",
      env: cleanGitEnv(process.env),
    });
    return result.stdout.trim();
  }

  beforeEach(async () => {
    tempDir = await createTempDir();
    lisaDir = path.join(tempDir, "lisa");
    await fs.ensureDir(path.join(lisaDir, ".github", "workflows"));
    await git("init", "-q");
    await git("config", "user.email", "callee-test@example.com");
    await git("config", "user.name", "Callee Test");
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  /**
   * Commit a set of workflow files and return the commit they landed in.
   * @param names - Workflow file names to write
   * @returns The commit SHA
   */
  async function commitWorkflows(names: readonly string[]): Promise<string> {
    for (const name of names) {
      await fs.writeFile(
        path.join(lisaDir, ".github", "workflows", name),
        "on: workflow_call\njobs: {}\n"
      );
    }
    await git("add", "-A");
    await git("commit", "-q", "-m", `workflows ${names.join(",")}`);
    return git("rev-parse", "HEAD");
  }

  it("reads the workflows present at that commit, not at the tip", async () => {
    const released = await commitWorkflows([QUALITY, "gates.yml"]);
    const tip = await commitWorkflows([UNRELEASED]);

    expect(tip).not.toBe(released);
    const atRelease = await listWorkflowsAtCommitFromGit(lisaDir, released);
    expect(atRelease).toEqual(expect.arrayContaining([QUALITY, "gates.yml"]));
    // The defect in one sentence: the file the consumer calls is on the tip
    // and not in the release the pinner is about to name.
    expect(atRelease).not.toContain(UNRELEASED);
    expect(await listWorkflowsAtCommitFromGit(lisaDir, tip)).toContain(
      UNRELEASED
    );
  });

  it("answers null for a commit this checkout does not have", async () => {
    await commitWorkflows([QUALITY]);
    expect(await listWorkflowsAtCommitFromGit(lisaDir, SHA)).toBeNull();
  });

  it("answers null for a directory that is not a git repository", async () => {
    const notARepo = path.join(tempDir, "plain");
    await fs.ensureDir(notARepo);
    expect(await listWorkflowsAtCommitFromGit(notARepo, SHA)).toBeNull();
  });
});
