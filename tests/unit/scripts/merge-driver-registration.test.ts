/**
 * Tests for registering the `lisa-generated-artifact` merge driver and for
 * reporting its absence (CodySwannGT/lisa#3084).
 *
 * ## Why the absence check is a deliverable and not a nicety
 *
 * A `.gitattributes` mapping can be committed, reviewed and merged while the
 * driver it names never runs: git falls back to its built-in text merge and
 * says nothing. Shipping a merge strategy that is present in the repository and
 * absent at runtime would leave #3084 exactly where it was while appearing
 * fixed. So "the driver actually runs on the machines that merge" is part of
 * the deliverable, and the check that says otherwise is tested here.
 *
 * The roster cases are the ones that matter most. Lisa's FIRST driver had a
 * registration check that named it, so the second driver would have been
 * uncovered until somebody widened it — these pin that the roster is derived
 * from `.gitattributes`, using a driver name that appears nowhere in Lisa.
 *
 * Per the Test Isolation house rule, expected values are HARDCODED.
 * @module tests/unit/scripts/merge-driver-registration
 */
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { afterEach, describe, expect, it } from "vitest";

import { mergeDriversInAttributes } from "../../../src/core/gitattributes-merge-drivers.js";
import { mergeDriversIn } from "../../../scripts/lib/gitattributes-merge-drivers.mjs";
import { inspectMergeDrivers } from "../../../scripts/check-merge-driver-registration.mjs";
import {
  DRIVER_COMMAND,
  GENERATED_ARTIFACT_DRIVER,
  installGeneratedArtifactMergeDriver,
} from "../../../scripts/install-generated-artifact-merge-driver.mjs";
import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../../helpers/io-latency-budget.js";
import { cleanupTempDir } from "../../helpers/test-utils.js";
import { resolveGit } from "../../support/git-executable.js";

useIoLatencyBudget();

const GIT = resolveGit();
const DRIVER_KEY = `merge.${GENERATED_ARTIFACT_DRIVER}.driver`;
const GENERATED = GENERATED_ARTIFACT_DRIVER;
const LEARNINGS = "lisa-learnings";
const MAPPING = `src/core/upstream-evidence-manifest.ts merge=${GENERATED_ARTIFACT_DRIVER}\n`;

/** Environment without the outer repository's git state. */
function cleanGitEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("GIT_")) delete env[key];
  }
  return env;
}

/**
 * Run one git command in a fixture repository.
 * @param cwd - Fixture repository path
 * @param args - Literal git arguments
 * @returns Trimmed stdout
 */
function git(cwd: string, args: readonly string[]): string {
  const result = boundedSpawnSync({
    label: `git ${args[0]}`,
    command: GIT,
    args: [...args],
    cwd,
    env: cleanGitEnv(),
  });
  return (result.stdout ?? "").trim();
}

/**
 * A repository shaped like the Lisa source checkout.
 * @param options - Whether to write the mapping and the driver script
 * @returns Fixture repository path
 */
function fixture(options: { mapping?: string; withScript?: boolean }): string {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-3084-reg-"));
  git(root, ["init", "--initial-branch=main"]);
  if (options.mapping !== undefined) {
    writeFileSync(path.join(root, ".gitattributes"), options.mapping);
  }
  if (options.withScript !== false) {
    mkdirSync(path.join(root, "scripts"), { recursive: true });
    writeFileSync(
      path.join(root, "scripts/merge-generated-artifact.mjs"),
      "// placeholder\n"
    );
  }
  return root;
}

describe("generated-artifact merge driver registration", () => {
  const roots: string[] = [];
  const lines: string[] = [];

  afterEach(async () => {
    lines.length = 0;
    while (roots.length > 0) {
      await cleanupTempDir(roots.pop() as string);
    }
  });

  /**
   * Create a fixture and remember it for cleanup.
   * @param options - Fixture options
   * @returns Fixture repository path
   */
  function repo(options: { mapping?: string; withScript?: boolean }): string {
    const root = fixture(options);
    roots.push(root);
    return root;
  }

  /** Collect one log line. */
  const log = (message: string): void => {
    lines.push(message);
  };

  it("registersARepoRelativeCommand so every worktree sharing .git/config stays correct", () => {
    const root = repo({ mapping: MAPPING });
    expect(installGeneratedArtifactMergeDriver(root, log)).toBe(0);
    expect(git(root, ["config", "--get", DRIVER_KEY])).toBe(DRIVER_COMMAND);
    expect(DRIVER_COMMAND.startsWith("node ./scripts/")).toBe(true);
  });

  it("isIdempotent, reporting the second run as already registered", () => {
    const root = repo({ mapping: MAPPING });
    installGeneratedArtifactMergeDriver(root, log);
    expect(installGeneratedArtifactMergeDriver(root, log)).toBe(0);
    expect(lines.at(-1)).toContain("already registered");
  });

  it("isInertWhereNothingMapsToTheDriver, so a consumer's config is untouched", () => {
    const root = repo({ mapping: "*.md text\n" });
    expect(installGeneratedArtifactMergeDriver(root, log)).toBe(0);
    expect(git(root, ["config", "--get", DRIVER_KEY])).toBe("");
    expect(lines.at(-1)).toContain("nothing to register");
  });

  it("isInertWithoutTheDriverScript, the shape a published package installs as", () => {
    const root = repo({ mapping: MAPPING, withScript: false });
    expect(installGeneratedArtifactMergeDriver(root, log)).toBe(0);
    expect(git(root, ["config", "--get", DRIVER_KEY])).toBe("");
  });

  it("isInertOutsideAGitWorkingTree", () => {
    const root = mkdtempSync(path.join(tmpdir(), "lisa-3084-nogit-"));
    roots.push(root);
    expect(installGeneratedArtifactMergeDriver(root, log)).toBe(0);
    expect(lines.at(-1)).toContain("not a git working tree");
  });

  it("reportsAMappedButUnregisteredDriver rather than letting it fall back silently", () => {
    const root = repo({ mapping: MAPPING });
    const report = inspectMergeDrivers(root);
    expect(report?.mapped).toEqual([GENERATED]);
    expect(report?.unregistered).toEqual([GENERATED]);
  });

  it("reportsNothingUnregisteredOnceItIsRegistered", () => {
    const root = repo({ mapping: MAPPING });
    installGeneratedArtifactMergeDriver(root, log);
    expect(inspectMergeDrivers(root)?.unregistered).toEqual([]);
  });

  it("derivesTheRosterFromGitattributes, covering a driver Lisa never heard of", () => {
    const root = repo({ mapping: "reports/*.json merge=some-third-party\n" });
    const report = inspectMergeDrivers(root);
    expect(report?.mapped).toEqual(["some-third-party"]);
    expect(report?.unregistered).toEqual(["some-third-party"]);
  });

  it("excludesGitsBuiltInStrategies, which need no registration", () => {
    const root = repo({
      mapping: "CHANGELOG.md merge=union\n*.png merge=binary\n",
    });
    expect(inspectMergeDrivers(root)?.mapped).toEqual([]);
  });

  it("theTwoRosterParsersAgree on this repository's real .gitattributes", () => {
    const attributes =
      "# comment merge=ignored\n" +
      `.lisa/PROJECT_LEARNINGS.md merge=${LEARNINGS}\n` +
      `src/core/upstream-evidence-manifest.ts merge=${GENERATED}\n` +
      "CHANGELOG.md merge=union\n";
    expect(mergeDriversIn(attributes)).toEqual([GENERATED, LEARNINGS]);
    expect(mergeDriversInAttributes(attributes)).toEqual([
      GENERATED,
      LEARNINGS,
    ]);
  });
});
