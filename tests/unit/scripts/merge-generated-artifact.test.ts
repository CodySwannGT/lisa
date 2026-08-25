/**
 * Tests for the `lisa-generated-artifact` merge driver
 * (CodySwannGT/lisa#3084).
 *
 * ## Why most of these run a real `git merge`
 *
 * The defect is a property of git, not of a string. A test asserting that
 * `.gitattributes` contains a `merge=` line proves nothing about what git does
 * with it — the whole ticket is about a mapping that is committed while the
 * driver never runs. So the cases that matter construct two branches that
 * genuinely conflict on both artifacts and run `git merge` for real, with the
 * driver registered and without it.
 *
 * `mergesWithoutDriver` is the negative control that gives every other case its
 * meaning: it asserts the SAME fixtures conflict when the driver is not
 * registered, so a passing suite cannot be explained by fixtures that never
 * conflicted in the first place.
 *
 * Per the Test Isolation house rule, expected values are HARDCODED.
 * @module tests/unit/scripts/merge-generated-artifact
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { afterEach, describe, expect, it } from "vitest";

import {
  mergeGeneratedArtifact,
  parseArtifact,
  renderArtifact,
} from "../../../scripts/merge-generated-artifact.mjs";
import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../../helpers/io-latency-budget.js";
import { cleanupTempDir } from "../../helpers/test-utils.js";
import { resolveGit } from "../../support/git-executable.js";

useIoLatencyBudget();

const GIT = resolveGit();
const DRIVER = path.resolve("scripts/merge-generated-artifact.mjs");
const GENERATED_DIR = "generated";
const ARTIFACT = `${GENERATED_DIR}/manifest.ts`;
const ALPHA = "a/alpha.mjs";
const ALPHA_HASH = "a1";
const BRAVO = "a/bravo.mjs";
const BRAVO_HASH = "b1";
const ONE = "a/one.mjs";
const ONE_HASH = "aa";
const ONE_LEDGER = "one.mjs";
const MERGE_MESSAGE = "merge";
const CONFLICT_FENCE = "<<<<<<<";
const UNMERGED = ["diff", "--name-only", "--diff-filter=U"] as const;

/**
 * Stable, locale-independent string order.
 * @param left - First value
 * @param right - Second value
 * @returns Negative, zero, or positive per the usual comparator contract
 */
function byText(left: string, right: string): number {
  return left.localeCompare(right, "en");
}
const LEDGER = `${GENERATED_DIR}/ledger.ts`;

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
 * @returns Exit status and combined output
 */
function git(
  cwd: string,
  args: readonly string[]
): { status: number; output: string } {
  const result = boundedSpawnSync({
    label: `git ${args[0]}`,
    command: GIT,
    args: [...args],
    cwd,
    env: cleanGitEnv(),
  });
  return {
    status: result.status ?? 1,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

/**
 * A manifest-shaped artifact: two blocks of `key: value` entries.
 * @param evidence - Path-to-hash pairs
 * @param surface - Paths present in the tracked set
 * @returns Artifact source
 */
function manifest(
  evidence: readonly (readonly [string, string])[],
  surface: readonly string[]
): string {
  const evidenceLines = evidence
    .map(([file, hash]) => `    ${JSON.stringify(file)}:\n      "${hash}",`)
    .join("\n");
  const surfaceLines = surface
    .map(file => `    ${JSON.stringify(file)}: true,`)
    .join("\n");
  return `/** Generated. Do not edit. */
export const EVIDENCE: Readonly<Record<string, string>> = Object.freeze({
${evidenceLines}
});

export const SURFACE: Readonly<Record<string, true>> = Object.freeze({
${surfaceLines}
});
`;
}

/**
 * A ledger-shaped artifact: one block of append-only array entries.
 * @param entries - Destination-to-hashes pairs
 * @returns Artifact source
 */
function ledger(
  entries: readonly (readonly [string, readonly string[]])[]
): string {
  const body = entries
    .map(
      ([destination, hashes]) =>
        `  ${JSON.stringify(destination)}: Object.freeze([\n${hashes
          .map(hash => `    "${hash}",`)
          .join("\n")}\n  ]),`
    )
    .join("\n");
  return `/** Generated. Do not edit. */
export const LEDGER: Readonly<Record<string, readonly string[]>> = Object.freeze({
${body}
});
`;
}

/**
 * Build a repository whose two branches conflict on both artifacts.
 *
 * `register` is the single variable under test: with it false the repository is
 * the unfixed state, mapping and all.
 * @param register - Whether to register the driver command locally
 * @returns Fixture repository path
 */
function fixture(register: boolean): string {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-3084-"));
  git(root, ["init", "--initial-branch=main"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "Test"]);
  writeFileSync(
    path.join(root, ".gitattributes"),
    `${ARTIFACT} merge=lisa-generated-artifact\n${LEDGER} merge=lisa-generated-artifact\n`
  );
  if (register) {
    git(root, [
      "config",
      "merge.lisa-generated-artifact.driver",
      `node ${DRIVER} --base %O --ours %A --theirs %B --path %P`,
    ]);
  }
  const base = {
    manifest: manifest([[ONE, ONE_HASH]], [ONE]),
    ledger: ledger([[ONE_LEDGER, [ONE_HASH]]]),
  };
  writeArtifacts(root, base);
  git(root, ["add", "-A"]);
  git(root, ["commit", "-m", "base"]);

  git(root, ["checkout", "-b", "alpha"]);
  writeArtifacts(root, {
    manifest: manifest(
      [
        [ALPHA, ALPHA_HASH],
        [ONE, ONE_HASH],
      ],
      [ALPHA, ONE]
    ),
    ledger: ledger([
      ["alpha.mjs", ["a1"]],
      [ONE_LEDGER, [ONE_HASH]],
    ]),
  });
  git(root, ["commit", "-am", "alpha"]);

  git(root, ["checkout", "main"]);
  git(root, ["checkout", "-b", "bravo"]);
  writeArtifacts(root, {
    manifest: manifest(
      [
        [BRAVO, BRAVO_HASH],
        [ONE, ONE_HASH],
      ],
      [BRAVO, ONE]
    ),
    ledger: ledger([
      ["bravo.mjs", ["b1"]],
      [ONE_LEDGER, [ONE_HASH]],
    ]),
  });
  git(root, ["commit", "-am", "bravo"]);
  git(root, ["checkout", "alpha"]);
  return root;
}

/**
 * Write both artifacts into a fixture.
 * @param root - Fixture repository path
 * @param contents - Artifact sources
 */
function writeArtifacts(
  root: string,
  contents: { manifest: string; ledger: string }
): void {
  const dir = path.join(root, GENERATED_DIR);
  boundedSpawnSync({
    label: "mkdir",
    command: "mkdir",
    args: ["-p", dir],
    cwd: root,
    env: cleanGitEnv(),
  });
  writeFileSync(path.join(root, ARTIFACT), contents.manifest);
  writeFileSync(path.join(root, LEDGER), contents.ledger);
}

/**
 * Read one artifact out of a fixture.
 * @param root - Fixture repository path
 * @param file - Repo-relative artifact path
 * @returns File contents
 */
function read(root: string, file: string): string {
  return readFileSync(path.join(root, file), "utf8");
}

describe("lisa-generated-artifact merge driver", () => {
  const roots: string[] = [];

  afterEach(async () => {
    while (roots.length > 0) {
      await cleanupTempDir(roots.pop() as string);
    }
  });

  /**
   * Create a fixture and remember it for cleanup.
   * @param register - Whether to register the driver
   * @returns Fixture repository path
   */
  function repo(register: boolean): string {
    const root = fixture(register);
    roots.push(root);
    return root;
  }

  it("mergesWithoutDriver: the same fixtures DO conflict when the driver is unregistered", () => {
    const root = repo(false);
    const merge = git(root, ["merge", "bravo", "-m", MERGE_MESSAGE]);
    expect(merge.status).not.toBe(0);
    const unmerged = git(root, UNMERGED);
    expect(unmerged.output.trim().split("\n").sort(byText)).toEqual([
      LEDGER,
      ARTIFACT,
    ]);
    expect(read(root, ARTIFACT)).toContain(CONFLICT_FENCE);
  });

  it("mergesCleanly: a mechanical regeneration conflict merges with no human choice", () => {
    const root = repo(true);
    const merge = git(root, ["merge", "bravo", "-m", MERGE_MESSAGE]);
    expect(merge.status).toBe(0);
    expect(git(root, UNMERGED).output.trim()).toBe("");
  });

  it("mergedResultIsCorrect: the merged artifact carries BOTH sides' entries and no markers", () => {
    const root = repo(true);
    git(root, ["merge", "bravo", "-m", MERGE_MESSAGE]);
    const merged = read(root, ARTIFACT);
    expect(merged).not.toContain(CONFLICT_FENCE);
    expect(merged).toContain(
      `${JSON.stringify(ALPHA)}:\n      "${ALPHA_HASH}",`
    );
    expect(merged).toContain(
      `${JSON.stringify(BRAVO)}:\n      "${BRAVO_HASH}",`
    );
    expect(merged).toContain(`${JSON.stringify(ONE)}:\n      "${ONE_HASH}",`);
    expect(read(root, LEDGER)).toContain('"alpha.mjs": Object.freeze([');
    expect(read(root, LEDGER)).toContain('"bravo.mjs": Object.freeze([');
  });

  it("mergedResultIsSorted: entries come back in the order the generators emit", () => {
    const root = repo(true);
    git(root, ["merge", "bravo", "-m", MERGE_MESSAGE]);
    const merged = read(root, ARTIFACT);
    // The marker assertion is what makes the ordering assertions load-bearing:
    // a conflicted file also happens to list alpha before bravo before one, so
    // without this line the case passes against the unfixed state.
    expect(merged).not.toContain(CONFLICT_FENCE);
    expect(merged.indexOf(ALPHA)).toBeLessThan(merged.indexOf(BRAVO));
    expect(merged.indexOf(BRAVO)).toBeLessThan(merged.indexOf("a/one.mjs"));
  });

  it("controlUnrelatedMerge: a merge that does not touch the artifacts is unaffected", () => {
    const root = repo(true);
    git(root, ["checkout", "main"]);
    git(root, ["checkout", "-b", "docs-a"]);
    writeFileSync(path.join(root, "a.txt"), "a\n");
    git(root, ["add", "-A"]);
    git(root, ["commit", "-m", "a"]);
    git(root, ["checkout", "main"]);
    git(root, ["checkout", "-b", "docs-b"]);
    writeFileSync(path.join(root, "b.txt"), "b\n");
    git(root, ["add", "-A"]);
    git(root, ["commit", "-m", "b"]);
    git(root, ["checkout", "docs-a"]);
    expect(git(root, ["merge", "docs-b", "-m", MERGE_MESSAGE]).status).toBe(0);
    expect(read(root, ARTIFACT)).toContain('"a/one.mjs"');
  });

  it("controlHandEdit: a one-sided human edit to the artifact survives the merge", () => {
    const root = repo(true);
    git(root, ["checkout", "bravo"]);
    writeFileSync(
      path.join(root, ARTIFACT),
      read(root, ARTIFACT).replace(
        "/** Generated. Do not edit. */",
        "/** Generated. Do not edit. */\n/* HAND EDIT */"
      )
    );
    git(root, ["commit", "-am", "hand edit"]);
    git(root, ["checkout", "alpha"]);
    expect(git(root, ["merge", "bravo", "-m", MERGE_MESSAGE]).status).toBe(0);
    const merged = read(root, ARTIFACT);
    expect(merged).toContain("/* HAND EDIT */");
    expect(merged).toContain(JSON.stringify(ALPHA));
    expect(merged).toContain(JSON.stringify(BRAVO));
  });

  it("controlGenuineConflict: both sides changing one key's value still conflicts", () => {
    const root = repo(true);
    for (const [branch, hash] of [
      ["charlie", "c1"],
      ["delta", "d1"],
    ] as const) {
      git(root, ["checkout", "main"]);
      git(root, ["checkout", "-b", branch]);
      writeArtifacts(root, {
        manifest: manifest([["a/one.mjs", hash]], [ONE]),
        ledger: ledger([[ONE_LEDGER, [ONE_HASH, hash]]]),
      });
      git(root, ["commit", "-am", branch]);
    }
    git(root, ["checkout", "charlie"]);
    const merge = git(root, ["merge", "delta", "-m", MERGE_MESSAGE]);
    expect(merge.status).not.toBe(0);
    expect(merge.output).toContain("could not be merged mechanically");
    expect(git(root, UNMERGED).output).toContain(ARTIFACT);
  });

  it("controlAppendOnlyUnion: both sides appending to one ledger entry unions", () => {
    const root = repo(true);
    for (const [branch, hash] of [
      ["echo", "e1"],
      ["foxtrot", "f1"],
    ] as const) {
      git(root, ["checkout", "main"]);
      git(root, ["checkout", "-b", branch]);
      writeFileSync(
        path.join(root, LEDGER),
        ledger([[ONE_LEDGER, [ONE_HASH, hash].sort(byText)]])
      );
      git(root, ["commit", "-am", branch]);
    }
    git(root, ["checkout", "echo"]);
    expect(git(root, ["merge", "foxtrot", "-m", MERGE_MESSAGE]).status).toBe(0);
    const merged = read(root, LEDGER);
    expect(merged).toContain('"aa",');
    expect(merged).toContain('"e1",');
    expect(merged).toContain('"f1",');
  });

  it("roundTripsTheRealArtifacts: parse then render is the identity on both checked-in files", () => {
    for (const file of [
      "src/core/upstream-evidence-manifest.ts",
      "src/core/lisa-owned-hash-ledger.ts",
    ]) {
      const text = readFileSync(path.resolve(file), "utf8");
      const parsed = parseArtifact(text);
      expect(parsed.ok).toBe(true);
      expect(renderArtifact(parsed.chunks)).toBe(text);
    }
  });

  it("refusesAnUnparseableSide rather than rewriting it", () => {
    const result = mergeGeneratedArtifact(
      manifest([[ONE, ONE_HASH]], [ONE]),
      manifest([[ONE, ONE_HASH]], [ONE]),
      "totally unrelated file contents\n"
    );
    expect(result.ok).toBe(false);
  });
});
