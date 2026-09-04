/**
 * Same-entry resolution for the upstream evidence manifest
 * (CodySwannGT/lisa#3822).
 *
 * ## What is under test
 *
 * The manifest records a whole file as ONE line — a path and a content hash —
 * so two branches editing the same source file always rewrite the same line,
 * whether or not the edits themselves conflict. Measured on the real
 * repository: two branches editing different regions of one hook script
 * auto-merge with both edits present, and the manifest is the ONLY conflicting
 * path. The `lisa-generated-artifact` driver used to conflict there, so a
 * derived file turned a clean merge into a failed one.
 *
 * It now resolves that case to our side for the manifest, and for the manifest
 * only. The resolved file is stale on purpose — no side is right, because the
 * merged tree holds bytes neither side hashed — and the driver says so.
 *
 * ## Why these run a real `git merge`
 *
 * The behaviour is a property of git plus `.gitattributes` plus a registered
 * driver command, not of a string. `conflictsWithoutTheDriver` is the negative
 * control that gives the rest their meaning: the SAME fixture conflicts when
 * the driver is unregistered, so a passing suite cannot be explained by a
 * fixture that never collided.
 *
 * `ledgerNonAppendStillConflicts` is the scope control. The hash ledger was in
 * 0 of 7 measured conflicts and needs nothing; a case that resolves for the
 * manifest must still conflict for it.
 *
 * Per the Test Isolation house rule, expected values are HARDCODED.
 * @module tests/unit/scripts/merge-generated-artifact-derived-entries
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { afterEach, describe, expect, it } from "vitest";

import {
  DERIVED_ENTRY_RESOLUTION_PATHS,
  describeResolved,
  mergeGeneratedArtifact,
  resolvesDerivedEntries,
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

/** The real manifest path, which is what the resolution is scoped to. */
const MANIFEST = "src/core/upstream-evidence-manifest.ts";
/** The real ledger path, deliberately NOT scoped to the resolution. */
const LEDGER = "src/core/lisa-owned-hash-ledger.ts";
/** A source file both branches edit, exactly as two agents would. */
const SHARED = "all/copy-overwrite/scripts/lib/kill-marks.mjs";
const BASE_HASH = "0000";
const OUR_HASH = "aaaa";
const THEIR_HASH = "bbbb";
const MERGE_MESSAGE = "merge";
const CONFLICT_FENCE = "<<<<<<<";
const UNMERGED = ["diff", "--name-only", "--diff-filter=U"] as const;

/**
 * A manifest-shaped artifact: one block of `path: hash` entries.
 * @param hash - Hash recorded for the shared source file
 * @returns Artifact source
 */
function manifest(hash: string): string {
  return `/** Generated. Do not edit. */
export const UPSTREAM_EVIDENCE_MANIFEST: Readonly<Record<string, string>> =
  Object.freeze({
    ${JSON.stringify(SHARED)}:
      "${hash}",
  });
`;
}

/**
 * A ledger-shaped artifact: one block of append-only array entries.
 * @param hashes - Hashes recorded for the shared source file
 * @returns Artifact source
 */
function ledger(hashes: readonly string[]): string {
  const items = hashes.map(hash => `    "${hash}",`).join("\n");
  return `/** Generated. Do not edit. */
export const LEDGER: Readonly<Record<string, readonly string[]>> = Object.freeze({
  ${JSON.stringify(SHARED)}: Object.freeze([
${items}
  ]),
});
`;
}

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
 * Write one file, creating its directory.
 * @param root - Fixture repository path
 * @param file - Repo-relative path
 * @param contents - File contents
 */
function write(root: string, file: string, contents: string): void {
  const full = path.join(root, file);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, contents);
}

/**
 * Read one file out of a fixture.
 * @param root - Fixture repository path
 * @param file - Repo-relative path
 * @returns File contents
 */
function read(root: string, file: string): string {
  return readFileSync(path.join(root, file), "utf8");
}

/** One side of a fixture: what that branch writes into each artifact. */
interface Side {
  readonly branch: string;
  readonly manifestHash: string;
  readonly ledgerHashes: readonly string[];
}

/**
 * Build a repository whose two branches change the SAME entry in both
 * artifacts, the way two agents editing one source file do.
 * @param register - Whether to register the driver command locally
 * @param sides - What each branch writes
 * @returns Fixture repository path
 */
function fixture(
  register: boolean,
  sides: readonly [Side, Side]
): { root: string } {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-3822-"));
  git(root, ["init", "--initial-branch=main"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "Test"]);
  write(
    root,
    ".gitattributes",
    `${MANIFEST} merge=lisa-generated-artifact\n${LEDGER} merge=lisa-generated-artifact\n`
  );
  if (register) {
    git(root, [
      "config",
      "merge.lisa-generated-artifact.driver",
      `node ${DRIVER} --base %O --ours %A --theirs %B --path %P`,
    ]);
  }
  write(root, SHARED, "// base\n");
  write(root, MANIFEST, manifest(BASE_HASH));
  write(root, LEDGER, ledger([BASE_HASH]));
  git(root, ["add", "-A"]);
  git(root, ["commit", "-m", "base"]);
  for (const side of sides) {
    git(root, ["checkout", "main"]);
    git(root, ["checkout", "-b", side.branch]);
    write(root, MANIFEST, manifest(side.manifestHash));
    write(root, LEDGER, ledger(side.ledgerHashes));
    git(root, ["commit", "-am", side.branch]);
  }
  git(root, ["checkout", sides[0].branch]);
  return { root };
}

/** Both branches append their own hash — the ledger's ordinary shape. */
const APPENDING: readonly [Side, Side] = [
  {
    branch: "lane-a",
    manifestHash: OUR_HASH,
    ledgerHashes: [BASE_HASH, OUR_HASH],
  },
  {
    branch: "lane-b",
    manifestHash: THEIR_HASH,
    ledgerHashes: [BASE_HASH, THEIR_HASH],
  },
];

/** Both branches drop the base hash — not an append, so not unionable. */
const REPLACING: readonly [Side, Side] = [
  { branch: "lane-a", manifestHash: OUR_HASH, ledgerHashes: [OUR_HASH] },
  { branch: "lane-b", manifestHash: THEIR_HASH, ledgerHashes: [THEIR_HASH] },
];

describe("manifest same-entry resolution", () => {
  const roots: string[] = [];

  afterEach(async () => {
    while (roots.length > 0) {
      await cleanupTempDir(roots.pop() as string);
    }
  });

  /**
   * Create a fixture and remember it for cleanup.
   * @param register - Whether to register the driver
   * @param sides - What each branch writes
   * @returns Fixture repository path
   */
  function repo(register: boolean, sides: readonly [Side, Side]): string {
    const { root } = fixture(register, sides);
    roots.push(root);
    return root;
  }

  it("conflictsWithoutTheDriver: the same fixture DOES conflict unregistered", () => {
    const root = repo(false, APPENDING);
    const merge = git(root, ["merge", "lane-b", "-m", MERGE_MESSAGE]);
    expect(merge.status).not.toBe(0);
    expect(git(root, UNMERGED).output).toContain(MANIFEST);
    expect(read(root, MANIFEST)).toContain(CONFLICT_FENCE);
  });

  it("mergesWithoutHumanIntervention when both sides rewrote one entry", () => {
    const root = repo(true, APPENDING);
    const merge = git(root, ["merge", "lane-b", "-m", MERGE_MESSAGE]);
    expect(merge.status).toBe(0);
    expect(git(root, UNMERGED).output.trim()).toBe("");
    expect(read(root, MANIFEST)).not.toContain(CONFLICT_FENCE);
  });

  it("keepsExactlyOneLinePerPath, never both sides' hashes", () => {
    const root = repo(true, APPENDING);
    // Asserting the status too is what makes the rest load-bearing: a driver
    // that REFUSES leaves `--ours` untouched, so the file on disk is already a
    // single clean line with our hash. Without this line the case passes
    // against the unfixed state.
    expect(git(root, ["merge", "lane-b", "-m", MERGE_MESSAGE]).status).toBe(0);
    const merged = read(root, MANIFEST);
    expect(merged).toContain(`"${OUR_HASH}",`);
    expect(merged).not.toContain(`"${THEIR_HASH}",`);
    expect(
      merged.split("\n").filter(line => line.includes(SHARED))
    ).toHaveLength(1);
  });

  it("saysTheArtifactIsStale and names the regeneration command", () => {
    const root = repo(true, APPENDING);
    const merge = git(root, ["merge", "lane-b", "-m", MERGE_MESSAGE]);
    expect(merge.output).toContain("STALE on purpose");
    expect(merge.output).toContain("bun run build:upstream-evidence-manifest");
  });

  it("ledgerAppendsStillUnion, exactly as they did before", () => {
    const root = repo(true, APPENDING);
    git(root, ["merge", "lane-b", "-m", MERGE_MESSAGE]);
    const merged = read(root, LEDGER);
    expect(merged).toContain(`"${BASE_HASH}",`);
    expect(merged).toContain(`"${OUR_HASH}",`);
    expect(merged).toContain(`"${THEIR_HASH}",`);
  });

  it("ledgerNonAppendStillConflicts: the resolution did not leak to the ledger", () => {
    const root = repo(true, REPLACING);
    const merge = git(root, ["merge", "lane-b", "-m", MERGE_MESSAGE]);
    expect(merge.status).not.toBe(0);
    expect(merge.output).toContain("could not be merged mechanically");
    expect(git(root, UNMERGED).output).toContain(LEDGER);
  });
});

describe("which artifacts resolve a contested entry", () => {
  it("scopes the resolution to the manifest alone", () => {
    expect(resolvesDerivedEntries(MANIFEST)).toBe(true);
    expect(resolvesDerivedEntries(LEDGER)).toBe(false);
    expect([...DERIVED_ENTRY_RESOLUTION_PATHS]).toEqual([
      "src/core/upstream-evidence-manifest.ts",
    ]);
  });

  it("is strict when git supplied no path at all", () => {
    expect(resolvesDerivedEntries(undefined)).toBe(false);
    const result = mergeGeneratedArtifact(
      manifest(BASE_HASH),
      manifest(OUR_HASH),
      manifest(THEIR_HASH)
    );
    expect(result.ok).toBe(false);
  });

  it("reports which entries it took a side on", () => {
    const result = mergeGeneratedArtifact(
      manifest(BASE_HASH),
      manifest(OUR_HASH),
      manifest(THEIR_HASH),
      MANIFEST
    );
    expect(result.ok).toBe(true);
    expect(result.resolved).toEqual([SHARED]);
    expect(result.text).toContain(`"${OUR_HASH}",`);
  });

  it("tries the append-only union FIRST, even in a resolving artifact", () => {
    // Order matters and no git-level case can show it: the manifest has no
    // array-valued entries today, and the ledger never resolves. Asserted
    // directly so that resolving before unioning — which would silently drop
    // one side's appended element — cannot pass.
    const result = mergeGeneratedArtifact(
      ledger([BASE_HASH]),
      ledger([BASE_HASH, OUR_HASH]),
      ledger([BASE_HASH, THEIR_HASH]),
      MANIFEST
    );
    expect(result.ok).toBe(true);
    expect(result.resolved).toEqual([]);
    expect(result.text).toContain(`"${OUR_HASH}",`);
    expect(result.text).toContain(`"${THEIR_HASH}",`);
  });

  it("reports nothing when every entry merged on its own", () => {
    const result = mergeGeneratedArtifact(
      manifest(BASE_HASH),
      manifest(OUR_HASH),
      manifest(BASE_HASH),
      MANIFEST
    );
    expect(result.ok).toBe(true);
    expect(result.resolved).toEqual([]);
  });

  it("still conflicts when one side DELETED the entry the other changed", () => {
    const result = mergeGeneratedArtifact(
      manifest(BASE_HASH),
      manifest(OUR_HASH),
      `/** Generated. Do not edit. */
export const UPSTREAM_EVIDENCE_MANIFEST: Readonly<Record<string, string>> =
  Object.freeze({
    "all/other.mjs":
      "cccc",
  });
`,
      MANIFEST
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("in incompatible ways");
  });
});

describe("the notice a resolved merge prints", () => {
  const ONE = "all/one.mjs";

  it("names every contested entry when there are few", () => {
    const notice = describeResolved(MANIFEST, [ONE, "all/two.mjs"]);
    expect(notice).toContain("2 entries changed on both sides");
    expect(notice).toContain("all/one.mjs, all/two.mjs");
  });

  it("summarises the tail when there are many", () => {
    const notice = describeResolved(MANIFEST, [
      ONE,
      "all/two.mjs",
      "all/three.mjs",
      "all/four.mjs",
      "all/five.mjs",
    ]);
    expect(notice).toContain("and 2 more");
  });

  it("uses the singular for one entry", () => {
    expect(describeResolved(MANIFEST, [ONE])).toContain(
      "1 entry changed on both sides"
    );
  });
});
